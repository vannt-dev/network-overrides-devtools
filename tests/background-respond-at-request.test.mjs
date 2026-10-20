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
