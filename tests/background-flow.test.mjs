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
  await new Promise(resolve => setTimeout(resolve, 0));

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
test('Background enforces an imported disabled rule by not applying it: request passes through untouched', async () => {
  const harness = createBackgroundHarness();
  const domainOverridesKey = `overrides_${TEST_DOMAIN}`;

  // Shape this exactly like ui.ts's import handler now persists rules: only the
  // known OverrideRule fields, written under the domain-scoped storage key.
  harness.storageState[domainOverridesKey] = [
    { pattern: '/users$/', body: '{"shouldNotApply":true}', mode: 'text', enabled: false },
  ];

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: harness.storageState[domainOverridesKey],
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-disabled-only',
    request: { url: TEST_API_URL, method: 'GET' },
    responseStatusCode: 200,
    resourceType: 'Fetch',
  });

  const fulfill = harness.commandLog.find(
    ({ method, params }) =>
      method === 'Fetch.fulfillRequest' && params.requestId === 'req-disabled-only'
  );
  assert.equal(fulfill, undefined);

  const continueCmd = harness.commandLog.find(
    ({ method, params }) =>
      method === 'Fetch.continueRequest' && params.requestId === 'req-disabled-only'
  );
  assert.ok(continueCmd);
  assert.equal(continueCmd.params.body, undefined);
});

test('Background rehydrates from storage.session and re-attaches enabled tabs on startup', async () => {
  const harness = createBackgroundHarness({
    existingTabIds: [7, 8],
    sessionState: {
      tabState_8: {
        enabled: true,
        origin: 'https://b.test',
        overrides: [{ pattern: 'users', body: '{"mocked":true}', mode: 'text' }],
        attached: true,
        recentApis: {},
        recentApiBodies: {},
      },
    },
  });

  await harness.context.NetworkOverridesBackground.ready;

  assert.deepEqual(normalize(harness.attachedTabs), [{ target: { tabId: 8 }, version: '1.3' }]);
  const state = harness.context.NetworkOverridesTabState.get(8);
  assert.equal(state.attached, true);
  assert.deepEqual(normalize(state.overrides), [
    { pattern: 'users', body: '{"mocked":true}', mode: 'text' },
  ]);
});

test('Background startup removes legacy recentApis_* keys from storage.local', async () => {
  const harness = createBackgroundHarness({
    storageState: {
      recentApis_42: { 'https://x.test/a': { url: 'https://x.test/a', type: 'xhr' } },
      recentApiBodies_42: { 'https://x.test/a': '{}' },
      'overrides_https://x.test': [{ pattern: 'keep', body: '', mode: 'text' }],
      enabled: true,
    },
  });

  await harness.context.NetworkOverridesBackground.ready;

  assert.equal(harness.storageState.recentApis_42, undefined);
  assert.equal(harness.storageState.recentApiBodies_42, undefined);
  assert.deepEqual(normalize(harness.storageState['overrides_https://x.test']), [
    { pattern: 'keep', body: '', mode: 'text' },
  ]);
  assert.equal(harness.storageState.enabled, true);
});

test('Navigating to a new origin loads that origin saved rules and clears captured APIs', async () => {
  const harness = createBackgroundHarness({
    storageState: {
      'overrides_https://new.test': [{ pattern: 'orders', body: '{"new":true}', mode: 'text' }],
    },
  });
  await harness.context.NetworkOverridesBackground.ready;

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: 'https://old.test/',
    enabled: true,
    overrides: [{ pattern: 'users', body: '{"old":true}', mode: 'text' }],
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  harness.emitDebuggerEvent('Network.requestWillBeSent', {
    request: { url: 'https://old.test/api/users' },
    type: 'Fetch',
  });

  harness.navigateTab(7, 'https://new.test/home');
  await new Promise(resolve => setTimeout(resolve, 0));

  const state = harness.context.NetworkOverridesTabState.get(7);
  assert.equal(state.origin, 'https://new.test');
  assert.deepEqual(normalize(state.overrides), [
    { pattern: 'orders', body: '{"new":true}', mode: 'text' },
  ]);
  assert.equal(state.recentApis.size, 0);
});

test('Same-origin navigation leaves rules and captured APIs untouched', async () => {
  const harness = createBackgroundHarness();
  await harness.context.NetworkOverridesBackground.ready;

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: 'https://old.test/',
    enabled: true,
    overrides: [{ pattern: 'users', body: '{}', mode: 'text' }],
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  harness.emitDebuggerEvent('Network.requestWillBeSent', {
    request: { url: 'https://old.test/api/users' },
    type: 'Fetch',
  });

  harness.navigateTab(7, 'https://old.test/other-page');
  await new Promise(resolve => setTimeout(resolve, 0));

  const state = harness.context.NetworkOverridesTabState.get(7);
  assert.equal(state.overrides.length, 1);
  assert.equal(state.recentApis.size, 1);
});

