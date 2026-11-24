import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import {
  createUiContext,
  createUiHarness,
  flushUi,
  closeAllUiHarnessWindows,
  normalize,
} from './test-harness.mjs';
import { TEST_DOMAIN } from './config.mjs';

after(() => {
  closeAllUiHarnessWindows();
});

function click(harness, element) {
  element.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
}

function input(harness, element, value) {
  element.value = value;
  element.dispatchEvent(new harness.window.Event('input', { bubbles: true }));
}

function change(harness, element, value) {
  element.value = value;
  element.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
}

const $ = (harness, selector) => harness.document.querySelector(selector);
const shown = element => element.style.display !== 'none';
const savedRules = harness => normalize(harness.localState[`overrides_${TEST_DOMAIN}`] || []);
const lastUpdate = harness =>
  harness.sentMessages.filter(message => message.type === 'update').at(-1);

async function panelHarness(options = {}) {
  const harness = createUiHarness({ page: 'panel.html', tabUrl: `${TEST_DOMAIN}/`, ...options });
  await flushUi(harness.window);
  return harness;
}

async function newRule(harness, pattern) {
  click(harness, $(harness, '#add-api-btn'));
  await flushUi(harness.window);
  input(harness, $(harness, '#modal-pattern'), pattern);
}

async function save(harness) {
  click(harness, $(harness, '#save-override'));
  await flushUi(harness.window, 6);
}

// ---- removing response headers ---------------------------------------------------

test('the No CSP and No cache presets keep the real response and list the headers to remove', async () => {
  const harness = await panelHarness();
  await newRule(harness, '/page');
  click(harness, $(harness, '.preset-btn[data-preset="no-csp"]'));
  assert.equal($(harness, '#modal-mode').value, 'passthrough');
  assert.equal(shown($(harness, '#modal-passthrough-help')), true);
  assert.equal(shown($(harness, '#modal-body').closest('.modal-field')), false);
  assert.equal(shown($(harness, '#modal-process-templates').closest('.modal-field')), false);
  assert.equal($(harness, '#modal-group-response-headers').open, true);
  // A second preset adds its headers to the list.
  click(harness, $(harness, '.preset-btn[data-preset="no-cache"]'));
  await save(harness);
  assert.deepEqual(savedRules(harness), [
    {
      pattern: '/page',
      body: '',
      mode: 'passthrough',
      removeResponseHeaders: [
        'content-security-policy',
        'content-security-policy-report-only',
        'cache-control',
        'expires',
        'etag',
        'last-modified',
        'pragma',
        'age',
      ],
    },
  ]);
});

test('a mocked body can remove headers too, and a bad name is refused', async () => {
  const harness = await panelHarness();
  await newRule(harness, '/api/x');
  input(harness, $(harness, '#modal-body'), '{}');
  input(harness, $(harness, '#modal-remove-headers'), 'Set-Cookie\nnot a header');
  await save(harness);
  assert.match($(harness, '#modal-feedback').textContent, /not a header/);
  assert.equal($(harness, '#modal-remove-headers').getAttribute('aria-invalid'), 'true');
  assert.deepEqual(savedRules(harness), []);

  input(harness, $(harness, '#modal-remove-headers'), 'Set-Cookie, X-Debug-*');
  assert.equal($(harness, '#modal-group-response-headers .modal-group-count').textContent, '2');
  await save(harness);
  assert.deepEqual(savedRules(harness), [
    {
      pattern: '/api/x',
      body: '{}',
      mode: 'text',
      removeResponseHeaders: ['set-cookie', 'x-debug-*'],
    },
  ]);
});

test('a pass-through rule saves no body and never answers without the server', async () => {
  const harness = await panelHarness();
  await newRule(harness, '/api/y');
  input(harness, $(harness, '#modal-body'), 'ignored');
  $(harness, '#modal-respond-at-request').checked = true;
  change(harness, $(harness, '#modal-mode'), 'passthrough');
  assert.equal(shown($(harness, '#modal-respond-at-request').closest('.modal-field')), false);
  input(harness, $(harness, '#modal-status'), '503');
  await save(harness);
  assert.deepEqual(savedRules(harness), [
    { pattern: '/api/y', body: '', mode: 'passthrough', statusCode: 503 },
  ]);
});

// ---- weighted random responses ------------------------------------------------------

