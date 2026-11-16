import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import {
  createUiContext,
  createUiHarness,
  flushUi,
  closeAllUiHarnessWindows,
  normalize,
} from './test-harness.mjs';
import { createBackgroundHarness } from './background-test-harness.mjs';
import { TEST_DOMAIN, TEST_API_URL, TEST_API_2_URL } from './config.mjs';

after(() => {
  closeAllUiHarnessWindows();
});

const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
const usersRule = { pattern: '/api/users', body: '{"mocked":true}', mode: 'text' };
const ordersRule = { pattern: '/api/orders', body: '{"orders":[]}', mode: 'text' };

async function backgroundWith(overrides) {
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

/** A UI port subscribed to tab 7, recording what the worker posts to it. */
function subscribe(harness) {
  const messages = [];
  const listeners = {};
  harness.listeners.onConnect({
    name: 'network-overrides-ui',
    postMessage: message => messages.push(structuredClone(message)),
    onMessage: { addListener: fn => (listeners.message = fn) },
    onDisconnect: { addListener: fn => (listeners.disconnect = fn) },
  });
  listeners.message({ type: 'subscribe', tabId: 7 });
  return messages;
}

function pause(harness, requestId, url, extra = {}) {
  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId,
    request: { url, method: 'GET', headers: {} },
    resourceType: 'Fetch',
    ...extra,
  });
}

/** One request through both stages, as Chrome reports it. */
function request(harness, requestId, url) {
  pause(harness, requestId, url);
  pause(harness, requestId, url, { responseStatusCode: 200, responseHeaders: [] });
}

function hitsOf(harness, rules) {
  const store = harness.context.NetworkOverridesTabState;
  const keys = harness.context.NetworkOverridesUtils.ruleHitKeys(rules);
  const hits = store.ruleHitsSnapshot(7);
  return keys.map(key => hits[key]?.count ?? 0);
}

test('ruleHitKeys ignores order of fields and the enabled flag, and tells duplicates apart', () => {
  const { ruleHitKeys } = createUiContext().NetworkOverridesUtils;
  const [plain] = ruleHitKeys([usersRule]);
  assert.equal(typeof plain, 'string');
  assert.deepEqual(
    normalize(
      ruleHitKeys([
        { mode: 'text', enabled: false, body: '{"mocked":true}', pattern: '/api/users' },
      ])
    ),
    [plain]
  );
  assert.notEqual(ruleHitKeys([{ ...usersRule, statusCode: 500 }])[0], plain);
  assert.deepEqual(normalize(ruleHitKeys([ordersRule, usersRule, usersRule])).slice(1), [
    plain,
    `${plain}#1`,
  ]);
});

test('a request a rule answers counts one hit; a request no rule matches counts none', async () => {
  const rules = [usersRule, ordersRule];
  const harness = await backgroundWith(rules);

  request(harness, 'req-1', TEST_API_URL);
  request(harness, 'req-other', `${TEST_DOMAIN}/api/other`);
  assert.deepEqual(hitsOf(harness, rules), [1, 0]);

  request(harness, 'req-2', `${TEST_API_URL}?page=2`);
  request(harness, 'req-3', TEST_API_2_URL);
  assert.deepEqual(hitsOf(harness, rules), [2, 1]);

  const store = harness.context.NetworkOverridesTabState;
  const [usersKey] = harness.context.NetworkOverridesUtils.ruleHitKeys(rules);
  const hit = store.ruleHitsSnapshot(7)[usersKey];
  assert.equal(hit.lastUrl, `${TEST_API_URL}?page=2`);
  assert.ok(Math.abs(Date.now() - hit.lastAt) < 5000);
});

test('a disabled rule and a rule shadowed by an earlier one count nothing', async () => {
  const shadowed = { ...usersRule, body: '{"second":true}' };
  const rules = [usersRule, shadowed, { ...ordersRule, enabled: false }];
  const harness = await backgroundWith(rules);

  request(harness, 'req-1', TEST_API_URL);
  request(harness, 'req-2', TEST_API_2_URL);

  assert.deepEqual(hitsOf(harness, rules), [1, 0, 0]);
});

