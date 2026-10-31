import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import {
  createUiContext,
  createUiHarness,
  flushUi,
  closeAllUiHarnessWindows,
} from './test-harness.mjs';
import { createBackgroundHarness } from './background-test-harness.mjs';
import { TEST_DOMAIN, TEST_API_URL } from './config.mjs';

after(() => {
  closeAllUiHarnessWindows();
});

const plain = value => JSON.parse(JSON.stringify(value));
const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

// ---- paths -------------------------------------------------------------------

test('parsePatchPath reads dot, bracket and JSON Pointer paths', () => {
  const { NetworkOverridesUtils: u } = createUiContext();
  const segments = path => plain(u.parsePatchPath(path).segments);
  assert.deepEqual(segments('data.user.plan'), ['data', 'user', 'plan']);
  assert.deepEqual(segments('items[0].name'), ['items', 0, 'name']);
  assert.deepEqual(segments('[2][-]'), [2, '-']);
  assert.deepEqual(segments('a["b.c"][\'d]e\']'), ['a', 'b.c', 'd]e']);
  assert.deepEqual(segments('a["say \\"hi\\""]'), ['a', 'say "hi"']);
  assert.deepEqual(segments('/data/items/0/a~1b/c~0d'), ['data', 'items', '0', 'a/b', 'c~d']);
  assert.deepEqual(segments('/list/-'), ['list', '-']);
  assert.deepEqual(segments('  data.plan  '), ['data', 'plan']);
});

test('parsePatchPath rejects empty, malformed and unsafe paths', () => {
  const { NetworkOverridesUtils: u } = createUiContext();
  for (const bad of [
    '',
    '   ',
    '/',
    'a..b',
    'a.',
    '.a',
    'a[',
    'a[x]',
    'a[1.5]',
    'a["b"',
    'a["b"]c',
    '/a/~2',
    '__proto__.x',
    'a["__proto__"]',
    '/a/__proto__',
  ]) {
    assert.equal(typeof u.parsePatchPath(bad).error, 'string', `${JSON.stringify(bad)} is invalid`);
  }
});

// ---- applying operations -------------------------------------------------------

function apply(root, ops) {
  const { NetworkOverridesUtils: u } = createUiContext();
  return plain(u.applyJsonPatch(root, ops));
}

test('applyJsonPatch sets and removes nested fields and array items', () => {
  const result = apply(
    {
      data: { user: { plan: 'free', name: 'Ann' }, ads: [1, 2] },
      items: [{ id: 1 }, { id: 2 }, { id: 3 }],
    },
    [
      { op: 'set', path: 'data.user.plan', value: 'pro' },
      { op: 'remove', path: 'data.ads' },
      { op: 'set', path: 'items[0].id', value: 10 },
      { op: 'remove', path: 'items[1]' },
      { op: 'set', path: '/items/-', value: { id: 4 } },
      { op: 'set', path: 'data.user.flags', value: null },
    ]
  );
  assert.deepEqual(result.value, {
    data: { user: { plan: 'pro', name: 'Ann', flags: null } },
    items: [{ id: 10 }, { id: 3 }, { id: 4 }],
  });
  assert.deepEqual(result.skipped, []);
});

test('applyJsonPatch creates missing objects for set and ignores missing paths for remove', () => {
  const result = apply({ data: {} }, [
    { op: 'set', path: 'data.user.profile.plan', value: 'pro' },
    { op: 'set', path: 'meta.tags[0]', value: 'beta' },
    { op: 'set', path: 'meta.list[-]', value: 1 },
    { op: 'remove', path: 'data.missing.deeper' },
    { op: 'remove', path: 'nothing[3]' },
  ]);
  assert.deepEqual(result.value, {
    data: { user: { profile: { plan: 'pro' } } },
    meta: { tags: ['beta'], list: [1] },
  });
  assert.deepEqual(result.skipped, []);
});

test('applyJsonPatch skips an operation it cannot apply and keeps the others', () => {
  const result = apply({ data: { plan: 'free' }, items: [1, 2] }, [
    { op: 'set', path: 'data.plan.level', value: 1 },
    { op: 'set', path: 'items[5]', value: 9 },
    { op: 'set', path: 'items.first', value: 9 },
    { op: 'set', path: 'items[2]', value: 3 },
    { op: 'set', path: 'data.ok', value: true },
  ]);
  assert.deepEqual(result.value, { data: { plan: 'free', ok: true }, items: [1, 2, 3] });
  assert.equal(result.skipped.length, 3);
  assert.match(result.skipped[0], /data\.plan\.level/);
  assert.match(result.skipped[0], /data\.plan is a string/);
  assert.match(result.skipped[1], /items\[5\]/);
  assert.match(result.skipped[2], /items\.first/);
});

