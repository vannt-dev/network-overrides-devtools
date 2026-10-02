import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createUiHarness, flushUi, closeAllUiHarnessWindows } from './test-harness.mjs';

after(() => {
  closeAllUiHarnessWindows();
});

const rule = (pattern, extra = {}) => ({ pattern, body: '{}', mode: 'text', ...extra });
const patterns = rules => rules.map(item => item.pattern);

async function createHarness(storageState) {
  const harness = createUiHarness({ storageState });
  await flushUi(harness.window);
  return harness;
}

function handles(harness) {
  return [...harness.document.querySelectorAll('#list .rule-drag-handle')];
}

function items(harness) {
  return [...harness.document.querySelectorAll('#list .override-item')];
}

function fire(harness, target, type, init = {}) {
  target.dispatchEvent(
    new harness.window.MouseEvent(type, { bubbles: true, cancelable: true, ...init })
  );
}

function press(harness, target, key) {
  target.dispatchEvent(
    new harness.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  );
}

test('moveRule places a rule before or after another and refuses no-op moves', async () => {
  const harness = await createHarness({ overrides: [] });
  const { moveRule } = harness.window.NetworkOverridesUi;
  const rules = [rule('a'), rule('b'), rule('c'), rule('d')];

  assert.deepEqual(patterns(moveRule(rules, 0, 2, 'after')), ['b', 'c', 'a', 'd']);
  assert.deepEqual(patterns(moveRule(rules, 0, 2, 'before')), ['b', 'a', 'c', 'd']);
  assert.deepEqual(patterns(moveRule(rules, 3, 0, 'before')), ['d', 'a', 'b', 'c']);
  assert.deepEqual(patterns(moveRule(rules, 3, 0, 'after')), ['a', 'd', 'b', 'c']);
  assert.deepEqual(patterns(rules), ['a', 'b', 'c', 'd'], 'the input array is not mutated');

  assert.equal(moveRule(rules, 1, 1, 'before'), null);
  assert.equal(moveRule(rules, 1, 2, 'before'), null, 'already directly before the target');
  assert.equal(moveRule(rules, 2, 1, 'after'), null, 'already directly after the target');
  assert.equal(moveRule(rules, -1, 1, 'before'), null);
  assert.equal(moveRule(rules, 0, 4, 'after'), null);
  assert.equal(moveRule(rules, 0.5, 1, 'after'), null);
});

test('moveRule keeps domain rules and global rules in their own groups', async () => {
  const harness = await createHarness({ overrides: [] });
  const { moveRule } = harness.window.NetworkOverridesUi;
  const rules = [
    rule('a'),
    rule('b'),
    rule('g1', { isGlobal: true }),
    rule('g2', { isGlobal: true }),
  ];

  assert.equal(moveRule(rules, 0, 2, 'after'), null);
  assert.equal(moveRule(rules, 3, 1, 'before'), null);
  assert.deepEqual(patterns(moveRule(rules, 3, 2, 'before')), ['a', 'b', 'g2', 'g1']);
  assert.deepEqual(patterns(moveRule(rules, 0, 1, 'after')), ['b', 'a', 'g1', 'g2']);
});

test('arrow keys on the handle move a rule, save the order and keep focus on it', async () => {
  const harness = await createHarness({ overrides: [rule('a'), rule('b'), rule('c')] });

  press(harness, handles(harness)[0], 'ArrowDown');
  await flushUi(harness.window);

  assert.deepEqual(patterns(harness.localState.overrides), ['b', 'a', 'c']);
  const update = harness.sentMessages.filter(message => message.type === 'update').at(-1);
  assert.deepEqual(patterns(update.overrides), ['b', 'a', 'c']);
  assert.equal(harness.document.activeElement, handles(harness)[1]);

  press(harness, handles(harness)[1], 'ArrowUp');
  await flushUi(harness.window);
  assert.deepEqual(patterns(harness.localState.overrides), ['a', 'b', 'c']);
  assert.equal(harness.document.activeElement, handles(harness)[0]);
});

