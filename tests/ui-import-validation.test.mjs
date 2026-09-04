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

function clickDialog(harness, selector) {
  harness.document
    .querySelector(selector)
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
}

test('Import with mismatched domain shows a dialog and proceeds when accepted', async () => {
  const harness = createUiHarness({
    storageState: { enabled: true, overrides: [] },
    apis: [],
    tabUrl: `${TEST_DOMAIN}/`,
  });

  await flushUi(harness.window);
  harness.document
    .querySelector('[data-tab="overrides"]')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  selectImportFile(
    harness,
    JSON.stringify({
      version: 1,
      domain: 'https://other-domain.example',
      exportedAt: '2026-01-01T00:00:00.000Z',
      overrides: [{ pattern: 'imported', body: '{}', mode: 'text' }],
    })
  );
  await flushUi(harness.window);
  assert.match(harness.document.querySelector('.ui-dialog__message').textContent, /other-domain/);
  clickDialog(harness, '[data-dialog-action="primary"]');
  await flushUi(harness.window);

  assert.deepEqual(harness.localState.overrides, [
    { pattern: 'imported', body: '{}', mode: 'text' },
  ]);
});

test('Import with mismatched domain aborts with no changes when the dialog is cancelled', async () => {
  const harness = createUiHarness({
    storageState: {
      enabled: true,
      overrides: [{ pattern: 'existing', body: '{}', mode: 'text' }],
    },
    apis: [],
    tabUrl: `${TEST_DOMAIN}/`,
  });

  await flushUi(harness.window);
  harness.document
    .querySelector('[data-tab="overrides"]')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  selectImportFile(
    harness,
    JSON.stringify({
      version: 1,
      domain: 'https://other-domain.example',
      exportedAt: '2026-01-01T00:00:00.000Z',
      overrides: [{ pattern: 'imported', body: '{}', mode: 'text' }],
    })
  );
  await flushUi(harness.window);
  clickDialog(harness, '.ui-dialog__actions .ui-btn--secondary');
  await flushUi(harness.window);

  assert.equal(harness.document.querySelector('.ui-dialog'), null);
  assert.deepEqual(harness.localState.overrides, [
    { pattern: 'existing', body: '{}', mode: 'text' },
  ]);
  assert.equal(harness.alerts.length, 0);
});

test('UI shows attach status and unchecks the toggle on attach failure', async () => {
  // Seed one captured API so init's loadApis succeeds immediately and the
  // status port connects within flushUi instead of after the ~1s retry loop.
  const harness = createUiHarness({
    storageState: { enabled: true },
    apis: [{ url: TEST_API_URL, type: 'fetch' }],
  });
  await flushUi(harness.window);

  harness.emitPortMessage({ type: 'status', tabId: 99, attached: true });
  const statusEl = harness.document.getElementById('attach-status');
  assert.equal(statusEl.textContent, 'Intercepting requests');
  assert.equal(statusEl.classList.contains('attach-status--on'), true);

  harness.emitPortMessage({
    type: 'status',
    tabId: 99,
    attached: false,
    error: 'Another debugger is already attached',
  });
  await flushUi(harness.window);
  assert.equal(statusEl.textContent, 'Attach failed: Another debugger is already attached');
  assert.equal(statusEl.classList.contains('attach-status--error'), true);
  assert.equal(harness.document.getElementById('enable').checked, false);
  assert.equal(harness.localState.enabled, false);
});

test('UI queries getStatus on load', async () => {
  const harness = createUiHarness();
  await flushUi(harness.window);
  assert.equal(
    harness.sentMessages.some(msg => msg.type === 'getStatus'),
    true
  );
});

test('UI unchecks the toggle when getStatus itself reports an attach error', async () => {
  const harness = createUiHarness({
    storageState: { enabled: true },
    statusResponse: {
      type: 'statusResponse',
      attached: false,
      error: 'Cannot access a chrome:// URL',
    },
  });
  await flushUi(harness.window);

  const statusEl = harness.document.getElementById('attach-status');
  assert.equal(statusEl.textContent, 'Attach failed: Cannot access a chrome:// URL');
  assert.equal(harness.document.getElementById('enable').checked, false);
  assert.equal(harness.localState.enabled, false);
});

test('Import rejects rules with an unknown mode or method', async () => {
  const harness = createUiHarness({ apis: [], tabUrl: `${TEST_DOMAIN}/` });
  await flushUi(harness.window);

  selectImportFile(
    harness,
    JSON.stringify({
      version: 1,
      domain: TEST_DOMAIN,
      overrides: [{ pattern: 'x', mode: 'yaml', body: '' }],
    })
  );
  await flushUi(harness.window);
  assert.equal(harness.document.querySelectorAll('.notification-toast--error').length, 1);
  assert.match(
    harness.document.querySelector('.notification-toast--error').textContent,
    /invalid/i
  );
  assert.equal(harness.localState.overrides, undefined);

  selectImportFile(
    harness,
    JSON.stringify({
      version: 1,
      domain: TEST_DOMAIN,
      overrides: [{ pattern: 'x', mode: 'text', body: '', method: 'TRACE' }],
    })
  );
  await flushUi(harness.window);
  assert.equal(harness.document.querySelectorAll('.notification-toast--error').length, 1);
  assert.equal(harness.localState.overrides, undefined);
});

test('Import normalizes method casing to uppercase', async () => {
  const harness = createUiHarness({ apis: [], tabUrl: `${TEST_DOMAIN}/` });
  await flushUi(harness.window);

  selectImportFile(
    harness,
    JSON.stringify({
      version: 1,
      domain: TEST_DOMAIN,
      overrides: [{ pattern: 'x', mode: 'text', body: '', method: 'get' }],
    })
  );
  await flushUi(harness.window);

  const saved = harness.storageSets.findLast(set => `overrides_${TEST_DOMAIN}` in set);
  assert.equal(saved[`overrides_${TEST_DOMAIN}`][0].method, 'GET');
});

test('Import preserves global scope and request body fields', async () => {
  const harness = createUiHarness({ apis: [], tabUrl: `${TEST_DOMAIN}/` });
  await flushUi(harness.window);

  selectImportFile(
    harness,
    JSON.stringify({
      version: 1,
      domain: TEST_DOMAIN,
      overrides: [
        {
          pattern: '/api/users',
          mode: 'text',
          body: '{}',
          isGlobal: true,
          requestBody: '{"page":2}',
        },
      ],
    })
  );
  await flushUi(harness.window);

  assert.deepEqual(harness.localState.overrides_global, [
    {
      pattern: '/api/users',
      mode: 'text',
      body: '{}',
      isGlobal: true,
      requestBody: '{"page":2}',
    },
  ]);
});
