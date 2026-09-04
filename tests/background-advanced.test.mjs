import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackgroundContext, normalize } from './test-harness.mjs';
import { createBackgroundHarness } from './background-test-harness.mjs';
import { TEST_DOMAIN, TEST_API_URL, TEST_DOWNLOAD_URL } from './config.mjs';

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

test('Background removes stale body-dependent response headers when fulfilling a new body', async () => {
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
    requestId: 'req-compressed-headers',
    request: { url: TEST_API_URL },
    responseHeaders: [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'Content-Encoding', value: 'br' },
      { name: 'Content-Length', value: '999' },
      { name: 'Transfer-Encoding', value: 'chunked' },
      { name: 'Digest', value: 'sha-256=stale' },
      { name: 'X-Network-Overrides', value: 'false' },
    ],
    responseStatusCode: 200,
    resourceType: 'Fetch',
  });

  const fulfill = harness.commandLog.find(
    ({ method, params }) =>
      method === 'Fetch.fulfillRequest' && params.requestId === 'req-compressed-headers'
  );
  assert.ok(fulfill);
  const byName = name =>
    fulfill.params.responseHeaders.filter(header => header.name.toLowerCase() === name);
  assert.equal(byName('content-encoding').length, 0);
  assert.equal(byName('content-length').length, 0);
  assert.equal(byName('transfer-encoding').length, 0);
  assert.equal(byName('digest').length, 0);
  assert.deepEqual(
    byName('x-network-overrides').map(header => header.value),
    ['true']
  );
});

test('Background honors processTemplates false', async () => {
  const harness = createBackgroundHarness();
  const literalBody = '{"token":"{{$uuid}}"}';

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [{ pattern: '/users$/', body: literalBody, mode: 'text', processTemplates: false }],
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-no-templates',
    request: { url: TEST_API_URL },
    responseStatusCode: 200,
    resourceType: 'Fetch',
  });

  const fulfill = harness.commandLog.find(
    ({ method, params }) =>
      method === 'Fetch.fulfillRequest' && params.requestId === 'req-no-templates'
  );
  assert.equal(Buffer.from(fulfill.params.body, 'base64').toString('utf8'), literalBody);
});

test('Background skips rule headers that conflict with marker headers', async () => {
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
          { name: 'X-Network-Overrides', value: 'false' },
          { name: 'X-Network-Overrides-Pattern', value: 'should-be-skipped' },
          { name: 'X-Custom', value: 'yes' },
        ],
      },
    ],
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-marker-conflict',
    request: { url: TEST_API_URL },
    responseStatusCode: 200,
    resourceType: 'Fetch',
  });

  const fulfill = harness.commandLog.find(
    ({ method, params }) =>
      method === 'Fetch.fulfillRequest' && params.requestId === 'req-marker-conflict'
  );
  assert.ok(fulfill);
  const headers = fulfill.params.responseHeaders;

  // Count x-network-overrides headers (case-insensitive)
  const markerHeaders = headers.filter(h => h.name.toLowerCase() === 'x-network-overrides');
  assert.equal(markerHeaders.length, 1, 'Must have exactly one x-network-overrides header');
  assert.equal(markerHeaders[0].value, 'true', 'Marker header must have value "true"');

  // Pattern marker should also be unique
  const patternMarkers = headers.filter(
    h => h.name.toLowerCase() === 'x-network-overrides-pattern'
  );
  assert.equal(
    patternMarkers.length,
    1,
    'Must have exactly one x-network-overrides-pattern header'
  );
  assert.equal(patternMarkers[0].value, '/users$/', 'Pattern marker must have the rule pattern');

  // Custom header should pass through
  assert.equal(
    headers.some(header => header.name === 'X-Custom' && header.value === 'yes'),
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

test('Background overrides request headers at request stage when requestHeaders rule is present', async () => {
  const harness = createBackgroundHarness();

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [
      {
        pattern: '/users$/',
        body: '',
        mode: 'text',
        requestHeaders: [{ name: 'Authorization', value: 'Bearer test-token' }],
      },
    ],
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-headers-1',
    request: { url: TEST_API_URL, method: 'GET', headers: { 'User-Agent': 'TestBrowser' } },
    resourceType: 'Fetch',
  });

  const continueCmd = harness.commandLog.find(
    ({ method, params }) =>
      method === 'Fetch.continueRequest' && params.requestId === 'req-headers-1'
  );
  assert.ok(continueCmd, 'Must execute Fetch.continueRequest');
  assert.ok(Array.isArray(continueCmd.params.headers), 'Headers parameter must be an array');
  assert.equal(
    continueCmd.params.headers.some(
      h => h.name === 'authorization' && h.value === 'Bearer test-token'
    ),
    true,
    'Authorization header must be injected'
  );
});

