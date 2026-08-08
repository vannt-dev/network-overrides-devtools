import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUTPUT = path.join(ROOT, 'store-assets', 'screenshots');
const WORK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'network-overrides-store-'));
const PROFILE = path.join(WORK_DIR, 'profile');
fs.mkdirSync(OUTPUT, { recursive: true });

const json = value => JSON.stringify(value);
const server = http.createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  if (request.url === '/api/users') {
    response.setHeader('Content-Type', 'application/json');
    response.end(json({ users: [{ id: 42, name: 'Ada Lovelace', role: 'admin' }] }));
    return;
  }
  if (request.url === '/api/orders') {
    response.setHeader('Content-Type', 'application/json');
    response.end(json({ orders: [{ id: 'ORD-1042', total: 129.5, status: 'processing' }] }));
    return;
  }
  if (request.url === '/graphql') {
    response.setHeader('Content-Type', 'application/json');
    response.end(json({ data: { viewer: { id: 42, name: 'Ada Lovelace' } } }));
    return;
  }
  if (request.url === '/api/analytics') {
    response.setHeader('Content-Type', 'application/json');
    response.end(json({ conversionRate: 0.184, activeUsers: 1284 }));
    return;
  }
  response.setHeader('Content-Type', 'text/html');
  response.end('<!doctype html><title>Demo application</title><h1>Demo application</h1>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const origin = `http://127.0.0.1:${port}`;

const context = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
});

const storeCss = `
  :root { color-scheme: light; }
  html {
    width: 1280px;
    height: 800px;
    overflow: hidden;
    background:
      radial-gradient(circle at 18% 16%, rgba(98, 181, 255, .28), transparent 31%),
      radial-gradient(circle at 72% 84%, rgba(28, 113, 206, .18), transparent 34%),
      linear-gradient(135deg, #eef7ff 0%, #dceeff 48%, #f6fbff 100%);
  }
  body.popup-body.store-shot {
    position: absolute;
    top: 40px;
    right: 60px;
    width: 500px;
    min-width: 500px;
    height: 720px;
    min-height: 0;
    margin: 0;
    padding: 18px;
    overflow: auto;
    border: 1px solid rgba(76, 129, 180, .28);
    border-radius: 18px;
    background: #fff;
    box-shadow: 0 26px 70px rgba(29, 75, 119, .24);
  }
  .store-caption {
    position: fixed;
    z-index: 3100;
    top: 0;
    left: 0;
    display: flex;
    width: 650px;
    height: 800px;
    box-sizing: border-box;
    flex-direction: column;
    justify-content: center;
    padding: 74px;
    color: #173b5f;
    font-family: Arial, sans-serif;
    pointer-events: none;
  }
  .store-brand {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 30px;
    color: #35698f;
    font-size: 19px;
    font-weight: 700;
    letter-spacing: .01em;
  }
  .store-brand img {
    width: 48px;
    height: 48px;
    filter: drop-shadow(0 7px 14px rgba(28, 93, 151, .18));
  }
  .store-kicker {
    margin-bottom: 14px;
    color: #0a66c2;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: .12em;
    text-transform: uppercase;
  }
  .store-caption h1 {
    max-width: 500px;
    margin: 0 0 18px;
    color: #173b5f;
    font-size: 50px;
    line-height: 1.04;
    letter-spacing: -.035em;
  }
  .store-caption p {
    max-width: 500px;
    margin: 0;
    color: #4e708e;
    font-size: 22px;
    line-height: 1.45;
  }
  body.store-shot #override-modal {
    z-index: 2000;
    top: 40px;
    right: 60px;
    bottom: auto;
    left: auto;
    width: 500px;
    height: 720px;
    padding: 0;
    overflow: hidden;
    border-radius: 18px;
    background: transparent;
    box-shadow: 0 26px 70px rgba(29, 75, 119, .24);
  }
  body.store-shot #override-modal .modal-content--override {
    width: 500px;
    height: 720px;
    max-height: 720px;
    margin: 0;
    border-radius: 18px;
  }
  body.store-shot .notification-region {
    top: 54px;
    right: 76px;
    width: 448px;
  }
`;

function captionMarkup(kicker, title, description, iconUrl) {
  return `
    <aside class="store-caption">
      <div class="store-brand"><img src="${iconUrl}" alt="" /> Network Overrides API</div>
      <div class="store-kicker">${kicker}</div>
      <h1>${title}</h1>
      <p>${description}</p>
    </aside>`;
}

async function setCaption(page, kicker, title, description) {
  await page.evaluate(
    async ({ kicker, title, description }) => {
      document.querySelector('.store-caption')?.remove();
      document.body.classList.add('store-shot');
      const markup = await window.__storeCaptionMarkup(
        kicker,
        title,
        description,
        chrome.runtime.getURL('icons/icon-128x128.png')
      );
      document.body.insertAdjacentHTML('beforeend', markup);
    },
    { kicker, title, description }
  );
}

