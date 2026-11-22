import fs from 'node:fs';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import {
  createUiHarness,
  flushUi,
  closeAllUiHarnessWindows,
  readPageHtml,
  normalize,
} from './test-harness.mjs';
import { TEST_DOMAIN } from './config.mjs';

after(() => {
  closeAllUiHarnessWindows();
});

const API_URL = `${TEST_DOMAIN}/api/users?page=1`;

function click(harness, element) {
  element.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
}

function key(harness, element, keyName) {
  element.dispatchEvent(
    new harness.window.KeyboardEvent('keydown', { key: keyName, bubbles: true })
  );
}

function input(harness, element, value) {
  element.value = value;
  element.dispatchEvent(new harness.window.Event('input', { bubbles: true }));
}

function $(harness, selector) {
  return harness.document.querySelector(selector);
}

function savedRules(harness) {
  return normalize(harness.localState[`overrides_${TEST_DOMAIN}`] || []);
}

async function openTab(harness, tab) {
  click(harness, $(harness, `.tab-btn[data-tab="${tab}"]`));
  await flushUi(harness.window);
}

async function panelHarness(options = {}) {
  const harness = createUiHarness({ page: 'panel.html', tabUrl: `${TEST_DOMAIN}/`, ...options });
  await flushUi(harness.window);
  return harness;
}

async function save(harness) {
  click(harness, $(harness, '#save-override'));
  await flushUi(harness.window, 6);
}

const DEFAULT_FIELDS = ['modal-pattern', 'modal-method', 'modal-status', 'modal-body'];
const ADVANCED_FIELDS = [
  'modal-graphql-op',
  'modal-match-query',
  'modal-match-headers',
  'modal-match-body',
  'modal-global-rule',
  'modal-delay',
  'modal-fail-reason',
  'modal-respond-at-request',
  'modal-headers',
  'modal-mode',
  'modal-process-templates',
  'modal-request-body',
  'modal-request-headers',
];

test('panel.html and popup.html share the same markup', () => {
  const panel = fs.readFileSync('panel.html', 'utf8').split('\n');
  const popup = fs.readFileSync('popup.html', 'utf8').split('\n');
  assert.equal(panel.length, popup.length);
  const differing = panel.filter((line, index) => line !== popup[index]);
  assert.equal(differing.length, 3, differing.join('\n'));
});