test('applyJsonPatch works on a top-level array and refuses a top-level primitive', () => {
  assert.deepEqual(
    apply(
      [{ a: 1 }, { a: 2 }],
      [
        { op: 'set', path: '[1].a', value: 20 },
        { op: 'set', path: '/0/a', value: 10 },
      ]
    ).value,
    [{ a: 10 }, { a: 20 }]
  );
  const primitive = apply('text', [{ op: 'set', path: 'a', value: 1 }]);
  assert.equal(primitive.value, 'text');
  assert.equal(primitive.skipped.length, 1);
});

test('applyJsonPatch writes copies, so the operations stay the same for the next response', () => {
  const { NetworkOverridesUtils: u } = createUiContext();
  const ops = [
    { op: 'set', path: 'data.items', value: [] },
    { op: 'set', path: 'data.items[-]', value: 1 },
    { op: 'set', path: 'data.flags', value: { beta: true } },
    { op: 'set', path: 'data.flags.gamma', value: false },
  ];
  const first = plain(u.applyJsonPatch({ data: {} }, ops).value);
  const second = plain(u.applyJsonPatch({ data: {} }, ops).value);
  assert.deepEqual(first, { data: { items: [1], flags: { beta: true, gamma: false } } });
  assert.deepEqual(second, first);
  assert.deepEqual(ops[0].value, []);
  assert.deepEqual(ops[2].value, { beta: true });
});

test('applyJsonPatch does not follow inherited properties', () => {
  const { NetworkOverridesUtils: u } = createUiContext();
  const root = JSON.parse('{"a":{}}');
  const result = u.applyJsonPatch(root, [
    { op: 'set', path: 'a.constructor.polluted', value: true },
    { op: 'remove', path: 'a.toString' },
  ]);
  assert.deepEqual(plain(result.value), { a: { constructor: { polluted: true } } });
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
});

// ---- text form -------------------------------------------------------------------

test('parsePatchText reads one operation per line', () => {
  const { NetworkOverridesUtils: u } = createUiContext();
  const parsed = u.parsePatchText(
    [
      'set data.user.plan = "pro"',
      '',
      '  remove data.ads  ',
      'SET items[0] = {"id": 1, "tags": ["a=b"]}',
      'set a["x=y"].b = null',
      'set /meta/count=3',
    ].join('\n')
  );
  assert.deepEqual(plain(parsed.operations), [
    { op: 'set', path: 'data.user.plan', value: 'pro' },
    { op: 'remove', path: 'data.ads' },
    { op: 'set', path: 'items[0]', value: { id: 1, tags: ['a=b'] } },
    { op: 'set', path: 'a["x=y"].b', value: null },
    { op: 'set', path: '/meta/count', value: 3 },
  ]);
});

test('parsePatchText reports the first bad line with its number', () => {
  const { NetworkOverridesUtils: u } = createUiContext();
  const cases = [
    ['set data.plan = pro', 1, /JSON/],
    ['remove a\nset data.plan', 2, /=/],
    ['set = 1', 1, /path/i],
    ['remove a.', 1, /path/i],
    ['remove a = 1', 1, /path/i],
    ['replace a = 1', 1, /set|remove/],
    ['set a =', 1, /value/i],
    ['', 0, /at least one/i],
  ];
  for (const [text, line, message] of cases) {
    const parsed = u.parsePatchText(text);
    assert.equal(parsed.operations, undefined, text);
    assert.equal(parsed.line, line, text);
    assert.match(parsed.error, message, text);
    if (line > 0) assert.match(parsed.error, new RegExp(`^Line ${line}:`), text);
  }
});

test('formatPatchOperations writes text that parsePatchText reads back', () => {
  const { NetworkOverridesUtils: u } = createUiContext();
  const ops = [
    { op: 'set', path: 'data.user.plan', value: 'pro' },
    { op: 'remove', path: 'data.ads' },
    { op: 'set', path: 'items[0]', value: { id: 1 } },
  ];
  const text = u.formatPatchOperations(ops);
  assert.equal(text, 'set data.user.plan = "pro"\nremove data.ads\nset items[0] = {"id":1}');
  assert.deepEqual(plain(u.parsePatchText(text).operations), ops);
});

