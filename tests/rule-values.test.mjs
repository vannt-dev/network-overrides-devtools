import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createUiContext, closeAllUiHarnessWindows } from './test-harness.mjs';
import { createBackgroundHarness } from './background-test-harness.mjs';
import { TEST_DOMAIN, TEST_API_URL } from './config.mjs';

after(() => {
  closeAllUiHarnessWindows();
});

const plain = value => JSON.parse(JSON.stringify(value));
const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
const utils = () => createUiContext().NetworkOverridesUtils;

// ---- variables -------------------------------------------------------------------

test('fillVariables puts defined values in place and leaves unknown names as written', () => {
  const u = utils();
  const vars = { host: 'staging.example.com', 'api.v': '2', token: '{{host}}' };
  assert.equal(
    u.fillVariables('https://{{host}}/v{{api.v}}/{{missing}}', vars),
    'https://staging.example.com/v2/{{missing}}'
  );
  // A value is put in once: braces inside it are not filled in again.
  assert.equal(u.fillVariables('Bearer {{token}}', vars), 'Bearer {{host}}');
  assert.equal(u.fillVariables('no braces', vars), 'no braces');
  // Built-in placeholders are not variables, so they are left for the template step.
  assert.equal(
    u.fillVariables('{{$uuid}} {{param:1}} {{now}}', vars),
    '{{$uuid}} {{param:1}} {{now}}'
  );
});

test('a backslash before {{ keeps the text as written', () => {
  const u = utils();
  assert.equal(u.fillVariables('\\{{host}} {{host}}', { host: 'h' }), '{{host}} h');
  const body = u.fillBodyText('{"a":"\\{{now}}","b":"{{env}}"}', { env: 'qa' }, true, [], '');
  assert.equal(body, '{"a":"{{now}}","b":"qa"}');
});

test('fillBodyText fills variables, then the built-in placeholders; off sends the body as written', () => {
  const u = utils();
  const filled = u.fillBodyText(
    '{"env":"{{env}}","id":"{{param:1}}","q":"{{$query(q)}}"}',
    { env: 'qa' },
    true,
    ['42'],
    'https://example.com/a?q=hi'
  );
  assert.equal(filled, '{"env":"qa","id":"42","q":"hi"}');
  assert.equal(u.fillBodyText('{"env":"{{env}}"}', { env: 'qa' }, false), '{"env":"{{env}}"}');
});

test('variable names: a letter or _ first; the built-in placeholder names are taken', () => {
  const u = utils();
  assert.equal(u.variableNameError('host'), null);
  assert.equal(u.variableNameError('_api.v-2'), null);
  for (const bad of ['', '2x', 'a b', 'a:b', '$x', 'a{b']) {
    assert.equal(u.variableNameError(bad), 'invalid', bad);
  }
  for (const taken of ['now', 'NOW', 'uuid', 'epoch', 'timestamp']) {
    assert.equal(u.variableNameError(taken), 'reserved', taken);
  }
});

test('mergeVariables lets a site value win over a global one and drops bad entries', () => {
  const u = utils();
  const merged = plain(
    u.mergeVariables(
      [
        { name: 'host', value: 'global.example' },
        { name: 'token', value: 't' },
        { name: 'now', value: 'reserved' },
        { name: 'x' },
      ],
      [{ name: 'host', value: 'site.example' }]
    )
  );
  assert.deepEqual(merged, { host: 'site.example', token: 't' });
  // A name such as __proto__ is a plain key, not the prototype.
  const odd = u.mergeVariables([], [{ name: '__proto__', value: 'v' }]);
  assert.equal(u.fillVariables('{{__proto__}}', odd), 'v');
  assert.equal(u.fillVariables('{{toString}}', {}), '{{toString}}');
});

// ---- removed headers ---------------------------------------------------------------

test('parseHeaderNames reads lines and commas, lower-cases and drops repeats', () => {
  const u = utils();
  assert.deepEqual(
    plain(u.parseHeaderNames('Content-Security-Policy\n cache-control, ETag\nETAG\n')),
    {
      names: ['content-security-policy', 'cache-control', 'etag'],
    }
  );
  assert.deepEqual(plain(u.parseHeaderNames('x-debug-*')), { names: ['x-debug-*'] });
  assert.deepEqual(plain(u.parseHeaderNames('Bad Name')), { error: 'Bad Name' });
  assert.deepEqual(plain(u.parseHeaderNames('*')), { error: '*' });
  assert.deepEqual(plain(u.parseHeaderNames('a*b')), { error: 'a*b' });
});

