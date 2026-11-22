import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createBackgroundHarness } from './background-test-harness.mjs';
import { TEST_DOMAIN } from './config.mjs';

const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
const PAGE_URL = `${TEST_DOMAIN}/shop/`;

async function backgroundWithRules(overrides) {
  const harness = createBackgroundHarness();
  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides,
  });
  await tick();
  return harness;
}

function subscribe(harness) {
  const messages = [];
  const listeners = {};
  const port = {
    name: 'network-overrides-ui',
    postMessage: message => messages.push(message),
    onMessage: { addListener: fn => (listeners.message = fn) },
    onDisconnect: { addListener: fn => (listeners.disconnect = fn) },
  };
  harness.listeners.onConnect(port);
  listeners.message({ type: 'subscribe', tabId: 7 });
  return messages;
}

const commandsFor = (harness, requestId) =>
  harness.commandLog.filter(({ params }) => params?.requestId === requestId);
const commandFor = (harness, requestId) => commandsFor(harness, requestId).at(-1);
const bodyOf = command => Buffer.from(command.params.body, 'base64').toString('utf8');
const headerOf = (command, name) =>
  command.params.responseHeaders.find(header => header.name.toLowerCase() === name.toLowerCase())
    ?.value;

function pauseRequest(harness, requestId, url, resourceType) {
  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId,
    request: { url, method: 'GET', headers: {} },
    resourceType,
  });
}

function pauseResponse(
  harness,
  requestId,
  { url = PAGE_URL, resourceType = 'Document', ...extra }
) {
  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId,
    request: { url, method: 'GET', headers: {} },
    responseStatusCode: 200,
    responseHeaders: [
      { name: 'Content-Type', value: 'text/html; charset=utf-8' },
      { name: 'Content-Length', value: '99' },
      { name: 'Content-Encoding', value: 'br' },
    ],
    resourceType,
    ...extra,
  });
}

const injectRule = (extra = {}) => ({
  pattern: `${TEST_DOMAIN}/*`,
  body: '',
  mode: 'text',
  kind: 'inject',
  injectScript: 'window.injected = true;',
  injectStyle: 'body{outline:1px solid red}',
  ...extra,
});

const PAGE = '<!doctype html><html><head><title>t</title></head><body><p>x</p></body></html>';

// ---- replacing static files -------------------------------------------------------

test('a file answered without the server gets a Content-Type from its extension', async () => {
  const harness = await backgroundWithRules([
    { pattern: '*/static/app.js*', body: 'console.log(1)', mode: 'text', respondAtRequest: true },
    { pattern: '*/static/logo.png', body: 'iVBORw0KGgo=', mode: 'file', respondAtRequest: true },
    { pattern: '*/api/data', body: '{}', mode: 'text', respondAtRequest: true },
  ]);
  pauseRequest(harness, 'js', `${TEST_DOMAIN}/static/app.js?v=2`, 'Script');
  pauseRequest(harness, 'png', `${TEST_DOMAIN}/static/logo.png`, 'Image');
  pauseRequest(harness, 'api', `${TEST_DOMAIN}/api/data`, 'Fetch');

  assert.equal(
    headerOf(commandFor(harness, 'js'), 'content-type'),
    'text/javascript; charset=utf-8'
  );
  assert.equal(bodyOf(commandFor(harness, 'js')), 'console.log(1)');
  assert.equal(headerOf(commandFor(harness, 'png'), 'content-type'), 'image/png');
  // Unknown extensions keep the old JSON default.
  assert.equal(
    headerOf(commandFor(harness, 'api'), 'content-type'),
    'application/json; charset=utf-8'
  );
});

test('the Content-Type of a replaced file can be set by the rule', async () => {
  const harness = await backgroundWithRules([
    {
      pattern: '*/static/app.js',
      body: 'x',
      mode: 'text',
      respondAtRequest: true,
      responseHeaders: [{ name: 'Content-Type', value: 'application/javascript' }],
    },
  ]);
  pauseRequest(harness, 'js', `${TEST_DOMAIN}/static/app.js`, 'Script');
  assert.equal(headerOf(commandFor(harness, 'js'), 'content-type'), 'application/javascript');
});

// ---- injecting JS and CSS -------------------------------------------------------------

test('an inject rule adds its style and script to a matching HTML page', async () => {
  const harness = await backgroundWithRules([injectRule()]);
  harness.responseBodies.set('doc', {
    body: Buffer.from(PAGE).toString('base64'),
    base64Encoded: true,
  });
  pauseResponse(harness, 'doc', {});
  await tick(5);

  const command = commandFor(harness, 'doc');
  assert.equal(command.method, 'Fetch.fulfillRequest');
  assert.equal(command.params.responseCode, 200);
  const html = bodyOf(command);
  assert.match(
    html,
    /<style data-network-overrides>body\{outline:1px solid red\}<\/style><\/head>/
  );
  assert.match(html, /<script data-network-overrides>window\.injected = true;<\/script><\/body>/);
  assert.equal(headerOf(command, 'content-type'), 'text/html; charset=utf-8');
  assert.equal(headerOf(command, 'content-length'), undefined);
  assert.equal(headerOf(command, 'content-encoding'), undefined);
  assert.equal(headerOf(command, 'x-network-overrides'), 'true');
});

