import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiHarness, flushUi } from './test-harness.mjs';
import { TEST_API_URL, TEST_DOMAIN } from './config.mjs';

test('UI init renders captured APIs and respects the manual editor option', async () => {
  const harness = createUiHarness({
    storageState: {
      overrides: [
        { pattern: 'api/users', body: '{}', mode: 'text' },
        { pattern: 'api/orders', body: '{}', mode: 'text' },
      ],
    },
    apis: [
      { url: `${TEST_DOMAIN}/api/users`, type: 'fetch' },
      { url: `${TEST_DOMAIN}/api/orders`, type: 'xmlhttprequest' },
    ],
  });

  await flushUi(harness.window);

  assert.equal(harness.document.getElementById('new-row').style.display, 'none');
  assert.equal(harness.document.getElementById('apis-section').style.display, 'block');
  assert.deepEqual(
    harness.sentMessages.slice(0, 2).map(message => message.type),
    ['update', 'getApis']
  );

  // Default tab is Captured APIs (non-overridden); switch to Overridden tab
  harness.document
    .querySelector('[data-tab="overridden"]')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  assert.equal(harness.document.querySelectorAll('.api-item').length, 2);
});

test('Clicking an API opens the modal, auto-fills the body, and saving notifies background', async () => {
  const harness = createUiHarness({
    storageState: {
      enabled: true,
      overrides: [{ pattern: TEST_API_URL, body: '{"name":"Alice"}', mode: 'text' }],
    },
    apis: [{ url: TEST_API_URL, type: 'fetch' }],
    apiBodies: {
      [TEST_API_URL]: '{"name":"Alice"}',
    },
  });

  await flushUi(harness.window);

  // Switch to Overridden tab to see the API
  harness.document
    .querySelector('[data-tab="overridden"]')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  harness.document
    .querySelector('.api-item')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  assert.equal(harness.document.getElementById('override-modal').style.display, 'block');
  assert.equal(harness.document.getElementById('modal-title-text').textContent, 'Edit override');
  assert.equal(harness.document.getElementById('modal-body').value, '{\n  "name": "Alice"\n}');

  harness.document.getElementById('modal-body').value = '{"name":"Bob"}';
  harness.document
    .getElementById('save-override')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  assert.equal(harness.localState.overrides.length, 1);
  assert.deepEqual(harness.localState.overrides[0], {
    pattern: 'https://example.com/api/users',
    body: '{"name":"Bob"}',
    mode: 'text',
  });

  const lastUpdate = harness.sentMessages.filter(message => message.type === 'update').at(-1);
  assert.deepEqual(lastUpdate, {
    type: 'update',
    tabId: 99,
    tabUrl: 'https://example.test/',
    enabled: true,
    overrides: [
      {
        pattern: TEST_API_URL,
        body: '{"name":"Bob"}',
        mode: 'text',
      },
    ],
  });
});

test('Changing the enable checkbox persists state and sends an update message', async () => {
  const harness = createUiHarness({
    storageState: {
      enabled: false,
      overrides: [{ pattern: 'users', body: '{"ok":true}', mode: 'text' }],
    },
    apis: [{ url: TEST_API_URL, type: 'fetch' }],
  });

  await flushUi(harness.window);

  const checkbox = harness.document.getElementById('enable');
  checkbox.checked = true;
  checkbox.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
  await flushUi(harness.window);

  assert.equal(harness.localState.enabled, true);

  const lastUpdate = harness.sentMessages.filter(message => message.type === 'update').at(-1);
  assert.deepEqual(lastUpdate, {
    type: 'update',
    tabId: 99,
    tabUrl: 'https://example.test/',
    enabled: true,
    overrides: [{ pattern: 'users', body: '{"ok":true}', mode: 'text' }],
  });
});