test('withoutHeaders removes listed names whatever their case, and prefixes ending in *', () => {
  const u = utils();
  const headers = [
    { name: 'Content-Type', value: 'text/html' },
    { name: 'X-Debug-Id', value: '1' },
    { name: 'x-debug-trace', value: '2' },
    { name: 'Cache-Control', value: 'max-age=60' },
  ];
  assert.deepEqual(plain(u.withoutHeaders(headers, ['cache-control', 'x-debug-*'])), [
    { name: 'Content-Type', value: 'text/html' },
  ]);
  assert.equal(u.withoutHeaders(headers, undefined), headers);
});

// ---- weighted responses --------------------------------------------------------------

test('pickWeighted gives each answer a share as large as its weight', () => {
  const u = utils();
  assert.equal(u.pickWeighted([80, 20], 0), 0);
  assert.equal(u.pickWeighted([80, 20], 0.79), 0);
  assert.equal(u.pickWeighted([80, 20], 0.8), 1);
  assert.equal(u.pickWeighted([80, 20], 0.9999), 1);
  assert.equal(u.pickWeighted([0, 5, 0], 0.5), 1, 'a weight of 0 is never picked');
  assert.equal(u.pickWeighted([0, 0], 0.5), 0, 'all zero falls back to the first');
});

test('seededRandom repeats its numbers for a seed, and 80/20 weights give about 80/20', () => {
  const u = utils();
  const a = u.seededRandom(42);
  const b = u.seededRandom(42);
  const first = Array.from({ length: 5 }, () => a());
  assert.deepEqual(
    Array.from({ length: 5 }, () => b()),
    first
  );
  assert.notDeepEqual(Array.from({ length: 5 }, u.seededRandom(43)), first);
  assert.ok(first.every(value => value >= 0 && value < 1));
  const next = u.seededRandom(7);
  let second = 0;
  for (let i = 0; i < 10000; i++) if (u.pickWeighted([80, 20], next()) === 1) second++;
  assert.ok(second > 1800 && second < 2200, `picked the second answer ${second} times`);
});

// ---- background ------------------------------------------------------------------------

async function backgroundWithRules(overrides, variables) {
  const harness = createBackgroundHarness();
  const message = {
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides,
  };
  if (variables) message.variables = variables;
  harness.callMessage(message);
  await tick();
  return harness;
}

function subscribe(harness) {
  const messages = [];
  const listeners = {};
  const port = {
    name: 'network-overrides-ui',
    postMessage: message => messages.push(message),
    onMessage: { addListener: fn => (listeners.message = fn) },
    onDisconnect: { addListener: fn => (listeners.disconnect = fn) },
  };
  harness.listeners.onConnect(port);
  listeners.message({ type: 'subscribe', tabId: 7 });
  return messages;
}

function pauseResponse(harness, requestId, extra = {}) {
  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId,
    request: { url: TEST_API_URL, method: 'GET', headers: {} },
    responseHeaders: [
      { name: 'Content-Type', value: 'text/html; charset=utf-8' },
      { name: 'Content-Length', value: '64' },
      { name: 'Content-Encoding', value: 'gzip' },
      { name: 'Content-Security-Policy', value: "script-src 'self'" },
      { name: 'Cache-Control', value: 'max-age=3600' },
      { name: 'ETag', value: '"abc"' },
      { name: 'X-Real', value: 'yes' },
    ],
    responseStatusCode: 200,
    resourceType: 'Document',
    ...extra,
  });
}

function pauseRequest(harness, requestId, request = {}) {
  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId,
    request: { url: TEST_API_URL, method: 'GET', headers: {}, ...request },
    resourceType: 'Fetch',
  });
}

const commandFor = (harness, requestId) =>
  harness.commandLog.filter(({ params }) => params?.requestId === requestId).at(-1);
const bodyOf = command => Buffer.from(command.params.body, 'base64').toString('utf8');
const headerOf = (command, name) =>
  command.params.responseHeaders.find(header => header.name.toLowerCase() === name.toLowerCase())
    ?.value;