test('Cross-origin requests are captured', async () => {
  const harness = createBackgroundHarness();
  await harness.context.NetworkOverridesBackground.ready;

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: 'https://app.test/',
    enabled: true,
    overrides: [],
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  harness.emitDebuggerEvent('Network.requestWillBeSent', {
    request: { url: 'https://api.other.test/v1/users' },
    type: 'Fetch',
  });

  const { response } = harness.callMessage({ type: 'getApis', tabId: 7 });
  assert.deepEqual(normalize(response.apis.map(api => api.url)), [
    'https://api.other.test/v1/users',
  ]);
});

test('Background enforces an imported method-restricted rule by not applying it: request passes through untouched', async () => {
  const harness = createBackgroundHarness();
  const domainOverridesKey = `overrides_${TEST_DOMAIN}`;

  harness.storageState[domainOverridesKey] = [
    { pattern: '/users$/', body: '{"shouldNotApply":true}', mode: 'text', method: 'POST' },
  ];

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: harness.storageState[domainOverridesKey],
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-method-only',
    request: { url: TEST_API_URL, method: 'GET' },
    responseStatusCode: 200,
    resourceType: 'Fetch',
  });

  const fulfill = harness.commandLog.find(
    ({ method, params }) =>
      method === 'Fetch.fulfillRequest' && params.requestId === 'req-method-only'
  );
  assert.equal(fulfill, undefined);

  const continueCmd = harness.commandLog.find(
    ({ method, params }) =>
      method === 'Fetch.continueRequest' && params.requestId === 'req-method-only'
  );
  assert.ok(continueCmd);
});

test('getStatus reports attach success and failure', async () => {
  const harness = createBackgroundHarness();
  await harness.context.NetworkOverridesBackground.ready;

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: 'https://a.test/',
    enabled: true,
    overrides: [],
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  let { response } = harness.callMessage({ type: 'getStatus', tabId: 7 });
  assert.deepEqual(normalize(response), { type: 'statusResponse', attached: true });

  const failing = createBackgroundHarness();
  await failing.context.NetworkOverridesBackground.ready;
  failing.setAttachError('Another debugger is already attached');
  failing.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: 'https://a.test/',
    enabled: true,
    overrides: [],
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  ({ response } = failing.callMessage({ type: 'getStatus', tabId: 7 }));
  assert.deepEqual(normalize(response), {
    type: 'statusResponse',
    attached: false,
    error: 'Another debugger is already attached',
  });
  assert.equal(failing.context.NetworkOverridesTabState.get(7).enabled, false);
});

test('Rehydrate adopts a debugger session that survived the worker restart', async () => {
  // chrome.debugger sessions belong to the extension, not the worker instance:
  // after an idle-kill the session is still attached, so the fresh attach fails
  // with "already attached". The background must adopt that session instead of
  // treating it as a failure and disabling the tab.
  const harness = createBackgroundHarness({
    existingTabIds: [7, 8],
    preAttachedTabIds: [8],
    sessionState: {
      tabState_8: {
        enabled: true,
        origin: 'https://b.test',
        overrides: [{ pattern: 'users', body: '{"mocked":true}', mode: 'text' }],
        attached: true,
        recentApis: {},
        recentApiBodies: {},
      },
    },
  });

  await harness.context.NetworkOverridesBackground.ready;

  const state = harness.context.NetworkOverridesTabState.get(8);
  assert.equal(state.attached, true);
  assert.equal(state.enabled, true);
  assert.equal(state.attachError, undefined);
  assert.equal(
    harness.commandLog.some(
      ({ target, method }) => target.tabId === 8 && method === 'Fetch.enable'
    ),
    true
  );
});

test('External debugger detach disables interception but keeps captured data', async () => {
  const harness = createBackgroundHarness();
  await harness.context.NetworkOverridesBackground.ready;

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [{ pattern: 'users', body: '{}', mode: 'text' }],
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  harness.emitDebuggerEvent('Network.requestWillBeSent', {
    request: { url: TEST_API_URL },
    type: 'Fetch',
  });

  // User clicks Cancel on the debugging infobar: the tab is still open, so the
  // captured data and rules must survive — only interception stops.
  harness.emitDetach(7, 'canceled_by_user');
  await new Promise(resolve => setTimeout(resolve, 0));

  const state = harness.context.NetworkOverridesTabState.get(7);
  assert.ok(state, 'tab state must not be disposed');
  assert.equal(state.attached, false);
  assert.equal(state.enabled, false);
  assert.equal(state.recentApis.size, 1);
  assert.equal(state.overrides.length, 1);

  // The persisted snapshot must survive too, with enabled off so a worker
  // restart does not silently re-attach against the user's cancellation.
  await harness.context.NetworkOverridesTabState.flushPersist(7);
  const snapshot = harness.sessionState['tabState_7'];
  assert.ok(snapshot);
  assert.equal(snapshot.enabled, false);

  const { response } = harness.callMessage({ type: 'getStatus', tabId: 7 });
  assert.equal(response.attached, false);
  assert.match(String(response.error), /detach/i);
});

