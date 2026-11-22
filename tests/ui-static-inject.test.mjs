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

const ui = createUiContext().NetworkOverridesUi;

function click(harness, element) {
  element.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
}

function input(harness, element, value) {
  element.value = value;
  element.dispatchEvent(new harness.window.Event('input', { bubbles: true }));
}

const $ = (harness, selector) => harness.document.querySelector(selector);
const shown = el => {
  for (let node = el; node; node = node.parentElement) {
    if (node.style?.display === 'none' || node.hidden) return false;
  }
  return true;
};
const savedRules = harness => normalize(harness.localState[`overrides_${TEST_DOMAIN}`] || []);

async function panelHarness(options = {}) {
  const harness = createUiHarness({ page: 'panel.html', tabUrl: `${TEST_DOMAIN}/`, ...options });
  await flushUi(harness.window);
  return harness;
}

async function openNewRule(harness) {
  click(harness, $(harness, '#add-api-btn'));
  await flushUi(harness.window);
}

async function openFirstRule(harness) {
  click(harness, $(harness, '.tab-btn[data-tab="overrides"]'));
  await flushUi(harness.window);
  click(harness, $(harness, '#list .edit-btn'));
  await flushUi(harness.window);
}

function chooseType(harness, value) {
  const radio = $(harness, `input[name="modal-override-type"][value="${value}"]`);
  radio.checked = true;
  radio.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
}

async function save(harness) {
  click(harness, $(harness, '#save-override'));
  await flushUi(harness.window, 6);
}

async function pickFile(harness, parts, name, type) {
  const file = new harness.window.File(parts, name, { type });
  const picker = $(harness, '#modal-body-file');
  Object.defineProperty(picker, 'files', { value: [file], configurable: true });
  picker.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
  for (let i = 0; i < 20; i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
    await flushUi(harness.window);
    if (picker.dataset.loading !== 'true') break;
  }
}

// ---- summaries ---------------------------------------------------------------------

test('a rule built from a local file and an inject rule each read as one line', () => {
  assert.equal(
    ui.summarizeRule({ pattern: '*/app.js', body: 'x', mode: 'text', fileName: 'app.js' }),
    '*/app.js → local file app.js'
  );
  assert.equal(
    ui.summarizeRule({ pattern: '*/logo.png', body: 'AA==', mode: 'file', fileName: 'new.png' }),
    '*/logo.png → local file new.png'
  );
  const inject = extra => ({
    pattern: 'https://example.com/*',
    body: '',
    mode: 'text',
    kind: 'inject',
    ...extra,
  });
  assert.equal(
    ui.summarizeRule(inject({ injectStyle: 'a{}' })),
    'https://example.com/* → inject CSS'
  );
  assert.equal(
    ui.summarizeRule(inject({ injectScript: 'go()' })),
    'https://example.com/* → inject JS'
  );
  assert.equal(
    ui.summarizeRule(
      inject({ injectScript: 'go()', injectStyle: 'a{}', relaxCsp: true, method: 'GET' })
    ),
    'https://example.com/* → inject JS + CSS · CSP removed'
  );
});

// ---- inject rules in the editor -----------------------------------------------------

test('the Inject JS/CSS type shows only its own fields and saves an inject rule', async () => {
  const harness = await panelHarness();
  await openNewRule(harness);
  assert.equal(shown($(harness, '#modal-inject-fields')), false, 'hidden for a mock response');

  chooseType(harness, 'inject');
  assert.equal(shown($(harness, '#modal-inject-fields')), true);
  for (const id of [
    '#modal-body-fields',
    '#modal-status-field',
    '#modal-presets',
    '#modal-method',
  ]) {
    assert.equal(shown($(harness, id)), false, id);
  }
  assert.equal(shown($(harness, '#modal-pattern')), true);

  input(harness, $(harness, '#modal-pattern'), `${TEST_DOMAIN}/*`);
  await save(harness);
  assert.match($(harness, '#modal-feedback').textContent, /script or a stylesheet/i);
  assert.deepEqual(savedRules(harness), []);

  input(harness, $(harness, '#modal-inject-script'), 'window.hi = 1;');
  input(harness, $(harness, '#modal-inject-style'), 'body{background:pink}');
  $(harness, '#modal-inject-relax-csp').checked = true;
  await save(harness);
  assert.deepEqual(savedRules(harness), [
    {
      pattern: `${TEST_DOMAIN}/*`,
      body: '',
      mode: 'text',
      kind: 'inject',
      injectScript: 'window.hi = 1;',
      injectStyle: 'body{background:pink}',
      relaxCsp: true,
    },
  ]);
});

test('editing an inject rule fills its fields and keeps its shape', async () => {
  const rule = {
    pattern: `${TEST_DOMAIN}/*`,
    body: '',
    mode: 'text',
    kind: 'inject',
    injectStyle: 'p{color:red}',
  };
  const harness = await panelHarness({ storageState: { overrides: [rule] } });
  await openFirstRule(harness);
  assert.equal($(harness, 'input[name="modal-override-type"][value="inject"]').checked, true);
  assert.equal($(harness, '#modal-inject-style').value, 'p{color:red}');
  assert.equal($(harness, '#modal-inject-script').value, '');
  assert.equal($(harness, '#modal-inject-relax-csp').checked, false);
  assert.equal(shown($(harness, '#modal-inject-fields')), true);
  await save(harness);
  assert.deepEqual(savedRules(harness), [rule]);
});