test('validatePatchOperations accepts stored operations and names what is wrong', () => {
  const { NetworkOverridesUtils: u } = createUiContext();
  assert.equal(
    u.validatePatchOperations([
      { op: 'set', path: 'a', value: 0 },
      { op: 'remove', path: '/b' },
    ]),
    null
  );
  for (const bad of [
    undefined,
    'set a = 1',
    [],
    [null],
    [{ op: 'add', path: 'a', value: 1 }],
    [{ op: 'set', path: 'a' }],
    [{ op: 'set', path: '', value: 1 }],
    [{ op: 'remove', path: 3 }],
    [{ op: 'remove', path: '__proto__' }],
  ]) {
    assert.equal(typeof u.validatePatchOperations(bad), 'string', JSON.stringify(bad));
  }
});

// ---- background ------------------------------------------------------------------

async function backgroundWithRules(overrides) {
  const harness = createBackgroundHarness();
  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides,
  });
  await tick();
  return harness;
}

/** A UI port subscribed to tab 7, recording what the worker posts to it. */
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
      { name: 'Content-Type', value: 'application/json; charset=utf-8' },
      { name: 'Content-Length', value: '64' },
      { name: 'Content-Encoding', value: 'gzip' },
      { name: 'X-Real', value: 'yes' },
    ],
    responseStatusCode: 200,
    resourceType: 'Fetch',
    ...extra,
  });
}

const commandFor = (harness, requestId) =>
  harness.commandLog.filter(({ params }) => params?.requestId === requestId).at(-1);
const bodyOf = command => Buffer.from(command.params.body, 'base64').toString('utf8');
const headerOf = (command, name) =>
  command.params.responseHeaders.find(header => header.name.toLowerCase() === name.toLowerCase())
    ?.value;

const patchRule = (patch, extra = {}) => ({
  pattern: `${TEST_DOMAIN}/api/*`,
  body: '',
  mode: 'patch',
  patch,
  ...extra,
});

test('a patch rule edits fields of the real JSON response and keeps its status and headers', async () => {
  const harness = await backgroundWithRules([
    patchRule([
      { op: 'set', path: 'data.user.plan', value: 'pro' },
      { op: 'remove', path: 'data.ads' },
      { op: 'set', path: 'data.items[1].name', value: 'Bé' },
    ]),
  ]);
  harness.responseBodies.set('req-patch', {
    body: Buffer.from(
      '\uFEFF{"data":{"user":{"plan":"free"},"ads":[1],"items":[{"name":"a"},{"name":"b"}]}}'
    ).toString('base64'),
    base64Encoded: true,
  });
  pauseResponse(harness, 'req-patch', { responseStatusCode: 201 });
  await tick(5);

  const command = commandFor(harness, 'req-patch');
  assert.equal(command.method, 'Fetch.fulfillRequest');
  assert.deepEqual(JSON.parse(bodyOf(command)), {
    data: { user: { plan: 'pro' }, items: [{ name: 'a' }, { name: 'Bé' }] },
  });
  assert.equal(command.params.responseCode, 201);
  assert.equal(headerOf(command, 'x-real'), 'yes');
  assert.equal(headerOf(command, 'content-type'), 'application/json; charset=utf-8');
  // The body changed length and is no longer compressed; Chrome sets the length itself.
  assert.equal(headerOf(command, 'content-length'), undefined);
  assert.equal(headerOf(command, 'content-encoding'), undefined);
  assert.equal(headerOf(command, 'x-network-overrides'), 'true');
});

test('a patch rule still applies its own status, headers and delay', async () => {
  const harness = await backgroundWithRules([
    patchRule([{ op: 'set', path: 'ok', value: false }], {
      statusCode: 503,
      responseHeaders: [{ name: 'X-Real', value: 'overridden' }],
      delayMs: 30,
    }),
  ]);
  harness.responseBodies.set('req-status', { body: '{"ok":true}', base64Encoded: false });
  pauseResponse(harness, 'req-status');
  await tick(5);
  assert.equal(commandFor(harness, 'req-status')?.method, 'Fetch.getResponseBody');
  await tick(60);
  const command = commandFor(harness, 'req-status');
  assert.equal(command.method, 'Fetch.fulfillRequest');
  assert.equal(command.params.responseCode, 503);
  assert.equal(headerOf(command, 'x-real'), 'overridden');
  assert.equal(bodyOf(command), '{"ok":false}');
});

