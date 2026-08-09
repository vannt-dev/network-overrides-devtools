import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createUiHarness, flushUi, closeAllUiHarnessWindows } from './test-harness.mjs';
import { TEST_API_URL, TEST_DOMAIN } from './config.mjs';

// Every createUiHarness() call in this file boots a real jsdom window whose
// window.setInterval (from ui.ts's init) keeps running until the window is
// closed. Close them all once, after this file's tests finish, so the
// process can exit instead of hanging on leaked timers.
after(() => {
  closeAllUiHarnessWindows();
});

function selectImportFile(harness, jsonText) {
  const file = new harness.window.File([jsonText], 'rules.json', { type: 'application/json' });
  const input = harness.document.getElementById('import-rules-input');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
}

test('Saving a body override persists status, delay, and extra headers', async () => {
  const harness = createUiHarness({
    apis: [{ url: `${TEST_DOMAIN}/api/users`, type: 'fetch', method: 'GET' }],
    tabUrl: `${TEST_DOMAIN}/`,
  });
  await flushUi(harness.window);

  harness.document
    .querySelector('#apis-list li.api-item')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  harness.document.getElementById('modal-body').value = '{"mock":1}';
  harness.document.getElementById('modal-status').value = '503';
  harness.document.getElementById('modal-delay').value = '1500';
  harness.document.getElementById('modal-headers').value =
    'X-Custom: yes\nContent-Type: text/plain';
  harness.document
    .getElementById('save-override')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  const saved = harness.storageSets.findLast(set => `overrides_${TEST_DOMAIN}` in set)[
    `overrides_${TEST_DOMAIN}`
  ][0];
  assert.equal(saved.statusCode, 503);
  assert.equal(saved.delayMs, 1500);
  assert.deepEqual(saved.responseHeaders, [
    { name: 'X-Custom', value: 'yes' },
    { name: 'Content-Type', value: 'text/plain' },
  ]);
});

test('Saving a fail rule persists failReason and delay with an empty body', async () => {
  const harness = createUiHarness({ apis: [], tabUrl: `${TEST_DOMAIN}/` });
  await flushUi(harness.window);

  harness.document
    .getElementById('add-api-btn')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  harness.document.getElementById('modal-pattern').value = 'api/fail';
  const failRadio = harness.document.querySelector(
    'input[name="modal-override-type"][value="fail"]'
  );
  failRadio.checked = true;
  failRadio.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
  harness.document.getElementById('modal-fail-reason').value = 'TimedOut';
  harness.document.getElementById('modal-delay').value = '2000';
  harness.document
    .getElementById('save-override')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  const saved = harness.storageSets.findLast(set => `overrides_${TEST_DOMAIN}` in set)[
    `overrides_${TEST_DOMAIN}`
  ][0];
  assert.equal(saved.failReason, 'TimedOut');
  assert.equal(saved.delayMs, 2000);
  assert.equal(saved.body, '');
  assert.equal(saved.redirectUrl, undefined);
  assert.equal(saved.statusCode, undefined);
});

test('Modal save rejects out-of-range status and delay and malformed header lines', async () => {
  const harness = createUiHarness({
    apis: [{ url: `${TEST_DOMAIN}/api/users`, type: 'fetch' }],
    tabUrl: `${TEST_DOMAIN}/`,
  });
  await flushUi(harness.window);

  harness.document
    .querySelector('#apis-list li.api-item')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  const save = () =>
    harness.document
      .getElementById('save-override')
      .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));

  harness.document.getElementById('modal-status').value = '99';
  save();
  await flushUi(harness.window);
  assert.match(harness.document.getElementById('modal-feedback').textContent, /status/i);
  assert.equal(
    harness.document.getElementById('modal-status').getAttribute('aria-invalid'),
    'true'
  );

  harness.document.getElementById('modal-status').value = '';
  harness.document.getElementById('modal-delay').value = '-5';
  save();
  await flushUi(harness.window);
  assert.match(harness.document.getElementById('modal-feedback').textContent, /delay/i);
  assert.equal(harness.document.getElementById('modal-delay').getAttribute('aria-invalid'), 'true');

  harness.document.getElementById('modal-delay').value = '';
  harness.document.getElementById('modal-headers').value = 'no colon here';
  save();
  await flushUi(harness.window);
  assert.match(harness.document.getElementById('modal-feedback').textContent, /header/i);
  assert.equal(
    harness.document.getElementById('modal-headers').getAttribute('aria-invalid'),
    'true'
  );
  assert.equal(harness.alerts.length, 0);

  const saved = harness.storageSets.find(set => `overrides_${TEST_DOMAIN}` in set);
  assert.equal(saved, undefined); // nothing was persisted
});

