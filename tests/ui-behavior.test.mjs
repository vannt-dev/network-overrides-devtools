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

test('A disabled rule still counts an API as Overridden but dims it; a method-mismatched rule does not count it at all', async () => {
  const harness = createUiHarness({
    storageState: {
      enabled: true,
      overrides: [
        { pattern: 'users', body: '{}', mode: 'text', enabled: false },
        { pattern: 'orders', body: '{}', mode: 'text', method: 'POST' },
      ],
    },
    apis: [
      { url: `${TEST_DOMAIN}/api/users`, type: 'fetch', method: 'GET' },
      { url: `${TEST_DOMAIN}/api/orders`, type: 'fetch', method: 'GET' },
    ],
  });

  await flushUi(harness.window);

  harness.document
    .querySelector('[data-tab="overridden"]')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  const overriddenItems = harness.document.querySelectorAll('.api-item');
  assert.equal(overriddenItems.length, 1);
  assert.equal(overriddenItems[0].classList.contains('api-item--rule-disabled'), true);

  harness.document
    .querySelector('[data-tab="other"]')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  assert.equal(harness.document.querySelectorAll('.api-item').length, 1);
});

test('When a disabled rule and an enabled rule both match the same API, the enabled rule wins for dimming', async () => {
  const harness = createUiHarness({
    storageState: {
      enabled: true,
      overrides: [
        { pattern: 'users', body: '{}', mode: 'text', enabled: false },
        { pattern: 'users', body: '{}', mode: 'text', enabled: true },
      ],
    },
    apis: [{ url: `${TEST_DOMAIN}/api/users`, type: 'fetch' }],
  });

  await flushUi(harness.window);

  harness.document
    .querySelector('[data-tab="overridden"]')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  const item = harness.document.querySelector('.api-item');
  assert.equal(item.classList.contains('active'), true);
  assert.equal(item.classList.contains('api-item--rule-disabled'), false);
});

test('Toggling a rule checkbox persists its enabled state, dims the row, and notifies background', async () => {
  const harness = createUiHarness({
    storageState: {
      enabled: true,
      overrides: [{ pattern: 'users', body: '{"ok":true}', mode: 'text' }],
    },
    apis: [{ url: `${TEST_DOMAIN}/api/users`, type: 'fetch' }],
  });

  await flushUi(harness.window);

  harness.document
    .querySelector('[data-tab="overrides"]')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  const checkbox = harness.document.querySelector('.override-enabled-toggle');
  assert.equal(checkbox.checked, true);

  checkbox.checked = false;
  checkbox.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
  await flushUi(harness.window);

  assert.equal(harness.localState.overrides[0].enabled, false);
  assert.equal(
    harness.document.querySelector('.override-item').classList.contains('override-item--disabled'),
    true
  );

  const lastUpdate = harness.sentMessages.filter(message => message.type === 'update').at(-1);
  assert.equal(lastUpdate.overrides[0].enabled, false);
});

test('Opening the modal from a captured API pre-selects its method; saving persists a non-ANY method', async () => {
  const harness = createUiHarness({
    storageState: { enabled: true, overrides: [] },
    apis: [{ url: `${TEST_DOMAIN}/api/users`, type: 'fetch', method: 'POST' }],
  });

  await flushUi(harness.window);

  harness.document
    .querySelector('.api-item')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  assert.equal(harness.document.getElementById('modal-method').value, 'POST');

  harness.document
    .getElementById('save-override')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  assert.equal(harness.localState.overrides[0].method, 'POST');
});

test('Export builds the documented JSON envelope and triggers a download', async () => {
  const harness = createUiHarness({
    storageState: {
      enabled: true,
      overrides: [{ pattern: 'users', body: '{"ok":true}', mode: 'text' }],
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
    .getElementById('export-rules-btn')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  assert.equal(harness.downloads.length, 1);
  const exported = JSON.parse(harness.downloads[0].content);
  assert.equal(exported.version, 1);
  assert.equal(exported.domain, TEST_DOMAIN);
  assert.equal(typeof exported.exportedAt, 'string');
  assert.deepEqual(exported.overrides, [{ pattern: 'users', body: '{"ok":true}', mode: 'text' }]);
});

function selectImportFile(harness, jsonText) {
  const file = new harness.window.File([jsonText], 'rules.json', { type: 'application/json' });
  const input = harness.document.getElementById('import-rules-input');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
}

test('Import merges when confirm() returns true and there are existing rules', async () => {
  const harness = createUiHarness({
    storageState: {
      enabled: true,
      overrides: [{ pattern: 'existing', body: '{}', mode: 'text' }],
    },
    apis: [],
  });

  await flushUi(harness.window);
  harness.document
    .querySelector('[data-tab="overrides"]')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  harness.setConfirmResult(true);
  selectImportFile(
    harness,
    JSON.stringify({
      version: 1,
      domain: TEST_DOMAIN,
      exportedAt: '2026-01-01T00:00:00.000Z',
      overrides: [{ pattern: 'imported', body: '{}', mode: 'text' }],
    })
  );
  await flushUi(harness.window);

  assert.equal(harness.localState.overrides.length, 2);
  assert.equal(harness.localState.overrides[0].pattern, 'existing');
  assert.equal(harness.localState.overrides[1].pattern, 'imported');
});

test('Import replaces when confirm() returns false and there are existing rules', async () => {
  const harness = createUiHarness({
    storageState: {
      enabled: true,
      overrides: [{ pattern: 'existing', body: '{}', mode: 'text' }],
    },
    apis: [],
  });

  await flushUi(harness.window);
  harness.document
    .querySelector('[data-tab="overrides"]')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  harness.setConfirmResult(false);
  selectImportFile(
    harness,
    JSON.stringify({
      version: 1,
      domain: TEST_DOMAIN,
      exportedAt: '2026-01-01T00:00:00.000Z',
      overrides: [{ pattern: 'imported', body: '{}', mode: 'text' }],
    })
  );
  await flushUi(harness.window);

  assert.deepEqual(harness.localState.overrides, [
    { pattern: 'imported', body: '{}', mode: 'text' },
  ]);
});

test('Import shows an alert and makes no changes when the file is not valid JSON', async () => {
  const harness = createUiHarness({
    storageState: { enabled: true, overrides: [{ pattern: 'existing', body: '{}', mode: 'text' }] },
    apis: [],
  });

  await flushUi(harness.window);
  harness.document
    .querySelector('[data-tab="overrides"]')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  selectImportFile(harness, 'not json');
  await flushUi(harness.window);

  assert.equal(harness.localState.overrides.length, 1);
  assert.equal(harness.localState.overrides[0].pattern, 'existing');
  assert.equal(harness.alerts.length, 1);
});
