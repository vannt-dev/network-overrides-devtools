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
  assert.deepEqual(exported.overrides, [{ pattern: 'users', body: { ok: true }, mode: 'text' }]);
});

test('Export compacts pretty-printed JSON bodies and leaves non-JSON bodies untouched', async () => {
  const harness = createUiHarness({
    storageState: {
      enabled: true,
      overrides: [
        {
          pattern: 'users',
          body: '{\n  "ok": true,\n  "items": [\n    1,\n    2\n  ]\n}',
          mode: 'text',
        },
        { pattern: 'plain', body: 'not json\nwith a newline', mode: 'text' },
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
    .getElementById('export-rules-btn')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  const exported = JSON.parse(harness.downloads[0].content);
  // JSON bodies are exported as real nested JSON (no escaped-string noise)
  assert.deepEqual(exported.overrides[0].body, { ok: true, items: [1, 2] });
  // non-JSON bodies must survive byte-for-byte
  assert.equal(exported.overrides[1].body, 'not json\nwith a newline');
  // the stored rules themselves must not be rewritten by exporting
  assert.match(harness.localState.overrides[0].body, /\n/);
});

test('Import accepts a nested JSON body and stores it as a string rule body', async () => {
  const harness = createUiHarness({ apis: [], tabUrl: `${TEST_DOMAIN}/` });
  await flushUi(harness.window);

  selectImportFile(
    harness,
    JSON.stringify({
      version: 1,
      domain: TEST_DOMAIN,
      overrides: [
        { pattern: 'users', mode: 'text', body: { ok: true, items: [1, 2] } },
        { pattern: 'plain', mode: 'text', body: 'raw text' },
      ],
    })
  );
  await flushUi(harness.window);

  assert.equal(harness.alerts.length, 0);
  const saved = harness.storageSets.findLast(set => `overrides_${TEST_DOMAIN}` in set);
  const rules = saved[`overrides_${TEST_DOMAIN}`];
  assert.equal(rules[0].body, '{"ok":true,"items":[1,2]}');
  assert.equal(rules[1].body, 'raw text');
});

test('Export shows an alert and does not attempt a download when Blob construction fails', async () => {
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

  const OriginalBlob = harness.window.Blob;
  harness.window.Blob = function BrokenBlob() {
    throw new Error('Blob construction boom');
  };

  try {
    harness.document
      .getElementById('export-rules-btn')
      .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
    await flushUi(harness.window);

    assert.equal(harness.downloads.length, 0);
    assert.equal(harness.alerts.length, 1);
    assert.match(harness.alerts[0], /Failed to export rules/);
  } finally {
    harness.window.Blob = OriginalBlob;
  }
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
    tabUrl: `${TEST_DOMAIN}/`,
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
    tabUrl: `${TEST_DOMAIN}/`,
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

test('Import shows an alert and makes no changes when a rule has a non-string method', async () => {
  const harness = createUiHarness({
    storageState: { enabled: true, overrides: [{ pattern: 'existing', body: '{}', mode: 'text' }] },
    apis: [],
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
      domain: TEST_DOMAIN,
      exportedAt: '2026-01-01T00:00:00.000Z',
      overrides: [{ pattern: 'imported', body: '{}', mode: 'text', method: 123 }],
    })
  );
  await flushUi(harness.window);

  assert.equal(harness.localState.overrides.length, 1);
  assert.equal(harness.localState.overrides[0].pattern, 'existing');
  assert.equal(harness.alerts.length, 1);
});

test('Import shows an alert and makes no changes when an "overrides" entry is not an object', async () => {
  const harness = createUiHarness({
    storageState: { enabled: true, overrides: [{ pattern: 'existing', body: '{}', mode: 'text' }] },
    apis: [],
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
      domain: TEST_DOMAIN,
      exportedAt: '2026-01-01T00:00:00.000Z',
      overrides: [null],
    })
  );
  await flushUi(harness.window);

  assert.equal(harness.localState.overrides.length, 1);
  assert.equal(harness.localState.overrides[0].pattern, 'existing');
  assert.equal(harness.alerts.length, 1);
});

test('Import with no existing rules writes them directly and never prompts to merge or replace', async () => {
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
      domain: TEST_DOMAIN,
      exportedAt: '2026-01-01T00:00:00.000Z',
      overrides: [{ pattern: 'imported', body: '{}', mode: 'text' }],
    })
  );
  await flushUi(harness.window);

  assert.deepEqual(harness.localState.overrides, [
    { pattern: 'imported', body: '{}', mode: 'text' },
  ]);
  assert.equal(harness.confirms.length, 0);
});

test('Import strips unknown fields from rule objects, keeping only known OverrideRule fields', async () => {
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
      domain: TEST_DOMAIN,
      exportedAt: '2026-01-01T00:00:00.000Z',
      overrides: [
        {
          pattern: 'imported',
          body: '{}',
          mode: 'text',
          method: 'POST',
          enabled: false,
          redirectUrl: 'https://example.com/new',
          notAKnownField: 'should be dropped',
        },
      ],
    })
  );
  await flushUi(harness.window);

  assert.deepEqual(harness.localState.overrides, [
    {
      pattern: 'imported',
      body: '{}',
      mode: 'text',
      method: 'POST',
      enabled: false,
      redirectUrl: 'https://example.com/new',
    },
  ]);
});

test('Import with mismatched domain prompts to confirm and proceeds when accepted', async () => {
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

  harness.setConfirmResult(true);
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

  assert.equal(harness.confirms.length, 1);
  assert.match(harness.confirms[0], /other-domain\.example/);
  assert.deepEqual(harness.localState.overrides, [
    { pattern: 'imported', body: '{}', mode: 'text' },
  ]);
});

test('Import with mismatched domain aborts with no changes when the confirm is cancelled', async () => {
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

  harness.setConfirmResult(false);
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

  // Only the domain-mismatch confirm should have fired; the import aborted
  // before ever reaching the merge/replace confirm.
  assert.equal(harness.confirms.length, 1);
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
  assert.equal(harness.alerts.length, 1);
  assert.match(harness.alerts[0], /invalid/i);
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
  assert.equal(harness.alerts.length, 2);
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
  assert.equal(harness.alerts.length, 1);
  assert.match(harness.alerts[0], /status/i);

  harness.document.getElementById('modal-status').value = '';
  harness.document.getElementById('modal-delay').value = '-5';
  save();
  await flushUi(harness.window);
  assert.equal(harness.alerts.length, 2);
  assert.match(harness.alerts[1], /delay/i);

  harness.document.getElementById('modal-delay').value = '';
  harness.document.getElementById('modal-headers').value = 'no colon here';
  save();
  await flushUi(harness.window);
  assert.equal(harness.alerts.length, 3);
  assert.match(harness.alerts[2], /header/i);

  const saved = harness.storageSets.find(set => `overrides_${TEST_DOMAIN}` in set);
  assert.equal(saved, undefined); // nothing was persisted
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