async function screenshot(page, filename) {
  await page.screenshot({ path: path.join(OUTPUT, filename) });
  console.log(path.join(OUTPUT, filename));
}

try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = new URL(worker.url()).host;

  const site = context.pages()[0] ?? (await context.newPage());
  await site.goto(`${origin}/`);
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 1280, height: 800 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.addStyleTag({ content: storeCss });
  await popup.exposeFunction('__storeCaptionMarkup', captionMarkup);

  await site.bringToFront();
  await popup.evaluate(() => window.dispatchEvent(new Event('focus')));
  await popup.waitForTimeout(500);
  if (!(await popup.locator('#enable').isChecked())) await popup.click('.switch-slider');

  await site.evaluate(async baseUrl => {
    await Promise.all([
      fetch(`${baseUrl}/api/users`),
      fetch(`${baseUrl}/api/orders`),
      fetch(`${baseUrl}/graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operationName: 'GetViewer',
          query: 'query GetViewer { viewer { id } }',
        }),
      }),
      fetch(`${baseUrl}/api/analytics`),
    ]);
  }, origin);
  await popup.click('#refresh-apis');
  await popup.waitForTimeout(1200);
  await setCaption(
    popup,
    'Live capture',
    'See every API call as it happens.',
    'Filter captured Fetch, XHR, GraphQL, document and image requests from one focused view.'
  );
  await screenshot(popup, '01-captured-apis.png');

  const usersApi = popup.locator('.api-item', { hasText: '/api/users' }).first();
  await usersApi.click();
  await popup.waitForSelector('#override-modal', { state: 'visible' });
  await popup.fill(
    '#modal-body',
    json({ users: [{ id: 42, name: 'Ada Lovelace', role: 'admin', plan: 'pro' }] })
  );
  await popup.click('#format-json-btn');
  await popup.click('#modal-request-headers-table .add-header-row-btn');
  await popup.fill('#modal-request-headers-table .header-row-key', 'Authorization');
  await popup.fill('#modal-request-headers-table .header-row-value', 'Bearer mock-token');
  await popup.fill('#modal-status', '200');
  await popup.fill('#modal-delay', '250');
  await setCaption(
    popup,
    'Response mocking',
    'Shape the exact response you need.',
    'Override JSON bodies, request headers, status codes and network delay without changing application code.'
  );
  await screenshot(popup, '02-override-editor.png');

  await popup.click('.modal-close');
  const rules = [
    {
      pattern: '/api/users',
      method: 'GET',
      mode: 'text',
      body: json({ users: [{ id: 42, name: 'Ada Lovelace' }] }),
      statusCode: 200,
      delayMs: 250,
      requestHeaders: [{ name: 'Authorization', value: 'Bearer mock-token' }],
      responseHeaders: [{ name: 'X-Mock-Source', value: 'network-overrides' }],
    },
    {
      pattern: '/api/orders',
      method: 'POST',
      mode: 'text',
      body: json({ id: 'ORD-1042', status: 'created' }),
      statusCode: 201,
    },
    {
      pattern: '/api/payments/*',
      method: 'ANY',
      mode: 'text',
      body: '',
      redirectUrl: 'https://sandbox.example.com/payments/*',
    },
    {
      pattern: '/api/reports',
      method: 'GET',
      mode: 'text',
      body: '',
      failReason: 'TimedOut',
      delayMs: 3000,
      enabled: false,
    },
  ];
  await popup.evaluate(({ key, rules }) => chrome.storage.local.set({ [key]: rules }), {
    key: `overrides_${origin}`,
    rules,
  });
  await site.bringToFront();
  await popup.reload();
  await popup.addStyleTag({ content: storeCss });
  await popup.evaluate(() => window.dispatchEvent(new Event('focus')));
  await popup.waitForTimeout(700);
  await popup.click('[data-tab="overrides"]');
  await setCaption(
    popup,
    'Reusable rules',
    'Model success, redirects and failures.',
    'Toggle, duplicate and combine method, delay, header, redirect and failure rules for realistic test flows.'
  );
  await screenshot(popup, '03-override-rules.png');

  await popup.evaluate(() => {
    window.NetworkOverridesUi.showPersistenceNotification('Override saved', {
      applied: false,
      warning: 'Another debugger is currently using this tab',
      retry: async () => undefined,
    });
  });
  await setCaption(
    popup,
    'Clear feedback',
    'Know when every change is active.',
    'Save validation and apply status stay visible, with a one-click retry when Chrome cannot update interception.'
  );
  await screenshot(popup, '04-save-and-retry.png');
} finally {
  await context.close();
  await new Promise(resolve => server.close(resolve));
}
