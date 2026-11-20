import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiContext } from './test-harness.mjs';

const ui = createUiContext().NetworkOverridesUi;
const summarize = rule => ui.summarizeRule(rule);

test('a text body rule shows the method, the pattern and the mocked body', () => {
  assert.equal(
    summarize({ pattern: '/api/users', body: '[]', mode: 'text', method: 'GET' }),
    'GET /api/users → mock body'
  );
  // Any method is left out.
  assert.equal(
    summarize({ pattern: '/api/users', body: '[]', mode: 'text' }),
    '/api/users → mock body'
  );
  assert.equal(
    summarize({ pattern: '/api/users', body: '[]', mode: 'text', method: 'ANY' }),
    '/api/users → mock body'
  );
});

test('status and delay replace the plain body note', () => {
  assert.equal(
    summarize({
      pattern: '/api/orders',
      body: '{}',
      mode: 'text',
      method: 'GET',
      statusCode: 500,
      delayMs: 3000,
    }),
    'GET /api/orders → 500 · slow 3 s'
  );
  assert.equal(
    summarize({ pattern: 'a', body: '', mode: 'text', delayMs: 1500 }),
    'a → mock body · slow 1.5 s'
  );
  assert.equal(
    summarize({ pattern: 'a', body: '', mode: 'text', delayMs: 250 }),
    'a → mock body · slow 250 ms'
  );
  // A zero delay is no delay.
  assert.equal(summarize({ pattern: 'a', body: '', mode: 'text', delayMs: 0 }), 'a → mock body');
});

test('a base64 body, a script and a patch say what they are', () => {
  assert.equal(summarize({ pattern: 'img', body: 'iVBO', mode: 'file' }), 'img → base64 body');
  assert.equal(
    summarize({ pattern: 'img', body: 'iVBO', mode: 'file', statusCode: 201 }),
    'img → 201 · base64 body'
  );
  assert.equal(summarize({ pattern: 's', body: 'return 1', mode: 'script' }), 's → script');
  assert.equal(
    summarize({
      pattern: '/graphql',
      body: '',
      mode: 'patch',
      method: 'POST',
      graphqlOperation: 'GetUser',
      patch: [
        { op: 'set', path: 'data.user.plan', value: 'pro' },
        { op: 'remove', path: 'data.ads' },
      ],
    }),
    'POST /graphql (op: GetUser) → patch 2 fields'
  );
  assert.equal(
    summarize({ pattern: 'p', body: '', mode: 'patch', patch: [{ op: 'remove', path: 'a' }] }),
    'p → patch 1 field'
  );
});

test('fail and redirect rules', () => {
  assert.equal(
    summarize({ pattern: '/api/*', body: '', mode: 'text', failReason: 'Failed' }),
    '/api/* → network error'
  );
  assert.equal(
    summarize({
      pattern: '/api/*',
      body: '',
      mode: 'text',
      failReason: 'InternetDisconnected',
      delayMs: 2000,
    }),
    '/api/* → network error (InternetDisconnected) · slow 2 s'
  );
  assert.equal(
    summarize({
      pattern: 'https://old.test/*',
      body: '',
      mode: 'text',
      redirectUrl: 'https://new.test/*',
    }),
    'https://old.test/* → redirect to https://new.test/*'
  );
});

test('answering without the server, response headers and request changes are listed', () => {
  assert.equal(
    summarize({
      pattern: '/api/new',
      body: '{}',
      mode: 'text',
      statusCode: 201,
      respondAtRequest: true,
      responseHeaders: [{ name: 'X-A', value: '1' }],
    }),
    '/api/new → 201 · no server · +1 response header'
  );
  assert.equal(
    summarize({
      pattern: '/api/save',
      body: '',
      mode: 'text',
      redirectUrl: 'https://b.test/save',
      requestBody: '{"name":"mock"}',
      requestHeaders: [
        { name: 'Authorization', value: 'Bearer x' },
        { name: 'X-B', value: '2' },
      ],
    }),
    '/api/save → redirect to https://b.test/save · new request body · +2 request headers'
  );
});

test('conditions are shown compactly after what matches', () => {
  assert.equal(
    summarize({
      pattern: '/api/list',
      body: '[]',
      mode: 'text',
      method: 'GET',
      matchQuery: [{ name: 'page', value: '2' }, { name: 'debug' }],
      matchHeaders: [{ name: 'X-Tenant', value: 'acme' }, { name: 'Authorization' }],
      matchBody: '"plan":"pro"',
    }),
    'GET /api/list + query page=2&debug + header X-Tenant: acme, Authorization + body has "plan":"pro" → mock body'
  );
});

test('WebSocket rules show the direction, the frame match and the action', () => {
  assert.equal(
    summarize({ pattern: 'wss://a.test/socket', body: 'x', mode: 'text', kind: 'websocket' }),
    'ws wss://a.test/socket → replace frames'
  );
  assert.equal(
    summarize({
      pattern: 'wss://a.test/socket',
      body: '',
      mode: 'text',
      kind: 'websocket',
      wsDirection: 'send',
      wsMatch: '^ping',
      wsMatchRegex: true,
      wsAction: 'block',
    }),
    'ws wss://a.test/socket (send, /^ping/) → block frames'
  );
  assert.equal(
    summarize({
      pattern: '*',
      body: 'y',
      mode: 'text',
      kind: 'websocket',
      wsDirection: 'both',
      wsMatch: 'price',
      wsAction: 'substitute',
    }),
    'ws * (both, contains "price") → substitute text in frames'
  );
  assert.equal(
    summarize({
      pattern: '*',
      body: '',
      mode: 'text',
      kind: 'websocket',
      wsAction: 'delay',
      delayMs: 3000,
    }),
    'ws * → delay frames 3 s'
  );
});

test('turned-off templates are noted; the GLOBAL badge, not the summary, marks global rules', () => {
  assert.equal(
    summarize({ pattern: '/a', body: '{{now}}', mode: 'text', processTemplates: false }),
    '/a → mock body · templates off'
  );
  assert.equal(
    summarize({ pattern: '/a', body: '', mode: 'text', isGlobal: true, statusCode: 404 }),
    '/a → 404'
  );
});