test('the editor saves other responses with weights and a seed, and shows them again', async () => {
  const harness = await panelHarness();
  await newRule(harness, '/api/flaky');
  // Plain text: reopening the editor would pretty-print a JSON body.
  input(harness, $(harness, '#modal-body'), 'ok');
  input(harness, $(harness, '#modal-status'), '200');
  click(harness, $(harness, '#modal-add-variant'));
  const row = $(harness, '#modal-variants .variant-row');
  input(harness, row.querySelector('.variant-weight'), '20');
  input(harness, row.querySelector('.variant-status'), '500');
  input(harness, row.querySelector('.variant-body'), '{"error":"boom"}');
  input(harness, row.querySelector('.variant-headers'), 'Retry-After: 1');
  input(harness, $(harness, '#modal-weight'), '80');
  input(harness, $(harness, '#modal-random-seed'), '42');
  assert.equal($(harness, '#modal-group-responses .modal-group-count').textContent, '1');
  await save(harness);

  const rule = {
    pattern: '/api/flaky',
    body: 'ok',
    mode: 'text',
    statusCode: 200,
    responses: [
      {
        weight: 20,
        body: '{"error":"boom"}',
        statusCode: 500,
        responseHeaders: [{ name: 'Retry-After', value: '1' }],
      },
    ],
    weight: 80,
    randomSeed: 42,
  };
  assert.deepEqual(savedRules(harness), [rule]);
  assert.match($(harness, '#list').textContent, /random: 2 responses/);

  click(harness, $(harness, '.tab-btn[data-tab="overrides"]'));
  await flushUi(harness.window);
  click(harness, $(harness, '#list .edit-btn'));
  await flushUi(harness.window);
  assert.equal($(harness, '#modal-group-responses').open, true);
  const rows = harness.document.querySelectorAll('#modal-variants .variant-row');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].querySelector('.variant-status').value, '500');
  assert.equal($(harness, '#modal-weight').value, '80');
  assert.equal($(harness, '#modal-random-seed').value, '42');
  await save(harness);
  assert.deepEqual(savedRules(harness), [rule]);

  // Removing the only other response saves a plain rule again.
  click(harness, $(harness, '#list .edit-btn'));
  await flushUi(harness.window);
  click(harness, $(harness, '#modal-variants .variant-delete'));
  await save(harness);
  assert.deepEqual(savedRules(harness), [
    { pattern: '/api/flaky', body: 'ok', mode: 'text', statusCode: 200 },
  ]);
});

test('bad weights and seeds are refused; script and patch bodies have no other responses', async () => {
  const harness = await panelHarness();
  await newRule(harness, '/api/w');
  click(harness, $(harness, '#modal-add-variant'));
  const row = $(harness, '#modal-variants .variant-row');
  input(harness, row.querySelector('.variant-weight'), '1.5');
  await save(harness);
  assert.match($(harness, '#modal-feedback').textContent, /whole number from 0 to 1000/);

  input(harness, row.querySelector('.variant-weight'), '0');
  input(harness, $(harness, '#modal-weight'), '0');
  await save(harness);
  assert.match($(harness, '#modal-feedback').textContent, /weight above 0/);

  input(harness, $(harness, '#modal-weight'), '');
  input(harness, $(harness, '#modal-random-seed'), '-1');
  await save(harness);
  assert.match($(harness, '#modal-feedback').textContent, /seed/i);
  assert.deepEqual(savedRules(harness), []);

  change(harness, $(harness, '#modal-mode'), 'script');
  assert.equal(shown($(harness, '#modal-responses-fields')), false);
  input(harness, $(harness, '#modal-body'), 'return 1;');
  await save(harness);
  assert.deepEqual(savedRules(harness), [{ pattern: '/api/w', body: 'return 1;', mode: 'script' }]);
});

// ---- variables ------------------------------------------------------------------------

async function openVariables(harness) {
  click(harness, $(harness, '.tab-btn[data-tab="overrides"]'));
  await flushUi(harness.window);
  click(harness, $(harness, '#variables-btn'));
  await flushUi(harness.window);
}

test('the Variables dialog saves site and global variables and sends them, site first', async () => {
  const harness = await panelHarness({
    storageState: {
      overrides: [{ pattern: '{{api}}/users', body: '{}', mode: 'text' }],
      variables_global: [{ name: 'api', value: '/global' }],
    },
  });
  await openVariables(harness);
  assert.equal($(harness, '#variables-modal').style.display, 'flex');
  assert.equal($(harness, '#variables-site-name').textContent, TEST_DOMAIN);
  assert.equal($(harness, '#variables-global').value, 'api: /global');
  // The tables use the words of variables, not of headers.
  assert.equal(
    $(harness, '#variables-global-table .header-row-key').getAttribute('aria-label'),
    'Variable name'
  );

  input(harness, $(harness, '#variables-site'), 'api: /v2\nhost: http://staging:8080');
  input(harness, $(harness, '#variables-global'), 'api: /global\ntoken: abc');
  click(harness, $(harness, '#variables-save'));
  await flushUi(harness.window, 6);

  assert.equal($(harness, '#variables-modal').style.display, 'none');
  assert.deepEqual(normalize(harness.localState[`variables_${TEST_DOMAIN}`]), [
    { name: 'api', value: '/v2' },
    { name: 'host', value: 'http://staging:8080' },
  ]);
  assert.deepEqual(normalize(harness.localState.variables_global), [
    { name: 'api', value: '/global' },
    { name: 'token', value: 'abc' },
  ]);
  assert.deepEqual(lastUpdate(harness).variables, {
    api: '/v2',
    token: 'abc',
    host: 'http://staging:8080',
  });
  assert.match($(harness, '.notification-toast--success').textContent, /Variables saved/);
});