test('a pass-through rule keeps the real body and status, removes headers and adds its own', async () => {
  const harness = await backgroundWithRules([
    {
      pattern: `${TEST_DOMAIN}/api/*`,
      body: '',
      mode: 'passthrough',
      removeResponseHeaders: ['content-security-policy', 'cache-control', 'etag'],
      responseHeaders: [{ name: 'Cache-Control', value: 'no-store' }],
    },
  ]);
  // The bytes come back exactly as Chrome had them, binary included.
  const bytes = Buffer.from([0x3c, 0x70, 0x3e, 0xff, 0x00, 0x3c]);
  harness.responseBodies.set('req-pass', { body: bytes.toString('base64'), base64Encoded: true });
  pauseResponse(harness, 'req-pass', { responseStatusCode: 203 });
  await tick(5);

  const command = commandFor(harness, 'req-pass');
  assert.equal(command.method, 'Fetch.fulfillRequest');
  assert.equal(command.params.body, bytes.toString('base64'));
  assert.equal(command.params.responseCode, 203);
  assert.equal(headerOf(command, 'content-security-policy'), undefined);
  assert.equal(headerOf(command, 'etag'), undefined);
  assert.equal(headerOf(command, 'cache-control'), 'no-store', 'the rule sets its own value');
  assert.equal(headerOf(command, 'x-real'), 'yes');
  assert.equal(headerOf(command, 'content-type'), 'text/html; charset=utf-8');
  // The body is handed over decoded, so its encoding and length no longer apply.
  assert.equal(headerOf(command, 'content-encoding'), undefined);
  assert.equal(headerOf(command, 'content-length'), undefined);
  assert.equal(headerOf(command, 'x-network-overrides'), 'true');
});

test('a pass-through rule encodes a text body Chrome gives as a string', async () => {
  const harness = await backgroundWithRules([
    { pattern: `${TEST_DOMAIN}/api/*`, body: '', mode: 'passthrough', statusCode: 500 },
  ]);
  harness.responseBodies.set('req-text', { body: '{"ok":"đúng"}', base64Encoded: false });
  pauseResponse(harness, 'req-text');
  await tick(5);
  const command = commandFor(harness, 'req-text');
  assert.equal(bodyOf(command), '{"ok":"đúng"}');
  assert.equal(command.params.responseCode, 500);
});

test('a pass-through rule with no body to read lets the response through and tells the panel', async () => {
  const harness = await backgroundWithRules([
    {
      pattern: `${TEST_DOMAIN}/api/*`,
      body: '',
      mode: 'passthrough',
      removeResponseHeaders: ['etag'],
    },
  ]);
  const messages = subscribe(harness);
  pauseResponse(harness, 'req-none');
  await tick(5);
  assert.equal(commandFor(harness, 'req-none').method, 'Fetch.continueRequest');
  const notice = messages.find(message => message.type === 'headersRuleSkipped');
  assert.match(notice?.message || '', /could not be read/);
});

test('a pass-through rule never answers at the request stage, even when told to', async () => {
  const harness = await backgroundWithRules([
    { pattern: `${TEST_DOMAIN}/api/*`, body: '', mode: 'passthrough', respondAtRequest: true },
  ]);
  pauseRequest(harness, 'req-early');
  await tick(5);
  assert.equal(commandFor(harness, 'req-early').method, 'Fetch.continueRequest');
});

test('a mocked body removes the server headers its rule lists, by name or prefix', async () => {
  const harness = await backgroundWithRules([
    {
      pattern: `${TEST_DOMAIN}/api/*`,
      body: '{"mock":true}',
      mode: 'text',
      removeResponseHeaders: ['content-security-policy', 'x-*'],
    },
  ]);
  pauseResponse(harness, 'req-mock');
  await tick(5);
  const command = commandFor(harness, 'req-mock');
  assert.equal(bodyOf(command), '{"mock":true}');
  assert.equal(headerOf(command, 'content-security-policy'), undefined);
  assert.equal(headerOf(command, 'x-real'), undefined);
  assert.equal(headerOf(command, 'cache-control'), 'max-age=3600');
  // The markers cannot be removed.
  assert.equal(headerOf(command, 'x-network-overrides'), 'true');
});