test('Background handles updateCapturedBodyTypes message', async () => {
  const harness = createBackgroundHarness();
  let responded = false;
  harness.listeners.onMessage(
    { type: 'updateCapturedBodyTypes', types: ['document', 'script'] },
    {},
    () => {
      responded = true;
    }
  );
  assert.equal(responded, true);
});

test('Background processes response template tokens {{uuid}} and {{timestamp}}', async () => {
  const harness = createBackgroundHarness();

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [{ pattern: '/users$/', body: '{"id":"{{uuid}}"}', mode: 'text' }],
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-template-1',
    request: { url: TEST_API_URL },
    responseStatusCode: 200,
    resourceType: 'Fetch',
  });

  await new Promise(resolve => setTimeout(resolve, 20));

  const fulfill = harness.commandLog.find(
    ({ method, params }) =>
      method === 'Fetch.fulfillRequest' && params.requestId === 'req-template-1'
  );
  assert.ok(fulfill, 'Must fulfill request');
  const decoded = Buffer.from(fulfill.params.body, 'base64').toString('utf8');
  assert.equal(decoded.includes('{{uuid}}'), false, 'Template token must be replaced');
  assert.ok(/"id":"[a-f0-9-]{36}"/.test(decoded), 'UUID regex must match generated UUID');
});

test('Background filters GraphQL requests by operationName', async () => {
  const harness = createBackgroundHarness();

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [
      {
        pattern: '/graphql',
        body: '{"data":{"user":{"name":"Mocked User"}}}',
        mode: 'text',
        graphqlOperation: 'GetUserProfile',
      },
    ],
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  // Request 1: Different operation -> should NOT match
  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-gql-1',
    request: {
      url: `${TEST_DOMAIN}/graphql`,
      method: 'POST',
      postData: '{"operationName":"GetOrders"}',
    },
    resourceType: 'Fetch',
  });

  const continueCmd = harness.commandLog.find(
    ({ method, params }) => method === 'Fetch.continueRequest' && params.requestId === 'req-gql-1'
  );
  assert.ok(continueCmd, 'Different operation must pass through');

  // Request 2: Matching operation -> MUST match
  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-gql-2',
    request: {
      url: `${TEST_DOMAIN}/graphql`,
      method: 'POST',
      postData: '{"operationName":"GetUserProfile"}',
    },
    resourceType: 'Fetch',
  });

  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-gql-2',
    request: {
      url: `${TEST_DOMAIN}/graphql`,
      method: 'POST',
      postData: '{"operationName":"GetUserProfile"}',
    },
    responseStatusCode: 200,
    resourceType: 'Fetch',
  });
  await new Promise(resolve => setTimeout(resolve, 20));

  const fulfill = harness.commandLog.find(
    ({ method, params }) => method === 'Fetch.fulfillRequest' && params.requestId === 'req-gql-2'
  );
  assert.ok(fulfill, 'Matching GraphQL operation must fulfill request');
});
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

test('Background overrides outgoing request payload when requestBody is set', async () => {
  const harness = createBackgroundHarness();

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [
      { pattern: '/users$/', body: '', mode: 'text', requestBody: '{"name":"overridden"}' },
    ],
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-body-mod',
    request: { url: TEST_API_URL, method: 'POST', postData: '{"name":"original"}' },
    resourceType: 'Fetch',
  });

  const continueCmd = harness.commandLog.find(
    ({ method, params }) =>
      method === 'Fetch.continueRequest' && params.requestId === 'req-body-mod'
  );
  assert.ok(continueCmd);
  assert.ok(continueCmd.params.postData);
});
