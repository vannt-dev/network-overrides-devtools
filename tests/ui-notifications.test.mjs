import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createUiHarness, flushUi, closeAllUiHarnessWindows } from './test-harness.mjs';

after(() => {
  closeAllUiHarnessWindows();
});

test('Shared notifications expose semantic success, warning, and error states', async () => {
  const harness = createUiHarness();
  await flushUi(harness.window);
  const ui = harness.window.NetworkOverridesUi;

  ui.showNotification('Saved successfully', 'success', 0);
  ui.showNotification('Apply warning', 'warning', 0);
  ui.showNotification('Storage failed', 'error', 0);

  const toasts = harness.document.querySelectorAll('.notification-toast');
  assert.equal(toasts.length, 3);
  assert.equal(toasts[0].getAttribute('role'), 'status');
  assert.equal(toasts[2].getAttribute('role'), 'alert');
  assert.equal(toasts[2].dataset.kind, 'error');

  toasts[2]
    .querySelector('.notification-toast__close')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  assert.equal(harness.document.querySelectorAll('.notification-toast').length, 2);
});

test('Persistence notifications distinguish applied rules from saved-only rules', async () => {
  const harness = createUiHarness();
  await flushUi(harness.window);
  const ui = harness.window.NetworkOverridesUi;

  ui.showPersistenceNotification('Override saved', { applied: true });
  ui.showPersistenceNotification('Override saved', {
    applied: false,
    warning: 'Debugger unavailable',
  });

  assert.match(
    harness.document.querySelector('.notification-toast--success').textContent,
    /applied to the active tab/i
  );
  assert.match(
    harness.document.querySelector('.notification-toast--warning').textContent,
    /debugger unavailable/i
  );
});

test('Notifications deduplicate repeated messages and keep only the three newest', async () => {
  const harness = createUiHarness();
  await flushUi(harness.window);
  const ui = harness.window.NetworkOverridesUi;

  ui.showNotification('Repeated', 'error', 0);
  ui.showNotification('Repeated', 'error', 0);
  ui.showNotification('Second', 'info', 0);
  ui.showNotification('Third', 'warning', 0);
  ui.showNotification('Fourth', 'success', 0);

  const messages = Array.from(harness.document.querySelectorAll('.notification-toast')).map(
    toast => toast.dataset.message
  );
  assert.deepEqual(messages, ['Second', 'Third', 'Fourth']);
});

test('A saved-only notification can retry applying interception', async () => {
  const harness = createUiHarness();
  await flushUi(harness.window);
  let retryCount = 0;

  harness.window.NetworkOverridesUi.showPersistenceNotification('Override saved', {
    applied: false,
    warning: 'Debugger unavailable',
    retry: async () => {
      retryCount += 1;
    },
  });
  harness.document
    .querySelector('.notification-toast__action')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  assert.equal(retryCount, 1);
  assert.match(
    harness.document.querySelector('.notification-toast--success').textContent,
    /interception updated/i
  );
});

test('Shared prompt dialog validates input and resolves from the keyboard', async () => {
  const harness = createUiHarness();
  await flushUi(harness.window);
  const pending = harness.window.NetworkOverridesUi.showPromptDialog(
    'Save profile',
    'Choose a profile name.',
    'Profile name'
  );
  await flushUi(harness.window);
  const input = harness.document.querySelector('.ui-dialog input');

  input.dispatchEvent(new harness.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  input.value = 'Error Flow';
  input.dispatchEvent(new harness.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

  assert.equal(await pending, 'Error Flow');
  assert.equal(harness.document.querySelector('.ui-dialog'), null);
});
