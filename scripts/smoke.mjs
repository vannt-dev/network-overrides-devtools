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

// SMOKE_EXT_PATH runs the checks against another build, e.g. the unzipped Store package.
const EXT_PATH = process.env.SMOKE_EXT_PATH
  ? path.resolve(process.env.SMOKE_EXT_PATH)
  : path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const WORK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'network-overrides-smoke-'));
const PROFILE = path.join(WORK_DIR, 'profile');
console.log('screenshots + profile in', WORK_DIR);

const results = [];
// The rule editor keeps everything but the everyday fields in a collapsed
// Advanced section; open it and one of its groups, as a user would.
async function openEditorGroup(page, groupId) {
  for (const id of ['modal-advanced-fields', groupId]) {
    const isOpen = await page.locator(`#${id}`).evaluate(details => details.open);
    if (!isOpen) await page.click(`#${id} > summary`);
  }
}

function report(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const server = http.createServer((req, res) => {
  if (
    req.url.startsWith('/api/users') ||
    req.url.startsWith('/api/script') ||
    req.url.startsWith('/api/cond')
  ) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end('{"real":true}');
    return;
  }
  if (req.url.startsWith('/api/patch')) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'X-Real': 'yes' });
    res.end(
      '{"data":{"user":{"plan":"free","name":"Ann"},"ads":[1,2],"items":[{"id":1},{"id":2}]}}'
    );
    return;
  }
  if (req.url.startsWith('/api/headers')) {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'max-age=3600',
      ETag: '"v1"',
      'X-Real': 'yes',
    });
    res.end('{"real":"headers"}');
    return;
  }
  if (req.url.startsWith('/headers/csp.html')) {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "script-src 'self'",
    });
    res.end(
      '<!doctype html><html><head><title>csp</title></head><body><p id="p">real page</p>' +
        '<script>window.PAGE_INLINE = true;</script></body></html>'
    );
    return;
  }
  if (req.url.startsWith('/api/notjson')) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('plain text, not JSON');
    return;
  }
  if (req.url.startsWith('/static/')) {
    const cache = { 'Cache-Control': 'max-age=3600' };
    if (req.url.startsWith('/static/page.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<!doctype html><html><head><title>static</title>' +
          '<link rel="stylesheet" href="/static/style.css"></head><body><h1 id="h">static page</h1>' +
          '<img id="logo" src="/static/logo.png">' +
          '<script src="/static/app.js"></script><script src="/static/missing.js"></script>' +
          '</body></html>'
      );
      return;
    }
    if (req.url.startsWith('/static/csp.html') || req.url.startsWith('/static/sandbox.html')) {
      const sandbox = req.url.startsWith('/static/sandbox.html');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': sandbox
          ? 'sandbox allow-same-origin'
          : "script-src 'self'; style-src 'self'",
      });
      // The page's own inline script must stay blocked by its CSP.
      res.end(
        '<!doctype html><html><head><title>csp</title></head><body><p id="p">csp</p>' +
          '<script>window.PAGE_INLINE = true;</script></body></html>'
      );
      return;
    }
    if (req.url.startsWith('/static/app.js')) {
      res.writeHead(200, { 'Content-Type': 'text/javascript', ...cache });
      res.end('window.APP = "original";');
      return;
    }
    if (req.url.startsWith('/static/style.css')) {
      res.writeHead(200, { 'Content-Type': 'text/css', ...cache });
      res.end('#h { color: rgb(0, 0, 255); }');
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
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
    if (statusText === 'Intercepting requests' || statusText.startsWith('Attach failed:')) break;
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

  // ---- 2b. the captured list exports as a HAR file with the real response body
  if (captured) {
    const downloadPromise = popup.waitForEvent('download', { timeout: 10000 });
    await popup.click('#export-har-btn');
    const download = await downloadPromise.catch(() => null);
    let harEntry = null;
    if (download) {
      const har = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
      harEntry = har.log.entries.find(entry => entry.request.url.endsWith('/api/users')) ?? null;
    }
    report(
      'Export HAR downloads a .har file holding the captured request and its body',
      Boolean(download?.suggestedFilename().endsWith('.har')) &&
        harEntry?.response.status === 200 &&
        harEntry?.response.content.text === '{"real":true}',
      download ? JSON.stringify(harEntry?.response.content ?? null) : 'no download'
    );
  }

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

    // ---- 3a. the rule's hit badge counts the request it answered, and a
    // request no rule matches leaves it alone. The count reaches the popup in
    // a throttled message, so it is polled for.
    const hitBadge = popup.locator('#list .rule-hits').first();
    const hitCount = async () => ((await hitBadge.textContent()) ?? '').trim();
    let hitsAfterMatch = '';
    for (let i = 0; i < 20; i++) {
      hitsAfterMatch = await hitCount();
      if (hitsAfterMatch === '1') break;
      await popup.waitForTimeout(250);
    }
    const hitTitle = (await hitBadge.getAttribute('title')) ?? '';
    report(
      'a matching request raises the hit count of its rule',
      hitsAfterMatch === '1' && hitTitle.includes('/api/users'),
      JSON.stringify({ count: hitsAfterMatch, title: hitTitle })
    );
    await site.evaluate(u => fetch(u).then(r => r.text()), `http://127.0.0.1:${PORT}/api/other`);
    await popup.waitForTimeout(1000);
    const hitsAfterMiss = await hitCount();
    report(
      'a request no rule matches leaves the hit count alone',
      hitsAfterMiss === '1',
      hitsAfterMiss
    );
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

    // ---- 3d. script rule: the response is computed in the page, from the
    // request and the real response, while the request is held.
    async function addScriptRule(pattern, script) {
      await popup.click('#add-api-btn');
      await popup.waitForSelector('#override-modal', { state: 'visible' });
      await popup.fill('#modal-pattern', pattern);
      await popup.check('input[name="modal-override-type"][value="body"]');
      await openEditorGroup(popup, 'modal-group-body-type');
      await popup.selectOption('#modal-mode', 'script');
      await popup.fill('#modal-body', script);
      await popup.click('#save-override');
      await popup.waitForSelector('#override-modal', { state: 'hidden' });
      await popup.waitForTimeout(1000);
    }
    await addScriptRule(
      'api/script',
      `const original = JSON.parse(request.response.body);
return {
  status: 201,
  headers: { 'X-Script': document.title },
  body: { real: original.real, q: request.query.q, method: request.method },
};`
    );
    const scripted = await site.evaluate(
      u =>
        fetch(u, { method: 'POST', body: 'x' }).then(async r => ({
          status: r.status,
          header: r.headers.get('x-script'),
          body: await r.text(),
        })),
      `http://127.0.0.1:${PORT}/api/script?q=hello`
    );
    report(
      'script rule answers with what the script returned',
      scripted.status === 201 &&
        scripted.header === 'smoke' &&
        scripted.body === '{"real":true,"q":"hello","method":"POST"}',
      JSON.stringify(scripted)
    );

    await addScriptRule('api/boom', `throw new Error('boom');`);
    const failedScript = await site.evaluate(
      u =>
        fetch(u).then(async r => ({
          status: r.status,
          header: r.headers.get('x-network-overrides-error'),
          body: await r.text(),
        })),
      `http://127.0.0.1:${PORT}/api/boom`
    );
    report(
      'a script that throws is answered with a 500 naming the error',
      failedScript.status === 500 &&
        failedScript.header === 'script' &&
        failedScript.body.includes('Error: boom'),
      JSON.stringify(failedScript)
    );
    // ---- 3e. a body rule set to answer without calling the server is
    // fulfilled before the request leaves the browser, so a host nothing
    // listens on still gets the mock.
    await popup.click('#add-api-btn');
    await popup.waitForSelector('#override-modal', { state: 'visible' });
    await popup.fill('#modal-pattern', '127.0.0.1:1/api/offline');
    await popup.check('input[name="modal-override-type"][value="body"]');
    await openEditorGroup(popup, 'modal-group-body-type');
    await popup.selectOption('#modal-mode', 'text');
    await popup.fill('#modal-body', '{"offline":"{{$queryParam(q)}}"}');
    await popup.fill('#modal-status', '201');
    await openEditorGroup(popup, 'modal-group-timing');
    await popup.check('#modal-respond-at-request');
    await popup.click('#save-override');
    await popup.waitForSelector('#override-modal', { state: 'hidden' });
    await popup.waitForTimeout(1000);
    const offline = await site.evaluate(
      u =>
        fetch(u, { method: 'POST', body: 'x' }).then(
          async r => ({ status: r.status, body: await r.text() }),
          error => ({ error: String(error) })
        ),
      'http://127.0.0.1:1/api/offline?q=hi'
    );
    report(
      'a rule answering without the server mocks a host nothing listens on',
      offline.status === 201 && offline.body === '{"offline":"hi"}',
      JSON.stringify(offline)
    );
    const preflighted = await site.evaluate(
      u =>
        fetch(u, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        }).then(
          async r => ({ status: r.status, body: await r.text() }),
          error => ({ error: String(error) })
        ),
      'http://127.0.0.1:1/api/offline?q=pre'
    );
    report(
      'a preflighted cross-origin request is mocked with no CORS headers on the rule',
      preflighted.status === 201 && preflighted.body === '{"offline":"pre"}',
      JSON.stringify(preflighted)
    );

    // {{$jwt}} gives a well-formed token whose payload holds the claims.
    await popup.click('#add-api-btn');
    await popup.waitForSelector('#override-modal', { state: 'visible' });
    await popup.fill('#modal-pattern', '127.0.0.1:1/api/jwt');
    await popup.check('input[name="modal-override-type"][value="body"]');
    await openEditorGroup(popup, 'modal-group-body-type');
    await popup.selectOption('#modal-mode', 'text');
    await popup.fill('#modal-body', '{"token":"{{$jwt({\\"role\\":\\"admin\\"}, 120)}}"}');
    await openEditorGroup(popup, 'modal-group-timing');
    await popup.check('#modal-respond-at-request');
    await popup.click('#save-override');
    await popup.waitForSelector('#override-modal', { state: 'hidden' });
    await popup.waitForTimeout(1000);
    const jwt = await site.evaluate(
      u =>
        fetch(u).then(
          async r => {
            const token = JSON.parse(await r.text()).token;
            const part = text => JSON.parse(atob(text.replace(/-/g, '+').replace(/_/g, '/')));
            const [header, payload, signature] = token.split('.');
            return {
              token,
              header: part(header),
              payload: part(payload),
              signature: signature.length,
            };
          },
          error => ({ error: String(error) })
        ),
      'http://127.0.0.1:1/api/jwt'
    );
    report(
      'a {{$jwt}} body gives a well-formed token with the claims and lifetime',
      /^[\w-]+\.[\w-]+\.[\w-]+$/.test(jwt.token || '') &&
        jwt.header?.alg === 'HS256' &&
        jwt.payload?.role === 'admin' &&
        jwt.payload?.exp - jwt.payload?.iat === 120 &&
        jwt.signature === 43,
      JSON.stringify(jwt)
    );

    // An error status works on a preflighted request too: the preflight gets
    // its own 204, the request gets the 500.
    await popup.click('#add-api-btn');
    await popup.waitForSelector('#override-modal', { state: 'visible' });
    await popup.fill('#modal-pattern', '127.0.0.1:1/api/broken');
    await popup.check('input[name="modal-override-type"][value="body"]');
    await openEditorGroup(popup, 'modal-group-body-type');
    await popup.selectOption('#modal-mode', 'text');
    await popup.fill('#modal-body', '{"error":"down"}');
    await popup.fill('#modal-status', '500');
    await openEditorGroup(popup, 'modal-group-timing');
    await popup.check('#modal-respond-at-request');
    await popup.click('#save-override');
    await popup.waitForSelector('#override-modal', { state: 'hidden' });
    await popup.waitForTimeout(1000);
    const broken = await site.evaluate(
      u =>
        fetch(u, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-Trace': '1' },
          body: '{}',
        }).then(
          async r => ({ status: r.status, body: await r.text() }),
          error => ({ error: String(error) })
        ),
      'http://127.0.0.1:1/api/broken'
    );
    report(
      'a 500 mock reaches the page on a preflighted cross-origin request',
      broken.status === 500 && broken.body === '{"error":"down"}',
      JSON.stringify(broken)
    );

    // ---- 3f. query, header and body conditions narrow a rule: it applies
    // (at the response stage) only when all of them hold.
    await popup.click('#add-api-btn');
    await popup.waitForSelector('#override-modal', { state: 'visible' });
    await popup.fill('#modal-pattern', 'api/cond');
    await popup.check('input[name="modal-override-type"][value="body"]');
    await openEditorGroup(popup, 'modal-group-body-type');
    await popup.selectOption('#modal-mode', 'text');
    await popup.fill('#modal-body', '{"cond":true}');
    await openEditorGroup(popup, 'modal-match-fields');
    await popup.fill('#modal-match-query', 'page=2&debug');
    await popup.fill('#modal-match-headers', 'X-Tenant: acme');
    await popup.fill('#modal-match-body', '"plan":"pro"');
    await popup.click('#save-override');
    await popup.waitForSelector('#override-modal', { state: 'hidden' });
    await popup.waitForTimeout(1000);
    const condFetch = (query, headers, body) =>
      site.evaluate(
        ([u, h, b]) => fetch(u, { method: 'POST', headers: h, body: b }).then(r => r.text()),
        [`http://127.0.0.1:${PORT}/api/cond${query}`, headers, body]
      );
    const tenant = { 'X-Tenant': 'acme' };
    const pro = '{"plan":"pro"}';
    const conditional = {
      allHold: await condFetch('?page=2&debug', tenant, pro),
      wrongQuery: await condFetch('?page=3&debug', tenant, pro),
      noHeader: await condFetch('?page=2&debug', {}, pro),
      wrongBody: await condFetch('?page=2&debug', tenant, '{"plan":"free"}'),
    };
    report(
      'a rule with query, header and body conditions applies only when all hold',
      conditional.allHold === '{"cond":true}' &&
        conditional.wrongQuery === '{"real":true}' &&
        conditional.noHeader === '{"real":true}' &&
        conditional.wrongBody === '{"real":true}',
      JSON.stringify(conditional)
    );

    // ---- 3g. patch rule: the request reaches the server and only some fields
    // of its JSON response change; its status and headers stay.
    async function addPatchRule(pattern, operations) {
      await popup.click('#add-api-btn');
      await popup.waitForSelector('#override-modal', { state: 'visible' });
      await popup.fill('#modal-pattern', pattern);
      await popup.check('input[name="modal-override-type"][value="body"]');
      await openEditorGroup(popup, 'modal-group-body-type');
      await popup.selectOption('#modal-mode', 'patch');
      await popup.fill('#modal-body', operations);
      await popup.click('#save-override');
      await popup.waitForSelector('#override-modal', { state: 'hidden' });
      await popup.waitForTimeout(1000);
    }
    await addPatchRule(
      'api/patch',
      ['set data.user.plan = "pro"', 'remove data.ads', 'set data.items[1].id = 20'].join('\n')
    );
    const patched = await site.evaluate(
      u =>
        fetch(u).then(async r => ({
          status: r.status,
          real: r.headers.get('x-real'),
          body: await r.text(),
        })),
      `http://127.0.0.1:${PORT}/api/patch`
    );
    report(
      'patch rule changes fields of the real JSON response and keeps its status and headers',
      patched.status === 200 &&
        patched.real === 'yes' &&
        patched.body ===
          '{"data":{"user":{"plan":"pro","name":"Ann"},"items":[{"id":1},{"id":20}]}}',
      JSON.stringify(patched)
    );

    await addPatchRule('api/notjson', 'set plan = "pro"');
    const notJson = await site.evaluate(
      u => fetch(u).then(r => r.text()),
      `http://127.0.0.1:${PORT}/api/notjson`
    );
    await popup.waitForTimeout(500);
    const patchNotice =
      (await popup.locator('.notification-toast--warning').last().textContent())?.trim() || '';
    report(
      'patch rule passes a non-JSON response through unchanged and says so in the panel',
      notJson === 'plain text, not JSON' && /not JSON/.test(patchNotice),
      JSON.stringify({ notJson, patchNotice })
    );
  }

  // ---- 3h. static files: rules answer a page's script, stylesheet, image and a
  // missing file with local files; an inject rule adds JS/CSS to the page itself.
  const staticDir = path.join(WORK_DIR, 'static-files');
  fs.mkdirSync(staticDir, { recursive: true });
  const localFile = (name, content) => {
    const file = path.join(staticDir, name);
    fs.writeFileSync(file, content);
    return file;
  };
  const staticPage = name => `http://127.0.0.1:${PORT}/static/${name}`;
  const pageState = () =>
    site.evaluate(() => ({
      app: window.APP ?? null,
      missing: window.MISSING ?? null,
      injected: window.INJECTED ?? null,
      color: getComputedStyle(document.getElementById('h')).color,
      background: getComputedStyle(document.body).backgroundColor,
      logo: document.getElementById('logo').naturalWidth,
    }));
  const lastToast = async kind =>
    (await popup.locator(`.notification-toast--${kind}`).last().textContent())?.trim() || '';
  async function openNewRule(pattern, type) {
    if (await popup.locator('#override-modal').isVisible()) {
      await popup.click('#override-modal .modal-close');
      await popup.waitForSelector('#override-modal', { state: 'hidden' });
    }
    await popup.click('#add-api-btn');
    await popup.waitForSelector('#override-modal', { state: 'visible' });
    await popup.fill('#modal-pattern', pattern);
    await popup.check(`input[name="modal-override-type"][value="${type}"]`);
  }
  async function saveRule() {
    await popup.click('#save-override');
    await popup.waitForSelector('#override-modal', { state: 'hidden' });
    await popup.waitForTimeout(1000);
  }
  async function addFileRule(pattern, file) {
    await openNewRule(pattern, 'body');
    await popup.setInputFiles('#modal-body-file', file);
    await popup.waitForFunction(
      () =>
        !document.getElementById('modal-body-file').dataset.loading &&
        Boolean(document.getElementById('modal-body-file-info').dataset.fileName)
    );
    const feedback = ((await popup.textContent('#modal-feedback')) ?? '').trim();
    await saveRule();
    return feedback;
  }
  async function addInjectRule(pattern, script, style, relaxCsp = false) {
    await openNewRule(pattern, 'inject');
    await popup.fill('#modal-inject-script', script);
    await popup.fill('#modal-inject-style', style);
    if (relaxCsp) await popup.check('#modal-inject-relax-csp');
    await saveRule();
  }
  async function setRuleEnabled(patternText, enabled) {
    const toggle = popup
      .locator('#list li', { has: popup.locator('.rule-pattern', { hasText: patternText }) })
      .locator('.rule-toggle')
      .first();
    if ((await toggle.isChecked()) !== enabled) {
      // The checkbox sits under a styled switch; flip it as a click would.
      await toggle.evaluate(box => {
        box.checked = !box.checked;
        box.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
    await popup.waitForTimeout(1000);
  }

  // Prime the HTTP cache first: app.js and style.css are sent with max-age=3600.
  await site.goto(staticPage('page.html'));
  const original = await pageState();
  report(
    'static page loads its real script and stylesheet (cache primed)',
    original.app === 'original' && original.color === 'rgb(0, 0, 255)' && original.logo === 0,
    JSON.stringify(original)
  );

  await addFileRule('static/app.js', localFile('app.js', 'window.APP = "local file";'));
  await addFileRule('static/style.css', localFile('style.css', '#h { color: rgb(255, 0, 0); }'));
  await addFileRule('static/missing.js', localFile('missing.js', 'window.MISSING = "served";'));
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  await addFileRule('static/logo.png', localFile('logo.png', png));
  const ruleListText = (await popup.locator('#list').textContent()) ?? '';
  await site.goto(staticPage('page.html'));
  const replaced = await pageState();
  report(
    'local files replace a cached script and stylesheet, a 404 script and an image',
    replaced.app === 'local file' &&
      replaced.color === 'rgb(255, 0, 0)' &&
      replaced.missing === 'served' &&
      replaced.logo === 1,
    JSON.stringify(replaced)
  );
  report('the rule list names the local file', /local file/i.test(ruleListText));

  await setRuleEnabled('static/app.js', false);
  await site.goto(staticPage('page.html'));
  const restored = await pageState();
  report(
    'turning a file rule off brings the original script back',
    restored.app === 'original' && restored.color === 'rgb(255, 0, 0)',
    JSON.stringify(restored)
  );
  await setRuleEnabled('static/app.js', true);

  await addInjectRule(
    'static/page.html',
    'window.INJECTED = document.getElementById("h") ? "dom ready" : "no dom";',
    'body { background-color: rgb(1, 2, 3); }'
  );
  await site.goto(staticPage('page.html'));
  const injected = await pageState();
  report(
    'inject rule adds JS (after the DOM) and CSS to the page; file rules still apply',
    injected.injected === 'dom ready' &&
      injected.background === 'rgb(1, 2, 3)' &&
      injected.app === 'local file',
    JSON.stringify(injected)
  );
  await popup.screenshot({ path: path.join(WORK_DIR, '3h-static-rules.png') });

  const cspState = () =>
    site.evaluate(() => ({
      injected: window.INJECTED ?? null,
      pageInline: window.PAGE_INLINE ?? null,
      color: getComputedStyle(document.getElementById('p')).color,
    }));
  await addInjectRule(
    'static/csp.html',
    'window.INJECTED = "through csp";',
    '#p { color: rgb(0, 128, 0); }'
  );
  await site.goto(staticPage('csp.html'));
  await popup.waitForTimeout(500);
  const throughCsp = await cspState();
  report(
    'injected JS and CSS run through the page CSP by hash; its own inline script stays blocked',
    throughCsp.injected === 'through csp' &&
      throughCsp.color === 'rgb(0, 128, 0)' &&
      throughCsp.pageInline === null,
    JSON.stringify(throughCsp)
  );

  await addInjectRule('static/sandbox.html', 'window.INJECTED = "sandbox";', '');
  await site.goto(staticPage('sandbox.html'));
  await popup.waitForTimeout(500);
  const sandboxed = await site.evaluate(() => window.INJECTED ?? null);
  const sandboxNotice = await lastToast('warning');
  report(
    'a CSP sandbox without allow-scripts stops the script and the panel warns about it',
    sandboxed === null && /sandbox/.test(sandboxNotice),
    JSON.stringify({ sandboxed, sandboxNotice })
  );

  await setRuleEnabled('static/csp.html', false);
  await addInjectRule('static/csp.html', 'window.INJECTED = "csp removed";', '', true);
  await site.goto(staticPage('csp.html'));
  const removed = await cspState();
  report(
    'with "Remove the page CSP" ticked the page loads without its CSP',
    removed.injected === 'csp removed' && removed.pageInline === true,
    JSON.stringify(removed)
  );

  // ---- 3i. headers, variables and weighted random responses
  // "No cache" keeps the real body and drops the caching headers; "No CSP"
  // lets a page's inline script run while its HTML stays the server's.
  async function addPresetRule(pattern, preset) {
    await openNewRule(pattern, 'body');
    await popup.click(`.preset-btn[data-preset="${preset}"]`);
    await saveRule();
  }
  await addPresetRule('api/headers', 'no-cache');
  const kept = await site.evaluate(
    u =>
      fetch(u).then(async r => ({
        body: await r.text(),
        cache: r.headers.get('cache-control'),
        etag: r.headers.get('etag'),
        real: r.headers.get('x-real'),
      })),
    `http://127.0.0.1:${PORT}/api/headers`
  );
  report(
    '"No cache" keeps the real body and removes the caching headers',
    kept.body === '{"real":"headers"}' &&
      kept.cache === null &&
      kept.etag === null &&
      kept.real === 'yes',
    JSON.stringify(kept)
  );

  await site.goto(`http://127.0.0.1:${PORT}/headers/csp.html`);
  const blocked = await site.evaluate(() => window.PAGE_INLINE ?? null);
  await addPresetRule('headers/csp.html', 'no-csp');
  await site.goto(`http://127.0.0.1:${PORT}/headers/csp.html`);
  const unblocked = await site.evaluate(() => ({
    inline: window.PAGE_INLINE ?? null,
    text: document.getElementById('p')?.textContent ?? null,
  }));
  report(
    '"No CSP" removes the page CSP and keeps its real HTML',
    blocked === null && unblocked.inline === true && unblocked.text === 'real page',
    JSON.stringify({ blocked, ...unblocked })
  );

  // Variables: one for this site and one for every site, used in a pattern,
  // a body and a header.
  if (await popup.locator('#override-modal').isVisible()) {
    await popup.click('#override-modal .modal-close');
    await popup.waitForSelector('#override-modal', { state: 'hidden' });
  }
  await popup.click('button.tab-btn[data-tab="overrides"]');
  await popup.click('#variables-btn');
  await popup.waitForSelector('#variables-modal', { state: 'visible' });
  await popup.click('#variables-site-table .headers-editor-mode button:last-child');
  await popup.fill('#variables-site', 'res: vars');
  await popup.click('#variables-global-table .headers-editor-mode button:last-child');
  await popup.fill('#variables-global', 'env: qa\nres: global');
  await popup.click('#variables-save');
  await popup.waitForSelector('#variables-modal', { state: 'hidden' });
  await popup.click('button.tab-btn[data-tab="other"]');
  await openNewRule('api/{{res}}', 'body');
  await popup.fill('#modal-body', '{"env":"{{env}}","raw":"\\{{env}}"}');
  await openEditorGroup(popup, 'modal-group-response-headers');
  await popup.click('#modal-response-headers-table .headers-editor-mode button:last-child');
  await popup.fill('#modal-headers', 'X-Env: {{env}}');
  await saveRule();
  const withVars = await site.evaluate(
    u => fetch(u).then(async r => ({ body: await r.text(), env: r.headers.get('x-env') })),
    `http://127.0.0.1:${PORT}/api/vars`
  );
  report(
    'variables fill a rule pattern, body and header; a site value wins over a global one',
    withVars.body === '{"env":"qa","raw":"{{env}}"}' && withVars.env === 'qa',
    JSON.stringify(withVars)
  );

  // Weighted responses with a seed answer in the order the seed gives.
  await openNewRule('api/weighted', 'body');
  await popup.fill('#modal-body', '{"ok":true}');
  await popup.fill('#modal-status', '200');
  await openEditorGroup(popup, 'modal-group-responses');
  await popup.click('#modal-add-variant');
  await popup.fill('#modal-variants .variant-weight', '1');
  await popup.fill('#modal-variants .variant-status', '500');
  await popup.fill('#modal-variants .variant-body', '{"error":true}');
  await popup.fill('#modal-weight', '1');
  await popup.fill('#modal-random-seed', '42');
  await saveRule();
  const expectedPicks = await popup.evaluate(() => {
    const next = NetworkOverridesUtils.seededRandom(42);
    return Array.from({ length: 16 }, () => NetworkOverridesUtils.pickWeighted([1, 1], next()));
  });
  const picks = [];
  for (let i = 0; i < expectedPicks.length; i++) {
    // Midway the panel is focused, which sends the same rules again: the order goes on.
    if (i === 12) {
      await popup.evaluate(() => window.dispatchEvent(new Event('focus')));
      await popup.waitForTimeout(1000);
    }
    picks.push(
      await site.evaluate(
        u =>
          fetch(u).then(async r => ({
            status: r.status,
            body: await r.text(),
            response: r.headers.get('x-network-overrides-response'),
          })),
        `http://127.0.0.1:${PORT}/api/weighted`
      )
    );
  }
  const followsSeed = picks.every((pick, i) =>
    expectedPicks[i] === 1
      ? pick.status === 500 && pick.body === '{"error":true}' && pick.response === '2'
      : pick.status === 200 && pick.body === '{"ok":true}' && pick.response === '1'
  );
  report(
    'weighted responses with a seed answer in the seeded order, also after the panel re-sends the rules',
    followsSeed && expectedPicks.includes(0) && expectedPicks.includes(1),
    JSON.stringify({ expected: expectedPicks, statuses: picks.map(pick => pick.status) })
  );
  await popup.screenshot({ path: path.join(WORK_DIR, '3i-headers-vars-weighted.png') });

  // A rule of about 3 MB is saved here and checked again after the worker restart.
  const bigBody = `window.BIG = "yes"; /* ${'x'.repeat(3 * 1024 * 1024)} */`;
  const bigWarning = await addFileRule('static/big.js', localFile('big.js', bigBody));
  const fetchBig = () =>
    site.evaluate(
      u => fetch(u).then(async r => ({ status: r.status, length: (await r.text()).length })),
      staticPage('big.js')
    );
  const big = await fetchBig();
  report(
    'a 3 MB local file saves with a size warning and is served',
    big.status === 200 && big.length === bigBody.length && /MB/.test(bigWarning),
    JSON.stringify({ ...big, bigWarning })
  );
  await site.goto(`http://127.0.0.1:${PORT}/`);
  await site.waitForTimeout(1000);

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
    const bigAfter = await fetchBig();
    report(
      'after worker restart the 3 MB file rule still applies',
      bigAfter.status === 200 && bigAfter.length === bigBody.length,
      JSON.stringify(bigAfter)
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
