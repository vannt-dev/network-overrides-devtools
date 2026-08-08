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
    harness.sentMessages.slice(0, 3).map(message => message.type),
    ['update', 'getStatus', 'getApis']
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

test('Header refresh button exposes and clears its loading state', async () => {
  const harness = createUiHarness({ apis: [{ url: TEST_API_URL, type: 'fetch' }] });
  await flushUi(harness.window);

  const refreshButton = harness.document.getElementById('refresh-apis');
  refreshButton.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));

  assert.equal(refreshButton.disabled, true);
  assert.equal(refreshButton.classList.contains('loading'), true);
  assert.equal(refreshButton.getAttribute('aria-busy'), 'true');

  await flushUi(harness.window);
  assert.equal(refreshButton.disabled, false);
  assert.equal(refreshButton.classList.contains('loading'), false);
  assert.equal(refreshButton.hasAttribute('aria-busy'), false);
  assert.equal(refreshButton.title, 'Refresh captured requests');
});

test('Header info button opens the bundled user guide', async () => {
  const harness = createUiHarness({ apis: [{ url: TEST_API_URL, type: 'fetch' }] });
  await flushUi(harness.window);

  harness.document
    .getElementById('info-btn')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));

  assert.deepEqual(harness.openedTabs, [{ url: 'guide.html' }]);
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

test('Rapid rule changes are persisted in order and keep the newest state', async () => {
  const harness = createUiHarness({
    storageState: {
      enabled: true,
      overrides: [{ pattern: 'users', body: '{}', mode: 'text' }],
    },
  });
  await flushUi(harness.window);
  harness.document
    .querySelector('[data-tab="overrides"]')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  const toggle = harness.document.querySelector('.override-enabled-toggle');
  toggle.checked = false;
  toggle.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
  toggle.checked = true;
  toggle.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
  await flushUi(harness.window, 6);

  const overrideWrites = harness.storageSets.filter(entry =>
    Object.keys(entry).some(key => key.startsWith('overrides_'))
  );
  assert.equal(overrideWrites.length, 2);
  assert.equal(overrideWrites[0][Object.keys(overrideWrites[0])[0]][0].enabled, false);
  assert.equal(overrideWrites[1][Object.keys(overrideWrites[1])[0]][0].enabled, true);
  assert.equal(harness.localState.overrides[0].enabled, true);
});

test('Rule actions roll back and notify when persistence fails', async () => {
  const harness = createUiHarness({
    storageState: {
      overrides: [{ pattern: 'users', body: '{}', mode: 'text' }],
    },
    storageSetError: 'Storage is unavailable',
  });
  await flushUi(harness.window);
  harness.document
    .querySelector('[data-tab="overrides"]')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  const toggle = harness.document.querySelector('.rule-toggle');
  toggle.checked = false;
  toggle.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
  await flushUi(harness.window);

  assert.equal(harness.localState.overrides[0].enabled, undefined);
  assert.equal(harness.document.querySelector('.rule-toggle').checked, true);
  assert.match(
    harness.document.querySelector('.notification-toast--error').textContent,
    /storage is unavailable/i
  );
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

test('Editing a rule with an out-of-range stored method falls back to ANY in the modal instead of saving silently', async () => {
  const harness = createUiHarness({
    storageState: {
      enabled: true,
      overrides: [{ pattern: 'users', body: '{}', mode: 'text', method: 'TRACE' }],
    },
    apis: [{ url: `${TEST_DOMAIN}/api/users`, type: 'fetch' }],
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

  assert.equal(harness.document.getElementById('modal-method').value, 'ANY');

  harness.document
    .getElementById('save-override')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  // Saving after the fallback must not silently persist an ANY method for what
  // was originally a method-restricted rule with an out-of-range value; it
  // should end up unset (ANY), which is the honest reflection of what the
  // modal showed and the user had the chance to review.
  assert.equal(harness.localState.overrides[0].method, undefined);
});