test('fail, redirect and early-answer rules count once per request', async () => {
  const rules = [
    { pattern: '/api/fail', body: '', mode: 'text', failReason: 'Failed' },
    { pattern: '/api/old', body: '', mode: 'text', redirectUrl: `${TEST_DOMAIN}/api/new` },
    { pattern: '/api/early', body: '{}', mode: 'text', respondAtRequest: true },
    { pattern: '/api/star/*', body: '', mode: 'text', redirectUrl: `${TEST_DOMAIN}/*/*` },
  ];
  const harness = await backgroundWith(rules);

  pause(harness, 'req-fail', `${TEST_DOMAIN}/api/fail`);
  request(harness, 'req-redirect', `${TEST_DOMAIN}/api/old`);
  pause(harness, 'req-early', `${TEST_DOMAIN}/api/early`);
  // A redirect that cannot be built is passed through, so it is not a hit.
  pause(harness, 'req-star', `${TEST_DOMAIN}/api/star/x`);

  assert.deepEqual(hitsOf(harness, rules), [1, 1, 1, 0]);
});

test('a rule that rewrites the request and answers the response counts once', async () => {
  const rules = [{ ...usersRule, requestHeaders: [{ name: 'X-Debug', value: '1' }] }];
  const harness = await backgroundWith(rules);

  request(harness, 'req-1', TEST_API_URL);

  assert.deepEqual(hitsOf(harness, rules), [1]);
});

test('a patch rule that leaves the response alone is not counted', async () => {
  const rules = [
    {
      pattern: '/api/users',
      body: '',
      mode: 'patch',
      patch: [{ op: 'set', path: 'plan', value: 'pro' }],
    },
  ];
  const harness = await backgroundWith(rules);

  harness.responseBodies.set('req-html', { body: '<html></html>', base64Encoded: false });
  pause(harness, 'req-html', TEST_API_URL, { responseStatusCode: 200, responseHeaders: [] });
  await tick(5);
  assert.deepEqual(hitsOf(harness, rules), [0]);

  harness.responseBodies.set('req-json', { body: '{"plan":"free"}', base64Encoded: false });
  pause(harness, 'req-json', TEST_API_URL, { responseStatusCode: 200, responseHeaders: [] });
  await tick(5);
  assert.deepEqual(hitsOf(harness, rules), [1]);
});

test('counts follow a rule through reordering and toggling, and start over when it is edited', async () => {
  const harness = await backgroundWith([usersRule, ordersRule]);
  request(harness, 'req-1', TEST_API_URL);

  const moved = [ordersRule, { ...usersRule, enabled: false }];
  harness.callMessage({ type: 'update', tabId: 7, enabled: true, overrides: moved });
  await tick();
  assert.deepEqual(hitsOf(harness, moved), [0, 1]);

  const edited = [ordersRule, { ...usersRule, statusCode: 404 }];
  harness.callMessage({ type: 'update', tabId: 7, enabled: true, overrides: edited });
  await tick();
  assert.deepEqual(hitsOf(harness, edited), [0, 0]);
});

test('panels get the counts on subscribe and then in throttled updates', async () => {
  const rules = [usersRule];
  const harness = await backgroundWith(rules);
  const [key] = harness.context.NetworkOverridesUtils.ruleHitKeys(rules);
  request(harness, 'req-before', TEST_API_URL);

  const messages = subscribe(harness);
  assert.equal(messages[0].type, 'apis');
  assert.equal(messages[0].ruleHits[key].count, 1);

  for (let index = 0; index < 20; index += 1) request(harness, `req-${index}`, TEST_API_URL);
  const updates = () => messages.filter(message => message.type === 'ruleHits');
  assert.equal(updates().length, 0, 'nothing is posted per request');
  await tick(harness.context.NetworkOverridesTabState.RULE_HITS_BROADCAST_MS + 50);
  assert.equal(updates().length, 1);
  assert.equal(updates()[0].hits[key].count, 21);
});

test('resetRuleHits and Clear set the counts back to zero and tell the panels', async () => {
  const rules = [usersRule];
  const harness = await backgroundWith(rules);
  const messages = subscribe(harness);

  request(harness, 'req-1', TEST_API_URL);
  harness.callMessage({ type: 'resetRuleHits', tabId: 7 });
  assert.deepEqual(hitsOf(harness, rules), [0]);
  assert.deepEqual(normalize(messages.at(-1)), { type: 'ruleHits', hits: {} });

  request(harness, 'req-2', TEST_API_URL);
  harness.callMessage({ type: 'clearApis', tabId: 7 });
  assert.deepEqual(hitsOf(harness, rules), [0]);
});

