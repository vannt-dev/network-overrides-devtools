import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import {
  createUiContext,
  createUiHarness,
  flushUi,
  closeAllUiHarnessWindows,
} from './test-harness.mjs';
import { createBackgroundHarness } from './background-test-harness.mjs';
import { TEST_DOMAIN } from './config.mjs';

after(() => {
  closeAllUiHarnessWindows();
});

// ---- matching helpers -------------------------------------------------------

test('matchesQuery: no condition matches everything', () => {
  const { NetworkOverridesUtils: u } = createUiContext();
  assert.equal(u.matchesQuery(undefined, 'https://a.test/x'), true);
  assert.equal(u.matchesQuery([], 'https://a.test/x?y=1'), true);
});

test('matchesQuery: a name alone needs the parameter to be present', () => {
  const { NetworkOverridesUtils: u } = createUiContext();
  const conds = [{ name: 'debug' }];
  assert.equal(u.matchesQuery(conds, 'https://a.test/x?debug'), true);
  assert.equal(u.matchesQuery(conds, 'https://a.test/x?debug=0'), true);
  assert.equal(u.matchesQuery(conds, 'https://a.test/x?a=1'), false);
  assert.equal(u.matchesQuery(conds, 'https://a.test/x'), false);
  // Parameter names are case-sensitive, as servers read them.
  assert.equal(u.matchesQuery(conds, 'https://a.test/x?DEBUG=1'), false);
});

test('matchesQuery: name=value compares the decoded value, any of repeated keys', () => {
  const { NetworkOverridesUtils: u } = createUiContext();
  assert.equal(u.matchesQuery([{ name: 'page', value: '2' }], 'https://a.test/x?page=2'), true);
  assert.equal(u.matchesQuery([{ name: 'page', value: '2' }], 'https://a.test/x?page=20'), false);
  assert.equal(
    u.matchesQuery([{ name: 'q', value: 'hello world' }], 'https://a.test/x?q=hello%20world'),
    true
  );
  assert.equal(
    u.matchesQuery([{ name: 'q', value: 'hello world' }], 'https://a.test/x?q=hello+world'),
    true
  );
  assert.equal(u.matchesQuery([{ name: 'tag', value: 'b' }], 'https://a.test/x?tag=a&tag=b'), true);
  assert.equal(u.matchesQuery([{ name: 'empty', value: '' }], 'https://a.test/x?empty='), true);
});

test('matchesQuery: every condition must hold', () => {
  const { NetworkOverridesUtils: u } = createUiContext();
  const conds = [{ name: 'page', value: '2' }, { name: 'debug' }];
  assert.equal(u.matchesQuery(conds, 'https://a.test/x?page=2&debug=1'), true);
  assert.equal(u.matchesQuery(conds, 'https://a.test/x?page=2'), false);
});

test('matchesQuery: an unparsable URL never matches a condition', () => {
  const { NetworkOverridesUtils: u } = createUiContext();
  assert.equal(u.matchesQuery([{ name: 'a' }], 'not a url'), false);
});

test('matchesHeaders: names ignore case, values are exact, both header shapes work', () => {
  const { NetworkOverridesUtils: u } = createUiContext();
  const cdp = { 'X-Tenant': 'acme', Authorization: 'Bearer t' };
  const list = [
    { name: 'x-tenant', value: 'acme' },
    { name: 'authorization', value: 'Bearer t' },
  ];
  for (const headers of [cdp, list]) {
    assert.equal(u.matchesHeaders(undefined, headers), true);
    assert.equal(u.matchesHeaders([{ name: 'authorization' }], headers), true);
    assert.equal(u.matchesHeaders([{ name: 'X-TENANT', value: 'acme' }], headers), true);
    assert.equal(u.matchesHeaders([{ name: 'x-tenant', value: 'ACME' }], headers), false);
    assert.equal(u.matchesHeaders([{ name: 'x-missing' }], headers), false);
    assert.equal(
      u.matchesHeaders([{ name: 'x-tenant', value: 'acme' }, { name: 'x-missing' }], headers),
      false
    );
  }
  assert.equal(u.matchesHeaders([{ name: 'a' }], undefined), false);
});

test('matchesBody: substring of the request body; no body never matches', () => {
  const { NetworkOverridesUtils: u } = createUiContext();
  assert.equal(u.matchesBody(undefined, undefined), true);
  assert.equal(u.matchesBody('', 'anything'), true);
  assert.equal(u.matchesBody('"plan":"pro"', '{"id":1,"plan":"pro"}'), true);
  assert.equal(u.matchesBody('"plan":"pro"', '{"plan":"free"}'), false);
  assert.equal(u.matchesBody('"plan":"pro"', undefined), false);
  assert.equal(u.matchesBody('"plan":"pro"', ''), false);
});