test('a patch rule passes a non-JSON response through unchanged and tells the panel', async () => {
  const harness = await backgroundWithRules([
    patchRule([{ op: 'set', path: 'plan', value: 'pro' }]),
  ]);
  const messages = subscribe(harness);
  harness.responseBodies.set('req-html', { body: '<html>nope</html>', base64Encoded: false });
  pauseResponse(harness, 'req-html');
  // No body at all, such as a 204 or a redirect, passes through as well.
  pauseResponse(harness, 'req-empty', { responseStatusCode: 204 });
  await tick(5);

  for (const id of ['req-html', 'req-empty']) {
    const command = commandFor(harness, id);
    assert.equal(command.method, 'Fetch.continueRequest', id);
    assert.deepEqual(Object.keys(command.params), ['requestId'], id);
  }
  const notices = messages.filter(message => message.type === 'patchRuleSkipped');
  assert.equal(notices.length, 1, 'repeated notices for one rule are held back');
  assert.equal(notices[0].pattern, `${TEST_DOMAIN}/api/*`);
  assert.match(notices[0].message, /not JSON/);
  assert.equal(notices[0].url, TEST_API_URL);
});

test('a patch rule reports operations it had to skip', async () => {
  const harness = await backgroundWithRules([
    patchRule([
      { op: 'set', path: 'plan.level', value: 2 },
      { op: 'set', path: 'seen', value: true },
    ]),
  ]);
  const messages = subscribe(harness);
  harness.responseBodies.set('req-skip', { body: '{"plan":"free"}', base64Encoded: false });
  pauseResponse(harness, 'req-skip');
  await tick(5);
  assert.equal(bodyOf(commandFor(harness, 'req-skip')), '{"plan":"free","seen":true}');
  const notice = messages.find(message => message.type === 'patchRuleSkipped');
  assert.match(notice.message, /plan\.level/);
});

test('a patch rule never answers at the request stage, even when imported with that flag', async () => {
  const harness = await backgroundWithRules([
    patchRule([{ op: 'set', path: 'a', value: 1 }], {
      respondAtRequest: true,
      requestHeaders: [{ name: 'X-Debug', value: '1' }],
    }),
  ]);
  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-stage',
    request: { url: TEST_API_URL, method: 'GET', headers: {} },
    resourceType: 'Fetch',
  });
  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-preflight',
    request: {
      url: TEST_API_URL,
      method: 'OPTIONS',
      headers: { Origin: 'https://page.test', 'Access-Control-Request-Method': 'PUT' },
    },
    resourceType: 'Preflight',
  });
  await tick(5);
  const command = commandFor(harness, 'req-stage');
  assert.equal(command.method, 'Fetch.continueRequest');
  assert.equal(
    command.params.headers.find(header => header.name === 'x-debug')?.value,
    '1',
    'request changes of the rule still apply'
  );
  assert.equal(commandFor(harness, 'req-preflight').method, 'Fetch.continueRequest');
});

// ---- editor, list and import ---------------------------------------------------------

function click(harness, selector) {
  harness.document
    .querySelector(selector)
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
}

function setMode(harness, mode) {
  const select = harness.document.getElementById('modal-mode');
  select.value = mode;
  select.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
}

test('Rule editor saves patch operations and shows them again when editing', async () => {
  const harness = createUiHarness({
    storageState: { enabled: true, overrides: [] },
    apis: [{ url: `${TEST_DOMAIN}/api/me`, type: 'fetch' }],
  });
  await flushUi(harness.window);
  click(harness, '.api-item');
  await flushUi(harness.window);

  setMode(harness, 'patch');
  const respondAtRequest = harness.document.getElementById('modal-respond-at-request');
  assert.equal(respondAtRequest.closest('label').style.display, 'none');
  assert.notEqual(harness.document.getElementById('modal-patch-help').style.display, 'none');
  respondAtRequest.checked = true;
  harness.document.getElementById('modal-body').value =
    'set data.user.plan = "pro"\nremove data.ads';
  click(harness, '#save-override');
  await flushUi(harness.window);

  const saved = harness.localState.overrides[0];
  assert.equal(saved.mode, 'patch');
  assert.equal(saved.body, '');
  assert.deepEqual(plain(saved.patch), [
    { op: 'set', path: 'data.user.plan', value: 'pro' },
    { op: 'remove', path: 'data.ads' },
  ]);
  assert.equal('respondAtRequest' in saved, false);
  assert.equal('processTemplates' in saved, false);

  click(harness, '[data-tab="overrides"]');
  await flushUi(harness.window);
  const badge = harness.document.querySelector('.patch-badge');
  assert.ok(badge, 'the rule list shows that the rule patches the real response');
  assert.match(badge.textContent, /PATCH/);
  assert.match(badge.title, /data\.user\.plan/);

  click(harness, '.edit-btn');
  await flushUi(harness.window);
  assert.equal(harness.document.getElementById('modal-mode').value, 'patch');
  assert.equal(
    harness.document.getElementById('modal-body').value,
    'set data.user.plan = "pro"\nremove data.ads'
  );
});

