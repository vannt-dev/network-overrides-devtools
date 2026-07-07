import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackgroundHarness, createBackgroundContext, normalize } from './test-harness.mjs';
import { TEST_DOMAIN, TEST_API_URL, TEST_DOWNLOAD_URL } from './config.mjs';

test('Background handles update messages by attaching and detaching the debugger', async () => {
  const harness = createBackgroundHarness();

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [{ pattern: 'users', body: '{"ok":true}', mode: 'text' }],
  });
  await Promise.resolve();

  assert.deepEqual(normalize(harness.attachedTabs), [{ target: { tabId: 7 }, version: '1.3' }]);
  assert.deepEqual(
    normalize(harness.commandLog.slice(0, 2).map(({ method, params }) => ({ method, params }))),
    [
      { method: 'Network.enable', params: {} },
      {
        method: 'Fetch.enable',
        params: { patterns: [{ requestStage: 'Request' }, { requestStage: 'Response' }] },
      },
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

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [],
  });

  harness.emitDebuggerEvent('Network.requestWillBeSent', {
    request: { url: TEST_API_URL },
    type: 'Fetch',
  });

  const apisResponse = harness.callMessage({ type: 'getApis', tabId: 7 });
  assert.equal(apisResponse.keepAlive, true);
  assert.deepEqual(normalize(apisResponse.response), {
    type: 'apisResponse',
    apis: [{ url: TEST_API_URL, type: 'Fetch', headers: [] }],
  });

  harness.responseBodies.set('req-1', {
    body: 'eyJuYW1lIjoiQWxpY2UifQ==',
    base64Encoded: true,
  });
  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-1',
    request: { url: TEST_API_URL },
    responseStatusCode: 200,
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
    url: TEST_API_URL,
  });
  assert.equal(bodyResponse.keepAlive, true);
  assert.deepEqual(normalize(bodyResponse.response), {
    type: 'apiDataResponse',
    url: TEST_API_URL,
    body: '{"name":"Alice"}',
  });
});

test('Background fulfills matching requests with override headers and body', async () => {
  const harness = createBackgroundHarness();

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [{ pattern: '/users$/', body: '{"mocked":true}', mode: 'text' }],
  });
  await Promise.resolve();

  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-2',
    request: { url: TEST_API_URL },
    responseHeaders: [{ name: 'Cache-Control', value: 'no-cache' }],
    responseStatusCode: 201,
    responseStatusText: 'Created',
    resourceType: 'Fetch',
  });
  await Promise.resolve();

  assert.deepEqual(normalize(harness.attachedTabs), [{ target: { tabId: 7 }, version: '1.3' }]);
  assert.deepEqual(
    normalize(harness.commandLog.slice(0, 2).map(({ method, params }) => ({ method, params }))),
    [
      { method: 'Network.enable', params: {} },
      {
        method: 'Fetch.enable',
        params: { patterns: [{ requestStage: 'Request' }, { requestStage: 'Response' }] },
      },
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

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [],
  });

  harness.emitDebuggerEvent('Network.requestWillBeSent', {
    request: { url: TEST_API_URL },
    type: 'Fetch',
  });

  const apisResponse = harness.callMessage({ type: 'getApis', tabId: 7 });
  assert.equal(apisResponse.keepAlive, true);
  assert.deepEqual(normalize(apisResponse.response), {
    type: 'apisResponse',
    apis: [{ url: TEST_API_URL, type: 'Fetch', headers: [] }],
  });

  harness.responseBodies.set('req-1', {
    body: 'eyJuYW1lIjoiQWxpY2UifQ==',
    base64Encoded: true,
  });
  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-1',
    request: { url: TEST_API_URL },
    responseStatusCode: 200,
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
    url: TEST_API_URL,
  });
  assert.equal(bodyResponse.keepAlive, true);
  assert.deepEqual(normalize(bodyResponse.response), {
    type: 'apiDataResponse',
    url: TEST_API_URL,
    body: '{"name":"Alice"}',
  });
});

test('Background fulfills matching requests with override headers and body', async () => {
  const harness = createBackgroundHarness();

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [{ pattern: '/users$/', body: '{"mocked":true}', mode: 'text' }],
  });
  await Promise.resolve();

  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-2',
    request: { url: TEST_API_URL },
    responseHeaders: [{ name: 'Cache-Control', value: 'no-cache' }],
    responseStatusCode: 201,
    responseStatusText: 'Created',
    resourceType: 'Fetch',
  });

  const fulfill = harness.commandLog.find(({ method }) => method === 'Fetch.fulfillRequest');
  assert.ok(fulfill);
  assert.equal(fulfill.params.requestId, 'req-2');
  assert.equal(fulfill.params.responseCode, 201);
  assert.equal(fulfill.params.responsePhrase, undefined);
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
  const storageUrl = `${TEST_DOMAIN}/api/from-storage`;
  harness.storageState.recentApis_42 = {
    [storageUrl]: 'fetch',
  };
  harness.storageState.recentApiBodies_42 = {
    [storageUrl]: '{"source":"storage"}',
  };

  const apisResponse = harness.callMessage({ type: 'getApis', tabId: 42 });
  assert.equal(apisResponse.keepAlive, true);
  assert.deepEqual(normalize(apisResponse.response), {
    type: 'apisResponse',
    apis: [
      {
        url: storageUrl,
        type: 'fetch',
      },
    ],
  });

  const bodyResponse = harness.callMessage({
    type: 'getApiData',
    tabId: 42,
    url: storageUrl,
  });
  assert.equal(bodyResponse.keepAlive, true);
  assert.deepEqual(normalize(bodyResponse.response), {
    type: 'apiDataResponse',
    url: storageUrl,
    body: '{"source":"storage"}',
  });
});