test('Editing and deleting overrides from the saved list updates storage and notifies background', async () => {
  const harness = createUiHarness({
    storageState: {
      enabled: true,
      overrides: [
        { pattern: 'users', body: '{"ok":true}', mode: 'text' },
        { pattern: 'orders', body: '{"items":[]}', mode: 'text' },
      ],
    },
    apis: [
      { url: `${TEST_DOMAIN}/api/users`, type: 'fetch' },
      { url: `${TEST_DOMAIN}/api/orders`, type: 'fetch' },
    ],
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

  assert.equal(harness.document.getElementById('override-modal').style.display, 'block');
  assert.equal(harness.document.getElementById('modal-title-text').textContent, 'Edit override');
  assert.equal(harness.document.getElementById('modal-pattern').value, 'users');

  harness.document.getElementById('modal-pattern').value = 'users-v2';
  harness.document.getElementById('modal-body').value = '{"ok":"updated"}';
  harness.document
    .getElementById('save-override')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  assert.deepEqual(harness.localState.overrides[0], {
    pattern: 'users-v2',
    body: '{"ok":"updated"}',
    mode: 'text',
  });

  harness.document
    .querySelector('.del-btn')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  assert.equal(harness.localState.overrides.length, 1);
  assert.deepEqual(harness.localState.overrides[0], {
    pattern: 'orders',
    body: '{"items":[]}',
    mode: 'text',
  });

  const updates = harness.sentMessages.filter(message => message.type === 'update');
  assert.equal(updates.length >= 3, true);
  assert.deepEqual(updates.at(-1), {
    type: 'update',
    tabId: 99,
    tabUrl: 'https://example.test/',
    enabled: true,
    overrides: [{ pattern: 'orders', body: '{"items":[]}', mode: 'text' }],
  });
});

test('UI retries loading APIs until captured requests become available', async () => {
  const harness = createUiHarness({
    storageState: {
      enabled: false,
      overrides: [{ pattern: 'api/retried', body: '{}', mode: 'text' }],
    },
    apiResponses: [[], [], [{ url: `${TEST_DOMAIN}/api/retried`, type: 'fetch' }]],
  });

  await flushUi(harness.window, 1);
  await new Promise(resolve => harness.window.setTimeout(resolve, 600));
  await flushUi(harness.window, 2);

  assert.equal(harness.getApisCallCount() >= 3, true);
  assert.equal(harness.document.getElementById('apis-section').style.display, 'block');

  // Switch to Overridden tab to see the API
  harness.document
    .querySelector('[data-tab="overridden"]')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  assert.equal(harness.document.querySelectorAll('.api-item').length, 1);
});

// use-current-body button removed; auto-fill from captured response still applies on new overrides

test('Tab switching shows correct APIs and search filters within a tab', async () => {
  const harness = createUiHarness({
    storageState: {
      enabled: true,
      overrides: [{ pattern: 'users', body: '{"ok":true}', mode: 'text' }],
    },
    apis: [
      { url: `${TEST_DOMAIN}/api/users`, type: 'fetch' },
      { url: `${TEST_DOMAIN}/api/orders`, type: 'fetch' },
      { url: `${TEST_DOMAIN}/assets/app.js`, type: 'script' },
    ],
  });

  await flushUi(harness.window);

  // Default tab is Captured APIs (non-overridden)
  assert.equal(harness.document.querySelectorAll('.api-item').length, 2);

  // Switch to Overridden tab
  harness.document
    .querySelector('[data-tab="overridden"]')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  assert.equal(harness.document.querySelectorAll('.api-item').length, 1);
  assert.equal(harness.document.querySelector('.api-item').classList.contains('active'), true);

  // Switch to Captured APIs tab
  harness.document
    .querySelector('[data-tab="other"]')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  assert.equal(harness.document.querySelectorAll('.api-item').length, 2);

  // Search within Captured APIs tab
  const searchInput = harness.document.getElementById('api-search');
  searchInput.value = 'orders';
  searchInput.dispatchEvent(new harness.window.Event('input', { bubbles: true }));
  await flushUi(harness.window);

  assert.equal(harness.document.querySelectorAll('.api-item').length, 1);
  assert.equal(harness.document.querySelector('.api-item b').textContent.includes('orders'), true);

  // Switch to Rules tab
  harness.document
    .querySelector('[data-tab="overrides"]')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  assert.equal(harness.document.getElementById('overrides-section').style.display, 'block');
  assert.equal(harness.document.querySelectorAll('.override-item').length, 1);
});
