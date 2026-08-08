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

test('Export shows an error notification and skips download when Blob construction fails', async () => {
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
    assert.equal(harness.document.querySelectorAll('.notification-toast--error').length, 1);
    assert.match(
      harness.document.querySelector('.notification-toast--error').textContent,
      /Failed to export rules/
    );
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

function clickDialog(harness, selector, inputValue) {
  if (inputValue !== undefined) {
    const input = harness.document.querySelector('.ui-dialog input');
    input.value = inputValue;
  }
  harness.document
    .querySelector(selector)
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
}

test('Import appends when Append rules is selected', async () => {
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
      domain: TEST_DOMAIN,
      exportedAt: '2026-01-01T00:00:00.000Z',
      overrides: [{ pattern: 'imported', body: '{}', mode: 'text' }],
    })
  );
  await flushUi(harness.window);
  clickDialog(harness, '[data-dialog-action="primary"]');
  await flushUi(harness.window);

  assert.equal(harness.localState.overrides.length, 2);
  assert.equal(harness.localState.overrides[0].pattern, 'existing');
  assert.equal(harness.localState.overrides[1].pattern, 'imported');
});

test('Import replaces when Replace rules is selected', async () => {
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
      domain: TEST_DOMAIN,
      exportedAt: '2026-01-01T00:00:00.000Z',
      overrides: [{ pattern: 'imported', body: '{}', mode: 'text' }],
    })
  );
  await flushUi(harness.window);
  clickDialog(harness, '[data-dialog-action="secondary"]');
  await flushUi(harness.window);

  assert.deepEqual(harness.localState.overrides, [
    { pattern: 'imported', body: '{}', mode: 'text' },
  ]);
});

test('Import shows a notification and makes no changes when the file is not valid JSON', async () => {
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
  assert.equal(harness.document.querySelectorAll('.notification-toast--error').length, 1);
});

test('Import shows a notification and makes no changes when a rule has a non-string method', async () => {
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
  assert.equal(harness.document.querySelectorAll('.notification-toast--error').length, 1);
});

test('Import shows a notification and makes no changes when an "overrides" entry is not an object', async () => {
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
  assert.equal(harness.document.querySelectorAll('.notification-toast--error').length, 1);
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

test('Rule profiles report save and delete outcomes through shared notifications', async () => {
  const harness = createUiHarness({
    storageState: {
      overrides: [{ pattern: 'users', body: '{}', mode: 'text' }],
    },
    tabUrl: `${TEST_DOMAIN}/`,
  });
  await flushUi(harness.window);

  harness.document
    .getElementById('save-profile-btn')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);
  clickDialog(harness, '[data-dialog-action="primary"]', 'Error Flow');
  await flushUi(harness.window);

  const profileKey = `rule_profiles_${TEST_DOMAIN}`;
  assert.deepEqual(harness.localState[profileKey]['Error Flow'], [
    { pattern: 'users', body: '{}', mode: 'text' },
  ]);
  assert.match(
    harness.document.querySelector('.notification-toast--success').textContent,
    /profile.*saved/i
  );

  harness.document.getElementById('profiles-select').value = 'Error Flow';
  harness.document
    .getElementById('delete-profile-btn')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);
  clickDialog(harness, '[data-dialog-action="primary"]');
  await flushUi(harness.window);

  assert.equal(harness.localState[profileKey]['Error Flow'], undefined);
  const successMessages = Array.from(
    harness.document.querySelectorAll('.notification-toast--success')
  ).map(item => item.textContent);
  assert.equal(
    successMessages.some(message => /profile.*deleted/i.test(message)),
    true
  );
});
