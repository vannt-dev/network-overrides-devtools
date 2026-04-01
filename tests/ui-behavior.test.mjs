import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiHarness, flushUi } from './test-harness.mjs';

test('UI init renders captured APIs and respects the manual editor option', async () => {
  const harness = createUiHarness({
    apis: [
      { url: 'https://example.com/api/users', type: 'fetch' },
      { url: 'https://example.com/api/orders', type: 'xmlhttprequest' },
    ],
  });

  await flushUi(harness.window);

  assert.equal(harness.document.getElementById('new-row').style.display, 'none');
  assert.equal(harness.document.getElementById('apis-section').style.display, 'block');
  assert.equal(harness.document.querySelectorAll('.api-item').length, 2);
  assert.deepEqual(
    harness.sentMessages.slice(0, 2).map((message) => message.type),
    ['update', 'getApis'],
  );
});

test('Clicking an API opens the modal, auto-fills the body, and saving notifies background', async () => {
  const harness = createUiHarness({
    storageState: {
      enabled: true,
      overrides: [],
    },
    apis: [{ url: 'https://example.com/api/users', type: 'fetch' }],
    apiBodies: {
      'https://example.com/api/users': '{"name":"Alice"}',
    },
  });

  await flushUi(harness.window);

  harness.document.querySelector('.api-item').dispatchEvent(
    new harness.window.MouseEvent('click', { bubbles: true }),
  );
  await flushUi(harness.window);

  assert.equal(harness.document.getElementById('override-modal').style.display, 'block');
  assert.equal(harness.document.getElementById('modal-status').textContent, 'Creating new override');
  assert.equal(
    harness.document.getElementById('modal-body').value,
    '{\n  "name": "Alice"\n}',
  );

  harness.document.getElementById('modal-body').value = '{"name":"Bob"}';
  harness.document.getElementById('save-override').dispatchEvent(
    new harness.window.MouseEvent('click', { bubbles: true }),
  );
  await flushUi(harness.window);

  assert.equal(harness.localState.overrides.length, 1);
  assert.deepEqual(harness.localState.overrides[0], {
    pattern: 'https://example.com/api/users',
    body: '{"name":"Bob"}',
    mode: 'text',
  });

  const lastUpdate = harness.sentMessages.filter((message) => message.type === 'update').at(-1);
  assert.deepEqual(lastUpdate, {
    type: 'update',
    tabId: 99,
    enabled: true,
    overrides: [
      {
        pattern: 'https://example.com/api/users',
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
      overrides: [
        { pattern: 'users', body: '{"ok":true}', mode: 'text' },
      ],
    },
    apis: [{ url: 'https://example.com/api/users', type: 'fetch' }],
  });

  await flushUi(harness.window);

  const checkbox = harness.document.getElementById('enable');
  checkbox.checked = true;
  checkbox.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
  await flushUi(harness.window);

  assert.equal(harness.localState.enabled, true);

  const lastUpdate = harness.sentMessages.filter((message) => message.type === 'update').at(-1);
  assert.deepEqual(lastUpdate, {
    type: 'update',
    tabId: 99,
    enabled: true,
    overrides: [
      { pattern: 'users', body: '{"ok":true}', mode: 'text' },
    ],
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
      { url: 'https://example.com/api/users', type: 'fetch' },
      { url: 'https://example.com/api/orders', type: 'fetch' },
    ],
  });

  await flushUi(harness.window);

  harness.document.querySelector('.edit-btn').dispatchEvent(
    new harness.window.MouseEvent('click', { bubbles: true }),
  );
  await flushUi(harness.window);

  assert.equal(harness.document.getElementById('override-modal').style.display, 'block');
  assert.equal(harness.document.getElementById('modal-status').textContent, 'Editing saved override');
  assert.equal(harness.document.getElementById('modal-pattern').value, 'users');

  harness.document.getElementById('modal-pattern').value = 'users-v2';
  harness.document.getElementById('modal-body').value = '{"ok":"updated"}';
  harness.document.getElementById('save-override').dispatchEvent(
    new harness.window.MouseEvent('click', { bubbles: true }),
  );
  await flushUi(harness.window);

  assert.deepEqual(harness.localState.overrides[0], {
    pattern: 'users-v2',
    body: '{"ok":"updated"}',
    mode: 'text',
  });

  harness.document.querySelector('.del-btn').dispatchEvent(
    new harness.window.MouseEvent('click', { bubbles: true }),
  );
  await flushUi(harness.window);

  assert.equal(harness.localState.overrides.length, 1);
  assert.deepEqual(harness.localState.overrides[0], {
    pattern: 'orders',
    body: '{"items":[]}',
    mode: 'text',
  });

  const updates = harness.sentMessages.filter((message) => message.type === 'update');
  assert.equal(updates.length >= 3, true);
  assert.deepEqual(updates.at(-1), {
    type: 'update',
    tabId: 99,
    enabled: true,
    overrides: [
      { pattern: 'orders', body: '{"items":[]}', mode: 'text' },
    ],
  });
});

