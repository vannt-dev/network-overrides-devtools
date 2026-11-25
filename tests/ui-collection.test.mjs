import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import {
  createUiContext,
  createUiHarness,
  flushUi,
  closeAllUiHarnessWindows,
  normalize,
} from './test-harness.mjs';
import { TEST_DOMAIN } from './config.mjs';

after(() => {
  closeAllUiHarnessWindows();
});

const ui = createUiContext().NetworkOverridesUi;
const KEY = `overrides_${TEST_DOMAIN}`;

const $ = (harness, selector) => harness.document.querySelector(selector);
const shown = el => {
  for (let node = el; node; node = node.parentElement) {
    if (node.style?.display === 'none' || node.hidden) return false;
  }
  return true;
};
const savedRules = harness => normalize(harness.localState[KEY] || []);

function click(harness, element) {
  element.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
}

function chooseType(harness, value) {
  const radio = $(harness, `input[name="modal-override-type"][value="${value}"]`);
  radio.checked = true;
  radio.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
}

/**
 * A panel whose background answers the collection messages from `items`,
 * the way the service worker does once the rule is saved.
 */
async function panelHarness(rules = [], items = [{ id: 1, title: 'Buy milk' }]) {
  const harness = createUiHarness({
    page: 'panel.html',
    tabUrl: `${TEST_DOMAIN}/`,
    storageState: rules.length ? { [KEY]: rules } : {},
  });
  const collection = { items: structuredClone(items), messages: [] };
  const original = harness.chrome.runtime.sendMessage;
  harness.chrome.runtime.sendMessage = (message, callback) => {
    if (!['getCollection', 'setCollection', 'resetCollection'].includes(message?.type)) {
      return original(message, callback);
    }
    collection.messages.push(structuredClone(message));
    if (message.type === 'setCollection') collection.items = structuredClone(message.items);
    if (message.type === 'resetCollection') collection.items = structuredClone(items);
    callback?.({ success: true, items: structuredClone(collection.items) });
  };
  await flushUi(harness.window);
  return { harness, collection };
}

async function openNewRule(harness) {
  click(harness, $(harness, '#add-api-btn'));
  await flushUi(harness.window);
}

async function openFirstRule(harness) {
  click(harness, $(harness, '.tab-btn[data-tab="overrides"]'));
  await flushUi(harness.window);
  click(harness, $(harness, '#list .edit-btn'));
  await flushUi(harness.window, 6);
}

async function save(harness) {
  click(harness, $(harness, '#save-override'));
  await flushUi(harness.window, 6);
}

test('a collection rule reads as one line', () => {
  const rule = { pattern: '/api/todos', body: '[]', mode: 'collection', statusCode: 500 };
  assert.equal(ui.summarizeRule(rule), '/api/todos → CRUD collection');
  assert.equal(
    ui.summarizeRule({ ...rule, collectionIdType: 'uuid', delayMs: 300 }),
    '/api/todos → CRUD collection · UUID ids · slow 300 ms'
  );
});

test('choosing CRUD collection shows the seed, id and data fields and hides the rest', async () => {
  const { harness } = await panelHarness();
  await openNewRule(harness);
  chooseType(harness, 'collection');
  await flushUi(harness.window);

  assert.ok(shown($(harness, '#modal-body')));
  assert.ok(shown($(harness, '#modal-collection-help')));
  assert.ok(shown($(harness, '#modal-collection-id-field')));
  assert.ok(shown($(harness, '#modal-collection-data')));
  assert.ok(shown($(harness, '#modal-delay')));
  assert.ok(!shown($(harness, '#modal-status')));
  assert.ok(!shown($(harness, '#modal-mode')));
  assert.ok(!shown($(harness, '#modal-presets')));
  assert.ok(!shown($(harness, '#modal-request-body')));
  assert.ok(!shown($(harness, '#modal-respond-at-request')));
  assert.ok(!shown($(harness, '#modal-body-file-btn')));
  assert.ok(!shown($(harness, '#modal-script-help')));
  // A new rule has no data yet: it has to be saved first.
  assert.match($(harness, '#modal-collection-note').textContent, /Save the rule/);
  assert.equal($(harness, '#modal-collection-reset').disabled, true);
  chooseType(harness, 'body');
  assert.ok(!shown($(harness, '#modal-collection-help')));
  assert.ok(!shown($(harness, '#modal-collection-fields')));
});

test('a collection rule saves its seed and id settings, and nothing for the server', async () => {
  const { harness } = await panelHarness();
  await openNewRule(harness);
  $(harness, '#modal-pattern').value = '/api/todos';
  $(harness, '#modal-request-body').value = '{"left":"over"}';
  chooseType(harness, 'collection');
  $(harness, '#modal-body').value = '[{"key":"a","title":"x"}]';
  $(harness, '#modal-collection-id-field').value = 'key';
  $(harness, '#modal-collection-id-type').value = 'uuid';
  $(harness, '#modal-delay').value = '200';
  await save(harness);

  assert.deepEqual(savedRules(harness), [
    {
      pattern: '/api/todos',
      body: '[{"key":"a","title":"x"}]',
      mode: 'collection',
      collectionIdField: 'key',
      collectionIdType: 'uuid',
      delayMs: 200,
    },
  ]);
});

