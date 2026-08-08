// Real-browser smoke test: loads the unpacked extension into Chromium and
// exercises the reliability paths that unit tests cannot reach — debugger
// attach/adopt, request interception, worker restart, and attach failures.
//
// Usage: npm run smoke   (downloads Chromium on first run via playwright)
//
// The popup is driven as a regular tab. Because its getActiveTab() resolves
// the active tab of its own window, the site tab is kept active and a focus
// event is dispatched so the API-stream port subscribes against the site tab.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const EXT_PATH = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const WORK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'network-overrides-smoke-'));
const PROFILE = path.join(WORK_DIR, 'profile');
console.log('screenshots + profile in', WORK_DIR);

const results = [];
function report(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/users')) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end('{"real":true}');
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!doctype html><title>smoke</title><h1>smoke page</h1>');
});
await new Promise(resolve => server.listen(0, resolve));
const PORT = server.address().port;

const context = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1100, height: 800 },
  args: [`--disable-extensions-except=${EXT_PATH}`, `--load-extension=${EXT_PATH}`],
});

try {
  // ---- extension id from its service worker
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = new URL(sw.url()).host;

  // ---- open site tab (active) and popup as a background tab in the same window
  const site = context.pages()[0] ?? (await context.newPage());
  await site.goto(`http://127.0.0.1:${PORT}/`);
  const popup = await context.newPage();
  // Approximate Chrome's action-popup viewport instead of testing the popup
  // with the much larger regular-tab viewport from the browser context.
  await popup.setViewportSize({ width: 400, height: 480 });
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await site.bringToFront(); // popup's getActiveTab() must resolve to the site tab
  // The popup subscribed its API-stream port while it was itself the active tab;
  // fire a focus event so startApiStream re-subscribes against the site tab.
  await popup.evaluate(() => window.dispatchEvent(new Event('focus')));
  await popup.waitForTimeout(500);

  // The #enable input is visually hidden behind the switch slider; toggle via the slider.
  async function setEnable(want) {
    const checked = await popup.locator('#enable').isChecked();
    if (checked !== want) await popup.click('.switch-slider');
  }

  // ---- 1. enable -> debugger attaches -> green status line
  await setEnable(true);
  let statusText = '';
  for (let i = 0; i < 20; i++) {
    statusText = (await popup.textContent('#attach-status'))?.trim() ?? '';
    if (statusText) break;
    await popup.waitForTimeout(500);
  }
  report(
    'attach status shows green "Intercepting requests"',
    statusText === 'Intercepting requests',
    statusText || '(empty)'
  );
  await popup.screenshot({ path: path.join(WORK_DIR, '1-attach-status.png') });

  // ---- 2. fetch is captured and listed in the popup
  const real = await site.evaluate(
    u => fetch(u).then(r => r.text()),
    `http://127.0.0.1:${PORT}/api/users`
  );
  report('unoverridden fetch returns the real body', real === '{"real":true}', real);
  await popup.click('#refresh-apis');
  await popup.waitForTimeout(1500);
  const apiItem = popup.locator('li.api-item', { hasText: '/api/users' }).first();
  const captured = (await apiItem.count()) > 0;
  report('request appears in the captured APIs list', captured);
  await popup.screenshot({ path: path.join(WORK_DIR, '2-captured.png') });

  // ---- 3. create an override rule through the modal, verify the response is mocked
  if (captured) {
    await apiItem.click();
    await popup.waitForSelector('#override-modal', { state: 'visible' });
    const modalLayout = await popup.evaluate(() => {
      const content = document.querySelector('#override-modal .modal-content--override');
      const body = document.querySelector('#override-modal .modal-scroll-body');
      const footer = document.querySelector('#override-modal .modal-footer');
      const contentRect = content.getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      return {
        withinViewport: contentRect.top >= 0 && contentRect.bottom <= window.innerHeight,
        footerVisible: footerRect.top >= contentRect.top && footerRect.bottom <= contentRect.bottom,
        bodyOverflow: getComputedStyle(body).overflowY,
      };
    });
    report(
      'override modal stays within the popup viewport',
      modalLayout.withinViewport,
      JSON.stringify(modalLayout)
    );
    report(
      'override modal keeps the Save footer outside the scroll body',
      modalLayout.footerVisible && modalLayout.bodyOverflow === 'auto',
      JSON.stringify(modalLayout)
    );
    await popup.fill('#modal-body', '{"mocked":true}');
    await popup.click('#save-override');
    await popup.waitForSelector('#override-modal', { state: 'hidden' });
    const saveNotice =
      (await popup.locator('.notification-toast--success').last().textContent())?.trim() || '';
    report(
      'successful Save confirms storage and background application',
      /saved and applied to the active tab/i.test(saveNotice),
      saveNotice
    );
    await popup.waitForTimeout(1000);
    const mocked = await site.evaluate(
      u => fetch(u).then(r => r.text()),
      `http://127.0.0.1:${PORT}/api/users`
    );
    report('override rule mocks the response body', mocked === '{"mocked":true}', mocked);
    const header = await site.evaluate(
      u => fetch(u).then(r => r.headers.get('x-network-overrides')),
      `http://127.0.0.1:${PORT}/api/users`
    );
    report('mocked response carries x-network-overrides header', header === 'true', String(header));

    // ---- 3b. status override: edit the same rule to force status 500
    // Saving the override in step 3 moved /api/users from the "Captured APIs"
    // tab into the "Overridden" tab, so switch tabs before re-locating it.
    await popup.click('button.tab-btn[data-tab="overridden"]');
    await apiItem.click();
    await popup.waitForSelector('#override-modal', { state: 'visible' });
    await popup.fill('#modal-status', '500');
    // Reopening the modal pretty-prints the JSON body for display; refill it
    // compact so the later worker-restart check's exact body match still holds.
    await popup.fill('#modal-body', '{"mocked":true}');
    await popup.click('#save-override');
    await popup.waitForSelector('#override-modal', { state: 'hidden' });
    await popup.waitForTimeout(1000);
    const mockedStatus = await site.evaluate(
      u => fetch(u).then(r => r.status),
      `http://127.0.0.1:${PORT}/api/users`
    );
    report(
      'status override makes fetch observe the mocked status',
      mockedStatus === 500,
      String(mockedStatus)
    );

    // ---- 3c. fail rule: a fresh rule makes fetch reject at the network layer
    if (await popup.locator('#override-modal').isVisible()) {
      await popup.click('#override-modal .modal-close');
      await popup.waitForSelector('#override-modal', { state: 'hidden' });
    }
    await popup.click('#add-api-btn');
    await popup.waitForSelector('#override-modal', { state: 'visible' });
    await popup.fill('#modal-pattern', 'api/fail');
    await popup.check('input[name="modal-override-type"][value="fail"]');
    await popup.click('#save-override');
    await popup.waitForSelector('#override-modal', { state: 'hidden' });
    await popup.waitForTimeout(1000);
    const failOutcome = await site.evaluate(
      u =>
        fetch(u).then(
          () => 'resolved',
          () => 'rejected'
        ),
      `http://127.0.0.1:${PORT}/api/fail`
    );
    report(
      'fail rule makes fetch reject at the network layer',
      failOutcome === 'rejected',
      failOutcome
    );
  }

  // ---- 4. force-stop the service worker, wake it, confirm re-attach + rules survive
  const swInternals = await context.newPage();
  await swInternals.goto('chrome://serviceworker-internals/');
  await swInternals.waitForTimeout(1000);
  let stopped = false;
  const stopBtn = swInternals
    .locator(
      `xpath=//*[contains(text(), '${extId}')]/ancestor::*[.//button][1]//button[normalize-space()='Stop']`
    )
    .first();
  if ((await stopBtn.count()) > 0) {
    await stopBtn.click();
    stopped = true;
  } else {
    const anyStop = swInternals.getByRole('button', { name: 'Stop' });
    if ((await anyStop.count()) === 1) {
      await anyStop.click(); // only our extension is loaded, so the single worker is ours
      stopped = true;
    }
  }
  await swInternals.close();
  if (!stopped) {
    report(
      'worker restart test',
      false,
      'could not find Stop control on chrome://serviceworker-internals (skipped)'
    );
  } else {
    await site.bringToFront();
    await site.waitForTimeout(1500);
    // wake the worker via a tab event (reload fires tabs.onUpdated) -> rehydrate + re-attach
    await site.reload();
    await site.waitForTimeout(2500);
    const afterRestart = await site.evaluate(
      u => fetch(u).then(r => r.text()),
      `http://127.0.0.1:${PORT}/api/users`
    );
    report(
      'after worker restart the override still applies (rehydrate + re-attach)',
      afterRestart === '{"mocked":true}',
      afterRestart
    );
  }

  // ---- 5. cross-origin navigation: rules switch to the new origin, captures reset
  await site.goto(`http://localhost:${PORT}/`); // different origin, same server
  await site.waitForTimeout(1500);
  const otherOrigin = await site.evaluate(
    u => fetch(u).then(r => r.text()),
    `http://localhost:${PORT}/api/users`
  );
  report(
    'after navigating to a new origin the old rule no longer applies',
    otherOrigin === '{"real":true}',
    otherOrigin
  );
  if (await popup.locator('#override-modal').isVisible()) {
    await popup.click('#override-modal .modal-close');
    await popup.waitForSelector('#override-modal', { state: 'hidden' });
  }
  await popup.click('#refresh-apis');
  await popup.waitForTimeout(1500);
  const staleItems = await popup.locator('li.api-item', { hasText: '127.0.0.1' }).count();
  report(
    'captured APIs from the old origin were cleared',
    staleItems === 0,
    `${staleItems} stale item(s)`
  );

  // ---- 6. attach failure: enable on a chrome:// tab -> red status, toggle unchecks
  await site.goto('chrome://version/');
  await site.waitForTimeout(500);
  await setEnable(false);
  await popup.waitForTimeout(500);
  await setEnable(true);
  // The cross-scheme navigation itself may already have painted a red detach
  // status, so wait for the toggle to uncheck — that only happens once the new
  // attach attempt fails.
  let failText = '';
  let unchecked = false;
  for (let i = 0; i < 20; i++) {
    unchecked = !(await popup.isChecked('#enable'));
    failText = (await popup.textContent('#attach-status'))?.trim() ?? '';
    if (unchecked && failText.startsWith('Attach failed:')) break;
    await popup.waitForTimeout(500);
  }
  report(
    'attach failure shows red status line',
    failText.startsWith('Attach failed:'),
    failText || '(empty)'
  );
  report('attach failure unchecks the enable toggle', unchecked);
  await popup.screenshot({ path: path.join(WORK_DIR, '3-attach-failed.png') });
} finally {
  await context.close();
  server.close();
}

const failed = results.filter(result => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
