import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackgroundContext, normalize } from './test-harness.mjs';
import { createBackgroundHarness } from './background-test-harness.mjs';
import { TEST_DOMAIN, TEST_API_URL } from './config.mjs';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

async function harnessWithScript(script, rule = {}) {
  const harness = createBackgroundHarness();
  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [{ pattern: `${TEST_DOMAIN}/api/*`, body: script, mode: 'script', ...rule }],
  });
  await tick();
  return harness;
}

function pauseResponse(harness, requestId, extra = {}) {
  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId,
    request: {
      url: `${TEST_API_URL}?page=2&page=9&q=a%20b`,
      method: 'post',
      headers: { 'X-Trace': 'abc', Accept: 'application/json' },
      postData: '{"name":"Ann"}',
    },
    responseHeaders: [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'Content-Length', value: '17' },
      { name: 'X-Origin', value: 'real' },
    ],
    responseStatusCode: 200,
    resourceType: 'Fetch',
    ...extra,
  });
}

const fulfilled = (harness, requestId) =>
  harness.commandLog.find(
    ({ method, params }) => method === 'Fetch.fulfillRequest' && params.requestId === requestId
  );
const bodyOf = command => Buffer.from(command.params.body, 'base64').toString('utf8');
const headerOf = (command, name) =>
  command.params.responseHeaders.find(header => header.name.toLowerCase() === name.toLowerCase())
    ?.value;

test('a script rule builds the response from the request and the original response', async () => {
  const harness = await harnessWithScript(`
    const original = JSON.parse(request.response.body);
    return {
      status: 207,
      headers: { 'X-Mocked-By': 'script', 'content-type': 'application/vnd.test+json' },
      body: {
        seen: {
          url: request.url,
          method: request.method,
          trace: request.headers['x-trace'],
          query: request.query,
          params: request.params,
          sent: JSON.parse(request.body).name,
          status: request.response.status,
          origin: request.response.headers['x-origin'],
        },
        users: original.users.slice(0, 1),
      },
    };
  `);
  harness.responseBodies.set('req-script', {
    body: Buffer.from('{"users":["Ann","Bob"]}', 'utf8').toString('base64'),
    base64Encoded: true,
  });

  pauseResponse(harness, 'req-script');
  await tick();

  const command = fulfilled(harness, 'req-script');
  assert.ok(command, 'the request is fulfilled once the script settles');
  assert.equal(command.params.responseCode, 207);
  assert.deepEqual(JSON.parse(bodyOf(command)), {
    seen: {
      url: `${TEST_API_URL}?page=2&page=9&q=a%20b`,
      method: 'POST',
      trace: 'abc',
      query: { page: '2', q: 'a b' },
      params: ['users?page=2&page=9&q=a%20b'],
      sent: 'Ann',
      status: 200,
      origin: 'real',
    },
    users: ['Ann'],
  });
  assert.equal(headerOf(command, 'x-mocked-by'), 'script');
  assert.equal(headerOf(command, 'content-type'), 'application/vnd.test+json');
  assert.equal(headerOf(command, 'x-origin'), 'real');
  assert.equal(headerOf(command, 'content-length'), undefined);
  assert.equal(headerOf(command, 'x-network-overrides'), 'true');
  assert.equal(headerOf(command, 'x-network-overrides-error'), undefined);

  const evaluate = harness.commandLog.find(({ method }) => method === 'Runtime.evaluate');
  assert.equal(evaluate.params.awaitPromise, true);
  assert.equal(evaluate.params.returnByValue, true);
});

test('a script may await, and a returned string is the body as it stands', async () => {
  const harness = await harnessWithScript(
    `const value = await Promise.resolve('{{now}} is not a template here');
     return value; // a trailing comment must not swallow the wrapper`,
    { statusCode: 404, responseHeaders: [{ name: 'X-Rule', value: 'yes' }] }
  );

  pauseResponse(harness, 'req-string');
  await tick();

  const command = fulfilled(harness, 'req-string');
  assert.equal(bodyOf(command), '{{now}} is not a template here');
  assert.equal(
    command.params.responseCode,
    404,
    'the rule status applies when the script names none'
  );
  assert.equal(headerOf(command, 'x-rule'), 'yes');
});

test('a script sees the page it runs in and a response without a body', async () => {
  const harness = await harnessWithScript(
    `return { fromPage: featureFlags.beta, original: request.response.body };`
  );
  harness.page.globals.featureFlags = { beta: true };

  pauseResponse(harness, 'req-page');
  await tick();

  assert.deepEqual(JSON.parse(bodyOf(fulfilled(harness, 'req-page'))), {
    fromPage: true,
    original: null,
  });
});

test('a script that throws answers the request with the error instead of the real response', async () => {
  const harness = await harnessWithScript(`throw new Error('no such user');`);

  pauseResponse(harness, 'req-throw');
  await tick();

  const command = fulfilled(harness, 'req-throw');
  assert.equal(command.params.responseCode, 500);
  assert.equal(headerOf(command, 'x-network-overrides-error'), 'script');
  assert.match(headerOf(command, 'content-type'), /^text\/plain/);
  assert.match(bodyOf(command), /Error: no such user/);
  assert.doesNotMatch(bodyOf(command), /\n\s+at /, 'the stack is left out');
  assert.equal(
    harness.commandLog.some(
      ({ method, params }) => method === 'Fetch.continueRequest' && params.requestId === 'req-throw'
    ),
    false
  );
});