test('matchesRequestConditions ANDs query, headers and body', () => {
  const { NetworkOverridesUtils: u } = createUiContext();
  const rule = {
    pattern: '/api',
    mode: 'text',
    body: '',
    matchQuery: [{ name: 'page', value: '2' }],
    matchHeaders: [{ name: 'x-tenant', value: 'acme' }],
    matchBody: 'pro',
  };
  const request = {
    url: 'https://a.test/api?page=2',
    headers: { 'X-Tenant': 'acme' },
    body: '{"plan":"pro"}',
  };
  assert.equal(u.matchesRequestConditions(rule, request), true);
  assert.equal(
    u.matchesRequestConditions(rule, { ...request, url: 'https://a.test/api?page=3' }),
    false
  );
  assert.equal(u.matchesRequestConditions(rule, { ...request, headers: {} }), false);
  assert.equal(u.matchesRequestConditions(rule, { ...request, body: undefined }), false);
  // A rule without conditions matches as before.
  assert.equal(
    u.matchesRequestConditions({ pattern: '/api', mode: 'text', body: '' }, { url: 'x' }),
    true
  );
});

test('query and header condition text round-trips through parse and format', () => {
  const { NetworkOverridesUtils: u } = createUiContext();
  assert.deepEqual(normalizePlain(u.parseQueryConditions('page=2&debug& q=hello world &')), [
    { name: 'page', value: '2' },
    { name: 'debug' },
    { name: 'q', value: 'hello world' },
  ]);
  assert.deepEqual(normalizePlain(u.parseQueryConditions('?a=1%262&b=')), [
    { name: 'a', value: '1&2' },
    { name: 'b', value: '' },
  ]);
  const conds = [{ name: 'a', value: '1&2' }, { name: 'q', value: 'x y' }, { name: 'flag' }];
  assert.deepEqual(normalizePlain(u.parseQueryConditions(u.formatQueryConditions(conds))), conds);

  assert.deepEqual(
    normalizePlain(u.parseHeaderConditions('X-Tenant: acme\n\nAuthorization\n Accept : a:b ')),
    [
      { name: 'X-Tenant', value: 'acme' },
      { name: 'Authorization' },
      { name: 'Accept', value: 'a:b' },
    ]
  );
  assert.equal(
    u.formatHeaderConditions([{ name: 'X-Tenant', value: 'acme' }, { name: 'Authorization' }]),
    'X-Tenant: acme\nAuthorization'
  );
});

function normalizePlain(value) {
  return JSON.parse(JSON.stringify(value));
}

// ---- background interception -------------------------------------------------

async function backgroundWithRules(overrides) {
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

function commandFor(harness, requestId) {
  return harness.commandLog.find(({ params }) => params?.requestId === requestId);
}

test('Background applies a rule only when query, header and body conditions hold', async () => {
  const harness = await backgroundWithRules([
    {
      pattern: '/api/orders',
      body: '{"mocked":true}',
      mode: 'text',
      respondAtRequest: true,
      matchQuery: [{ name: 'page', value: '2' }],
      matchHeaders: [{ name: 'x-tenant', value: 'acme' }],
      matchBody: '"plan":"pro"',
    },
  ]);
  const base = {
    url: `${TEST_DOMAIN}/api/orders?page=2`,
    method: 'POST',
    headers: { 'X-Tenant': 'acme' },
    postData: '{"plan":"pro"}',
  };
  const cases = [
    ['all-hold', base, 'Fetch.fulfillRequest'],
    ['wrong-query', { ...base, url: `${TEST_DOMAIN}/api/orders?page=3` }, 'Fetch.continueRequest'],
    ['no-header', { ...base, headers: {} }, 'Fetch.continueRequest'],
    ['wrong-body', { ...base, postData: '{"plan":"free"}' }, 'Fetch.continueRequest'],
    ['no-body', { ...base, postData: undefined }, 'Fetch.continueRequest'],
  ];
  for (const [id, request] of cases) {
    harness.emitDebuggerEvent('Fetch.requestPaused', {
      requestId: id,
      request,
      resourceType: 'Fetch',
    });
  }
  await new Promise(resolve => setTimeout(resolve, 20));
  for (const [id, , expected] of cases) {
    assert.equal(commandFor(harness, id)?.method, expected, id);
  }
});

test('Background reads the body from postDataEntries when postData is left out', async () => {
  const harness = await backgroundWithRules([
    {
      pattern: '/api/upload',
      body: 'ok',
      mode: 'text',
      respondAtRequest: true,
      matchBody: 'needle',
    },
  ]);
  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'entries',
    request: {
      url: `${TEST_DOMAIN}/api/upload`,
      method: 'POST',
      hasPostData: true,
      postDataEntries: [
        { bytes: Buffer.from('hay ne').toString('base64') },
        { bytes: Buffer.from('edle hay').toString('base64') },
      ],
    },
    resourceType: 'Fetch',
  });
  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'absent',
    request: { url: `${TEST_DOMAIN}/api/upload`, method: 'POST', hasPostData: true },
    resourceType: 'Fetch',
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(commandFor(harness, 'entries')?.method, 'Fetch.fulfillRequest');
  assert.equal(commandFor(harness, 'absent')?.method, 'Fetch.continueRequest');
});