test('an inject rule never touches the request stage, scripts, styles or API calls', async () => {
  const harness = await backgroundWithRules([
    injectRule(),
    { pattern: `${TEST_DOMAIN}/api/*`, body: '{"mock":true}', mode: 'text' },
  ]);
  pauseRequest(harness, 'doc-req', PAGE_URL, 'Document');
  assert.deepEqual(
    commandsFor(harness, 'doc-req').map(({ method }) => method),
    ['Fetch.continueRequest']
  );
  assert.deepEqual(Object.keys(commandFor(harness, 'doc-req').params), ['requestId']);

  pauseResponse(harness, 'js', { url: `${TEST_DOMAIN}/app.js`, resourceType: 'Script' });
  assert.equal(commandFor(harness, 'js').method, 'Fetch.continueRequest');

  // The API rule further down the list still applies to API calls on the page.
  pauseResponse(harness, 'api', { url: `${TEST_DOMAIN}/api/users`, resourceType: 'Fetch' });
  const api = commandFor(harness, 'api');
  assert.equal(api.method, 'Fetch.fulfillRequest');
  assert.equal(bodyOf(api), '{"mock":true}');
});

test('an inject rule passes redirects, errors and non-HTML documents through', async () => {
  const harness = await backgroundWithRules([injectRule()]);
  harness.responseBodies.set('pdf', { body: 'JVBERi0=', base64Encoded: true });
  pauseResponse(harness, 'redirect', { responseStatusCode: 302 });
  pauseResponse(harness, 'missing', { responseStatusCode: 404 });
  pauseResponse(harness, 'pdf', {
    responseHeaders: [{ name: 'Content-Type', value: 'application/pdf' }],
  });
  await tick(5);
  for (const id of ['redirect', 'missing', 'pdf']) {
    assert.deepEqual(
      commandsFor(harness, id).map(({ method }) => method),
      ['Fetch.continueRequest'],
      id
    );
  }
});

test('an inject rule leaves a page that is not UTF-8 alone and says why', async () => {
  const harness = await backgroundWithRules([injectRule()]);
  const messages = subscribe(harness);
  harness.responseBodies.set('sjis', {
    body: Buffer.from([0x3c, 0x70, 0x3e, 0x82, 0xa0, 0x3c, 0x2f, 0x70, 0x3e]).toString('base64'),
    base64Encoded: true,
  });
  pauseResponse(harness, 'sjis', {
    responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=Shift_JIS' }],
  });
  await tick(5);
  assert.equal(commandFor(harness, 'sjis').method, 'Fetch.continueRequest');
  const notice = messages.find(message => message.type === 'injectRuleNotice');
  assert.ok(notice, 'the panel is told');
  assert.match(notice.message, /UTF-8/);
});

const hashOf = text => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;

test('an inject rule lets its own code through the page CSP by hash and keeps the rest', async () => {
  const rule = injectRule();
  const harness = await backgroundWithRules([rule]);
  const messages = subscribe(harness);
  harness.responseBodies.set('csp', {
    body: PAGE.replace(
      '<title>',
      `<meta http-equiv="Content-Security-Policy" content="style-src 'self'"><title>`
    ),
    base64Encoded: false,
  });
  pauseResponse(harness, 'csp', {
    responseHeaders: [
      { name: 'Content-Type', value: 'text/html' },
      {
        name: 'Content-Security-Policy',
        value: "script-src 'self' 'nonce-r4nd'; frame-ancestors 'none'",
      },
      { name: 'Content-Security-Policy-Report-Only', value: "default-src 'self'" },
    ],
  });
  await tick(20);
  const command = commandFor(harness, 'csp');
  assert.equal(command.method, 'Fetch.fulfillRequest');
  const script = hashOf(rule.injectScript);
  const style = hashOf(rule.injectStyle);
  assert.equal(
    headerOf(command, 'content-security-policy'),
    `script-src 'self' 'nonce-r4nd' ${script}; frame-ancestors 'none'`
  );
  assert.equal(
    headerOf(command, 'content-security-policy-report-only'),
    `default-src 'self' ${script} ${style}`
  );
  const body = bodyOf(command);
  assert.match(body, new RegExp(`content="style-src 'self' ${style.replace(/[+/]/g, '\\$&')}"`));
  assert.match(body, /window\.injected/);
  assert.equal(
    messages.some(message => message.type === 'injectRuleNotice'),
    false
  );
});

test('an inject rule leaves a page without a CSP as it was, apart from the code', async () => {
  const harness = await backgroundWithRules([injectRule()]);
  harness.responseBodies.set('plain', { body: PAGE, base64Encoded: false });
  pauseResponse(harness, 'plain', {
    responseHeaders: [{ name: 'Content-Type', value: 'text/html' }],
  });
  await tick(20);
  const command = commandFor(harness, 'plain');
  assert.equal(headerOf(command, 'content-security-policy'), undefined);
  assert.match(
    bodyOf(command),
    /<style data-network-overrides>body\{outline:1px solid red\}<\/style><\/head>/
  );
});