test('a script with a syntax error or an unusable result is reported the same way', async () => {
  const cases = [
    ['return {', /SyntaxError/],
    ['const unused = 1;', /returned nothing/],
    ['return { status: 99, body: "x" };', /status that is not 100–599/],
    ['return { headers: "nope", body: "x" };', /headers that are not/],
  ];
  for (const [index, [script, expected]] of cases.entries()) {
    const harness = await harnessWithScript(script);
    pauseResponse(harness, `req-bad-${index}`);
    await tick();
    const command = fulfilled(harness, `req-bad-${index}`);
    assert.equal(command.params.responseCode, 500, script);
    assert.match(bodyOf(command), expected, script);
  }
});

test('a script that never settles is answered once, when its time is up', async () => {
  const harness = await harnessWithScript('return new Promise(() => {});');
  // The worker's timers, taken over once the rule is in place.
  const timers = [];
  harness.context.setTimeout = (callback, delay) => timers.push({ callback, delay });
  harness.context.clearTimeout = id => {
    if (timers[id - 1]) timers[id - 1].cleared = true;
  };
  harness.page.hang = true;

  pauseResponse(harness, 'req-hang');
  // Other parts of the worker keep timers of their own; the script's is the 5 s one.
  const limits = timers.filter(({ delay }) => delay === 5000);
  assert.equal(limits.length, 1);
  assert.equal(fulfilled(harness, 'req-hang'), undefined, 'still waiting before the limit');

  limits[0].callback();
  const command = fulfilled(harness, 'req-hang');
  assert.equal(command.params.responseCode, 500);
  assert.match(bodyOf(command), /did not return within 5 s/);

  // The page answering after all must not fulfil the request a second time.
  harness.page.release();
  assert.equal(
    harness.commandLog.filter(({ method }) => method === 'Fetch.fulfillRequest').length,
    1
  );
});

test('a script that settles in time cancels its timer', async () => {
  const harness = await harnessWithScript('return "quick";');
  const timers = [];
  harness.context.setTimeout = (callback, delay) => timers.push({ callback, delay });
  harness.context.clearTimeout = id => {
    if (timers[id - 1]) timers[id - 1].cleared = true;
  };

  pauseResponse(harness, 'req-quick');
  await tick();

  assert.equal(bodyOf(fulfilled(harness, 'req-quick')), 'quick');
  assert.deepEqual(
    timers.filter(({ delay }) => delay === 5000).map(({ cleared }) => cleared),
    [true]
  );
});

test('text rules are still answered without evaluating anything in the page', async () => {
  const harness = createBackgroundHarness();
  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [{ pattern: 'api/users', body: 'return 1;', mode: 'text' }],
  });
  await tick();

  pauseResponse(harness, 'req-text');

  assert.equal(bodyOf(fulfilled(harness, 'req-text')), 'return 1;');
  assert.equal(
    harness.commandLog.some(({ method }) => method === 'Runtime.evaluate'),
    false
  );
});

test('a script result is read back from the JSON text made in the page', () => {
  const { NetworkOverridesUtils } = createBackgroundContext();
  const read = raw => normalize({ value: NetworkOverridesUtils.parseScriptEnvelope(raw) });

  // Key order survives: the body below is compared as text, not as an object.
  assert.equal(
    JSON.stringify(NetworkOverridesUtils.parseScriptEnvelope('{"value":{"b":1,"a":2}}')),
    '{"b":1,"a":2}'
  );
  assert.deepEqual(read('{"value":"text"}'), { value: 'text' });
  assert.deepEqual(read('{}'), {});
  assert.deepEqual(read('not json'), {});
  assert.deepEqual(read({ value: 'an object, not text' }), {});
});

test('script results are normalized into a body, a status and headers', () => {
  const { NetworkOverridesUtils } = createBackgroundContext();
  const result = value => normalize(NetworkOverridesUtils.normalizeScriptResult(value));

  assert.deepEqual(result('plain'), { ok: true, body: 'plain' });
  assert.deepEqual(result({ ok: true }), { ok: true, body: '{"ok":true}' });
  assert.deepEqual(result([1, 2]), { ok: true, body: '[1,2]' });
  assert.deepEqual(result(0), { ok: true, body: '0' });
  assert.deepEqual(result({ body: null }), { ok: true, body: '' });
  assert.deepEqual(result({ status: 201, body: { id: 1 } }), {
    ok: true,
    body: '{"id":1}',
    statusCode: 201,
  });
  assert.deepEqual(result({ body: 'x', headers: [{ name: ' X-A ', value: 1 }] }), {
    ok: true,
    body: 'x',
    headers: [{ name: 'X-A', value: '1' }],
  });
  assert.equal(result(undefined).ok, false);
  assert.equal(result(null).ok, false);
  assert.equal(result({ body: 'x', status: 200.5 }).ok, false);
  assert.equal(result({ body: 'x', status: '200' }).ok, false);
  assert.equal(result({ body: 'x', headers: { 'X-A': { nested: true } } }).ok, false);
  assert.equal(result({ body: 'x', headers: [{ value: 'no name' }] }).ok, false);
});