test('variables fill the pattern, the body and the response headers of a rule', async () => {
  const harness = await backgroundWithRules(
    [
      {
        pattern: '{{origin}}/api/{{resource}}',
        body: '{"env":"{{env}}","escaped":"\\{{env}}","unknown":"{{nope}}"}',
        mode: 'text',
        responseHeaders: [{ name: 'X-Env', value: '{{env}}' }],
      },
    ],
    { origin: TEST_DOMAIN, resource: 'users', env: 'qa' }
  );
  pauseResponse(harness, 'req-vars');
  await tick(5);
  const command = commandFor(harness, 'req-vars');
  assert.equal(command.method, 'Fetch.fulfillRequest');
  assert.equal(bodyOf(command), '{"env":"qa","escaped":"{{env}}","unknown":"{{nope}}"}');
  assert.equal(headerOf(command, 'x-env'), 'qa');
  assert.equal(headerOf(command, 'x-network-overrides-pattern'), '{{origin}}/api/{{resource}}');
});

test('with templates off a body keeps its {{...}} as written; headers are still filled', async () => {
  const harness = await backgroundWithRules(
    [
      {
        pattern: `${TEST_DOMAIN}/api/*`,
        body: '{{env}}',
        mode: 'text',
        processTemplates: false,
        responseHeaders: [{ name: 'X-Env', value: '{{env}}' }],
      },
    ],
    { env: 'qa' }
  );
  pauseResponse(harness, 'req-off');
  await tick(5);
  const command = commandFor(harness, 'req-off');
  assert.equal(bodyOf(command), '{{env}}');
  assert.equal(headerOf(command, 'x-env'), 'qa');
});

test('variables fill request headers, the request body and a redirect URL', async () => {
  const harness = await backgroundWithRules(
    [
      {
        pattern: `${TEST_DOMAIN}/api/users`,
        body: '',
        mode: 'text',
        requestHeaders: [{ name: 'Authorization', value: 'Bearer {{token}}' }],
        requestBody: '{"user":"{{user}}"}',
      },
      {
        pattern: `${TEST_DOMAIN}/old/*`,
        body: '',
        mode: 'text',
        redirectUrl: 'https://{{host}}/new/*',
      },
    ],
    { token: 'abc', user: 'ann', host: 'staging.example.com' }
  );
  pauseRequest(harness, 'req-headers', { method: 'POST' });
  await tick(5);
  const changed = commandFor(harness, 'req-headers');
  assert.equal(changed.method, 'Fetch.continueRequest');
  assert.deepEqual(plain(changed.params.headers.find(header => header.name === 'authorization')), {
    name: 'authorization',
    value: 'Bearer abc',
  });
  assert.equal(Buffer.from(changed.params.postData, 'base64').toString(), '{"user":"ann"}');

  pauseRequest(harness, 'req-redirect', { url: `${TEST_DOMAIN}/old/page?x=1` });
  await tick(5);
  assert.equal(
    commandFor(harness, 'req-redirect').params.url,
    'https://staging.example.com/new/page?x=1'
  );
});

test('a rule whose pattern uses an undefined variable matches nothing', async () => {
  const harness = await backgroundWithRules([
    { pattern: '{{origin}}/api/*', body: 'x', mode: 'text' },
  ]);
  pauseResponse(harness, 'req-undefined');
  await tick(5);
  assert.equal(commandFor(harness, 'req-undefined').method, 'Fetch.continueRequest');
});

test('a script rule sees the variables as request.vars', async () => {
  const harness = await backgroundWithRules(
    [
      {
        pattern: `${TEST_DOMAIN}/api/*`,
        body: 'return { body: { env: request.vars.env } };',
        mode: 'script',
      },
    ],
    { env: 'qa' }
  );
  harness.responseBodies.set('req-script', { body: '{}', base64Encoded: false });
  pauseResponse(harness, 'req-script', { resourceType: 'Fetch' });
  await tick(20);
  const command = commandFor(harness, 'req-script');
  assert.equal(command.method, 'Fetch.fulfillRequest');
  assert.equal(bodyOf(command), '{"env":"qa"}');
});

