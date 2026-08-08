import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createUiHarness, flushUi, closeAllUiHarnessWindows } from './test-harness.mjs';

after(() => {
  closeAllUiHarnessWindows();
});

test('UI parses cURL command into an OverrideRule', async () => {
  const harness = createUiHarness();
  const ui = harness.window.NetworkOverridesUi;

  const curlStr = `curl -X POST "https://api.example.com/v1/users" -H "Authorization: Bearer token123" -H "Content-Type: application/json" --data-raw '{"name":"Alice"}'`;
  const rule = ui.parseCurlToRule(curlStr);

  assert.ok(rule, 'Rule must be parsed from cURL string');
  assert.equal(rule.pattern, '/v1/users');
  assert.equal(rule.method, 'POST');
  assert.equal(rule.body, '{"name":"Alice"}');
  assert.deepEqual(
    Array.from(rule.requestHeaders, header => ({ ...header })),
    [
      { name: 'Authorization', value: 'Bearer token123' },
      { name: 'Content-Type', value: 'application/json' },
    ]
  );
});
test('URL path patterns beginning with a slash are treated as text, not regex flags', () => {
  const harness = createUiHarness();
  const ui = harness.window.NetworkOverridesUi;

  assert.equal(ui.patternMatches('/api/users', 'https://example.com/api/users'), true);
});

test('UI parses Swagger/OpenAPI JSON specification into OverrideRules', async () => {
  const harness = createUiHarness();
  const ui = harness.window.NetworkOverridesUi;

  const swaggerJson = JSON.stringify({
    openapi: '3.0.0',
    paths: {
      '/api/v1/users/{id}': {
        get: {
          responses: {
            200: {
              content: {
                'application/json': {
                  example: { id: 1, name: 'Bob' },
                },
              },
            },
          },
        },
      },
    },
  });

  const rules = ui.parseSwaggerToRules(swaggerJson);
  assert.equal(rules.length, 1, 'Must parse 1 rule from OpenAPI spec');
  assert.equal(rules[0].pattern, '/api/v1/users/*');
  assert.equal(rules[0].method, 'GET');
  assert.ok(rules[0].body.includes('"name": "Bob"'));
});

test('Visual Header Table syncs bidirectional updates with Textarea', async () => {
  const harness = createUiHarness();
  const ui = harness.window.NetworkOverridesUi;

  const tableContainer = harness.document.createElement('div');
  const textarea = harness.document.createElement('textarea');
  textarea.value = 'X-Custom-1: Value1\nX-Custom-2: Value2';

  ui.renderHeaderTable(tableContainer, textarea);

  const rows = tableContainer.querySelectorAll('.header-table-row');
  assert.equal(rows.length, 2, 'Must render 2 table rows');

  // Edit first row key in table
  const keyInput = rows[0].querySelector('.header-row-key');
  keyInput.value = 'X-Modified-Header';
  keyInput.dispatchEvent(new harness.window.Event('input'));

  assert.ok(
    textarea.value.includes('X-Modified-Header: Value1'),
    'Textarea must sync from table input'
  );
});

test('Shared UI primitives normalize static and dynamic controls', async () => {
  const harness = createUiHarness();
  await flushUi(harness.window);

  assert.equal(
    harness.document.getElementById('modal-pattern').classList.contains('ui-control'),
    true
  );
  assert.equal(
    harness.document.getElementById('save-override').classList.contains('ui-btn--primary'),
    true
  );
  assert.equal(
    harness.document
      .querySelector('#modal-request-headers')
      .closest('label')
      .classList.contains('ui-field'),
    true
  );

  const container = harness.document.createElement('div');
  const textarea = harness.document.createElement('textarea');
  harness.window.NetworkOverridesUi.renderHeaderTable(container, textarea);
  assert.equal(container.querySelector('.add-header-row-btn').classList.contains('ui-btn'), true);
  assert.equal(
    container.querySelector('.headers-editor-mode button').classList.contains('ui-btn'),
    true
  );

  const refreshButton = harness.document.getElementById('refresh-apis');
  const infoButton = harness.document.getElementById('info-btn');
  assert.equal(refreshButton.getAttribute('aria-label'), 'Refresh captured requests');
  assert.equal(infoButton.getAttribute('aria-label'), 'Open user guide');
  assert.ok(refreshButton.querySelector('svg[aria-hidden="true"]'));
  assert.ok(infoButton.querySelector('svg[aria-hidden="true"]'));
  assert.ok(refreshButton.closest('.header-actions'));
  assert.ok(infoButton.closest('.header-actions'));
});

test('Override modal keeps header and actions outside the scrollable body', async () => {
  const harness = createUiHarness();
  await flushUi(harness.window);

  const modalContent = harness.document.querySelector('#override-modal .modal-content--override');
  const header = modalContent.querySelector(':scope > .modal-header');
  const scrollBody = modalContent.querySelector(':scope > .modal-scroll-body');
  const footer = modalContent.querySelector(':scope > .modal-footer');

  assert.ok(header.querySelector('#modal-title-text'));
  assert.ok(header.querySelector('.modal-close'));
  assert.ok(scrollBody.querySelector('#modal-pattern'));
  assert.ok(footer.querySelector('#save-override'));
  assert.equal(scrollBody.contains(header), false);
  assert.equal(scrollBody.contains(footer), false);
});

test('Format JSON is the only body-type action and appears only for valid JSON', async () => {
  const harness = createUiHarness();
  await flushUi(harness.window);

  const body = harness.document.getElementById('modal-body');
  const formatButton = harness.document.getElementById('format-json-btn');
  assert.equal(harness.document.getElementById('body-type-badge'), null);
  assert.equal(formatButton.style.display, 'none');

  body.value = 'plain text';
  body.dispatchEvent(new harness.window.Event('input', { bubbles: true }));
  assert.equal(formatButton.style.display, 'none');

  body.value = '{"ok":true}';
  body.dispatchEvent(new harness.window.Event('input', { bubbles: true }));
  assert.equal(formatButton.style.display, 'inline-flex');

  formatButton.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  assert.equal(body.value, '{\n  "ok": true\n}');
});