test('Background checks conditions at the response stage too', async () => {
  const harness = await backgroundWithRules([
    { pattern: '/api/users', body: '{"m":1}', mode: 'text', matchQuery: [{ name: 'mock' }] },
  ]);
  for (const [id, url] of [
    ['resp-yes', `${TEST_DOMAIN}/api/users?mock`],
    ['resp-no', `${TEST_DOMAIN}/api/users`],
  ]) {
    harness.emitDebuggerEvent('Fetch.requestPaused', {
      requestId: id,
      request: { url, method: 'GET' },
      responseStatusCode: 200,
      responseHeaders: [],
      resourceType: 'Fetch',
    });
  }
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(commandFor(harness, 'resp-yes')?.method, 'Fetch.fulfillRequest');
  assert.notEqual(commandFor(harness, 'resp-no')?.method, 'Fetch.fulfillRequest');
});

test('Background falls through to the next rule when conditions do not hold', async () => {
  const harness = await backgroundWithRules([
    {
      pattern: '/api/me',
      body: '"admin"',
      mode: 'text',
      respondAtRequest: true,
      matchHeaders: [{ name: 'x-role', value: 'admin' }],
    },
    { pattern: '/api/me', body: '"user"', mode: 'text', respondAtRequest: true },
  ]);
  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'fallthrough',
    request: { url: `${TEST_DOMAIN}/api/me`, method: 'GET', headers: { 'X-Role': 'user' } },
    resourceType: 'Fetch',
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  const fulfill = commandFor(harness, 'fallthrough');
  assert.equal(fulfill?.method, 'Fetch.fulfillRequest');
  assert.equal(Buffer.from(fulfill.params.body, 'base64').toString('utf8'), '"user"');
});

test('Background answers a preflight only for a rule whose query condition holds', async () => {
  const harness = await backgroundWithRules([
    {
      pattern: '/api/items',
      body: '{}',
      mode: 'text',
      respondAtRequest: true,
      matchQuery: [{ name: 'v', value: '2' }],
    },
  ]);
  for (const [id, url] of [
    ['pre-yes', `${TEST_DOMAIN}/api/items?v=2`],
    ['pre-no', `${TEST_DOMAIN}/api/items?v=1`],
  ]) {
    harness.emitDebuggerEvent('Fetch.requestPaused', {
      requestId: id,
      request: {
        url,
        method: 'OPTIONS',
        headers: { Origin: 'https://page.test', 'Access-Control-Request-Method': 'PUT' },
      },
      resourceType: 'Preflight',
    });
  }
  await new Promise(resolve => setTimeout(resolve, 20));
  const yes = commandFor(harness, 'pre-yes');
  assert.equal(yes?.method, 'Fetch.fulfillRequest');
  assert.equal(yes.params.responseCode, 204);
  assert.equal(commandFor(harness, 'pre-no')?.method, 'Fetch.continueRequest');
});

// ---- rule editor, list and import ------------------------------------------------

function click(harness, selector) {
  harness.document
    .querySelector(selector)
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
}