test('counts live in the session snapshot, never in the rules', async () => {
  const rules = [usersRule];
  const harness = await backgroundWith(rules);
  const store = harness.context.NetworkOverridesTabState;
  request(harness, 'req-1', `${TEST_API_URL}?${'x'.repeat(1000)}`);
  await store.flushPersist(7);

  const snapshot = harness.sessionState.tabState_7;
  const [key] = harness.context.NetworkOverridesUtils.ruleHitKeys(rules);
  assert.equal(snapshot.ruleHits[key].count, 1);
  assert.equal(snapshot.ruleHits[key].lastUrl.length, store.RULE_HIT_URL_LIMIT);
  assert.deepEqual(normalize(snapshot.overrides), [usersRule]);
  assert.deepEqual(normalize(store.get(7).overrides), [usersRule]);
  assert.equal(
    harness.storageSets.some(entry => JSON.stringify(entry).includes('ruleHits')),
    false,
    'nothing about hits reaches storage.local'
  );
});

test('counts come back after a worker restart', async () => {
  const [key] = createUiContext().NetworkOverridesUtils.ruleHitKeys([usersRule]);
  const harness = createBackgroundHarness({
    sessionState: {
      tabState_7: {
        enabled: false,
        origin: TEST_DOMAIN,
        overrides: [usersRule],
        recentApis: {},
        recentApiBodies: {},
        ruleHits: {
          [key]: { count: 4, lastAt: 1700000000000, lastUrl: TEST_API_URL },
          broken: { count: 'many' },
        },
      },
    },
  });
  await harness.context.NetworkOverridesBackground.ready;

  assert.deepEqual(normalize(harness.context.NetworkOverridesTabState.ruleHitsSnapshot(7)), {
    [key]: { count: 4, lastAt: 1700000000000, lastUrl: TEST_API_URL },
  });
});

test('a WebSocket applied report counts hits for the rules it names, within bounds', async () => {
  const wsRule = (pattern, extra = {}) => ({
    pattern,
    body: 'x',
    mode: 'text',
    kind: 'websocket',
    wsAction: 'replace',
    ...extra,
  });
  // Places in a report are among the enabled WebSocket rules only.
  const rules = [usersRule, wsRule('wss://a.test/*', { enabled: false }), wsRule('wss://b.test/*')];
  const harness = await backgroundWith(rules);
  const applied = perRule =>
    harness.emitDebuggerEvent('Runtime.bindingCalled', {
      name: '__nowsReport',
      payload: JSON.stringify({ event: 'applied', count: 1, rules: perRule }),
    });

  applied({ 0: 3 });
  assert.deepEqual(hitsOf(harness, rules), [0, 0, 3]);
  applied({ 0: -1, 1: 5, 7: 2, x: 1 });
  applied('nonsense');
  applied({ 0: 1.5 });
  assert.deepEqual(hitsOf(harness, rules), [0, 0, 3]);
  applied({ 0: 1e9 });
  assert.deepEqual(hitsOf(harness, rules), [0, 0, 1003]);
});

// ---- panel

async function uiWith(overrides, extra = {}) {
  const harness = createUiHarness({
    storageState: { enabled: true, overrides },
    tabUrl: `${TEST_DOMAIN}/`,
    statusResponse: { type: 'statusResponse', attached: true },
    ...extra,
  });
  await flushUi(harness.window);
  harness.document
    .querySelector('[data-tab="overrides"]')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);
  return harness;
}

const badges = harness => [...harness.document.querySelectorAll('#list .rule-hits')];
const keysOf = (harness, rules) => harness.window.NetworkOverridesUtils.ruleHitKeys(rules);

test('every rule shows a greyed 0 badge that a keyboard and a screen reader can reach', async () => {
  const harness = await uiWith([usersRule, ordersRule]);

  const [first, second] = badges(harness);
  assert.equal(first.textContent, '0');
  assert.equal(second.textContent, '0');
  assert.equal(first.classList.contains('rule-hits--active'), false);
  assert.equal(first.tabIndex, 0);
  assert.equal(first.getAttribute('role'), 'note');
  assert.equal(first.getAttribute('aria-label'), 'Not applied yet in this session');
  assert.equal(first.title, 'Not applied yet in this session');
});