test('every element the UI looks up by id exists in panel.html', () => {
  const source = fs.readFileSync('src/ui.ts', 'utf8');
  const ids = [...source.matchAll(/getElementById\('([^']+)'\)/g)].map(match => match[1]);
  const html = readPageHtml('panel.html');
  const missing = ids.filter(id => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, []);
});

test('the editor shows only the everyday fields; the rest sits in a collapsed Advanced section', async () => {
  const harness = await panelHarness();
  click(harness, $(harness, '#add-api-btn'));
  await flushUi(harness.window);

  const advanced = $(harness, '#modal-advanced-fields');
  assert.equal(advanced.tagName, 'DETAILS');
  assert.equal(advanced.open, false, 'Advanced starts closed for a new rule');
  for (const id of DEFAULT_FIELDS) {
    assert.equal(advanced.contains(harness.document.getElementById(id)), false, id);
  }
  for (const id of ADVANCED_FIELDS) {
    assert.equal(advanced.contains(harness.document.getElementById(id)), true, id);
  }
  const groups = [...advanced.querySelectorAll('details.modal-group')];
  assert.deepEqual(
    groups.map(group => group.querySelector('summary .modal-group-title').textContent),
    [
      'Conditions',
      'Timing & failure',
      'Response headers',
      'Body type: patch & script',
      'Change the request',
    ]
  );
  assert.ok(groups.every(group => !group.open));
  assert.ok(
    [...advanced.querySelectorAll('.modal-group-count')].every(badge => badge.hidden),
    'no counts while nothing is set'
  );
});

test('editing a rule opens the groups that hold a value and counts them', async () => {
  const harness = await panelHarness({
    storageState: {
      overrides: [
        {
          pattern: '/api/cart',
          body: '{}',
          mode: 'text',
          delayMs: 1500,
          matchQuery: [{ name: 'debug' }],
          graphqlOperation: 'GetCart',
          responseHeaders: [
            { name: 'X-A', value: '1' },
            { name: 'X-B', value: '2' },
          ],
        },
      ],
    },
  });
  await openTab(harness, 'overrides');
  click(harness, $(harness, '#list .edit-btn'));
  await flushUi(harness.window);

  const advanced = $(harness, '#modal-advanced-fields');
  const group = id => harness.document.getElementById(id);
  const count = id => group(id).querySelector('.modal-group-count');
  assert.equal(advanced.open, true);
  assert.equal(group('modal-match-fields').open, true);
  assert.equal(count('modal-match-fields').textContent, '2');
  assert.equal(group('modal-group-timing').open, true);
  assert.equal(count('modal-group-timing').textContent, '1');
  assert.equal(group('modal-group-response-headers').open, true);
  assert.equal(count('modal-group-response-headers').textContent, '2');
  assert.equal(group('modal-group-body-type').open, false);
  assert.equal(count('modal-group-body-type').hidden, true);
  assert.equal(group('modal-group-request').open, false);
  assert.equal(advanced.querySelector(':scope > summary .modal-group-count').textContent, '5');

  // Counts follow the fields as they change.
  input(harness, $(harness, '#modal-delay'), '');
  assert.equal(count('modal-group-timing').hidden, true);
  input(harness, $(harness, '#modal-match-body'), 'plan');
  assert.equal(count('modal-match-fields').textContent, '3');

  // Saving an unchanged rule keeps its stored shape.
  input(harness, $(harness, '#modal-delay'), '1500');
  input(harness, $(harness, '#modal-match-body'), '');
  await save(harness);
  assert.deepEqual(savedRules(harness), [
    {
      pattern: '/api/cart',
      body: '{}',
      mode: 'text',
      graphqlOperation: 'GetCart',
      matchQuery: [{ name: 'debug' }],
      delayMs: 1500,
      responseHeaders: [
        { name: 'X-A', value: '1' },
        { name: 'X-B', value: '2' },
      ],
    },
  ]);
});

test('a script, patch or fail rule opens the group that holds its setting', async () => {
  const harness = await panelHarness({
    storageState: {
      overrides: [
        { pattern: 's', body: 'return 1;', mode: 'script' },
        { pattern: 'f', body: '', mode: 'text', failReason: 'TimedOut' },
        { pattern: 'g', body: '', mode: 'text', isGlobal: true, processTemplates: false },
      ],
    },
  });
  await openTab(harness, 'overrides');
  const editButtons = harness.document.querySelectorAll('#list .edit-btn');

  click(harness, editButtons[0]);
  await flushUi(harness.window);
  assert.equal($(harness, '#modal-group-body-type').open, true);
  assert.equal($(harness, '#modal-group-body-type .modal-group-count').textContent, '1');
  click(harness, $(harness, '#override-modal .modal-close'));

  click(harness, editButtons[1]);
  await flushUi(harness.window);
  assert.equal($(harness, '#modal-group-timing').open, true);
  assert.equal($(harness, '#modal-fail-reason').value, 'TimedOut');
  // Groups with nothing that applies to a fail rule are not shown.
  assert.equal($(harness, '#modal-group-response-headers').style.display, 'none');
  click(harness, $(harness, '#override-modal .modal-close'));

  click(harness, editButtons[2]);
  await flushUi(harness.window);
  assert.equal($(harness, '#modal-match-fields').open, true, 'global counts as a condition');
  assert.equal($(harness, '#modal-group-body-type').open, true, 'templates turned off');
});

test('a validation error inside a closed group opens it before focusing the field', async () => {
  const harness = await panelHarness();
  click(harness, $(harness, '#add-api-btn'));
  await flushUi(harness.window);
  input(harness, $(harness, '#modal-pattern'), '/api/x');
  $(harness, '#modal-delay').value = '999999';
  await save(harness);
  assert.equal($(harness, '#modal-advanced-fields').open, true);
  assert.equal($(harness, '#modal-group-timing').open, true);
  assert.equal(harness.document.activeElement, $(harness, '#modal-delay'));
});

test('presets fill the existing fields', async () => {
  const harness = await panelHarness();
  const addWith = async (pattern, preset, body = '') => {
    click(harness, $(harness, '#add-api-btn'));
    await flushUi(harness.window);
    input(harness, $(harness, '#modal-pattern'), pattern);
    input(harness, $(harness, '#modal-body'), body);
    click(harness, $(harness, `.preset-btn[data-preset="${preset}"]`));
    assert.equal($(harness, '#modal-pattern').disabled, false, 'a preset never locks the pattern');
    await save(harness);
  };

  await addWith('/api/list', 'empty-list', '{"users":[{"id":1}],"total":1}');
  await addWith('/api/plain', 'empty-list');
  await addWith('/api/boom', 'server-error');
  await addWith('/api/slow', 'slow', '{"ok":true}');
  await addWith('/api/offline', 'offline');

  assert.deepEqual(savedRules(harness), [
    {
      pattern: '/api/list',
      body: '{\n  "users": [],\n  "total": 1\n}',
      mode: 'text',
      statusCode: 200,
    },
    { pattern: '/api/plain', body: '[]', mode: 'text', statusCode: 200 },
    {
      pattern: '/api/boom',
      body: '{"error":"Internal Server Error"}',
      mode: 'text',
      statusCode: 500,
    },
    { pattern: '/api/slow', body: '{"ok":true}', mode: 'text', delayMs: 3000 },
    { pattern: '/api/offline', body: '', mode: 'text', failReason: 'InternetDisconnected' },
  ]);
});

test('the Slow preset opens Timing & failure so the delay is visible', async () => {
  const harness = await panelHarness();
  click(harness, $(harness, '#add-api-btn'));
  await flushUi(harness.window);
  click(harness, $(harness, '.preset-btn[data-preset="slow"]'));
  assert.equal($(harness, '#modal-advanced-fields').open, true);
  assert.equal($(harness, '#modal-group-timing').open, true);
  assert.equal($(harness, '#modal-delay').value, '3000');
  assert.match($(harness, '#modal-feedback').textContent, /Slow/);
});

test('"Mock this" opens the editor filled from the captured request', async () => {
  const harness = await panelHarness({
    apis: [
      {
        url: API_URL,
        type: 'fetch',
        method: 'POST',
        statusCode: 201,
        body: '{"id":7}',
      },
    ],
  });
  const button = $(harness, '.api-item .mock-btn');
  assert.ok(button, 'each captured request has a Mock this button');
  assert.equal(button.textContent, 'Mock this');
  click(harness, button);
  await flushUi(harness.window);

  assert.equal($(harness, '#override-modal').style.display, 'block');
  assert.equal($(harness, '#modal-pattern').value, '/api/users?page=1');
  assert.equal($(harness, '#modal-method').value, 'POST');
  assert.equal($(harness, '#modal-status').value, '201');
  assert.equal($(harness, '#modal-body').value, '{\n  "id": 7\n}');
});

test('"Mock this" does not copy a status that cannot carry a mocked body', async () => {
  const harness = await panelHarness({
    apis: [{ url: API_URL, type: 'fetch', method: 'GET', statusCode: 304 }],
  });
  click(harness, $(harness, '.api-item .mock-btn'));
  await flushUi(harness.window);
  assert.equal($(harness, '#modal-status').value, '');
});

test('"Mock this" on a request a rule already covers edits that rule instead of adding one', async () => {
  const harness = await panelHarness({
    storageState: { overrides: [{ pattern: '/api/users', body: '[]', mode: 'text' }] },
    apis: [{ url: API_URL, type: 'fetch', method: 'GET', statusCode: 200 }],
  });
  await openTab(harness, 'overridden');
  click(harness, $(harness, '.api-item .mock-btn'));
  await flushUi(harness.window);
  assert.equal($(harness, '#modal-title-text').textContent, 'Edit override');
  input(harness, $(harness, '#modal-body'), '[1]');
  await save(harness);
  assert.equal(savedRules(harness).length, 1);
});

test('the Import menu holds the rules file and the cURL / OpenAPI import', async () => {
  const harness = await panelHarness();
  await openTab(harness, 'overrides');
  const menuButton = $(harness, '#import-menu-btn');
  const menu = $(harness, '#import-menu');
  assert.equal(menuButton.getAttribute('aria-haspopup'), 'menu');
  assert.equal(menu.hidden, true);
  assert.ok(menu.contains($(harness, '#import-rules-btn')));
  assert.ok(menu.contains($(harness, '#import-curl-swagger-btn')));

  click(harness, menuButton);
  assert.equal(menu.hidden, false);
  assert.equal(menuButton.getAttribute('aria-expanded'), 'true');
  assert.equal(harness.document.activeElement, $(harness, '#import-rules-btn'));
  key(harness, harness.document.activeElement, 'ArrowDown');
  assert.equal(harness.document.activeElement, $(harness, '#import-curl-swagger-btn'));
  key(harness, harness.document.activeElement, 'Escape');
  assert.equal(menu.hidden, true);
  assert.equal(menuButton.getAttribute('aria-expanded'), 'false');
  assert.equal(harness.document.activeElement, menuButton);

  click(harness, menuButton);
  click(harness, $(harness, '#import-curl-swagger-btn'));
  assert.equal(menu.hidden, true);
  const dialog = $(harness, '#curl-swagger-modal');
  assert.notEqual(dialog.style.display, 'none');
  assert.equal(dialog.querySelector('[role="dialog"]').getAttribute('aria-modal'), 'true');
  assert.equal(harness.document.activeElement, $(harness, '#curl-swagger-textarea'));
  key(harness, dialog, 'Escape');
  assert.equal(dialog.style.display, 'none');
});

test('the cURL / OpenAPI dialog is no longer at the top of the panel', () => {
  const html = readPageHtml('panel.html');
  assert.ok(html.indexOf('id="curl-swagger-modal"') > html.indexOf('id="overrides-section"'));
});

test('the Rules tab shows each rule as one line: what matches → what happens', async () => {
  const harness = await panelHarness({
    storageState: {
      overrides: [
        {
          pattern: '/api/orders',
          body: '{}',
          mode: 'text',
          method: 'GET',
          statusCode: 500,
          delayMs: 3000,
          matchQuery: [{ name: 'page', value: '2' }],
        },
      ],
    },
    apis: [{ url: `${TEST_DOMAIN}/api/orders?page=2`, type: 'fetch', method: 'GET' }],
  });
  await openTab(harness, 'overrides');
  const summary = $(harness, '#list .rule-summary');
  assert.equal(summary.textContent, 'GET /api/orders + query page=2 → 500 · slow 3 s');
  click(harness, summary);
  await flushUi(harness.window);
  assert.equal($(harness, '#modal-title-text').textContent, 'Edit override');

  // The Overridden list names the rule that covers each request.
  click(harness, $(harness, '#override-modal .modal-close'));
  await openTab(harness, 'overridden');
  assert.equal(
    $(harness, '.api-item .overridden-badge').title,
    'GET /api/orders + query page=2 → 500 · slow 3 s'
  );
});

test('a status copied by "Mock this" is not saved with a network-error rule', async () => {
  const harness = await panelHarness({
    apis: [{ url: API_URL, type: 'fetch', method: 'GET', statusCode: 201, body: '{}' }],
  });
  click(harness, $(harness, '.api-item .mock-btn'));
  await flushUi(harness.window);
  assert.equal($(harness, '#modal-status').value, '201');
  click(harness, $(harness, '.preset-btn[data-preset="offline"]'));
  await save(harness);

  const [rule] = savedRules(harness);
  assert.equal(rule.failReason, 'InternetDisconnected');
  assert.equal('statusCode' in rule, false);
});

test('switching the type away from a mock response clears the hidden status', async () => {
  const harness = await panelHarness();
  click(harness, $(harness, '#add-api-btn'));
  await flushUi(harness.window);
  input(harness, $(harness, '#modal-pattern'), '/api/r');
  input(harness, $(harness, '#modal-status'), '404');
  const redirect = $(harness, 'input[name="modal-override-type"][value="redirect"]');
  redirect.checked = true;
  redirect.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
  assert.equal($(harness, '#modal-status').value, '');
  // Body options do not apply to a redirect, so their group is not shown.
  assert.equal($(harness, '#modal-group-body-type').style.display, 'none');
});

test('a new rule starts in Text mode even after editing a script rule', async () => {
  const harness = await panelHarness({
    storageState: { overrides: [{ pattern: 's', body: 'return 1;', mode: 'script' }] },
  });
  await openTab(harness, 'overrides');
  click(harness, $(harness, '#list .edit-btn'));
  await flushUi(harness.window);
  assert.equal($(harness, '#modal-mode').value, 'script');
  click(harness, $(harness, '#override-modal .modal-close'));
  await openTab(harness, 'other');
  click(harness, $(harness, '#add-api-btn'));
  await flushUi(harness.window);
  assert.equal($(harness, '#modal-mode').value, 'text');
  assert.equal($(harness, '#modal-group-body-type').open, false);
});

test('"Mock this" keeps the URL pattern editable so it can be widened', async () => {
  const harness = await panelHarness({
    apis: [{ url: `${TEST_DOMAIN}/api/users/42`, type: 'fetch', method: 'GET', statusCode: 200 }],
  });
  click(harness, $(harness, '.api-item .mock-btn'));
  await flushUi(harness.window);

  const pattern = $(harness, '#modal-pattern');
  assert.equal(pattern.value, '/api/users/42', 'prefilled from the request');
  assert.equal(pattern.disabled, false);
  assert.equal(pattern.readOnly, false);
  assert.match($(harness, '#modal-pattern-hint').textContent, /Use \* to match more URLs/);

  input(harness, pattern, '/api/users/*');
  await save(harness);
  assert.equal(savedRules(harness)[0].pattern, '/api/users/*');
});

test('a pattern emptied after "Mock this" is refused like a new rule', async () => {
  const harness = await panelHarness({
    apis: [{ url: API_URL, type: 'fetch', method: 'GET', statusCode: 200 }],
  });
  click(harness, $(harness, '.api-item .mock-btn'));
  await flushUi(harness.window);
  input(harness, $(harness, '#modal-pattern'), '   ');
  await save(harness);
  assert.equal($(harness, '#modal-feedback').textContent, 'Pattern is required.');
  assert.equal($(harness, '#modal-pattern').getAttribute('aria-invalid'), 'true');
  assert.deepEqual(savedRules(harness), []);
});

test('editing a saved mock rule can change its URL pattern', async () => {
  const harness = await panelHarness({
    storageState: { overrides: [{ pattern: '/api/users/42', body: '[]', mode: 'text' }] },
  });
  await openTab(harness, 'overrides');
  click(harness, $(harness, '.edit-btn'));
  await flushUi(harness.window);
  const pattern = $(harness, '#modal-pattern');
  assert.equal(pattern.disabled, false);
  input(harness, pattern, '/api/users/*');
  await save(harness);
  assert.deepEqual(savedRules(harness), [{ pattern: '/api/users/*', body: '[]', mode: 'text' }]);
});

test('switching the rule type back to a mock keeps the pattern editable', async () => {
  const harness = await panelHarness();
  click(harness, $(harness, '#add-api-btn'));
  await flushUi(harness.window);
  for (const type of ['redirect', 'body']) {
    const radio = $(harness, `input[name="modal-override-type"][value="${type}"]`);
    radio.checked = true;
    radio.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
  }
  assert.equal($(harness, '#modal-pattern').disabled, false);
});

test('a broken /regex/ pattern is refused with the reason, and nothing is saved', async () => {
  const harness = await panelHarness({
    apis: [{ url: API_URL, type: 'fetch', method: 'GET', statusCode: 200 }],
  });
  click(harness, $(harness, '.api-item .mock-btn'));
  await flushUi(harness.window);
  input(harness, $(harness, '#modal-pattern'), '/api/(users/');
  await save(harness);
  assert.match($(harness, '#modal-feedback').textContent, /^Invalid regex pattern: /);
  assert.equal($(harness, '#modal-pattern').getAttribute('aria-invalid'), 'true');
  assert.deepEqual(savedRules(harness), []);

  input(harness, $(harness, '#modal-pattern'), '/api\/(users|orders)/i');
  await save(harness);
  assert.equal(savedRules(harness)[0].pattern, '/api\/(users|orders)/i');
});

test('Add Manual refuses a broken /regex/ pattern', async () => {
  const harness = await panelHarness();
  input(harness, $(harness, '#pattern'), '/api/[users/');
  click(harness, $(harness, '#add'));
  await flushUi(harness.window);
  assert.match(harness.window.document.body.textContent, /Invalid regex pattern: /);
  assert.deepEqual(savedRules(harness), []);
});