test('Rule editor saves match conditions and shows them again when editing', async () => {
  const harness = createUiHarness({
    storageState: { enabled: true, overrides: [] },
    apis: [{ url: `${TEST_DOMAIN}/api/orders?page=2`, type: 'fetch' }],
  });
  await flushUi(harness.window);
  click(harness, '.api-item');
  await flushUi(harness.window);

  harness.document.getElementById('modal-match-query').value = 'page=2&debug';
  harness.document.getElementById('modal-match-headers').value = 'X-Tenant: acme\nAuthorization';
  harness.document.getElementById('modal-match-body').value = '"plan":"pro"';
  click(harness, '#save-override');
  await flushUi(harness.window);

  const saved = harness.localState.overrides[0];
  assert.deepEqual(normalizePlain(saved.matchQuery), [
    { name: 'page', value: '2' },
    { name: 'debug' },
  ]);
  assert.deepEqual(normalizePlain(saved.matchHeaders), [
    { name: 'X-Tenant', value: 'acme' },
    { name: 'Authorization' },
  ]);
  assert.equal(saved.matchBody, '"plan":"pro"');

  click(harness, '[data-tab="overrides"]');
  await flushUi(harness.window);
  const badge = harness.document.querySelector('.match-badge');
  assert.ok(badge, 'the rule list shows that the rule has conditions');
  assert.match(badge.title, /page=2/);
  assert.match(badge.title, /X-Tenant/);
  assert.match(badge.title, /plan/);

  click(harness, '.edit-btn');
  await flushUi(harness.window);
  assert.equal(harness.document.getElementById('modal-match-query').value, 'page=2&debug');
  assert.equal(
    harness.document.getElementById('modal-match-headers').value,
    'X-Tenant: acme\nAuthorization'
  );
  assert.equal(harness.document.getElementById('modal-match-body').value, '"plan":"pro"');
});

test('Rule editor saves no condition fields when they are left empty', async () => {
  const harness = createUiHarness({
    storageState: { enabled: true, overrides: [] },
    apis: [{ url: `${TEST_DOMAIN}/api/users`, type: 'fetch' }],
  });
  await flushUi(harness.window);
  click(harness, '.api-item');
  await flushUi(harness.window);
  click(harness, '#save-override');
  await flushUi(harness.window);
  const saved = harness.localState.overrides[0];
  assert.equal('matchQuery' in saved, false);
  assert.equal('matchHeaders' in saved, false);
  assert.equal('matchBody' in saved, false);
});

test('Captured API list counts a rule only when its conditions hold', async () => {
  const { NetworkOverridesUi } = createUiContext();
  const rule = { pattern: '/api/orders', body: '', mode: 'text', matchQuery: [{ name: 'page' }] };
  assert.equal(
    NetworkOverridesUi.getMatchingRuleStatus(
      { url: 'https://a.test/api/orders?page=1', type: 'fetch' },
      [rule]
    )?.index,
    0
  );
  assert.equal(
    NetworkOverridesUi.getMatchingRuleStatus({ url: 'https://a.test/api/orders', type: 'fetch' }, [
      rule,
    ]),
    null
  );
});

function selectImportFile(harness, jsonText) {
  const file = new harness.window.File([jsonText], 'rules.json', { type: 'application/json' });
  const input = harness.document.getElementById('import-rules-input');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
}

test('Import keeps match conditions and drops unknown keys inside them', async () => {
  const harness = createUiHarness({ apis: [], tabUrl: `${TEST_DOMAIN}/` });
  await flushUi(harness.window);
  selectImportFile(
    harness,
    JSON.stringify({
      version: 1,
      domain: TEST_DOMAIN,
      overrides: [
        {
          pattern: '/api/orders',
          mode: 'text',
          body: '{}',
          matchQuery: [{ name: 'page', value: '2', extra: 1 }, { name: 'debug' }],
          matchHeaders: [{ name: 'X-Tenant', value: 'acme' }],
          matchBody: 'pro',
        },
      ],
    })
  );
  await flushUi(harness.window);
  assert.deepEqual(harness.localState[`overrides_${TEST_DOMAIN}`], [
    {
      pattern: '/api/orders',
      mode: 'text',
      body: '{}',
      matchQuery: [{ name: 'page', value: '2' }, { name: 'debug' }],
      matchHeaders: [{ name: 'X-Tenant', value: 'acme' }],
      matchBody: 'pro',
    },
  ]);
});

test('Import rejects malformed match conditions', async () => {
  const harness = createUiHarness({ apis: [], tabUrl: `${TEST_DOMAIN}/` });
  await flushUi(harness.window);
  for (const bad of [
    { matchQuery: 'page=2' },
    { matchQuery: [{ name: '' }] },
    { matchQuery: [{ name: 'a', value: 2 }] },
    { matchHeaders: [{ value: 'x' }] },
    { matchBody: 42 },
  ]) {
    selectImportFile(
      harness,
      JSON.stringify({
        version: 1,
        domain: TEST_DOMAIN,
        overrides: [{ pattern: 'x', mode: 'text', body: '', ...bad }],
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