test('Modal keeps the editor open and explains storage failures', async () => {
  const harness = createUiHarness({
    apis: [{ url: `${TEST_DOMAIN}/api/users`, type: 'fetch' }],
    tabUrl: `${TEST_DOMAIN}/`,
    storageSetError: 'Storage quota exceeded',
  });
  await flushUi(harness.window);

  harness.document
    .querySelector('#apis-list li.api-item')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  const saveButton = harness.document.getElementById('save-override');
  saveButton.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  assert.equal(saveButton.disabled, true);
  assert.equal(saveButton.textContent, 'Saving…');
  await flushUi(harness.window);

  assert.equal(harness.document.getElementById('override-modal').style.display, 'block');
  assert.match(harness.document.getElementById('modal-feedback').textContent, /quota exceeded/i);
  assert.equal(saveButton.disabled, false);
  assert.equal(saveButton.textContent, 'Save');
  assert.equal(harness.localState.overrides, undefined);
});

test('Modal distinguishes saved rules from background apply failures', async () => {
  const harness = createUiHarness({
    apis: [{ url: `${TEST_DOMAIN}/api/users`, type: 'fetch' }],
    tabUrl: `${TEST_DOMAIN}/`,
    backgroundUpdateResponse: {
      success: false,
      error: 'Another debugger is already attached',
    },
  });
  await flushUi(harness.window);

  harness.document
    .querySelector('#apis-list li.api-item')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);
  harness.document
    .getElementById('save-override')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  assert.equal(harness.document.getElementById('override-modal').style.display, 'none');
  assert.equal(harness.localState.overrides.length, 1);
  const warning = harness.document.querySelector('.notification-toast--warning');
  assert.match(warning.textContent, /saved/i);
  assert.match(warning.textContent, /debugger/i);
});

test('Editing a fail rule pre-fills the fail type, reason, and delay', async () => {
  const harness = createUiHarness({
    storageState: {
      overrides: [
        {
          pattern: 'api/fail',
          body: '',
          mode: 'text',
          failReason: 'ConnectionRefused',
          delayMs: 500,
        },
      ],
    },
    apis: [],
    tabUrl: `${TEST_DOMAIN}/`,
  });
  await flushUi(harness.window);

  harness.document
    .querySelector('[data-tab="overrides"]')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);
  harness.document
    .querySelector('.edit-btn')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  assert.equal(
    harness.document.querySelector('input[name="modal-override-type"][value="fail"]').checked,
    true
  );
  assert.equal(harness.document.getElementById('modal-fail-reason').value, 'ConnectionRefused');
  assert.equal(harness.document.getElementById('modal-delay').value, '500');
  assert.equal(harness.document.getElementById('modal-fail-fields').style.display, '');
});

test('Rules list shows status, delay, and FAIL badges', async () => {
  const harness = createUiHarness({
    storageState: {
      overrides: [
        { pattern: 'a', body: '{}', mode: 'text', statusCode: 500, delayMs: 3000 },
        { pattern: 'b', body: '', mode: 'text', failReason: 'TimedOut' },
      ],
    },
    apis: [],
    tabUrl: `${TEST_DOMAIN}/`,
  });
  await flushUi(harness.window);
  harness.document
    .querySelector('[data-tab="overrides"]')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  const items = harness.document.querySelectorAll('#list .override-item');
  assert.equal(items[0].querySelector('.override-status-badge').textContent, '500');
  assert.equal(items[0].querySelector('.override-delay-badge').textContent, '⏱ 3000ms');
  const failBadge = items[1].querySelector('.override-fail-badge');
  assert.equal(failBadge.textContent, 'FAIL');
  assert.equal(failBadge.title, 'TimedOut');
});

