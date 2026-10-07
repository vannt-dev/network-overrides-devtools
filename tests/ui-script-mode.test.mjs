import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createUiHarness, flushUi, closeAllUiHarnessWindows } from './test-harness.mjs';
import { TEST_DOMAIN } from './config.mjs';

// Every createUiHarness() call boots a jsdom window whose interval keeps the
// process alive until the window is closed.
after(() => {
  closeAllUiHarnessWindows();
});

const click = (harness, element) =>
  element.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));

async function openEditor() {
  const harness = createUiHarness({
    apis: [{ url: `${TEST_DOMAIN}/api/users`, type: 'fetch', method: 'GET' }],
    tabUrl: `${TEST_DOMAIN}/`,
  });
  await flushUi(harness.window);
  click(harness, harness.document.querySelector('#apis-list li.api-item'));
  await flushUi(harness.window);
  return harness;
}

function chooseMode(harness, mode) {
  const select = harness.document.getElementById('modal-mode');
  select.value = mode;
  select.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
}

test('Choosing the script mode explains it and puts the template option away', async () => {
  const harness = await openEditor();
  const help = harness.document.getElementById('modal-script-help');
  const templates = harness.document.getElementById('modal-process-templates').closest('label');
  const body = harness.document.getElementById('modal-body');

  assert.equal(help.style.display, 'none');
  assert.equal(templates.style.display, '');

  chooseMode(harness, 'script');
  assert.equal(help.style.display, '');
  assert.equal(templates.style.display, 'none');
  assert.match(body.placeholder, /^return /);

  // The explanation belongs to a response body; a redirect has none.
  const redirect = harness.document.querySelector(
    'input[name="modal-override-type"][value="redirect"]'
  );
  redirect.checked = true;
  redirect.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
  assert.equal(help.style.display, 'none');

  const bodyType = harness.document.querySelector(
    'input[name="modal-override-type"][value="body"]'
  );
  bodyType.checked = true;
  bodyType.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
  chooseMode(harness, 'text');
  assert.equal(help.style.display, 'none');
  assert.equal(templates.style.display, '');
  assert.equal(body.placeholder, 'Custom response body');
});

test('A script rule is saved with its source untouched and shown again on edit', async () => {
  const harness = await openEditor();
  const script = 'const n = 1;\nreturn { status: 201, body: { n } };';

  chooseMode(harness, 'script');
  harness.document.getElementById('modal-body').value = script;
  click(harness, harness.document.getElementById('save-override'));
  await flushUi(harness.window);

  const saved = harness.storageSets.findLast(set => `overrides_${TEST_DOMAIN}` in set)[
    `overrides_${TEST_DOMAIN}`
  ][0];
  assert.equal(saved.mode, 'script');
  assert.equal(saved.body, script);
});

test('Imported rules may be script rules', async () => {
  const harness = createUiHarness({
    storageState: { enabled: true, overrides: [] },
    apis: [],
    tabUrl: `${TEST_DOMAIN}/`,
  });
  await flushUi(harness.window);
  click(harness, harness.document.querySelector('[data-tab="overrides"]'));
  await flushUi(harness.window);

  const rule = { pattern: 'api/users', body: 'return "x";', mode: 'script' };
  const file = new harness.window.File(
    [JSON.stringify({ version: 1, domain: TEST_DOMAIN, overrides: [rule] })],
    'rules.json',
    { type: 'application/json' }
  );
  const input = harness.document.getElementById('import-rules-input');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
  await flushUi(harness.window);

  assert.deepEqual(harness.localState.overrides, [rule]);
});
