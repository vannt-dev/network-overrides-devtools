import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from './test-harness.mjs';
import { createBackgroundHarness } from './background-test-harness.mjs';
import { TEST_DOMAIN } from './config.mjs';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const wsRule = {
  pattern: 'wss://x.test/*',
  body: 'mock',
  mode: 'text',
  kind: 'websocket',
  wsAction: 'replace',
};
const methods = harness => harness.commandLog.map(({ method }) => method);

async function update(harness, overrides, enabled = true) {
  harness.callMessage({ type: 'update', tabId: 7, tabUrl: `${TEST_DOMAIN}/`, enabled, overrides });
  for (let i = 0; i < 5; i += 1) await settle();
}

test('HTTP-only rules send no WebSocket commands', async () => {
  const harness = createBackgroundHarness();
  await update(harness, [{ pattern: 'users', body: '{}', mode: 'text' }]);
  assert.deepEqual(
    methods(harness).filter(m => m.startsWith('Runtime.') || m.startsWith('Page.')),
    []
  );
});

test('attaching with a WebSocket rule installs the binding and the wrapper', async () => {
  const harness = createBackgroundHarness();
  await update(harness, [wsRule]);
  const wsCommands = harness.commandLog.filter(
    ({ method }) => method.startsWith('Runtime.') || method.startsWith('Page.')
  );
  assert.deepEqual(
    wsCommands.map(({ method }) => method),
    [
      'Runtime.enable',
      'Page.enable',
      'Runtime.addBinding',
      'Page.addScriptToEvaluateOnNewDocument',
      'Runtime.evaluate',
    ]
  );
  assert.deepEqual(normalize(wsCommands[2].params), { name: '__nowsReport' });
  const source = wsCommands[3].params.source;
  assert.equal(wsCommands[4].params.expression, source);
  assert.ok(source.startsWith('((function (rules)'));
  assert.ok(source.includes(JSON.stringify([wsRule])));
});

test('update while attached re-syncs: old script removed, new one added', async () => {
  const harness = createBackgroundHarness();
  await update(harness, [wsRule]);
  harness.commandLog.length = 0;
  const changed = { ...wsRule, body: 'changed' };
  await update(harness, [changed]);
  assert.deepEqual(methods(harness), [
    'Page.removeScriptToEvaluateOnNewDocument',
    'Page.addScriptToEvaluateOnNewDocument',
    'Runtime.evaluate',
  ]);
  assert.deepEqual(normalize(harness.commandLog[0].params), { identifier: '1' });
  assert.ok(harness.commandLog[1].params.source.includes('"changed"'));
});

test('disabled WebSocket rules are not sent to the page', async () => {
  const harness = createBackgroundHarness();
  await update(harness, [wsRule]);
  harness.commandLog.length = 0;
  await update(harness, [{ ...wsRule, enabled: false }]);
  assert.deepEqual(methods(harness), [
    'Page.removeScriptToEvaluateOnNewDocument',
    'Runtime.evaluate',
  ]);
  assert.ok(harness.commandLog[1].params.expression.includes('setRules([])'));
});

test('turning interception off pushes empty rules before detaching', async () => {
  const harness = createBackgroundHarness();
  await update(harness, [wsRule]);
  harness.commandLog.length = 0;
  await update(harness, [wsRule], false);
  const order = methods(harness);
  assert.ok(order.indexOf('Runtime.evaluate') < order.indexOf('Fetch.disable'));
  const evaluate = harness.commandLog.find(({ method }) => method === 'Runtime.evaluate');
  assert.ok(evaluate.params.expression.includes('setRules([])'));
});

test('re-attach resets the bridge instead of removing a stale script id', async () => {
  const harness = createBackgroundHarness();
  await update(harness, [wsRule]);
  harness.emitDetach(7);
  await settle();
  harness.commandLog.length = 0;
  await update(harness, [wsRule]);
  const wsMethods = methods(harness).filter(m => m.startsWith('Runtime.') || m.startsWith('Page.'));
  assert.deepEqual(wsMethods, [
    'Runtime.enable',
    'Page.enable',
    'Runtime.addBinding',
    'Page.addScriptToEvaluateOnNewDocument',
    'Runtime.evaluate',
  ]);
});