test('an inject rule warns when a CSP sandbox stops every script', async () => {
  const harness = await backgroundWithRules([injectRule()]);
  const messages = subscribe(harness);
  harness.responseBodies.set('sandbox', { body: PAGE, base64Encoded: false });
  pauseResponse(harness, 'sandbox', {
    responseHeaders: [
      { name: 'Content-Type', value: 'text/html' },
      { name: 'Content-Security-Policy', value: 'sandbox allow-forms' },
    ],
  });
  await tick(20);
  assert.equal(commandFor(harness, 'sandbox').method, 'Fetch.fulfillRequest');
  const notice = messages.find(message => message.type === 'injectRuleNotice');
  assert.ok(notice, 'the panel is told');
  assert.equal(notice.code, 'csp');
  assert.match(notice.message, /sandbox/);
});

test('with relaxCsp an inject rule removes the CSP headers and meta tags', async () => {
  const harness = await backgroundWithRules([injectRule({ relaxCsp: true })]);
  const messages = subscribe(harness);
  harness.responseBodies.set('csp', {
    body: PAGE.replace(
      '<title>',
      `<meta http-equiv="Content-Security-Policy" content="style-src 'none'"><title>`
    ),
    base64Encoded: false,
  });
  pauseResponse(harness, 'csp', {
    responseHeaders: [
      { name: 'Content-Type', value: 'text/html' },
      { name: 'Content-Security-Policy', value: "script-src 'self'" },
      { name: 'content-security-policy-report-only', value: "default-src 'none'" },
      { name: 'X-Kept', value: 'yes' },
    ],
  });
  await tick(5);
  const command = commandFor(harness, 'csp');
  assert.equal(headerOf(command, 'content-security-policy'), undefined);
  assert.equal(headerOf(command, 'content-security-policy-report-only'), undefined);
  assert.equal(headerOf(command, 'x-kept'), 'yes');
  assert.doesNotMatch(bodyOf(command), /Content-Security-Policy/i);
  assert.equal(
    messages.some(message => message.type === 'injectRuleNotice'),
    false
  );
});

test('a disabled inject rule does nothing', async () => {
  const harness = await backgroundWithRules([injectRule({ enabled: false })]);
  harness.responseBodies.set('doc', { body: PAGE, base64Encoded: false });
  pauseResponse(harness, 'doc', {});
  await tick(5);
  assert.equal(commandFor(harness, 'doc').method, 'Fetch.continueRequest');
});

test('a file replaced from disk is served with 200 even when the server has none', async () => {
  const harness = await backgroundWithRules([
    { pattern: '*/static/app.js', body: 'ok()', mode: 'text', fileName: 'app.js' },
    { pattern: '*/static/other.js', body: 'ok()', mode: 'text', fileName: 'o.js', statusCode: 203 },
  ]);
  pauseResponse(harness, 'missing', {
    url: `${TEST_DOMAIN}/static/app.js`,
    resourceType: 'Script',
    responseStatusCode: 404,
    responseHeaders: [{ name: 'Content-Type', value: 'text/html' }],
  });
  pauseResponse(harness, 'set', {
    url: `${TEST_DOMAIN}/static/other.js`,
    resourceType: 'Script',
    responseStatusCode: 404,
  });
  assert.equal(commandFor(harness, 'missing').params.responseCode, 200);
  assert.equal(commandFor(harness, 'set').params.responseCode, 203);
});

test('an inject rule keeps the UTF-8 byte order mark of the page', async () => {
  const harness = await backgroundWithRules([injectRule()]);
  harness.responseBodies.set('bom', {
    body: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(PAGE)]).toString('base64'),
    base64Encoded: true,
  });
  pauseResponse(harness, 'bom', {
    responseHeaders: [{ name: 'Content-Type', value: 'text/html' }],
  });
  await tick(20);
  const bytes = Buffer.from(commandFor(harness, 'bom').params.body, 'base64');
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.match(bytes.toString('utf8'), /window\.injected/);
});

test('a sandbox in a <meta> CSP, which browsers ignore, raises no notice', async () => {
  const harness = await backgroundWithRules([injectRule()]);
  const messages = subscribe(harness);
  harness.responseBodies.set('meta-sandbox', {
    body: PAGE.replace(
      '<title>',
      '<meta http-equiv="Content-Security-Policy" content="sandbox"><title>'
    ),
    base64Encoded: false,
  });
  pauseResponse(harness, 'meta-sandbox', {
    responseHeaders: [{ name: 'Content-Type', value: 'text/html' }],
  });
  await tick(20);
  assert.equal(commandFor(harness, 'meta-sandbox').method, 'Fetch.fulfillRequest');
  assert.equal(
    messages.some(message => message.type === 'injectRuleNotice'),
    false
  );
});