test('arrow keys do nothing at the ends of the list or for other keys', async () => {
  const harness = await createHarness({ overrides: [rule('a'), rule('b')] });
  const savesBefore = harness.storageSets.length;

  press(harness, handles(harness)[0], 'ArrowUp');
  press(harness, handles(harness)[1], 'ArrowDown');
  press(harness, handles(harness)[0], 'Enter');
  await flushUi(harness.window);

  assert.equal(harness.storageSets.length, savesBefore);
  assert.deepEqual(patterns(harness.localState.overrides), ['a', 'b']);
});

test('dragging a handle onto another rule drops before or after it', async () => {
  const harness = await createHarness({ overrides: [rule('a'), rule('b'), rule('c')] });

  // jsdom rows have no height, so clientY -1 is the upper half and 1 the lower half.
  fire(harness, handles(harness)[2], 'dragstart');
  assert.equal(items(harness)[2].classList.contains('override-item--dragging'), true);
  fire(harness, items(harness)[0], 'dragover', { clientY: -1 });
  assert.equal(items(harness)[0].classList.contains('override-item--drop-before'), true);
  fire(harness, items(harness)[0], 'drop', { clientY: -1 });
  await flushUi(harness.window);
  assert.deepEqual(patterns(harness.localState.overrides), ['c', 'a', 'b']);

  fire(harness, handles(harness)[0], 'dragstart');
  fire(harness, items(harness)[2], 'dragover', { clientY: 1 });
  assert.equal(items(harness)[2].classList.contains('override-item--drop-after'), true);
  fire(harness, items(harness)[2], 'drop', { clientY: 1 });
  await flushUi(harness.window);
  assert.deepEqual(patterns(harness.localState.overrides), ['a', 'b', 'c']);
});

test('a drop outside a drag, on the dragged rule, or after dragend changes nothing', async () => {
  const harness = await createHarness({ overrides: [rule('a'), rule('b')] });
  const savesBefore = harness.storageSets.length;

  fire(harness, items(harness)[1], 'drop', { clientY: 1 });

  fire(harness, handles(harness)[0], 'dragstart');
  const overSelf = new harness.window.MouseEvent('dragover', { bubbles: true, cancelable: true });
  items(harness)[0].dispatchEvent(overSelf);
  assert.equal(overSelf.defaultPrevented, false, 'the dragged row is not a drop target');
  fire(harness, items(harness)[0], 'drop');

  fire(harness, handles(harness)[0], 'dragend');
  assert.equal(items(harness)[0].classList.contains('override-item--dragging'), false);
  fire(harness, items(harness)[1], 'drop', { clientY: 1 });
  await flushUi(harness.window);

  assert.equal(harness.storageSets.length, savesBefore);
  assert.deepEqual(patterns(harness.localState.overrides), ['a', 'b']);
});

test('a domain rule cannot be moved among the global rules', async () => {
  const harness = await createHarness({
    overrides: [rule('a'), rule('b')],
    overrides_global: [rule('g1', { isGlobal: true }), rule('g2', { isGlobal: true })],
  });
  assert.deepEqual(
    items(harness).map(item => item.querySelector('.rule-pattern').textContent.includes('GLOBAL')),
    [false, false, true, true]
  );
  const savesBefore = harness.storageSets.length;

  press(harness, handles(harness)[1], 'ArrowDown');
  fire(harness, handles(harness)[0], 'dragstart');
  const overGlobal = new harness.window.MouseEvent('dragover', { bubbles: true, cancelable: true });
  items(harness)[2].dispatchEvent(overGlobal);
  assert.equal(
    overGlobal.defaultPrevented,
    false,
    'a global rule is not a drop target for a domain rule'
  );
  fire(harness, items(harness)[2], 'drop', { clientY: 1 });
  fire(harness, handles(harness)[0], 'dragend');
  await flushUi(harness.window);
  assert.equal(harness.storageSets.length, savesBefore);

  press(harness, handles(harness)[3], 'ArrowUp');
  await flushUi(harness.window);
  assert.deepEqual(patterns(harness.localState.overrides_global), ['g2', 'g1']);
  assert.deepEqual(patterns(harness.localState.overrides), ['a', 'b']);
});

test('clicking the handle does not open the editor', async () => {
  const harness = await createHarness({ overrides: [rule('a')] });

  fire(harness, handles(harness)[0], 'click');
  await flushUi(harness.window);

  assert.equal(harness.document.getElementById('modal-pattern').value, '');
});