// ---- replacing a file with one from disk ----------------------------------------------

test('a text file picked from disk fills the body, its type and turns templates off', async () => {
  const harness = await panelHarness();
  await openNewRule(harness);
  input(harness, $(harness, '#modal-pattern'), '*/static/app.js');
  await pickFile(harness, ['console.log("{{now}}");'], 'app.js', '');

  assert.equal($(harness, '#modal-body').value, 'console.log("{{now}}");');
  assert.equal(shown($(harness, '#modal-body')), true, 'text stays editable');
  assert.equal($(harness, '#modal-mode').value, 'text');
  assert.equal($(harness, '#modal-process-templates').checked, false);
  assert.match($(harness, '#modal-body-file-info').textContent, /app\.js/);
  await save(harness);
  assert.deepEqual(savedRules(harness), [
    {
      pattern: '*/static/app.js',
      body: 'console.log("{{now}}");',
      mode: 'text',
      fileName: 'app.js',
      processTemplates: false,
      responseHeaders: [{ name: 'Content-Type', value: 'text/javascript; charset=utf-8' }],
    },
  ]);
});

test('an image picked from disk is kept as base64 and shown by name, not as text', async () => {
  const harness = await panelHarness();
  await openNewRule(harness);
  input(harness, $(harness, '#modal-pattern'), '*/logo.png');
  await pickFile(harness, [new Uint8Array([137, 80, 78, 71, 0, 255])], 'new-logo.png', 'image/png');

  assert.equal(shown($(harness, '#modal-body')), false, 'no base64 in the text box');
  assert.equal($(harness, '#modal-mode').value, 'file');
  assert.match($(harness, '#modal-body-file-info').textContent, /new-logo\.png/);
  await save(harness);
  assert.deepEqual(savedRules(harness), [
    {
      pattern: '*/logo.png',
      body: Buffer.from([137, 80, 78, 71, 0, 255]).toString('base64'),
      mode: 'file',
      fileName: 'new-logo.png',
      responseHeaders: [{ name: 'Content-Type', value: 'image/png' }],
    },
  ]);
});

test('editing a rule that holds a binary file keeps the file; removing it brings the text box back', async () => {
  const rule = {
    pattern: '*/font.woff2',
    body: 'd09GMgAB',
    mode: 'file',
    fileName: 'font.woff2',
    responseHeaders: [{ name: 'Content-Type', value: 'font/woff2' }],
  };
  const harness = await panelHarness({ storageState: { overrides: [rule] } });
  await openFirstRule(harness);
  assert.equal(shown($(harness, '#modal-body')), false);
  assert.match($(harness, '#modal-body-file-info').textContent, /font\.woff2/);
  await save(harness);
  assert.deepEqual(savedRules(harness), [rule]);

  await openFirstRule(harness);
  click(harness, $(harness, '#modal-body-file-clear'));
  assert.equal(shown($(harness, '#modal-body')), true);
  assert.equal(shown($(harness, '#modal-body-file-info')), false);
  input(harness, $(harness, '#modal-body'), 'd09GMgAC');
  await save(harness);
  const [saved] = savedRules(harness);
  assert.equal(saved.body, 'd09GMgAC');
  assert.equal(saved.fileName, undefined);
});

test('a file over 2 MB is still loaded, with a warning about browser storage', async () => {
  const harness = await panelHarness();
  await openNewRule(harness);
  input(harness, $(harness, '#modal-pattern'), '*/big.png');
  await pickFile(harness, [new Uint8Array(1_700_000)], 'big.png', 'image/png');
  assert.match($(harness, '#modal-feedback').textContent, /MB/);
  assert.match($(harness, '#modal-feedback').className, /is-info/);
  await save(harness);
  assert.equal(savedRules(harness)[0].fileName, 'big.png');
});

// ---- import and export ----------------------------------------------------------------

test('Import keeps the fields of inject rules and file rules', async () => {
  const harness = createUiHarness({ apis: [], tabUrl: `${TEST_DOMAIN}/` });
  await flushUi(harness.window);
  const rules = [
    {
      pattern: `${TEST_DOMAIN}/*`,
      mode: 'text',
      body: '',
      kind: 'inject',
      injectScript: 'go()',
      injectStyle: 'a{}',
      relaxCsp: true,
    },
    { pattern: '*/logo.png', mode: 'file', body: 'AA==', fileName: 'logo.png' },
  ];
  const file = new harness.window.File(
    [JSON.stringify({ version: 1, domain: TEST_DOMAIN, overrides: rules })],
    'rules.json',
    { type: 'application/json' }
  );
  const picker = harness.document.getElementById('import-rules-input');
  Object.defineProperty(picker, 'files', { value: [file], configurable: true });
  picker.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
  await flushUi(harness.window);
  assert.deepEqual(harness.localState[`overrides_${TEST_DOMAIN}`], rules);
});