test('an applied report raises the Overridden counter', async () => {
  const harness = createBackgroundHarness();
  await update(harness, [wsRule]);
  harness.emitDebuggerEvent('Runtime.bindingCalled', {
    name: '__nowsReport',
    payload: '{"event":"applied"}',
  });
  harness.emitDebuggerEvent('Runtime.bindingCalled', { name: 'other', payload: '{}' });
  harness.emitDebuggerEvent('Runtime.bindingCalled', { name: '__nowsReport', payload: 'not json' });
  assert.equal(harness.context.NetworkOverridesTabState.get(7).stats.totalOverridden, 1);
});

test('a WebSocket handshake is recorded as a websocket API', async () => {
  const harness = createBackgroundHarness();
  await update(harness, [wsRule]);
  harness.emitDebuggerEvent('Network.webSocketCreated', {
    requestId: '1',
    url: 'wss://x.test/feed',
  });
  const apis = harness.callMessage({ type: 'getApis', tabId: 7 });
  await settle();
  assert.ok(
    normalize(apis.response.apis).some(
      api => api.url === 'wss://x.test/feed' && api.type === 'websocket'
    )
  );
});

test('HTTP interception ignores WebSocket rules', async () => {
  const harness = createBackgroundHarness();
  await update(harness, [{ ...wsRule, pattern: '*' }]);
  harness.commandLog.length = 0;
  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'r1',
    request: { url: `${TEST_DOMAIN}/logo.png`, method: 'GET', headers: {} },
    resourceType: 'Image',
    // Response stage: a matching body rule would answer with Fetch.fulfillRequest.
    responseStatusCode: 200,
    responseHeaders: [],
  });
  await settle();
  assert.deepEqual(methods(harness), ['Fetch.continueRequest']);
});

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const isClear = ({ method, params }) =>
  method === 'Runtime.evaluate' && params.expression.includes('setRules([])');

test('turning off right after a rule change clears the page before detaching', async () => {
  const harness = createBackgroundHarness({ deferCommandCallbacks: true });
  const first = harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [wsRule],
  });
  // Wait for the attach to finish rather than for a fixed time.
  for (let i = 0; i < 200 && first.response === undefined; i += 1) await wait(2);
  assert.equal(first.response?.attached, true);
  harness.commandLog.length = 0;
  const changed = [{ ...wsRule, body: 'changed' }];
  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: changed,
  });
  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: false,
    overrides: changed,
  });
  await wait(80);

  const log = harness.commandLog;
  const disable = log.findIndex(({ method }) => method === 'Fetch.disable');
  const lastAdd = log.findLastIndex(
    ({ method }) => method === 'Page.addScriptToEvaluateOnNewDocument'
  );
  const clear = log.findLastIndex(isClear);
  assert.ok(disable > 0, 'detached: ' + JSON.stringify(log.map(c => c.method)));
  assert.ok(clear > lastAdd && clear < disable, JSON.stringify(log.map(c => c.method)));
});

test('a rule change during the first attach reaches the page', async () => {
  const harness = createBackgroundHarness({ deferCommandCallbacks: true });
  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [{ ...wsRule, body: 'first' }],
  });
  // Wait until the first sync has read the rules, then change them.
  for (let i = 0; i < 100 && !harness.commandLog.some(c => c.method === 'Runtime.enable'); i += 1) {
    await wait(1);
  }
  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [{ ...wsRule, body: 'second' }],
  });
  await wait(120);

  const adds = harness.commandLog.filter(
    ({ method }) => method === 'Page.addScriptToEvaluateOnNewDocument'
  );
  assert.ok(adds.at(-1).params.source.includes('"second"'));
});

test('re-attaching without WebSocket rules clears a wrapper left in the page', async () => {
  const harness = createBackgroundHarness();
  await update(harness, [wsRule]);
  harness.emitDetach(7);
  await settle();
  harness.commandLog.length = 0;
  await update(harness, [{ pattern: 'users', body: '{}', mode: 'text' }]);
  assert.ok(harness.commandLog.some(isClear));
});

test('a navigation while detached sends nothing to the dead session', async () => {
  const harness = createBackgroundHarness();
  await update(harness, [wsRule]);
  harness.emitDetach(7);
  await settle();
  harness.commandLog.length = 0;
  harness.navigateTab(7, 'https://other.example/');
  for (let i = 0; i < 5; i += 1) await settle();
  assert.deepEqual(methods(harness), []);
});
