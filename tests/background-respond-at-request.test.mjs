import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from './test-harness.mjs';
import { createBackgroundHarness } from './background-test-harness.mjs';
import { TEST_DOMAIN, TEST_API_URL } from './config.mjs';

async function attachWith(overrides) {
  const harness = createBackgroundHarness();
  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides,
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  return harness;
}

function requestStage(harness, requestId, request = {}) {
  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId,
    request: { url: TEST_API_URL, method: 'POST', headers: {}, ...request },
    resourceType: 'Fetch',
  });
  return harness.commandLog.filter(({ params }) => params?.requestId === requestId);
}

const decode = body => Buffer.from(body, 'base64').toString('utf8');

test('A rule set to answer without calling the server is fulfilled at the request stage', async () => {
  const harness = await attachWith([
    {
      pattern: '/users$/',
      body: '{"id":"{{$queryParam(id)}}","path":"*"}',
      mode: 'text',
      statusCode: 201,
      responseHeaders: [{ name: 'X-Mock', value: 'yes' }],
      requestHeaders: [{ name: 'X-Ignored', value: '1' }],
      respondAtRequest: true,
    },
  ]);

  const commands = requestStage(harness, 'req-early');

  assert.deepEqual(
    commands.map(({ method }) => method),
    ['Fetch.fulfillRequest']
  );
  const { params } = commands[0];
  assert.equal(params.responseCode, 201);
  assert.equal(decode(params.body), '{"id":"","path":"*"}');
  assert.deepEqual(normalize(params.responseHeaders), [
    { name: 'X-Mock', value: 'yes' },
    { name: 'Content-Type', value: 'application/json; charset=utf-8' },
    { name: 'x-network-overrides', value: 'true' },
    { name: 'x-network-overrides-pattern', value: '/users$/' },
  ]);
});

test('Templates work when the rule answers without calling the server', async () => {
  const harness = await attachWith([
    {
      pattern: 'https://example.com/api/*',
      body: '{"q":"{{$queryParam(q)}}","epoch":{{epoch}}}',
      mode: 'text',
      respondAtRequest: true,
    },
  ]);

  const [command] = requestStage(harness, 'req-early-template', {
    url: `${TEST_API_URL}?q=hello`,
  });

  assert.equal(command.method, 'Fetch.fulfillRequest');
  assert.equal(command.params.responseCode, 200);
  assert.match(decode(command.params.body), /^\{"q":"hello","epoch":\d+\}$/);
});

test('An early answer waits for the rule delay', async () => {
  const harness = await attachWith([
    { pattern: '/users$/', body: 'late', mode: 'text', delayMs: 30, respondAtRequest: true },
  ]);

  assert.equal(requestStage(harness, 'req-early-delay').length, 0);
  await new Promise(resolve => setTimeout(resolve, 60));
  const commands = harness.commandLog.filter(
    ({ params }) => params?.requestId === 'req-early-delay'
  );
  assert.deepEqual(
    commands.map(({ method }) => method),
    ['Fetch.fulfillRequest']
  );
});

test('A script rule answering without the server sees no original response', async () => {
  const harness = await attachWith([
    {
      pattern: '/users$/',
      body: 'return { status: 202, body: { response: request.response } };',
      mode: 'script',
      respondAtRequest: true,
    },
  ]);

  requestStage(harness, 'req-early-script');
  await new Promise(resolve => setTimeout(resolve, 20));

  const fulfil = harness.commandLog.find(
    ({ method, params }) =>
      method === 'Fetch.fulfillRequest' && params.requestId === 'req-early-script'
  );
  assert.ok(fulfil);
  assert.equal(fulfil.params.responseCode, 202);
  assert.equal(decode(fulfil.params.body), '{"response":{"status":null,"headers":{},"body":null}}');
  assert.equal(
    harness.commandLog.some(
      ({ method, params }) =>
        method === 'Fetch.continueRequest' && params.requestId === 'req-early-script'
    ),
    false
  );
});

test('A body rule without the option still lets the request reach the server', async () => {
  const harness = await attachWith([{ pattern: '/users$/', body: 'mock', mode: 'text' }]);

  const commands = requestStage(harness, 'req-late');

  assert.deepEqual(
    commands.map(({ method }) => method),
    ['Fetch.continueRequest']
  );
});

test('The option does nothing on fail and redirect rules', async () => {
  const harness = await attachWith([
    {
      pattern: '/users$/',
      body: '',
      mode: 'text',
      failReason: 'TimedOut',
      respondAtRequest: true,
    },
  ]);

  const commands = requestStage(harness, 'req-early-fail');

  assert.deepEqual(
    commands.map(({ method }) => method),
    ['Fetch.failRequest']
  );
});

