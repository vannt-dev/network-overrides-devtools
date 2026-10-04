import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createUiHarness, flushUi, closeAllUiHarnessWindows } from './test-harness.mjs';

after(() => closeAllUiHarnessWindows());

const click = (harness, el) =>
  el.dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
const $ = (harness, id) => harness.document.getElementById(id);
const shown = el => el.style.display !== 'none';

function chooseType(harness, value) {
  const radio = harness.document.querySelector(
    `input[name="modal-override-type"][value="${value}"]`
  );
  radio.checked = true;
  radio.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
}

async function openAddModal(harness) {
  await flushUi(harness.window);
  click(harness, $(harness, 'add-api-btn'));
  await flushUi(harness.window);
}

test('choosing WebSocket frames shows its fields and hides the HTTP ones', async () => {
  const harness = createUiHarness({ storageState: { enabled: true, overrides: [] } });
  await openAddModal(harness);
  chooseType(harness, 'websocket');

  assert.ok(shown($(harness, 'modal-ws-fields')));
  assert.ok(!shown($(harness, 'modal-method').closest('label')));
  assert.ok(!shown($(harness, 'modal-status-field')));
  assert.ok(!shown($(harness, 'modal-headers-field')));
  assert.ok(!shown($(harness, 'modal-request-body-field')));
  assert.ok(shown($(harness, 'modal-body-fields')));
  assert.equal($(harness, 'modal-pattern').disabled, false);

  $(harness, 'modal-ws-action').value = 'block';
  $(harness, 'modal-ws-action').dispatchEvent(
    new harness.window.Event('change', { bubbles: true })
  );
  assert.ok(!shown($(harness, 'modal-body-fields')));

  chooseType(harness, 'body');
  assert.ok(!shown($(harness, 'modal-ws-fields')));
});

test('saving a WebSocket rule stores only its fields', async () => {
  const harness = createUiHarness({ storageState: { enabled: true, overrides: [] } });
  await openAddModal(harness);
  chooseType(harness, 'websocket');
  $(harness, 'modal-pattern').value = 'wss://x.test/*';
  $(harness, 'modal-ws-direction').value = 'send';
  $(harness, 'modal-ws-match').value = 'ping';
  $(harness, 'modal-ws-action').value = 'block';
  click(harness, $(harness, 'save-override'));
  await flushUi(harness.window);

  assert.deepEqual(harness.localState.overrides, [
    {
      pattern: 'wss://x.test/*',
      body: '',
      mode: 'text',
      kind: 'websocket',
      wsDirection: 'send',
      wsMatch: 'ping',
      wsAction: 'block',
    },
  ]);
});

for (const [name, setup, message] of [
  [
    'an invalid regex',
    h => {
      $(h, 'modal-ws-match').value = '(';
      $(h, 'modal-ws-regex').checked = true;
    },
    /regular expression/i,
  ],
  ['substitute without a match', h => ($(h, 'modal-ws-action').value = 'substitute'), /match/i],
  ['an http pattern', h => ($(h, 'modal-pattern').value = 'https://x.test/api'), /ws:\/\//],
  [
    'delay without a delay',
    h => {
      $(h, 'modal-ws-action').value = 'delay';
      $(h, 'modal-delay').value = '';
    },
    /delay/i,
  ],
]) {
  test(`saving refuses ${name}`, async () => {
    const harness = createUiHarness({ storageState: { enabled: true, overrides: [] } });
    await openAddModal(harness);
    chooseType(harness, 'websocket');
    $(harness, 'modal-pattern').value = 'wss://x.test/*';
    setup(harness);
    click(harness, $(harness, 'save-override'));
    await flushUi(harness.window);
    assert.match($(harness, 'modal-feedback').textContent, message);
    assert.deepEqual(harness.localState.overrides ?? [], []);
  });
}

test('the rules list shows a WS badge and a summary, and edit restores the fields', async () => {
  const rule = {
    pattern: 'wss://x.test/*',
    body: '',
    mode: 'text',
    kind: 'websocket',
    wsDirection: 'send',
    wsMatch: '^ping',
    wsMatchRegex: true,
    wsAction: 'block',
  };
  const harness = createUiHarness({ storageState: { enabled: true, overrides: [rule] } });
  await flushUi(harness.window);
  click(harness, harness.document.querySelector('[data-tab="overrides"]'));
  await flushUi(harness.window);

  assert.equal(harness.document.querySelector('.ws-badge').textContent, 'WS');
  assert.equal(harness.document.querySelector('.ws-summary').textContent, 'send · /^ping/ → block');

  click(harness, harness.document.querySelector('.edit-btn'));
  await flushUi(harness.window);
  assert.equal(
    harness.document.querySelector('input[name="modal-override-type"]:checked').value,
    'websocket'
  );
  assert.equal($(harness, 'modal-ws-direction').value, 'send');
  assert.equal($(harness, 'modal-ws-match').value, '^ping');
  assert.equal($(harness, 'modal-ws-regex').checked, true);
  assert.equal($(harness, 'modal-ws-action').value, 'block');
});

test('clicking a WS entry in the APIs tab opens the modal preset to WebSocket frames', async () => {
  const harness = createUiHarness({
    storageState: { enabled: true, overrides: [{ pattern: '*', body: 'x', mode: 'text' }] },
    apis: [{ url: 'wss://x.test/feed', type: 'websocket' }],
  });
  await flushUi(harness.window);
  // An API no rule matches is listed under "Other APIs".
  click(harness, harness.document.querySelector('[data-tab="other"]'));
  await flushUi(harness.window);
  click(harness, harness.document.querySelector('.api-item'));
  await flushUi(harness.window);

  assert.equal($(harness, 'modal-title-text').textContent, 'Add override');
  assert.equal(
    harness.document.querySelector('input[name="modal-override-type"]:checked').value,
    'websocket'
  );
  assert.equal($(harness, 'modal-pattern').value, 'wss://x.test/feed');
});
