import test from 'node:test';
import assert from 'node:assert/strict';
import { createUiHarness, normalize } from './test-harness.mjs';
import { createBackgroundHarness } from './background-test-harness.mjs';

test('Background saves the captured body types and reads them back after a restart', async () => {
  const harness = createBackgroundHarness();
  await harness.context.NetworkOverridesBackground.ready;
  harness.callMessage({ type: 'updateCapturedBodyTypes', types: ['XHR', 'fetch', 'document'] });
  assert.deepEqual(normalize(harness.storageSets.at(-1)), {
    capturedBodyTypes: ['xhr', 'fetch', 'document'],
  });
  assert.equal(harness.context.NetworkOverridesBackground.shouldCaptureBody('Document'), true);

  // a new service worker starts from what was saved
  const restarted = createBackgroundHarness({ storageState: { capturedBodyTypes: ['document'] } });
  await restarted.context.NetworkOverridesBackground.ready;
  assert.equal(restarted.context.NetworkOverridesBackground.shouldCaptureBody('Document'), true);
  assert.equal(restarted.context.NetworkOverridesBackground.shouldCaptureBody('Fetch'), false);

  // every box unticked is a choice too: nothing is captured, not the default
  const none = createBackgroundHarness({ storageState: { capturedBodyTypes: [] } });
  await none.context.NetworkOverridesBackground.ready;
  assert.equal(none.context.NetworkOverridesBackground.shouldCaptureBody('Fetch'), false);

  // nothing saved yet: XHR and Fetch, as before
  const fresh = createBackgroundHarness();
  await fresh.context.NetworkOverridesBackground.ready;
  assert.equal(fresh.context.NetworkOverridesBackground.shouldCaptureBody('XHR'), true);
  assert.equal(fresh.context.NetworkOverridesBackground.shouldCaptureBody('Document'), false);
});

test('The panel ticks the capture types that were saved, not the defaults of the page', async () => {
  const harness = createUiHarness({
    storageState: { capturedBodyTypes: ['fetch', 'stylesheet'] },
    captureTypeBoxes: true,
  });
  const ticked = () =>
    Array.from(harness.document.querySelectorAll('.capture-type-cb'))
      .filter(input => input.checked)
      .map(input => input.value);
  for (let i = 0; i < 20 && ticked().join() !== 'fetch,stylesheet'; i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.deepEqual(ticked(), ['fetch', 'stylesheet']);

  const fresh = createUiHarness({ captureTypeBoxes: true });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(
    Array.from(fresh.document.querySelectorAll('.capture-type-cb'))
      .filter(input => input.checked)
      .map(input => input.value),
    ['xhr', 'fetch'],
    'nothing saved: the page defaults stay'
  );
});