test('a ruleHits message fills the badges in place, with the last time and URL', async () => {
  const rules = [usersRule, ordersRule];
  const harness = await uiWith(rules);
  const [usersKey] = keysOf(harness, rules);
  const before = badges(harness);
  const lastAt = Date.now();

  harness.emitPortMessage({
    type: 'ruleHits',
    hits: { [usersKey]: { count: 3, lastAt, lastUrl: `${TEST_API_URL}?page=2` } },
  });

  const [first, second] = badges(harness);
  assert.equal(first, before[0], 'the list is not rebuilt for a count');
  assert.equal(first.textContent, '3');
  assert.equal(first.classList.contains('rule-hits--active'), true);
  const time = new harness.window.Date(lastAt).toLocaleTimeString();
  assert.equal(
    first.title,
    ['Applied 3 times in this session', `Last applied at ${time}`, `${TEST_API_URL}?page=2`].join(
      '\n'
    )
  );
  assert.match(first.getAttribute('aria-label'), /^Applied 3 times in this session\. Last applied/);
  assert.equal(second.textContent, '0');

  harness.emitPortMessage({
    type: 'ruleHits',
    hits: { [usersKey]: { count: 1200, lastAt } },
  });
  assert.equal(badges(harness)[0].textContent, '999+');
  assert.match(badges(harness)[0].title, /^Applied 1200 times/);
});

test('the count stays with its rule when the list is rendered again', async () => {
  const rules = [usersRule, ordersRule];
  const harness = await uiWith(rules);
  const [usersKey] = keysOf(harness, rules);
  harness.emitPortMessage({
    type: 'ruleHits',
    hits: { [usersKey]: { count: 2, lastAt: Date.now() } },
  });

  // Move the first rule down with the keyboard: the list is rebuilt.
  harness.document.querySelector('#list .rule-drag-handle').dispatchEvent(
    new harness.window.KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    })
  );
  await flushUi(harness.window);

  assert.deepEqual(
    badges(harness).map(badge => badge.textContent),
    ['0', '2']
  );
});

test('an enabled rule with no hit gets a hint once requests went by', async () => {
  const rules = [usersRule, { ...ordersRule, enabled: false }];
  const harness = await uiWith(rules);
  const idle = () => badges(harness).map(badge => badge.classList.contains('rule-hits--idle'));
  assert.deepEqual(idle(), [false, false]);

  harness.emitPortMessage({
    type: 'apisDelta',
    apis: [{ url: `${TEST_DOMAIN}/api/other`, type: 'fetch' }],
  });
  assert.deepEqual(idle(), [true, false], 'a disabled rule gets no hint');
  assert.match(badges(harness)[0].title, /requests went by/);

  const [usersKey] = keysOf(harness, rules);
  harness.emitPortMessage({
    type: 'ruleHits',
    hits: { [usersKey]: { count: 1, lastAt: Date.now() } },
  });
  assert.deepEqual(idle(), [false, false]);
});

test('Reset counts zeroes the badges and asks the background to forget the counts', async () => {
  const rules = [usersRule];
  const harness = await uiWith(rules);
  const [usersKey] = keysOf(harness, rules);
  harness.emitPortMessage({
    type: 'ruleHits',
    hits: { [usersKey]: { count: 5, lastAt: Date.now() } },
  });
  assert.equal(badges(harness)[0].textContent, '5');

  harness.document
    .getElementById('reset-rule-hits-btn')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));

  assert.equal(badges(harness)[0].textContent, '0');
  assert.deepEqual(normalize(harness.sentMessages.at(-1)), { type: 'resetRuleHits', tabId: 99 });
});

test('counts never reach the saved rules or an exported file', async () => {
  const rules = [usersRule];
  const harness = await uiWith(rules);
  const [usersKey] = keysOf(harness, rules);
  harness.emitPortMessage({
    type: 'ruleHits',
    hits: { [usersKey]: { count: 5, lastAt: Date.now(), lastUrl: TEST_API_URL } },
  });

  // Toggling the rule saves the rules.
  const toggle = harness.document.querySelector('#list .rule-toggle');
  toggle.checked = false;
  toggle.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
  await flushUi(harness.window);
  harness.document
    .getElementById('export-rules-btn')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  const saved = harness.storageSets.at(-1);
  assert.deepEqual(normalize(saved[`overrides_${TEST_DOMAIN}`]), [
    { ...usersRule, enabled: false },
  ]);
  const exported = JSON.parse(harness.downloads[0].content);
  assert.deepEqual(exported.overrides, [
    { pattern: '/api/users', body: { mocked: true }, mode: 'text', enabled: false },
  ]);
  assert.equal(badges(harness)[0].textContent, '5', 'the count survives turning the rule off');
});