test('the Variables dialog refuses bad, built-in and repeated names', async () => {
  const harness = await panelHarness();
  await openVariables(harness);
  for (const [text, message] of [
    ['now: 1', /built-in/],
    ['2x: 1', /not a variable name/],
    ['a: 1\na: 2', /twice/],
    ['just text', /needs a name and a value/],
  ]) {
    input(harness, $(harness, '#variables-site'), text);
    click(harness, $(harness, '#variables-save'));
    await flushUi(harness.window);
    assert.match($(harness, '#variables-feedback').textContent, message, text);
  }
  assert.equal(harness.localState.variables_global, undefined);
  assert.equal($(harness, '#variables-modal').style.display, 'flex');
});

test('stored variables go to the background with the rules and mark captured requests', async () => {
  const harness = await panelHarness({
    storageState: {
      overrides: [{ pattern: '/api/{{resource}}', body: '{}', mode: 'text' }],
      [`variables_${TEST_DOMAIN}`]: [{ name: 'resource', value: 'users' }],
    },
    apis: [{ url: `${TEST_DOMAIN}/api/users`, type: 'fetch', method: 'GET' }],
  });
  assert.deepEqual(lastUpdate(harness).variables, { resource: 'users' });
  click(harness, $(harness, '.tab-btn[data-tab="overridden"]'));
  await flushUi(harness.window);
  assert.match($(harness, '#apis-list').textContent, /\/api\/users/);
});

// ---- import and summary ------------------------------------------------------------------

function selectImportFile(harness, jsonText) {
  const file = new harness.window.File([jsonText], 'rules.json', { type: 'application/json' });
  const element = harness.document.getElementById('import-rules-input');
  Object.defineProperty(element, 'files', { value: [file], configurable: true });
  element.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
}

test('an exported rule with removed headers and weighted responses imports as it was', async () => {
  const harness = await panelHarness();
  const rules = [
    {
      pattern: '/page',
      body: '',
      mode: 'passthrough',
      removeResponseHeaders: ['content-security-policy'],
    },
    {
      pattern: '/api/flaky',
      body: { ok: true },
      mode: 'text',
      weight: 4,
      randomSeed: 7,
      responses: [{ weight: 1, statusCode: 500, body: { error: 'boom' } }],
    },
  ];
  selectImportFile(harness, JSON.stringify({ version: 1, overrides: rules }));
  await flushUi(harness.window, 6);
  assert.deepEqual(savedRules(harness), [
    rules[0],
    {
      pattern: '/api/flaky',
      body: '{"ok":true}',
      mode: 'text',
      responses: [{ weight: 1, body: '{"error":"boom"}', statusCode: 500 }],
      weight: 4,
      randomSeed: 7,
    },
  ]);
});

test('an import with responses on a script rule, or bad removed headers, is refused', async () => {
  for (const rule of [
    { pattern: 'a', body: 'return 1;', mode: 'script', responses: [{ weight: 1, body: 'x' }] },
    { pattern: 'b', body: '', mode: 'text', responses: [{ weight: -1, body: 'x' }] },
    { pattern: 'c', body: '', mode: 'text', weight: 2 },
    { pattern: 'd', body: '', mode: 'text', removeResponseHeaders: ['bad name'] },
  ]) {
    const harness = await panelHarness();
    selectImportFile(harness, JSON.stringify({ version: 1, overrides: [rule] }));
    await flushUi(harness.window, 6);
    assert.deepEqual(savedRules(harness), [], rule.pattern);
    assert.match($(harness, '.notification-toast--error').textContent, /rule/i);
  }
});

test('the rule list says when a rule keeps the real response, removes headers or picks at random', () => {
  const ui = createUiContext().NetworkOverridesUi;
  assert.equal(
    ui.summarizeRule({
      pattern: '/page',
      body: '',
      mode: 'passthrough',
      removeResponseHeaders: ['content-security-policy'],
    }),
    '/page → real response · −content-security-policy'
  );
  assert.equal(
    ui.summarizeRule({
      pattern: '/api',
      body: '',
      mode: 'text',
      statusCode: 200,
      removeResponseHeaders: ['etag', 'expires'],
      responses: [
        { weight: 1, body: '' },
        { weight: 1, body: '' },
      ],
    }),
    '/api → 200 · random: 3 responses · −2 response headers'
  );
});