// Chrome pauses the CORS preflight of a cross-origin request too. When the
// request itself will be answered without the server, the preflight is
// answered for it, so cross-origin mocks need no hand-written CORS headers.
const ORIGIN = 'https://page.test';

function headerMap(command) {
  return Object.fromEntries(
    command.params.responseHeaders.map(({ name, value }) => [name.toLowerCase(), value])
  );
}

function preflight(harness, requestId, headers) {
  return requestStage(harness, requestId, { method: 'OPTIONS', headers });
}

test('The preflight of a request answered without the server is answered with 204', async () => {
  const harness = await attachWith([
    {
      pattern: '/users$/',
      body: '{"err":1}',
      mode: 'text',
      method: 'PUT',
      statusCode: 500,
      respondAtRequest: true,
    },
  ]);

  const [answer] = preflight(harness, 'req-preflight', {
    Origin: ORIGIN,
    'Access-Control-Request-Method': 'PUT',
    'Access-Control-Request-Headers': 'content-type,x-trace',
  });

  assert.equal(answer.method, 'Fetch.fulfillRequest');
  assert.equal(answer.params.responseCode, 204);
  assert.equal(answer.params.body, '');
  const headers = headerMap(answer);
  assert.equal(headers['access-control-allow-origin'], ORIGIN);
  assert.equal(headers['access-control-allow-methods'], 'PUT');
  assert.equal(headers['access-control-allow-headers'], 'content-type,x-trace');
  assert.equal(headers['access-control-allow-credentials'], 'true');
  assert.equal(headers['access-control-max-age'], '60');

  // The request itself then gets the mocked error status, readable cross-origin.
  const [mock] = requestStage(harness, 'req-after-preflight', {
    method: 'PUT',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
  });
  assert.equal(mock.method, 'Fetch.fulfillRequest');
  assert.equal(mock.params.responseCode, 500);
  const mockHeaders = headerMap(mock);
  assert.equal(mockHeaders['access-control-allow-origin'], ORIGIN);
  assert.equal(mockHeaders['access-control-allow-credentials'], 'true');
});

test('A preflight without an Origin is allowed for any origin, without credentials', async () => {
  const harness = await attachWith([
    { pattern: '/users$/', body: '{}', mode: 'text', respondAtRequest: true },
  ]);

  const [answer] = preflight(harness, 'req-preflight-no-origin', {
    'access-control-request-method': 'DELETE',
  });

  assert.equal(answer.params.responseCode, 204);
  const headers = headerMap(answer);
  assert.equal(headers['access-control-allow-origin'], '*');
  assert.equal(headers['access-control-allow-methods'], 'DELETE');
  assert.equal('access-control-allow-headers' in headers, false);
  assert.equal('access-control-allow-credentials' in headers, false);
});

test('CORS headers set on the rule win over the automatic ones', async () => {
  const harness = await attachWith([
    {
      pattern: '/users$/',
      body: '{}',
      mode: 'text',
      respondAtRequest: true,
      responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }],
    },
  ]);

  const [mock] = requestStage(harness, 'req-rule-cors', { headers: { Origin: ORIGIN } });

  const allowOrigin = mock.params.responseHeaders.filter(
    ({ name }) => name.toLowerCase() === 'access-control-allow-origin'
  );
  assert.deepEqual(normalize(allowOrigin), [{ name: 'Access-Control-Allow-Origin', value: '*' }]);
  assert.equal('access-control-allow-credentials' in headerMap(mock), false);
});

test('A preflight goes to the server when the request would not be answered early', async () => {
  const harness = await attachWith([
    { pattern: '/users$/', body: 'late', mode: 'text', method: 'PUT' },
    { pattern: '/users$/', body: 'early', mode: 'text', respondAtRequest: true },
  ]);

  // The first matching rule for PUT reaches the server, so its preflight must too.
  const put = preflight(harness, 'req-preflight-late', {
    Origin: ORIGIN,
    'Access-Control-Request-Method': 'PUT',
  });
  assert.deepEqual(
    put.map(({ method }) => method),
    ['Fetch.continueRequest']
  );
});

test('A rule that explicitly matches OPTIONS keeps control of the preflight', async () => {
  const harness = await attachWith([
    {
      pattern: '/users$/',
      body: 'options',
      mode: 'text',
      method: 'OPTIONS',
      statusCode: 200,
      respondAtRequest: true,
    },
    { pattern: '/users$/', body: 'early', mode: 'text', respondAtRequest: true },
  ]);

  const [answer] = preflight(harness, 'req-preflight-options-rule', {
    Origin: ORIGIN,
    'Access-Control-Request-Method': 'PUT',
  });

  assert.equal(answer.method, 'Fetch.fulfillRequest');
  assert.equal(answer.params.responseCode, 200);
  assert.equal(decode(answer.params.body), 'options');
});