test('Import rejects invalid mock-power fields', async () => {
  const harness = createUiHarness({ apis: [], tabUrl: `${TEST_DOMAIN}/` });
  await flushUi(harness.window);

  const attempts = [
    { pattern: 'x', mode: 'text', body: '', statusCode: 99 },
    { pattern: 'x', mode: 'text', body: '', statusCode: 'abc' },
    { pattern: 'x', mode: 'text', body: '', delayMs: -1 },
    { pattern: 'x', mode: 'text', body: '', delayMs: 999999 },
    { pattern: 'x', mode: 'text', body: '', responseHeaders: [{ name: '', value: 'v' }] },
    { pattern: 'x', mode: 'text', body: '', responseHeaders: 'not-an-array' },
    { pattern: 'x', mode: 'text', body: '', failReason: 'Nope' },
    { pattern: 'x', mode: 'text', body: '', failReason: 'Failed', redirectUrl: 'https://a.test/' },
  ];
  for (const rule of attempts) {
    selectImportFile(
      harness,
      JSON.stringify({ version: 1, domain: TEST_DOMAIN, overrides: [rule] })
    );
    await flushUi(harness.window);
  }
  assert.equal(harness.document.querySelectorAll('.notification-toast--error').length, 1);
  assert.equal(
    harness.storageSets.find(set => `overrides_${TEST_DOMAIN}` in set),
    undefined
  );
});

test('Import keeps valid mock-power fields on the cleaned rule', async () => {
  const harness = createUiHarness({ apis: [], tabUrl: `${TEST_DOMAIN}/` });
  await flushUi(harness.window);

  selectImportFile(
    harness,
    JSON.stringify({
      version: 1,
      domain: TEST_DOMAIN,
      overrides: [
        {
          pattern: 'users',
          mode: 'text',
          body: '{}',
          statusCode: 503,
          delayMs: 1500,
          responseHeaders: [{ name: 'X-Custom', value: 'yes' }],
        },
        { pattern: 'fail', mode: 'text', body: '', failReason: 'TimedOut' },
      ],
    })
  );
  await flushUi(harness.window);

  assert.equal(harness.alerts.length, 0);
  const rules = harness.storageSets.findLast(set => `overrides_${TEST_DOMAIN}` in set)[
    `overrides_${TEST_DOMAIN}`
  ];
  assert.deepEqual(rules[0], {
    pattern: 'users',
    mode: 'text',
    body: '{}',
    statusCode: 503,
    delayMs: 1500,
    responseHeaders: [{ name: 'X-Custom', value: 'yes' }],
  });
  assert.deepEqual(rules[1], {
    pattern: 'fail',
    mode: 'text',
    body: '',
    failReason: 'TimedOut',
  });
});

test('Duplicating a rule creates an exact copy in storage and UI', async () => {
  const harness = createUiHarness({
    storageState: {
      enabled: true,
      overrides: [{ pattern: 'users', body: '{"ok":1}', mode: 'text' }],
    },
  });

  await flushUi(harness.window);

  harness.document
    .querySelector('[data-tab="overrides"]')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  const dupBtn = harness.document.querySelector('.duplicate-btn');
  assert.ok(dupBtn, 'Duplicate button must exist');
  dupBtn.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  const rules = harness.localState.overrides;
  assert.equal(rules.length, 2);
  assert.deepEqual(rules[0], rules[1]);
});

test('Saving a body override with requestHeaders persists requestHeaders', async () => {
  const harness = createUiHarness({ apis: [{ url: TEST_API_URL, type: 'Fetch' }] });

  await flushUi(harness.window);

  const apiItem = harness.document.querySelector('.api-item');
  assert.ok(apiItem, 'api-item must exist');
  apiItem.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  const reqHeadersTextarea = harness.document.getElementById('modal-request-headers');
  assert.ok(reqHeadersTextarea, 'modal-request-headers element must exist');
  reqHeadersTextarea.value = 'Authorization: Bearer my-secret-token';

  harness.document
    .getElementById('save-override')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  const savedRules = harness.localState.overrides;
  assert.equal(savedRules.length, 1);
  assert.deepEqual(savedRules[0].requestHeaders, [
    { name: 'Authorization', value: 'Bearer my-secret-token' },
  ]);
});

test('Modal triggers save on Ctrl+Enter keyboard shortcut', async () => {
  const harness = createUiHarness({ apis: [], tabUrl: `${TEST_DOMAIN}/` });
  await flushUi(harness.window);

  harness.document
    .getElementById('add-api-btn')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  harness.document.getElementById('modal-pattern').value = 'api/shortcut';
  harness.document.getElementById('modal-body').value = '{"ok":true}';

  const modal = harness.document.getElementById('override-modal');
  modal.dispatchEvent(
    new harness.window.KeyboardEvent('keydown', {
      key: 'Enter',
      ctrlKey: true,
      bubbles: true,
    })
  );
  await flushUi(harness.window);

  const savedRules = harness.localState[`overrides_${TEST_DOMAIN}`];
  assert.ok(savedRules);
  assert.equal(savedRules.length, 1);
  assert.equal(savedRules[0].pattern, 'api/shortcut');
});