test('Rule editor refuses invalid patch operations and names the line', async () => {
  const harness = createUiHarness({
    storageState: { enabled: true, overrides: [] },
    apis: [{ url: `${TEST_DOMAIN}/api/me`, type: 'fetch' }],
  });
  await flushUi(harness.window);
  click(harness, '.api-item');
  await flushUi(harness.window);
  setMode(harness, 'patch');
  harness.document.getElementById('modal-body').value = 'remove ads\nset plan = pro';
  click(harness, '#save-override');
  await flushUi(harness.window);
  assert.match(harness.document.getElementById('modal-feedback').textContent, /^Line 2:/);
  assert.equal(harness.localState.overrides.length, 0);
});

function selectImportFile(harness, jsonText) {
  const file = new harness.window.File([jsonText], 'rules.json', { type: 'application/json' });
  const input = harness.document.getElementById('import-rules-input');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
}

test('Import keeps patch operations and drops what a patch rule cannot use', async () => {
  const harness = createUiHarness({ apis: [], tabUrl: `${TEST_DOMAIN}/` });
  await flushUi(harness.window);
  selectImportFile(
    harness,
    JSON.stringify({
      version: 1,
      domain: TEST_DOMAIN,
      overrides: [
        {
          pattern: '/api/me',
          mode: 'patch',
          body: '',
          respondAtRequest: true,
          patch: [
            { op: 'set', path: 'data.plan', value: { tier: 'pro' }, extra: 1 },
            { op: 'remove', path: '/data/ads', value: 'ignored' },
          ],
        },
      ],
    })
  );
  await flushUi(harness.window);
  assert.deepEqual(harness.localState[`overrides_${TEST_DOMAIN}`], [
    {
      pattern: '/api/me',
      mode: 'patch',
      body: '',
      patch: [
        { op: 'set', path: 'data.plan', value: { tier: 'pro' } },
        { op: 'remove', path: '/data/ads' },
      ],
    },
  ]);
});

test('Import rejects malformed patch operations', async () => {
  const harness = createUiHarness({ apis: [], tabUrl: `${TEST_DOMAIN}/` });
  await flushUi(harness.window);
  for (const bad of [
    { mode: 'patch' },
    { mode: 'patch', patch: [] },
    { mode: 'patch', patch: [{ op: 'set', path: 'a' }] },
    { mode: 'patch', patch: [{ op: 'move', path: 'a', value: 1 }] },
    { mode: 'patch', patch: [{ op: 'remove', path: 'a..b' }] },
    { mode: 'text', patch: [{ op: 'remove', path: 'a' }] },
  ]) {
    selectImportFile(
      harness,
      JSON.stringify({
        version: 1,
        domain: TEST_DOMAIN,
        overrides: [{ pattern: 'x', body: '', ...bad }],
      })
    );
    await flushUi(harness.window);
    assert.match(
      harness.document.querySelector('.notification-toast--error').textContent,
      /invalid/i,
      JSON.stringify(bad)
    );
    assert.equal(harness.localState[`overrides_${TEST_DOMAIN}`], undefined);
  }
});

test('The panel shows a notice when a patch rule leaves a response unchanged', async () => {
  const harness = createUiHarness({ storageState: { enabled: true, overrides: [] }, apis: [] });
  await flushUi(harness.window);
  harness.emitPortMessage({
    type: 'patchRuleSkipped',
    tabId: 99,
    pattern: '/api/me',
    url: `${TEST_DOMAIN}/api/me`,
    message: 'the response is not JSON, so it was passed through unchanged',
  });
  await flushUi(harness.window);
  const toast = harness.document.querySelector('.notification-toast--warning');
  assert.ok(toast, 'a warning is shown');
  assert.match(toast.textContent, /\/api\/me/);
  assert.match(toast.textContent, /not JSON/);
});