test('getStatus during an in-flight attach waits for the outcome instead of answering stale state', async () => {
  const harness = createBackgroundHarness();
  await harness.context.NetworkOverridesBackground.ready;

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: 'https://a.test/',
    enabled: true,
    overrides: [],
  });
  // No timer flush: the attach callback has not run yet, so a naive getStatus
  // would answer { attached: false } with no error.
  let response;
  const keepAlive = harness.listeners.onMessage({ type: 'getStatus', tabId: 7 }, {}, value => {
    response = value;
  });
  assert.equal(keepAlive, true);
  assert.equal(response, undefined); // must not answer before the attach settles
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(normalize(response), { type: 'statusResponse', attached: true });
});

test('Concurrent update messages attach the debugger exactly once', async () => {
  const harness = createBackgroundHarness();
  await harness.context.NetworkOverridesBackground.ready;

  const msg = { type: 'update', tabId: 7, tabUrl: 'https://a.test/', enabled: true, overrides: [] };
  harness.callMessage(msg);
  harness.callMessage(msg);
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(harness.attachedTabs.length, 1);
});

test('Background fails matching requests with the configured error reason', async () => {
  const harness = createBackgroundHarness();

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [{ pattern: '/users$/', body: '', mode: 'text', failReason: 'ConnectionRefused' }],
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-fail',
    request: { url: TEST_API_URL, method: 'GET' },
    resourceType: 'Fetch',
  });

  const failCmd = harness.commandLog.find(
    ({ method, params }) => method === 'Fetch.failRequest' && params.requestId === 'req-fail'
  );
  assert.ok(failCmd);
  assert.equal(failCmd.params.errorReason, 'ConnectionRefused');
  assert.equal(
    harness.commandLog.some(
      ({ method, params }) =>
        (method === 'Fetch.continueRequest' || method === 'Fetch.fulfillRequest') &&
        params.requestId === 'req-fail'
    ),
    false
  );
});

test('Background delays a fail rule before failing the request', async () => {
  const harness = createBackgroundHarness();

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [
      { pattern: '/users$/', body: '', mode: 'text', failReason: 'TimedOut', delayMs: 30 },
    ],
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-fail-delayed',
    request: { url: TEST_API_URL },
    resourceType: 'Fetch',
  });

  const findFail = () =>
    harness.commandLog.find(
      ({ method, params }) =>
        method === 'Fetch.failRequest' && params.requestId === 'req-fail-delayed'
    );
  assert.equal(findFail(), undefined); // not yet — the delay is pending
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.ok(findFail());
  assert.equal(findFail().params.errorReason, 'TimedOut');
});

test('Background fulfills with the rule statusCode instead of the original status', async () => {
  const harness = createBackgroundHarness();

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [{ pattern: '/users$/', body: '{"m":1}', mode: 'text', statusCode: 503 }],
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-status',
    request: { url: TEST_API_URL },
    responseStatusCode: 200,
    resourceType: 'Fetch',
  });

  const fulfill = harness.commandLog.find(
    ({ method, params }) => method === 'Fetch.fulfillRequest' && params.requestId === 'req-status'
  );
  assert.ok(fulfill);
  assert.equal(fulfill.params.responseCode, 503);
});

test('Background merges rule responseHeaders over the originals and keeps the markers', async () => {
  const harness = createBackgroundHarness();

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [
      {
        pattern: '/users$/',
        body: '{"m":1}',
        mode: 'text',
        responseHeaders: [
          { name: 'content-type', value: 'text/plain' }, // overwrites, case-insensitive
          { name: 'X-Custom', value: 'yes' }, // appends
        ],
      },
    ],
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-headers',
    request: { url: TEST_API_URL },
    responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
    responseStatusCode: 200,
    resourceType: 'Fetch',
  });

  const fulfill = harness.commandLog.find(
    ({ method, params }) => method === 'Fetch.fulfillRequest' && params.requestId === 'req-headers'
  );
  assert.ok(fulfill);
  const headers = fulfill.params.responseHeaders;
  const contentTypes = headers.filter(header => header.name.toLowerCase() === 'content-type');
  assert.equal(contentTypes.length, 1); // overwritten, not duplicated
  assert.equal(contentTypes[0].value, 'text/plain');
  assert.equal(
    headers.some(header => header.name === 'X-Custom' && header.value === 'yes'),
    true
  );
  assert.equal(
    headers.some(header => header.name === 'x-network-overrides' && header.value === 'true'),
    true
  );
});

test('Background delays fulfillment when the rule has delayMs', async () => {
  const harness = createBackgroundHarness();

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [{ pattern: '/users$/', body: '{"m":1}', mode: 'text', delayMs: 30 }],
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-delayed',
    request: { url: TEST_API_URL },
    responseStatusCode: 200,
    resourceType: 'Fetch',
  });

  const findFulfill = () =>
    harness.commandLog.find(
      ({ method, params }) =>
        method === 'Fetch.fulfillRequest' && params.requestId === 'req-delayed'
    );
  assert.equal(findFulfill(), undefined); // still waiting
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.ok(findFulfill());
});
