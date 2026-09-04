import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackgroundContext, normalize } from './test-harness.mjs';
import { createBackgroundHarness } from './background-test-harness.mjs';
import { TEST_DOMAIN, TEST_API_URL, TEST_DOWNLOAD_URL } from './config.mjs';

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

test('Navigation clears old-origin rules before the new-origin storage read completes', async () => {
  const harness = createBackgroundHarness();
  await harness.context.NetworkOverridesBackground.ready;

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: 'https://old.test/',
    enabled: true,
    overrides: [{ pattern: '*', body: '{"old":true}', mode: 'text' }],
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  const originalGet = harness.chrome.storage.local.get;
  let completeStorageRead;
  harness.chrome.storage.local.get = (keys, callback) => {
    completeStorageRead = () => originalGet(keys, callback);
  };
  harness.navigateTab(7, 'https://new.test/home');

  assert.deepEqual(normalize(harness.context.NetworkOverridesTabState.get(7).overrides), []);
  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-during-navigation',
    request: { url: 'https://new.test/api/users', method: 'GET' },
    responseStatusCode: 200,
    resourceType: 'Fetch',
  });
  assert.equal(
    harness.commandLog.some(
      ({ method, params }) =>
        method === 'Fetch.fulfillRequest' && params.requestId === 'req-during-navigation'
    ),
    false
  );
  assert.equal(typeof completeStorageRead, 'function');
  completeStorageRead();
});

test('Navigating to a new origin keeps global rules and loads local rules', async () => {
  const harness = createBackgroundHarness({
    storageState: {
      overrides_global: [
        { pattern: '/shared', body: '{"global":true}', mode: 'text', isGlobal: true },
      ],
      'overrides_https://new.test': [{ pattern: '/local', body: '{"local":true}', mode: 'text' }],
    },
  });
  await harness.context.NetworkOverridesBackground.ready;
  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: 'https://old.test/',
    enabled: true,
    overrides: [],
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  harness.navigateTab(7, 'https://new.test/home');
  const state = harness.context.NetworkOverridesTabState.get(7);
  assert.deepEqual(normalize(state.overrides), [
    { pattern: '/local', body: '{"local":true}', mode: 'text' },
    { pattern: '/shared', body: '{"global":true}', mode: 'text', isGlobal: true },
  ]);
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
  const failedUpdate = failing.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: 'https://a.test/',
    enabled: true,
    overrides: [],
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(normalize(failedUpdate.response), {
    type: 'updateResponse',
    success: false,
    attached: false,
    error: 'Another debugger is already attached',
  });
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
