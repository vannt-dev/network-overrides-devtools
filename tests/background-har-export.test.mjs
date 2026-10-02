import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from './test-harness.mjs';
import { createBackgroundHarness } from './background-test-harness.mjs';
import { TEST_DOMAIN, TEST_API_URL } from './config.mjs';

const OTHER_URL = `${TEST_DOMAIN}/api/without-body`;

test('getApis attaches captured bodies only when asked to', async () => {
  const harness = createBackgroundHarness();
  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [],
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  harness.emitDebuggerEvent('Network.requestWillBeSent', {
    request: { url: TEST_API_URL },
    type: 'Fetch',
  });
  harness.emitDebuggerEvent('Network.requestWillBeSent', {
    request: { url: OTHER_URL },
    type: 'Fetch',
  });
  harness.responseBodies.set('req-1', { body: '{"name":"Alice"}', base64Encoded: false });
  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-1',
    request: { url: TEST_API_URL },
    responseStatusCode: 200,
    resourceType: 'Fetch',
  });

  const plain = normalize(harness.callMessage({ type: 'getApis', tabId: 7 }).response);
  assert.equal(
    plain.apis.some(api => 'body' in api),
    false,
    'the list stays light by default'
  );

  const full = normalize(
    harness.callMessage({ type: 'getApis', tabId: 7, includeBodies: true }).response
  );
  const byUrl = Object.fromEntries(full.apis.map(api => [api.url, api]));
  assert.equal(byUrl[TEST_API_URL].body, '{"name":"Alice"}');
  assert.equal('body' in byUrl[OTHER_URL], false);
});

test('getApis attaches bodies from the session snapshot after a worker restart', async () => {
  const harness = createBackgroundHarness();
  harness.sessionState['tabState_7'] = {
    enabled: false,
    origin: '',
    overrides: [],
    recentApis: {
      [TEST_API_URL]: { url: TEST_API_URL, type: 'fetch' },
      [OTHER_URL]: { url: OTHER_URL, type: 'fetch' },
    },
    recentApiBodies: { [TEST_API_URL]: '{"cached":true}' },
  };

  let result;
  const keepAlive = harness.listeners.onMessage(
    { type: 'getApis', tabId: 7, includeBodies: true },
    {},
    value => {
      result = value;
    }
  );
  assert.equal(keepAlive, true);
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.deepEqual(normalize(result), {
    type: 'apisResponse',
    apis: [
      { url: TEST_API_URL, type: 'fetch', body: '{"cached":true}' },
      { url: OTHER_URL, type: 'fetch' },
    ],
  });
});
