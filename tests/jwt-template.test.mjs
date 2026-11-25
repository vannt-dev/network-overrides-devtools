import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createUiContext, closeAllUiHarnessWindows } from './test-harness.mjs';
import { createBackgroundHarness } from './background-test-harness.mjs';
import { TEST_DOMAIN, TEST_API_URL } from './config.mjs';

after(() => {
  closeAllUiHarnessWindows();
});

const utils = () => createUiContext().NetworkOverridesUtils;
const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** The three parts of a token, the first two decoded as JSON. */
function decode(token) {
  const parts = token.split('.');
  assert.equal(parts.length, 3, `three parts in ${token}`);
  for (const part of parts) assert.match(part, BASE64URL, `base64url without padding: ${part}`);
  const json = part => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  return { header: json(parts[0]), payload: json(parts[1]), signature: parts[2] };
}

test('{{$jwt}} gives a well-formed HS256 token with sub, iat = now and exp = now + 1 h', () => {
  const u = utils();
  const before = Math.floor(Date.now() / 1000);
  const body = u.processResponseTemplate('{"access_token":"{{$jwt}}"}');
  const after = Math.floor(Date.now() / 1000);
  const { header, payload, signature } = decode(JSON.parse(body).access_token);
  assert.deepEqual(header, { alg: 'HS256', typ: 'JWT' });
  assert.equal(typeof payload.sub, 'string');
  assert.ok(payload.iat >= before && payload.iat <= after, 'iat is now, in seconds');
  assert.equal(payload.exp - payload.iat, 3600);
  // 32 random bytes, like an HS256 signature.
  assert.equal(signature.length, 43);
  assert.equal(u.DEFAULT_JWT_LIFETIME, 3600);
});

test('{{$jwt()}} and the upper-case name work like {{$jwt}}; each token is new', () => {
  const u = utils();
  const [a, b, c] = u.processResponseTemplate('{{$jwt()}} {{$JWT}} {{$jwt}}').split(' ');
  for (const token of [a, b, c])
    assert.equal(decode(token).payload.exp - decode(token).payload.iat, 3600);
  assert.notEqual(decode(a).signature, decode(c).signature);
});

test('claims are added to the defaults and win over them', () => {
  const u = utils();
  const token = u.processResponseTemplate(
    '{{$jwt({"sub":"42","role":"admin","scope":["a","b"]})}}'
  );
  const { payload } = decode(token);
  assert.equal(payload.sub, '42');
  assert.equal(payload.role, 'admin');
  assert.deepEqual(payload.scope, ['a', 'b']);
  assert.equal(payload.exp - payload.iat, 3600);

  const fixed = decode(u.fakeJwt('{"iat":1000,"exp":2000}')).payload;
  assert.equal(fixed.iat, 1000);
  assert.equal(fixed.exp, 2000);
});

test('a lifetime in seconds changes exp; zero or negative gives an expired token', () => {
  const u = utils();
  const now = Date.UTC(2026, 0, 1) + 999;
  const iat = Math.floor(now / 1000);
  assert.equal(decode(u.fakeJwt('300', now)).payload.exp, iat + 300);
  assert.equal(decode(u.fakeJwt('{"sub":"7"}, 60', now)).payload.exp, iat + 60);
  assert.equal(decode(u.fakeJwt('-60', now)).payload.exp, iat - 60);
  assert.equal(decode(u.fakeJwt('0', now)).payload.exp, iat);
  assert.equal(decode(u.fakeJwt('', now)).payload.iat, iat);
  const token = u.processResponseTemplate('{{$jwt({"sub":"7"}, -1)}}');
  const { payload } = decode(token);
  assert.equal(payload.exp - payload.iat, -1);
});

test('base64url has no padding for every claim length, and non-ASCII claims round-trip', () => {
  const u = utils();
  // Lengths 1-3 cover every remainder of the 3-byte groups.
  for (const sub of ['a', 'ab', 'abc', 'abcd', 'abcde', 'abcdef']) {
    const token = u.fakeJwt(JSON.stringify({ sub }));
    assert.ok(!token.includes('='), token);
    assert.equal(decode(token).payload.sub, sub);
  }
  const name = 'Nguyễn Văn 😀 ü';
  assert.equal(decode(u.fakeJwt(JSON.stringify({ name }))).payload.name, name);
  for (const value of ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar', 'ÿþ']) {
    assert.equal(u.base64UrlEncode(value), Buffer.from(value, 'utf8').toString('base64url'));
  }
  assert.equal(u.base64UrlEncode([251, 255, 191]), '-_-_');
});

test('quotes typed as \\" (to keep a JSON body valid) are read as plain quotes', () => {
  const u = utils();
  const body = u.processResponseTemplate('{"token":"{{$jwt({\\"sub\\":\\"42\\"})}}"}');
  const parsed = JSON.parse(body);
  assert.equal(decode(parsed.token).payload.sub, '42');
});

test('a bad argument leaves the placeholder as written', () => {
  const u = utils();
  for (const args of [
    '{"sub":',
    '{sub:42}',
    '[1,2]',
    'null',
    '"text"',
    '{"a":1}, "soon"',
    '{"a":1}, 1.5',
    '{"a":1}, 60, 2',
    '60, {"a":1}',
  ]) {
    const token = `{{$jwt(${args})}}`;
    assert.equal(u.processResponseTemplate(`x ${token} y`), `x ${token} y`, args);
    assert.equal(u.fakeJwt(args), null, args);
  }
});

test('claims may hold variables, other placeholders and wildcard captures', () => {
  const u = utils();
  const body = u.fillBodyText(
    '{{$jwt({"sub":"{{param:1}}","env":"{{env}}","jti":"{{$uuid}}","q":"{{$query(q)}}"})}}',
    { env: 'qa' },
    true,
    ['42'],
    'https://example.com/a?q=hi'
  );
  const { payload } = decode(body);
  assert.equal(payload.sub, '42');
  assert.equal(payload.env, 'qa');
  assert.match(payload.jti, /^[0-9a-f-]{36}$/);
  assert.equal(payload.q, 'hi');
});

test('with templates off or a backslash before {{ the placeholder is kept as written', () => {
  const u = utils();
  assert.equal(u.fillBodyText('{{$jwt}}', {}, false), '{{$jwt}}');
  assert.equal(u.fillBodyText('\\{{$jwt}}', {}, true), '{{$jwt}}');
});

test('a mocked response gets a fresh token from the background', async () => {
  const harness = createBackgroundHarness();
  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [
      {
        pattern: `${TEST_DOMAIN}/api/*`,
        body: '{"token":"{{$jwt({"role":"{{role}}"}, 120)}}"}',
        mode: 'text',
      },
    ],
    variables: { role: 'admin' },
  });
  await tick();
  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-jwt',
    request: { url: TEST_API_URL, method: 'GET', headers: {} },
    responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
    responseStatusCode: 200,
    resourceType: 'Fetch',
  });
  await tick(5);
  const command = harness.commandLog.filter(({ params }) => params?.requestId === 'req-jwt').at(-1);
  assert.equal(command.method, 'Fetch.fulfillRequest');
  const body = JSON.parse(Buffer.from(command.params.body, 'base64').toString('utf8'));
  const { payload } = decode(body.token);
  assert.equal(payload.role, 'admin');
  assert.equal(payload.exp - payload.iat, 120);
});
