import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackgroundContext, normalize } from './test-harness.mjs';
import { createBackgroundHarness } from './background-test-harness.mjs';
import { TEST_DOMAIN, TEST_API_URL, TEST_DOWNLOAD_URL } from './config.mjs';

test('Background handles update messages by attaching and detaching the debugger', async () => {
  const harness = createBackgroundHarness();

  const updateResult = harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [{ pattern: 'users', body: '{"ok":true}', mode: 'text' }],
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(updateResult.keepAlive, true);
  assert.deepEqual(normalize(updateResult.response), {
    type: 'updateResponse',
    success: true,
    attached: true,
  });

  assert.deepEqual(normalize(harness.attachedTabs), [{ target: { tabId: 7 }, version: '1.3' }]);
  assert.deepEqual(
    normalize(harness.commandLog.slice(0, 3).map(({ method, params }) => ({ method, params }))),
    [
      { method: 'Network.enable', params: {} },
      {
        method: 'Network.emulateNetworkConditions',
        params: {
          offline: false,
          latency: 0,
          downloadThroughput: -1,
          uploadThroughput: -1,
        },
      },
      {
        method: 'Fetch.enable',
        params: { patterns: [{ requestStage: 'Request' }, { requestStage: 'Response' }] },
      },
    ]
  );

  harness.removeTab(7);
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(
    harness.commandLog.some(({ method }) => method === 'Fetch.disable'),
    true
  );
  assert.deepEqual(normalize(harness.detachedTabs), [{ tabId: 7 }]);
});

test('Background stores recent APIs and response bodies, then returns them through message handlers', async () => {
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
  await new Promise(resolve => setTimeout(resolve, 0));

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

test('Background falls back to chrome.storage.session when memory is empty (cold start)', async () => {
  const harness = createBackgroundHarness();
  harness.sessionState['tabState_7'] = {
    enabled: false,
    origin: '',
    overrides: [],
    recentApis: { [TEST_API_URL]: { url: TEST_API_URL, type: 'fetch' } },
    recentApiBodies: { [TEST_API_URL]: '{"cached":true}' },
  };

  let apisResult;
  const apisKeepAlive = harness.listeners.onMessage({ type: 'getApis', tabId: 7 }, {}, value => {
    apisResult = value;
  });
  assert.equal(apisKeepAlive, true);
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(normalize(apisResult), {
    type: 'apisResponse',
    apis: [{ url: TEST_API_URL, type: 'fetch' }],
  });

  let bodyResult;
  const bodyKeepAlive = harness.listeners.onMessage(
    { type: 'getApiData', tabId: 7, url: TEST_API_URL },
    {},
    value => {
      bodyResult = value;
    }
  );
  assert.equal(bodyKeepAlive, true);
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(normalize(bodyResult), {
    type: 'apiDataResponse',
    url: TEST_API_URL,
    body: '{"cached":true}',
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
  await new Promise(resolve => setTimeout(resolve, 0));

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

test('Background falls back to text encoding when a file-mode body is not valid base64', async () => {
  const harness = createBackgroundHarness();

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [{ pattern: 'download', body: 'not@base64!!', mode: 'file' }],
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-bad-base64',
    request: { url: TEST_DOWNLOAD_URL },
    responseStatusCode: 200,
    resourceType: 'Fetch',
  });

  const fulfill = harness.commandLog.find(
    ({ method, params }) =>
      method === 'Fetch.fulfillRequest' && params.requestId === 'req-bad-base64'
  );
  assert.ok(fulfill);
  assert.equal(Buffer.from(fulfill.params.body, 'base64').toString('utf8'), 'not@base64!!');
});

test('Background passes the request through when the redirect URL has unsubstituted wildcards', async () => {
  const harness = createBackgroundHarness();

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [
      // pattern has no wildcard, so there is no capture to substitute into the redirect
      {
        pattern: `${TEST_DOMAIN}/api/users`,
        body: '',
        mode: 'text',
        redirectUrl: 'https://new.test/*',
      },
    ],
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-unsub',
    request: { url: TEST_API_URL },
    resourceType: 'Fetch',
  });

  const continueCmd = harness.commandLog.find(
    ({ method, params }) => method === 'Fetch.continueRequest' && params.requestId === 'req-unsub'
  );
  assert.ok(continueCmd);
  assert.equal(continueCmd.params.url, undefined); // passed through, not redirected
  assert.equal(
    harness.errors.some(args => args.some(arg => String(arg).includes('Unsubstituted'))),
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
  await new Promise(resolve => setTimeout(resolve, 0));

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
  await new Promise(resolve => setTimeout(resolve, 0));

  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-response-redirect',
    request: { url: TEST_API_URL },
    responseStatusCode: 200,
    responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
    resourceType: 'Fetch',
  });
  await new Promise(resolve => setTimeout(resolve, 0));

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
  await new Promise(resolve => setTimeout(resolve, 0));

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

// The test above proves a disabled/mismatched rule is skipped in favor of a later
// matching rule. These two prove the terminal case an import can produce: a single
// rule, written to storage exactly as ui.ts's persistOverrides() would write it
// (only known OverrideRule fields, disabled or method-restricted), with nothing
// else to fall through to — the request must pass through completely untouched.
