import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createUiHarness, flushUi, closeAllUiHarnessWindows } from './test-harness.mjs';
import { TEST_DOMAIN } from './config.mjs';

after(() => {
  closeAllUiHarnessWindows();
});

function click(harness, element) {
  element.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
}

function chooseType(harness, value) {
  const radio = harness.document.querySelector(
    `input[name="modal-override-type"][value="${value}"]`
  );
  radio.checked = true;
  radio.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
}

function selectImportFile(harness, jsonText) {
  const file = new harness.window.File([jsonText], 'rules.json', { type: 'application/json' });
  const input = harness.document.getElementById('import-rules-input');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
}

test('The modal saves "Answer without calling the server" and shows it again on edit', async () => {
  const harness = createUiHarness({ apis: [], tabUrl: `${TEST_DOMAIN}/` });
  await flushUi(harness.window);

  click(harness, harness.document.getElementById('add-api-btn'));
  await flushUi(harness.window);
  harness.document.getElementById('modal-pattern').value = '/api/new';
  harness.document.getElementById('modal-body').value = '{"ok":true}';
  harness.document.getElementById('modal-respond-at-request').checked = true;
  click(harness, harness.document.getElementById('save-override'));
  await flushUi(harness.window);

  assert.deepEqual(harness.localState[`overrides_${TEST_DOMAIN}`], [
    { pattern: '/api/new', body: '{"ok":true}', mode: 'text', respondAtRequest: true },
  ]);

  click(harness, harness.document.querySelector('[data-tab="overrides"]'));
  await flushUi(harness.window);
  const badge = harness.document.querySelector('.override-offline-badge');
  assert.equal(badge?.textContent, 'NO SERVER');

  click(harness, harness.document.querySelector('.override-item .rule-pattern'));
  await flushUi(harness.window);
  assert.equal(harness.document.getElementById('modal-respond-at-request').checked, true);
});

test('The option is only offered for body rules and is not saved on other types', async () => {
  const harness = createUiHarness({ apis: [], tabUrl: `${TEST_DOMAIN}/` });
  await flushUi(harness.window);

  click(harness, harness.document.getElementById('add-api-btn'));
  await flushUi(harness.window);
  const option = harness.document.getElementById('modal-respond-at-request');
  const label = option.closest('label');
  assert.notEqual(label.style.display, 'none');

  option.checked = true;
  chooseType(harness, 'websocket');
  assert.equal(label.style.display, 'none');
  chooseType(harness, 'fail');
  harness.document.getElementById('modal-pattern').value = 'api/fail';
  click(harness, harness.document.getElementById('save-override'));
  await flushUi(harness.window);

  const [saved] = harness.localState[`overrides_${TEST_DOMAIN}`];
  assert.equal(saved.failReason, 'Failed');
  assert.equal('respondAtRequest' in saved, false);
});

test('Import keeps respondAtRequest and rejects a value that is not a boolean', async () => {
  const harness = createUiHarness({ apis: [], tabUrl: `${TEST_DOMAIN}/` });
  await flushUi(harness.window);
  const rule = { pattern: '/api/new', mode: 'text', body: '{}', respondAtRequest: true };

  selectImportFile(
    harness,
    JSON.stringify({
      version: 1,
      domain: TEST_DOMAIN,
      overrides: [{ ...rule, respondAtRequest: 'yes' }],
    })
  );
  await flushUi(harness.window);
  assert.match(
    harness.document.querySelector('.notification-toast--error').textContent,
    /invalid/i
  );
  assert.equal(harness.localState[`overrides_${TEST_DOMAIN}`], undefined);

  selectImportFile(harness, JSON.stringify({ version: 1, domain: TEST_DOMAIN, overrides: [rule] }));
  await flushUi(harness.window);
  assert.deepEqual(harness.localState[`overrides_${TEST_DOMAIN}`], [rule]);
});
