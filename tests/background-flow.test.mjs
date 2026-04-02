import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackgroundHarness, normalize } from './test-harness.mjs';

test('Background handles update messages by attaching and detaching the debugger', async () => {
  const harness = createBackgroundHarness();

  harness.callMessage({
    type: 'update',
    tabId: 7,
    enabled: true,
    overrides: [{ pattern: 'users', body: '{"ok":true}', mode: 'text' }],
  });
  await Promise.resolve();

  assert.deepEqual(normalize(harness.attachedTabs), [{ target: { tabId: 7 }, version: '1.3' }]);
  assert.deepEqual(
    normalize(harness.commandLog.slice(0, 2).map(({ method, params }) => ({ method, params }))),
    [
      { method: 'Network.enable', params: {} },
      { method: 'Fetch.enable', params: { patterns: [{ requestStage: 'Response' }] } },
    ]
  );

  harness.removeTab(7);
  await Promise.resolve();

  assert.equal(
    harness.commandLog.some(({ method }) => method === 'Fetch.disable'),
    true
  );
  assert.deepEqual(normalize(harness.detachedTabs), [{ tabId: 7 }]);
});

test('Background stores recent APIs and response bodies, then returns them through message handlers', () => {
  const harness = createBackgroundHarness();

  harness.emitDebuggerEvent('Network.requestWillBeSent', {
    request: { url: 'https://example.com/api/users' },
    type: 'Fetch',
  });

  const apisResponse = harness.callMessage({ type: 'getApis', tabId: 7 });
  assert.equal(apisResponse.keepAlive, true);
  assert.deepEqual(normalize(apisResponse.response), {
    type: 'apisResponse',
    apis: [{ url: 'https://example.com/api/users', type: 'Fetch' }],
  });

  harness.responseBodies.set('req-1', {
    body: 'eyJuYW1lIjoiQWxpY2UifQ==',
    base64Encoded: true,
  });
  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-1',
    request: { url: 'https://example.com/api/users' },
    resourceType: 'Fetch',
  });

  assert.equal(
    harness.commandLog.some(({ method }) => method === 'Fetch.getResponseBody'),
    true
  );
  assert.equal(
    harness.commandLog.some(({ method }) => method === 'Fetch.continueRequest'),
    true
  );

  const bodyResponse = harness.callMessage({
    type: 'getApiData',
    tabId: 7,
    url: 'https://example.com/api/users',
  });
  assert.equal(bodyResponse.keepAlive, true);
  assert.deepEqual(normalize(bodyResponse.response), {
    type: 'apiDataResponse',
    url: 'https://example.com/api/users',
    body: '{"name":"Alice"}',
  });
});

test('Background fulfills matching requests with override headers and body', async () => {
  const harness = createBackgroundHarness();

  harness.callMessage({
    type: 'update',
    tabId: 7,
    enabled: true,
    overrides: [{ pattern: '/users$/', body: '{"mocked":true}', mode: 'text' }],
  });
  await Promise.resolve();

  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-2',
    request: { url: 'https://example.com/api/users' },
    responseHeaders: [{ name: 'Cache-Control', value: 'no-cache' }],
    responseStatusCode: 201,
    responseStatusText: 'Created',
    resourceType: 'Fetch',
  });

  const fulfill = harness.commandLog.find(({ method }) => method === 'Fetch.fulfillRequest');
  assert.ok(fulfill);
  assert.equal(fulfill.params.requestId, 'req-2');
  assert.equal(fulfill.params.responseCode, 201);
  assert.equal(fulfill.params.responsePhrase, 'Created');
  assert.equal(Buffer.from(fulfill.params.body, 'base64').toString('utf8'), '{"mocked":true}');
  assert.equal(
    fulfill.params.responseHeaders.some(
      header => header.name === 'Content-Type' && header.value.includes('application/json')
    ),
    true
  );
  assert.equal(
    fulfill.params.responseHeaders.some(
      header => header.name === 'x-network-overrides' && header.value === 'true'
    ),
    true
  );
  assert.equal(
    fulfill.params.responseHeaders.some(
      header => header.name === 'x-network-overrides-pattern' && header.value === '/users$/'
    ),
    true
  );
});

test('Background falls back to chrome.storage.local when API caches are empty', () => {
  const harness = createBackgroundHarness();
  harness.storageState.recentApis_42 = {
    'https://example.com/api/from-storage': 'fetch',
  };
  harness.storageState.recentApiBodies_42 = {
    'https://example.com/api/from-storage': '{"source":"storage"}',
  };

  const apisResponse = harness.callMessage({ type: 'getApis', tabId: 42 });
  assert.equal(apisResponse.keepAlive, true);
  assert.deepEqual(normalize(apisResponse.response), {
    type: 'apisResponse',
    apis: [
      {
        url: 'https://example.com/api/from-storage',
        type: 'fetch',
      },
    ],
  });

  const bodyResponse = harness.callMessage({
    type: 'getApiData',
    tabId: 42,
    url: 'https://example.com/api/from-storage',
  });
  assert.equal(bodyResponse.keepAlive, true);
  assert.deepEqual(normalize(bodyResponse.response), {
    type: 'apiDataResponse',
    url: 'https://example.com/api/from-storage',
    body: '{"source":"storage"}',
  });
});

test('Background keeps raw base64 body unchanged when override mode is file', async () => {
  const harness = createBackgroundHarness();

  harness.callMessage({
    type: 'update',
    tabId: 7,
    enabled: true,
    overrides: [{ pattern: 'download', body: 'UERGREFUQQ==', mode: 'file' }],
  });
  await Promise.resolve();

  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-file',
    request: { url: 'https://example.com/api/download' },
    responseHeaders: [{ name: 'Content-Type', value: 'application/octet-stream' }],
    responseStatusCode: 200,
    resourceType: 'Fetch',
  });

  const fulfill = harness.commandLog.find(
    ({ method, params }) => method === 'Fetch.fulfillRequest' && params.requestId === 'req-file'
  );
  assert.ok(fulfill);
  assert.equal(fulfill.params.body, 'UERGREFUQQ==');
  assert.equal(
    fulfill.params.responseHeaders.some(
      header => header.name === 'Content-Type' && header.value === 'application/octet-stream'
    ),
    true
  );
});
