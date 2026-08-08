import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from './test-harness.mjs';
import { createBackgroundHarness } from './background-test-harness.mjs';

test('TabStateStore mirrors state to storage.session on flushPersist', async () => {
  const harness = createBackgroundHarness();
  const store = harness.context.NetworkOverridesTabState;

  const state = store.ensure(7);
  state.enabled = true;
  state.origin = 'https://a.test';
  store.setRecentApi(7, { url: 'https://a.test/api/users', type: 'fetch' });
  await store.flushPersist(7);

  const snapshot = harness.sessionState['tabState_7'];
  assert.equal(snapshot.enabled, true);
  assert.equal(snapshot.origin, 'https://a.test');
  assert.deepEqual(normalize(snapshot.recentApis), {
    'https://a.test/api/users': { url: 'https://a.test/api/users', type: 'fetch' },
  });
});

test('TabStateStore caps recentApis at the limit, dropping oldest first', async () => {
  const harness = createBackgroundHarness();
  const store = harness.context.NetworkOverridesTabState;

  for (let i = 0; i < store.RECENT_APIS_LIMIT + 5; i++) {
    store.setRecentApi(7, { url: `https://a.test/api/${i}`, type: 'fetch' });
  }
  const state = store.get(7);
  assert.equal(state.recentApis.size, store.RECENT_APIS_LIMIT);
  assert.equal(state.recentApis.has('https://a.test/api/0'), false);
  assert.equal(state.recentApis.has(`https://a.test/api/${store.RECENT_APIS_LIMIT + 4}`), true);
});

test('dispose clears memory and removes the session key', async () => {
  const harness = createBackgroundHarness();
  const store = harness.context.NetworkOverridesTabState;

  store.ensure(7).enabled = true;
  await store.flushPersist(7);
  assert.ok(harness.sessionState['tabState_7']);

  store.dispose(7);
  await Promise.resolve();
  assert.equal(store.get(7), undefined);
  assert.equal(harness.sessionState['tabState_7'], undefined);
});

test('rehydrate rebuilds live tabs, drops dead tabs, and reports enabled tabs', async () => {
  const harness = createBackgroundHarness();
  const store = harness.context.NetworkOverridesTabState;

  harness.existingTabs.add(8);
  harness.sessionState['tabState_8'] = {
    enabled: true,
    origin: 'https://b.test',
    overrides: [{ pattern: 'users', body: '{}', mode: 'text' }],
    attached: true,
    recentApis: { 'https://b.test/x': { url: 'https://b.test/x', type: 'xhr' } },
    recentApiBodies: {},
  };
  harness.sessionState['tabState_999'] = { enabled: true, origin: '', overrides: [] };

  const reattach = await store.rehydrate();

  assert.deepEqual(normalize(reattach), [8]);
  const state = store.get(8);
  assert.equal(state.enabled, true);
  assert.equal(state.attached, false); // never survives a restart
  assert.equal(state.recentApis.size, 1);
  assert.equal(store.get(999), undefined);
  assert.equal(harness.sessionState['tabState_999'], undefined);
});