test('a seed that is not a JSON array of objects is refused, unless placeholders fill it', async () => {
  const { harness } = await panelHarness();
  await openNewRule(harness);
  $(harness, '#modal-pattern').value = '/api/todos';
  chooseType(harness, 'collection');
  $(harness, '#modal-body').value = '{"id":1}';
  await save(harness);
  assert.match($(harness, '#modal-feedback').textContent, /JSON array of objects/);
  assert.deepEqual(savedRules(harness), []);

  $(harness, '#modal-body').value = '[{"id":1,"n":{{$randomInt(1,9)}}}]';
  await save(harness);
  assert.equal(savedRules(harness)[0].mode, 'collection');
});

test('editing a collection rule shows its current data, saves edits and resets to the seed', async () => {
  const rule = {
    pattern: '/api/todos',
    body: '[{"id":1,"title":"Buy milk"}]',
    mode: 'collection',
    collectionIdField: 'id',
  };
  const { harness, collection } = await panelHarness([rule]);
  await openFirstRule(harness);

  assert.equal($(harness, 'input[name="modal-override-type"]:checked').value, 'collection');
  assert.equal(
    $(harness, '#modal-body').value,
    '[\n  {\n    "id": 1,\n    "title": "Buy milk"\n  }\n]'
  );
  assert.equal($(harness, '#modal-collection-id-field').value, 'id');
  assert.equal($(harness, '#modal-mode').value, 'text');
  assert.deepEqual(collection.messages.at(-1), {
    type: 'getCollection',
    tabId: 99,
    pattern: '/api/todos',
  });
  assert.deepEqual(JSON.parse($(harness, '#modal-collection-data').value), [
    { id: 1, title: 'Buy milk' },
  ]);
  assert.match($(harness, '#modal-collection-note').textContent, /^Items: 1,/);

  $(harness, '#modal-collection-data').value = '[{"id":5,"title":"edited"}]';
  click(harness, $(harness, '#modal-collection-save'));
  await flushUi(harness.window);
  assert.deepEqual(collection.messages.at(-1).items, [{ id: 5, title: 'edited' }]);
  assert.match($(harness, '#modal-collection-note').textContent, /Saved\. Items: 1/);

  $(harness, '#modal-collection-data').value = '{"not":"a list"}';
  click(harness, $(harness, '#modal-collection-save'));
  await flushUi(harness.window);
  assert.equal(collection.messages.at(-1).type, 'setCollection');
  assert.equal(collection.messages.length, 2);
  assert.match($(harness, '#modal-collection-note').textContent, /JSON array of objects/);

  click(harness, $(harness, '#modal-collection-reset'));
  await flushUi(harness.window);
  assert.equal(collection.messages.at(-1).type, 'resetCollection');
  assert.deepEqual(JSON.parse($(harness, '#modal-collection-data').value), [
    { id: 1, title: 'Buy milk' },
  ]);
  assert.match($(harness, '#modal-collection-note').textContent, /Back to the seed\. Items: 1/);
});

test('Import keeps a collection rule with its id settings', async () => {
  const harness = createUiHarness({ apis: [], tabUrl: `${TEST_DOMAIN}/` });
  await flushUi(harness.window);
  const rule = {
    pattern: '/api/todos',
    mode: 'collection',
    body: '[]',
    collectionIdField: 'key',
    collectionIdType: 'uuid',
  };
  const file = new harness.window.File(
    [
      JSON.stringify({
        version: 1,
        domain: TEST_DOMAIN,
        overrides: [rule, { ...rule, respondAtRequest: true, pattern: '/b' }],
      }),
    ],
    'rules.json',
    { type: 'application/json' }
  );
  const picker = $(harness, '#import-rules-input');
  Object.defineProperty(picker, 'files', { value: [file], configurable: true });
  picker.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
  await flushUi(harness.window);
  assert.deepEqual(harness.localState[KEY], [rule, { ...rule, pattern: '/b' }]);
});

test('Import refuses an unknown collection id type', async () => {
  const harness = createUiHarness({ apis: [], tabUrl: `${TEST_DOMAIN}/` });
  await flushUi(harness.window);
  const bad = { pattern: '/api/todos', mode: 'collection', body: '[]', collectionIdType: 'guid' };
  const file = new harness.window.File(
    [JSON.stringify({ version: 1, domain: TEST_DOMAIN, overrides: [bad] })],
    'rules.json',
    { type: 'application/json' }
  );
  const picker = $(harness, '#import-rules-input');
  Object.defineProperty(picker, 'files', { value: [file], configurable: true });
  picker.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
  await flushUi(harness.window);
  assert.match($(harness, '.notification-toast--error').textContent, /invalid/i);
  assert.equal(harness.localState[KEY], undefined);
});

test('a captured request to an item of a collection is shown as handled by its rule', () => {
  const rules = [{ pattern: '*/api/todos', body: '[]', mode: 'collection' }];
  const status = ui.getMatchingRuleStatus(
    { url: `${TEST_DOMAIN}/api/todos/4`, type: 'fetch', method: 'DELETE' },
    rules
  );
  assert.equal(status?.index, 0);
});