test('UI retries loading APIs until captured requests become available', async () => {
  const harness = createUiHarness({
    storageState: {
      enabled: false,
      overrides: [],
    },
    apiResponses: [
      [],
      [],
      [{ url: 'https://example.com/api/retried', type: 'fetch' }],
    ],
  });

  await flushUi(harness.window, 1);
  await new Promise((resolve) => harness.window.setTimeout(resolve, 600));
  await flushUi(harness.window, 2);

  assert.equal(harness.getApisCallCount() >= 3, true);
  assert.equal(harness.document.querySelectorAll('.api-item').length, 1);
  assert.equal(harness.document.getElementById('apis-section').style.display, 'block');
});

test('Use current API response body button refreshes the modal body from the latest payload', async () => {
  const harness = createUiHarness({
    storageState: {
      enabled: true,
      overrides: [
        { pattern: 'https://example.com/api/users', body: '{"stale":true}', mode: 'text' },
      ],
    },
    apis: [{ url: 'https://example.com/api/users', type: 'fetch' }],
    apiBodies: {
      'https://example.com/api/users': '{"fresh":true}',
    },
  });

  await flushUi(harness.window);

  harness.document.querySelector('.api-item').dispatchEvent(
    new harness.window.MouseEvent('click', { bubbles: true }),
  );
  await flushUi(harness.window);

  assert.equal(
    harness.document.getElementById('modal-body').value,
    '{\n  "stale": true\n}',
  );

  harness.document.getElementById('use-current-body').dispatchEvent(
    new harness.window.MouseEvent('click', { bubbles: true }),
  );
  await flushUi(harness.window);

  assert.equal(
    harness.document.getElementById('modal-body').value,
    '{\n  "fresh": true\n}',
  );
});

test('Collapse/expand buckets and search or Only overridden filters update visible API groups', async () => {
  const harness = createUiHarness({
    storageState: {
      enabled: true,
      overrides: [
        { pattern: 'users', body: '{"ok":true}', mode: 'text' },
      ],
    },
    apis: [
      { url: 'https://example.com/api/users', type: 'fetch' },
      { url: 'https://example.com/api/orders', type: 'fetch' },
      { url: 'https://example.com/assets/app.js', type: 'script' },
    ],
  });

  await flushUi(harness.window);

  const bucketTitles = Array.from(harness.document.querySelectorAll('.api-bucket-title')).map((element) => element.textContent);
  assert.deepEqual(bucketTitles, ['Overridden APIs', 'Other APIs']);
  assert.equal(harness.document.querySelectorAll('.api-item').length, 3);

  harness.document.getElementById('collapse-all').dispatchEvent(
    new harness.window.MouseEvent('click', { bubbles: true }),
  );
  await flushUi(harness.window);

  assert.equal(harness.document.querySelectorAll('.api-section').length, 0);
  assert.equal(harness.document.querySelectorAll('.api-bucket').length, 2);

  harness.document.getElementById('expand-all').dispatchEvent(
    new harness.window.MouseEvent('click', { bubbles: true }),
  );
  await flushUi(harness.window);

  assert.equal(harness.document.querySelectorAll('.api-item').length, 3);

  const searchInput = harness.document.getElementById('api-search');
  searchInput.value = 'orders';
  searchInput.dispatchEvent(new harness.window.Event('input', { bubbles: true }));
  await flushUi(harness.window);

  assert.equal(harness.document.querySelectorAll('.api-item').length, 1);
  assert.equal(harness.document.querySelector('.api-item b').textContent.includes('orders'), true);

  searchInput.value = '';
  searchInput.dispatchEvent(new harness.window.Event('input', { bubbles: true }));
  const onlyOverridden = harness.document.getElementById('only-overridden');
  onlyOverridden.checked = true;
  onlyOverridden.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
  await flushUi(harness.window);

  const filteredTitles = Array.from(harness.document.querySelectorAll('.api-bucket-title')).map((element) => element.textContent);
  assert.deepEqual(filteredTitles, ['Overridden APIs']);
  assert.equal(harness.document.querySelectorAll('.api-item').length, 1);
  assert.equal(harness.document.querySelector('.api-item').classList.contains('active'), true);
});