test('a new origin loads its own and the global variables from storage', async () => {
  const other = 'https://other.example';
  const harness = createBackgroundHarness({
    storageState: {
      [`overrides_${other}`]: [
        { pattern: `${other}/api/*`, body: '{{who}}-{{all}}', mode: 'text' },
      ],
      [`variables_${other}`]: [{ name: 'who', value: 'site' }],
      variables_global: [
        { name: 'who', value: 'global' },
        { name: 'all', value: 'shared' },
      ],
    },
  });
  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [],
    variables: { who: 'old' },
  });
  await tick();
  harness.navigateTab(7, `${other}/page`);
  await tick();
  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-other',
    request: { url: `${other}/api/x`, method: 'GET', headers: {} },
    responseHeaders: [],
    responseStatusCode: 200,
    resourceType: 'Fetch',
  });
  await tick(5);
  assert.equal(bodyOf(commandFor(harness, 'req-other')), 'site-shared');
});

test('the variables of a tab are kept with its state across a worker restart', async () => {
  const harness = await backgroundWithRules([], { env: 'qa' });
  await tick(600);
  assert.deepEqual(harness.sessionState.tabState_7.variables, { env: 'qa' });
});

test('a rule with weighted responses follows its seed and says which answer it gave', async () => {
  const rule = {
    pattern: `${TEST_DOMAIN}/api/*`,
    body: '{"ok":true}',
    mode: 'text',
    statusCode: 200,
    weight: 80,
    randomSeed: 42,
    responses: [
      {
        weight: 20,
        statusCode: 500,
        body: '{"error":"{{env}}"}',
        responseHeaders: [{ name: 'Retry-After', value: '1' }],
      },
    ],
  };
  const harness = await backgroundWithRules([rule], { env: 'qa' });
  const u = utils();
  const random = u.seededRandom(42);
  const expected = Array.from({ length: 30 }, () =>
    u.pickWeighted([80, 20], random()) ? 500 : 200
  );
  assert.ok(expected.includes(500) && expected.includes(200), 'the seed gives both answers');

  const seen = [];
  for (let i = 0; i < expected.length; i++) {
    pauseResponse(harness, `req-w${i}`, { resourceType: 'Fetch' });
    await tick(1);
    const command = commandFor(harness, `req-w${i}`);
    seen.push(command.params.responseCode);
    if (command.params.responseCode === 500) {
      assert.equal(bodyOf(command), '{"error":"qa"}');
      assert.equal(headerOf(command, 'retry-after'), '1');
      assert.equal(headerOf(command, 'x-network-overrides-response'), '2');
    } else {
      assert.equal(bodyOf(command), '{"ok":true}');
      assert.equal(headerOf(command, 'retry-after'), undefined);
      assert.equal(headerOf(command, 'x-network-overrides-response'), '1');
    }
  }
  assert.deepEqual(seen, expected);

  // New rules start the order again.
  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [{ ...rule }],
  });
  await tick();
  pauseResponse(harness, 'req-again', { resourceType: 'Fetch' });
  await tick(1);
  assert.equal(commandFor(harness, 'req-again').params.responseCode, expected[0]);
});

test('a response with weight 0 is never given, and a variant without status keeps the rule status', async () => {
  const harness = await backgroundWithRules([
    {
      pattern: `${TEST_DOMAIN}/api/*`,
      body: 'main',
      mode: 'text',
      statusCode: 201,
      weight: 0,
      responses: [
        { weight: 0, statusCode: 500, body: 'never' },
        { weight: 3, body: 'third' },
      ],
    },
  ]);
  for (let i = 0; i < 20; i++) {
    pauseResponse(harness, `req-z${i}`, { resourceType: 'Fetch' });
    await tick(1);
    const command = commandFor(harness, `req-z${i}`);
    assert.equal(bodyOf(command), 'third');
    assert.equal(command.params.responseCode, 201);
    assert.equal(headerOf(command, 'x-network-overrides-response'), '3');
  }
});

test('a rule without other responses sends no response marker', async () => {
  const harness = await backgroundWithRules([
    { pattern: `${TEST_DOMAIN}/api/*`, body: 'one', mode: 'text' },
  ]);
  pauseResponse(harness, 'req-one', { resourceType: 'Fetch' });
  await tick(1);
  assert.equal(headerOf(commandFor(harness, 'req-one'), 'x-network-overrides-response'), undefined);
});