test('Background keeps raw base64 body unchanged when override mode is file', async () => {
  const harness = createBackgroundHarness();

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [{ pattern: 'download', body: 'UERGREFUQQ==', mode: 'file' }],
  });
  await Promise.resolve();

  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-file',
    request: { url: TEST_DOWNLOAD_URL },
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

test('Background glob matching with * wildcard', () => {
  const { NetworkOverridesBackground } = createBackgroundContext();

  assert.equal(
    NetworkOverridesBackground.patternMatches(
      'https://old.com/api/*/users',
      'https://old.com/api/v1/users'
    ),
    true
  );
  assert.equal(
    NetworkOverridesBackground.patternMatches(
      'https://old.com/api/*/users',
      'https://old.com/api/v1/admin'
    ),
    false
  );
  assert.equal(
    NetworkOverridesBackground.patternMatches('*/api/users', 'https://example.com/api/users'),
    true
  );
  assert.equal(
    NetworkOverridesBackground.patternMatches(
      'https://example.com/api/*',
      'https://example.com/api/users'
    ),
    true
  );
});

test('Background matchPattern captures wildcard segments', () => {
  const { NetworkOverridesBackground } = createBackgroundContext();

  assert.equal(NetworkOverridesBackground.matchPattern('*', 'https://example.com/api')?.length, 0);
  assert.equal(
    NetworkOverridesBackground.matchPattern(
      'https://old.com/api/*/users',
      'https://old.com/api/v1/users'
    )?.[0],
    'v1'
  );
  assert.equal(
    NetworkOverridesBackground.matchPattern(
      'https://old.com/api/*/*',
      'https://old.com/api/v1/users'
    )?.[1],
    'users'
  );
  assert.equal(
    NetworkOverridesBackground.matchPattern('nonexistent', 'https://example.com/api'),
    null
  );
});

test('Background substituteWildcards replaces * with captured segments', () => {
  const { NetworkOverridesBackground } = createBackgroundContext();

  assert.equal(
    NetworkOverridesBackground.substituteWildcards('https://new.com/api/*', ['v1']),
    'https://new.com/api/v1'
  );
  assert.equal(
    NetworkOverridesBackground.substituteWildcards('https://new.com/*/api/*', ['v1', 'users']),
    'https://new.com/v1/api/users'
  );
  assert.equal(
    NetworkOverridesBackground.substituteWildcards('https://new.com/api/v1', []),
    'https://new.com/api/v1'
  );
});

test('Background redirects requests when override has redirectUrl', async () => {
  const harness = createBackgroundHarness();

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [
      {
        pattern: `${TEST_DOMAIN}/api/*`,
        body: '',
        mode: 'text',
        redirectUrl: 'https://new-api.example.com/api/*',
      },
    ],
  });
  await Promise.resolve();

  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-redirect',
    request: { url: TEST_API_URL },
    resourceType: 'Fetch',
  });

  const continueCmd = harness.commandLog.find(
    ({ method, params }) =>
      method === 'Fetch.continueRequest' && params.requestId === 'req-redirect'
  );
  assert.ok(continueCmd);
  assert.equal(continueCmd.params.url, 'https://new-api.example.com/api/users');
});

test('Background does not fulfill body for redirect-only overrides at response stage', async () => {
  const harness = createBackgroundHarness();

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [
      {
        pattern: `${TEST_DOMAIN}/api/*`,
        body: '{"shouldNotBeUsed":true}',
        mode: 'text',
        redirectUrl: 'https://new-api.example.com/api/*',
      },
    ],
  });
  await Promise.resolve();

  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-response-redirect',
    request: { url: TEST_API_URL },
    responseStatusCode: 200,
    responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
    resourceType: 'Fetch',
  });
  await Promise.resolve();

  const fulfillCmd = harness.commandLog.find(
    ({ method, params }) =>
      method === 'Fetch.fulfillRequest' && params.requestId === 'req-response-redirect'
  );
  assert.equal(fulfillCmd, undefined);

  const continueCmd = harness.commandLog.find(
    ({ method, params }) =>
      method === 'Fetch.continueRequest' && params.requestId === 'req-response-redirect'
  );
  assert.ok(continueCmd);
});

test('Background skips disabled rules and method-mismatched rules, falling through to the next match', async () => {
  const harness = createBackgroundHarness();

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [
      { pattern: '/users$/', body: '{"disabled":true}', mode: 'text', enabled: false },
      { pattern: '/users$/', body: '{"wrongMethod":true}', mode: 'text', method: 'POST' },
      { pattern: '/users$/', body: '{"matched":true}', mode: 'text', method: 'GET' },
    ],
  });
  await Promise.resolve();

  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-method',
    request: { url: TEST_API_URL, method: 'GET' },
    responseStatusCode: 200,
    resourceType: 'Fetch',
  });

  const fulfill = harness.commandLog.find(
    ({ method, params }) => method === 'Fetch.fulfillRequest' && params.requestId === 'req-method'
  );
  assert.ok(fulfill);
  assert.equal(Buffer.from(fulfill.params.body, 'base64').toString('utf8'), '{"matched":true}');
});
