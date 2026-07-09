# Phase 1: Background Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the reliability bug class in the MV3 service worker — state loss on worker restart, storage leaks, stale state on navigation, cross-origin capture gaps, and silent attach failures — plus six small bug fixes.

**Architecture:** Extract a `TabStateStore` namespace (`src/tab-state.ts`) that owns all per-tab state with a debounced write-through mirror to `chrome.storage.session`, rehydration + debugger re-attach on worker startup, and a single `dispose()` cleanup path. `background.ts` becomes a consumer of the store. Attach status flows to the UI over the existing port plus a new `getStatus` message.

**Tech Stack:** TypeScript namespaces compiled by plain `tsc` (no bundler — each `src/*.ts` becomes `dist/*.js`, loaded via `<script>` tags in HTML and `importScripts` in the worker). Tests: `node --test` running `dist/*.js` inside `node:vm` contexts with a hand-rolled chrome mock (`tests/test-harness.mjs`).

**Spec:** `docs/superpowers/specs/2026-07-09-phase1-reliability-design.md`

## Global Constraints

- Node >= 22 (`package.json` engines). Run tests with `npm test` (builds first via `tsc`).
- Code style: namespaces + triple-slash references, NOT ES modules. New `src/tab-state.ts` must follow this style or the worker's `importScripts` wiring breaks.
- Commit messages follow commitlint conventional style (`feat:`, `fix:`, `test:`, `docs:`). Do NOT add a `Co-Authored-By` line (user preference).
- Never edit `dist/*` by hand; it is `tsc` output.
- `chrome.storage.session` mock in tests must be promise-based (the store uses the promise API).
- Every task ends with `npm test` green before committing.

---

### Task 1: Wildcard and glob pattern fixes

Two behavior fixes in pattern handling: (a) `substituteWildcards` currently does repeated `String.replace('*', …)`, so a capture value containing `*` gets clobbered by the next round; (b) glob `*` compiles to `(.+)` so `api/*` never matches `api/` — spec says change to `(.*)`.

**Files:**

- Modify: `src/utils.ts:28-53` (`matchPattern` glob branch, `substituteWildcards`)
- Modify: `src/ui.ts:84-92` (`isValidPattern` glob branch — keep in sync with `matchPattern`)
- Modify: `README.md` (pattern reference section: document that `*` matches zero or more characters)
- Test: `tests/helpers.test.mjs`

**Interfaces:**

- Produces: `NetworkOverridesUtils.matchPattern(pattern, url)` — glob `*` now compiles to `(.*)`; `NetworkOverridesUtils.substituteWildcards(template, captures)` — split/join implementation, leftover `*` slots stay literal `*` (the background's unsubstituted-`*` guard depends on this).

- [ ] **Step 1: Write the failing tests**

Append to `tests/helpers.test.mjs` (it already imports `createUiContext` from the harness; new tests can use `createBackgroundContext` the same way — check the top of the file and reuse whichever context the existing pattern tests use):

```js
test('substituteWildcards does not re-substitute * inside captured values', () => {
  const context = createUiContext();
  const result = context.NetworkOverridesUi.substituteWildcards('https://new.test/*/x/*', [
    'a*b',
    'second',
  ]);
  assert.equal(result, 'https://new.test/a*b/x/second');
});

test('substituteWildcards keeps leftover * literal when captures run out', () => {
  const context = createUiContext();
  const result = context.NetworkOverridesUi.substituteWildcards('https://new.test/*/x/*', ['only']);
  assert.equal(result, 'https://new.test/only/x/*');
});

test('glob * matches the empty string', () => {
  const context = createUiContext();
  assert.deepEqual(
    context.NetworkOverridesUi.matchPattern('https://a.test/api/*', 'https://a.test/api/'),
    ['']
  );
  assert.equal(
    context.NetworkOverridesUi.patternMatches('https://a.test/api/*', 'https://a.test/api/'),
    true
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: the first test FAILS with `'https://new.test/asecondb/x/*'` (the `*` inside `a*b` swallowed the second capture); the third FAILS because `(.+)` rejects the empty segment.

- [ ] **Step 3: Implement in `src/utils.ts`**

Replace `substituteWildcards` (lines 45-53):

```ts
export function substituteWildcards(template: string, captures: string[]): string {
  const parts = template.split('*');
  if (parts.length === 1) return template;
  let result = parts[0];
  for (let i = 1; i < parts.length; i++) {
    result += (i - 1 < captures.length ? captures[i - 1] : '*') + parts[i];
  }
  return result;
}
```

In `matchPattern` (line 31), change `'^' + parts.join('(.+)') + '$'` to `'^' + parts.join('(.*)') + '$'`.

In `src/ui.ts` `isValidPattern` (line 87), make the same `(.+)` → `(.*)` change.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, including all pre-existing tests (some existing tests may assert `(.+)` behavior — if one fails, update it to the new `(.*)` semantics and note it in the commit body).

- [ ] **Step 5: Update README pattern reference**

In `README.md`'s Pattern Reference section, update the wildcard row's description to say `*` captures **zero or more** characters (e.g. "`https://old.com/api/*/users` — `*` captures matching segments, including empty ones").

- [ ] **Step 6: Commit**

```bash
git add src/utils.ts src/ui.ts tests/helpers.test.mjs README.md
git commit -m "fix: make glob * match empty segments and stop re-substituting captures"
```

---

### Task 2: `TabStateStore` module + `storage.session` test mock

**Files:**

- Create: `src/tab-state.ts`
- Modify: `tests/test-harness.mjs` (add `storage.session` mock, `storage.local.remove` + promise support, `chrome.tabs.get`, load `dist/tab-state.js` into both background contexts)
- Create: `tests/tab-state.test.mjs`

**Interfaces:**

- Consumes: `NetworkOverridesShared.OverrideRule`, `NetworkOverridesShared.ApiEntry` (ambient declarations from `src/shared.ts`).
- Produces (used verbatim by Tasks 3-6):
  - `NetworkOverridesTabState.TabState` — `{ enabled: boolean; origin: string; overrides: OverrideRule[]; attached: boolean; attachError?: string; recentApis: Map<string, ApiEntry>; recentApiBodies: Map<string, string> }`
  - `NetworkOverridesTabState.TabRuntime` — `{ persistTimer; subscriberPorts: Set<chrome.runtime.Port>; broadcastQueue: Map<string, ApiEntry>; broadcastTimer; attachPromise: Promise<void> | null }`
  - `get(tabId): TabState | undefined`, `ensure(tabId): TabState`, `runtime(tabId): TabRuntime`, `tabIds(): number[]`
  - `setRecentApi(tabId, entry: ApiEntry): void` (upsert, move-to-end, cap 500, schedules persist)
  - `setRecentApiBody(tabId, url, body): void` (cap 100, schedules persist)
  - `schedulePersist(tabId): void` (500 ms debounce → `chrome.storage.session.set({ [stateKey(tabId)]: snapshot })`)
  - `flushPersist(tabId): Promise<void>` (cancel timer, write now — used by tests)
  - `dispose(tabId): void` (clears state + runtime, disconnects ports, removes session key)
  - `rehydrate(): Promise<number[]>` (returns tabIds with `enabled === true` needing re-attach)
  - `stateKey(tabId): string` → `` `tabState_${tabId}` ``

- [ ] **Step 1: Write `src/tab-state.ts`**

```ts
/// <reference types="chrome" />
/// <reference path="./shared.ts" />

namespace NetworkOverridesTabState {
  type OverrideRule = NetworkOverridesShared.OverrideRule;
  type ApiEntry = NetworkOverridesShared.ApiEntry;

  export interface TabState {
    enabled: boolean;
    origin: string;
    overrides: OverrideRule[];
    attached: boolean;
    attachError?: string;
    recentApis: Map<string, ApiEntry>;
    recentApiBodies: Map<string, string>;
  }

  // Runtime-only artifacts: never mirrored to storage.
  export interface TabRuntime {
    persistTimer: ReturnType<typeof setTimeout> | null;
    subscriberPorts: Set<chrome.runtime.Port>;
    broadcastQueue: Map<string, ApiEntry>;
    broadcastTimer: ReturnType<typeof setTimeout> | null;
    attachPromise: Promise<void> | null;
  }

  export const RECENT_APIS_LIMIT = 500;
  export const RECENT_API_BODIES_LIMIT = 100;
  export const PERSIST_DEBOUNCE_MS = 500;

  const states = new Map<number, TabState>();
  const runtimes = new Map<number, TabRuntime>();

  export function stateKey(tabId: number): string {
    return `tabState_${tabId}`;
  }

  export function get(tabId: number): TabState | undefined {
    return states.get(tabId);
  }

  export function ensure(tabId: number): TabState {
    let state = states.get(tabId);
    if (!state) {
      state = {
        enabled: false,
        origin: '',
        overrides: [],
        attached: false,
        recentApis: new Map(),
        recentApiBodies: new Map(),
      };
      states.set(tabId, state);
    }
    return state;
  }

  export function runtime(tabId: number): TabRuntime {
    let rt = runtimes.get(tabId);
    if (!rt) {
      rt = {
        persistTimer: null,
        subscriberPorts: new Set(),
        broadcastQueue: new Map(),
        broadcastTimer: null,
        attachPromise: null,
      };
      runtimes.set(tabId, rt);
    }
    return rt;
  }

  export function tabIds(): number[] {
    return Array.from(states.keys());
  }

  function trimToLimit(map: Map<string, unknown>, limit: number): void {
    while (map.size > limit) {
      const oldest = map.keys().next().value;
      if (oldest === undefined) break;
      map.delete(oldest);
    }
  }

  export function setRecentApi(tabId: number, entry: ApiEntry): void {
    const state = ensure(tabId);
    if (state.recentApis.has(entry.url)) {
      state.recentApis.delete(entry.url);
    }
    state.recentApis.set(entry.url, entry);
    trimToLimit(state.recentApis, RECENT_APIS_LIMIT);
    schedulePersist(tabId);
  }

  export function setRecentApiBody(tabId: number, url: string, body: string): void {
    const state = ensure(tabId);
    if (state.recentApiBodies.has(url)) {
      state.recentApiBodies.delete(url);
    }
    state.recentApiBodies.set(url, body);
    trimToLimit(state.recentApiBodies, RECENT_API_BODIES_LIMIT);
    schedulePersist(tabId);
  }

  function serialize(state: TabState): Record<string, unknown> {
    return {
      enabled: state.enabled,
      origin: state.origin,
      overrides: state.overrides,
      attached: state.attached,
      attachError: state.attachError,
      recentApis: Object.fromEntries(state.recentApis.entries()),
      recentApiBodies: Object.fromEntries(state.recentApiBodies.entries()),
    };
  }

  function persistNow(tabId: number): Promise<void> {
    const state = states.get(tabId);
    if (!state) return Promise.resolve();
    return Promise.resolve(
      chrome.storage.session.set({ [stateKey(tabId)]: serialize(state) })
    ).catch(() => {});
  }

  export function schedulePersist(tabId: number): void {
    const rt = runtime(tabId);
    if (rt.persistTimer) clearTimeout(rt.persistTimer);
    rt.persistTimer = setTimeout(() => {
      rt.persistTimer = null;
      void persistNow(tabId);
    }, PERSIST_DEBOUNCE_MS);
  }

  export function flushPersist(tabId: number): Promise<void> {
    const rt = runtime(tabId);
    if (rt.persistTimer) {
      clearTimeout(rt.persistTimer);
      rt.persistTimer = null;
    }
    return persistNow(tabId);
  }

  export function dispose(tabId: number): void {
    const rt = runtimes.get(tabId);
    if (rt) {
      if (rt.persistTimer) clearTimeout(rt.persistTimer);
      if (rt.broadcastTimer) clearTimeout(rt.broadcastTimer);
      rt.subscriberPorts.forEach(port => {
        try {
          port.disconnect();
        } catch {}
      });
      runtimes.delete(tabId);
    }
    states.delete(tabId);
    try {
      void Promise.resolve(chrome.storage.session.remove(stateKey(tabId))).catch(() => {});
    } catch {}
  }

  export async function rehydrate(): Promise<number[]> {
    let all: Record<string, any>;
    try {
      all = await chrome.storage.session.get(null);
    } catch {
      return [];
    }
    const toReattach: number[] = [];
    const deadKeys: string[] = [];
    for (const [key, raw] of Object.entries(all || {})) {
      if (!key.startsWith('tabState_')) continue;
      const tabId = Number(key.slice('tabState_'.length));
      if (Number.isNaN(tabId) || !raw || typeof raw !== 'object') {
        deadKeys.push(key);
        continue;
      }
      // Events may already have rebuilt fresher state before rehydrate ran;
      // never clobber in-memory state with the stored snapshot.
      if (states.has(tabId)) continue;
      let tabExists = false;
      try {
        const tab = await chrome.tabs.get(tabId);
        tabExists = !!tab;
      } catch {
        tabExists = false;
      }
      if (!tabExists) {
        deadKeys.push(key);
        continue;
      }
      const state = ensure(tabId);
      state.enabled = !!raw.enabled;
      state.origin = typeof raw.origin === 'string' ? raw.origin : '';
      state.overrides = Array.isArray(raw.overrides) ? raw.overrides : [];
      // The debugger never survives a worker restart.
      state.attached = false;
      state.attachError = undefined;
      state.recentApis = new Map(Object.entries(raw.recentApis || {}));
      state.recentApiBodies = new Map(Object.entries(raw.recentApiBodies || {}));
      if (state.enabled) toReattach.push(tabId);
    }
    if (deadKeys.length) {
      try {
        await chrome.storage.session.remove(deadKeys);
      } catch {}
    }
    return toReattach;
  }
}
```

- [ ] **Step 2: Extend the test harness**

In `tests/test-harness.mjs`:

(a) In `createBackgroundHarness`, add next to `storageState`:

```js
const sessionState = {};
const existingTabs = new Set([7]);
```

(b) Add to the harness `chrome.storage` object (sibling of `local`):

```js
session: {
  async get(keys) {
    if (keys === null || keys === undefined) return { ...sessionState };
    if (Array.isArray(keys)) {
      return Object.fromEntries(keys.map(key => [key, sessionState[key]]));
    }
    return { [keys]: sessionState[keys] };
  },
  async set(value) {
    Object.assign(sessionState, structuredClone(value));
  },
  async remove(keys) {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      delete sessionState[key];
    }
  },
},
```

(c) Upgrade the harness `storage.local` mock: `get(keys, callback)` returns a promise when `callback` is omitted (same key handling), and add:

```js
async remove(keys) {
  for (const key of Array.isArray(keys) ? keys : [keys]) {
    delete storageState[key];
  }
},
```

(d) Add to the harness `chrome.tabs` object:

```js
async get(tabId) {
  if (!existingTabs.has(tabId)) throw new Error(`No tab with id: ${tabId}`);
  return { id: tabId };
},
```

(e) Load the new file in **both** `createBackgroundContext` and `createBackgroundHarness`, after `shared.js` and before `background.js`:

```js
runDistFile('tab-state.js', context);
```

(f) In `createBackgroundContext`'s chrome mock, add the same promise-based `storage.session` mock (backed by a local `{}`), a `storage.local.remove: async () => {}`, make its `storage.local.get` return `{}` when called without a callback (`get: (keys, cb) => (cb ? cb({}) : Promise.resolve({}))`), add `tabs: { get: async () => ({ id: 0 }), onRemoved: …, onUpdated: { addListener: noop } }`. (The `onUpdated` mock is used by Task 5 but registering listeners must not crash from Task 3 onward.)

(g) Return `sessionState` and `existingTabs` from `createBackgroundHarness` so tests can seed/inspect them.

- [ ] **Step 3: Write the failing tests**

Create `tests/tab-state.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackgroundHarness, normalize } from './test-harness.mjs';

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

  assert.deepEqual(reattach, [8]);
  const state = store.get(8);
  assert.equal(state.enabled, true);
  assert.equal(state.attached, false); // never survives a restart
  assert.equal(state.recentApis.size, 1);
  assert.equal(store.get(999), undefined);
  assert.equal(harness.sessionState['tabState_999'], undefined);
});
```

Note: these tests need `harness.context` — add `context` to `createBackgroundHarness`'s return object while editing the harness in Step 2.

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `dist/tab-state.js` compiles fresh (build step runs first), but `harness.context.NetworkOverridesTabState` fails until Step 2's harness wiring (`runDistFile('tab-state.js', …)`, `context` in the return) is complete. Iterate until the only failures are real assertion failures, then make them pass.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all new tab-state tests plus every pre-existing test).

- [ ] **Step 6: Commit**

```bash
git add src/tab-state.ts tests/tab-state.test.mjs tests/test-harness.mjs
git commit -m "feat: add TabStateStore with session mirror, caps, dispose, and rehydrate"
```

---

### Task 3: Refactor `background.ts` onto the store

Mechanical replacement of the nine per-tab Maps with `TabStateStore`, plus three folded-in fixes: narrow `CAPTURED_BODY_TYPES` to `['xhr', 'fetch']`, chunked base64 encoding, and the `getApis`/`getApiData` storage fallback moving to `storage.session` (legacy string-entry path dropped).

**Files:**

- Modify: `src/background.ts` (most of the file)
- Modify: `tests/background-flow.test.mjs` (update tests that assert the old `recentApis_{tabId}` `storage.local` persistence)

**Interfaces:**

- Consumes: everything `NetworkOverridesTabState` produces (Task 2).
- Produces (relied on by Tasks 4-6): `attachDebugger(tabId)` / `detachDebugger(tabId)` reading/writing `state.attached`; message cases `getApis`/`getApiData` falling back to `chrome.storage.session.get(TabState.stateKey(tabId))`; `recordApi(tabId, entry)` helper = `TabState.setRecentApi` + broadcast scheduling. Message surface unchanged from the UI's perspective.

- [ ] **Step 1: Update existing tests that pin old storage behavior**

In `tests/background-flow.test.mjs`, find tests asserting `storageSets`/`storageState` entries under `recentApis_7` / `recentApiBodies_7` keys (search for `recentApis`). Change them to assert the session mirror instead, e.g. after emitting events:

```js
await harness.context.NetworkOverridesTabState.flushPersist(7);
const snapshot = harness.sessionState['tabState_7'];
assert.ok(snapshot.recentApis[TEST_API_URL]);
```

For the `getApis` cold-fallback test (background restarted, memory empty): seed `harness.sessionState['tabState_7'] = { enabled: false, origin: '', overrides: [], recentApis: { [TEST_API_URL]: { url: TEST_API_URL, type: 'fetch' } }, recentApiBodies: { [TEST_API_URL]: '{"cached":true}' } }` instead of the old `recentApis_7` local key, and assert `getApis` / `getApiData` still answer. If a test covers the legacy string-entry format (`{ [url]: 'fetch' }`), delete it — that path is removed. The fallback response is now async, so capture `sendResponse` results after `await new Promise(r => setTimeout(r, 0))`.

- [ ] **Step 2: Rewrite the state layer of `src/background.ts`**

At the top, change the importScripts line and add the alias:

```ts
importScripts('utils.js', 'tab-state.js');
```

Inside the namespace, delete the nine Map declarations (`attachedTabs`, `overridesMap`, `recentApisMap`, `recentApiBodiesMap`, `currentDomainMap`, `apiSubscriberPorts`, `apiBroadcastQueues`, `apiBroadcastTimers`, `persistTimers`, `bodyPersistTimers`), the constants `RECENT_APIS_LIMIT`/`RECENT_API_BODIES_LIMIT`, and the functions `recApisKey`, `recBodiesKey`, `persistRecentApis`, `cleanupTabData`, and the local `getOrigin`. `urlMatchesDomain` stays until Task 5 — update it to call `NetworkOverridesUtils.getOrigin`, and in the `debugger.onEvent` filter block replace `currentDomainMap.get(tabId) || ''` with `TabState.get(tabId)?.origin ?? ''` so Task 3 still compiles with the filter behavior unchanged. Add:

```ts
import TabState = NetworkOverridesTabState;
```

(TypeScript namespace alias — legal inside a namespace, compiles to `var TabState = NetworkOverridesTabState;`.)

Rewrite the replaced pieces:

```ts
const CAPTURED_BODY_TYPES = ['xhr', 'fetch'];

function recordApi(tabId: number, entry: ApiEntry): void {
  TabState.setRecentApi(tabId, entry);
  scheduleApiBroadcast(tabId, entry);
}

function scheduleApiBroadcast(tabId: number, entry: ApiEntry): void {
  const rt = TabState.runtime(tabId);
  if (rt.subscriberPorts.size === 0) return;
  rt.broadcastQueue.set(entry.url, entry);
  if (rt.broadcastTimer) return;
  rt.broadcastTimer = setTimeout(() => {
    rt.broadcastTimer = null;
    const delta = Array.from(rt.broadcastQueue.values());
    rt.broadcastQueue.clear();
    if (delta.length === 0 || rt.subscriberPorts.size === 0) return;
    rt.subscriberPorts.forEach(port => {
      try {
        port.postMessage({ type: 'apisDelta', apis: delta });
      } catch {}
    });
  }, 150);
}

function storeResponseBody(
  tabId: number,
  url: string,
  requestId: string,
  callback: () => void
): void {
  chrome.debugger.sendCommand(
    { tabId },
    'Fetch.getResponseBody',
    { requestId },
    (response: { body?: string; base64Encoded?: boolean } | undefined) => {
      if (!chrome.runtime.lastError && response && typeof response.body === 'string') {
        const rawBody = normalizeBody(response.body, response.base64Encoded ?? false);
        TabState.setRecentApiBody(tabId, url, rawBody);
      }
      callback();
    }
  );
}
```

Every remaining reference updates mechanically:

- `attachedTabs.has(tabId)` → `!!TabState.get(tabId)?.attached`
- `overridesMap.get(tabId)` → `TabState.get(tabId)` (`info.enabled` / `info.overrides` become `state.enabled` / `state.overrides`)
- the `update` case body becomes:

```ts
const state = TabState.ensure(tabId);
state.enabled = enabled;
state.overrides = overrides;
if (tabUrl) state.origin = NetworkOverridesUtils.getOrigin(tabUrl);
TabState.schedulePersist(tabId);
if (enabled) {
  attachDebugger(tabId).catch(console.error);
} else {
  detachDebugger(tabId).catch(console.error);
}
```

- `setRecentApi(tabId, …)` call sites → `recordApi(tabId, …)`
- port subscribe/unsubscribe: replace `apiSubscriberPorts` bookkeeping with `TabState.runtime(tabId).subscriberPorts.add(port)` / `.delete(port)`
- `attachDebugger`: on successful attach, `TabState.ensure(tabId).attached = true; TabState.schedulePersist(tabId);` instead of `attachedTabs.add`. The enable-commands failure branch: `state.attached = false; chrome.debugger.detach({ tabId }, () => {}); reject(err)` (do NOT dispose — keep captured data).
- `detachDebugger`: guard `if (!TabState.get(tabId)?.attached) return;`; in the detach callback call `TabState.dispose(tabId)` (matches today's cleanupTabData-on-disable behavior) then resolve.
- `tabs.onRemoved` / `debugger.onDetach` listeners: both just call `TabState.dispose(tabId)` (onRemoved already detaches first if attached — keep that).
- `getApis` case:

```ts
case 'getApis': {
  const tabId = Number(msg.tabId);
  if (Number.isNaN(tabId)) return;
  const state = TabState.get(tabId);
  if (state && typeof sendResponse === 'function') {
    sendResponse({ type: 'apisResponse', apis: Array.from(state.recentApis.values()) });
    return true;
  }
  void Promise.resolve(chrome.storage.session.get(TabState.stateKey(tabId))).then((data: any) => {
    const snapshot = data?.[TabState.stateKey(tabId)];
    const apis = snapshot?.recentApis ? Object.values(snapshot.recentApis) : [];
    if (typeof sendResponse === 'function') {
      sendResponse({ type: 'apisResponse', apis });
    }
  });
  return true;
}
```

- `getApiData` case: same shape — in-memory `state.recentApiBodies.get(url)`, else session snapshot `snapshot?.recentApiBodies?.[url] ?? ''`.
- `clearApis` case: `const state = TabState.get(clearTabId); if (state) { state.recentApis.clear(); state.recentApiBodies.clear(); TabState.schedulePersist(clearTabId); }`

Replace `stringToBase64Local`'s byte loop (lines 24-30) with chunked encoding:

```ts
const bytes = new TextEncoder().encode(str);
let binary = '';
const CHUNK = 0x8000;
for (let i = 0; i < bytes.length; i += CHUNK) {
  binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
}
return btoa(binary);
```

(Drop the trailing `Buffer.from(binary, 'latin1')` line and the `btoa` existence check — `btoa` always exists in the worker, and the Node test harness supplies it.)

- [ ] **Step 3: Run tests, iterate until green**

Run: `npm test`
Expected: compile clean; the suite passes with the Step 1 test updates. Any remaining failures are refactor mistakes — fix `background.ts`, not the tests (except where a test pinned removed behavior, e.g. legacy string entries or `script`/`image` body capture — a test asserting `Fetch.getResponseBody` for `resourceType: 'Script'` should now assert it is NOT called).

- [ ] **Step 4: Commit**

```bash
git add src/background.ts tests/background-flow.test.mjs
git commit -m "refactor: move background per-tab state onto TabStateStore"
```

---

### Task 4: Startup rehydrate, re-attach, and legacy-key migration

**Files:**

- Modify: `src/background.ts` (top-level init inside the namespace)
- Modify: `README.md` (storage table: `recentApis_{tabId}`/`recentApiBodies_{tabId}` rows replaced by `tabState_{tabId}` in `chrome.storage.session`)
- Test: `tests/background-flow.test.mjs`

**Interfaces:**

- Consumes: `TabState.rehydrate()`, `attachDebugger(tabId)` (Task 3 semantics: records `state.attached`).
- Produces: `NetworkOverridesBackground.ready: Promise<void>` — resolves when rehydrate + re-attach + migration are done. Tests and Task 6 await it.

- [ ] **Step 1: Write the failing tests**

Add to `tests/background-flow.test.mjs`. These seed state BEFORE the harness boots `background.js`, so `createBackgroundHarness` needs optional params — extend its signature to `createBackgroundHarness({ sessionState: initialSessionState = {}, storageState: initialStorageState = {}, existingTabIds = [7] } = {})`, seeding the internal objects before `runDistFile('background.js', …)`.

```js
test('Background rehydrates from storage.session and re-attaches enabled tabs on startup', async () => {
  const harness = createBackgroundHarness({
    existingTabIds: [7, 8],
    sessionState: {
      tabState_8: {
        enabled: true,
        origin: 'https://b.test',
        overrides: [{ pattern: 'users', body: '{"mocked":true}', mode: 'text' }],
        attached: true,
        recentApis: {},
        recentApiBodies: {},
      },
    },
  });

  await harness.context.NetworkOverridesBackground.ready;

  assert.deepEqual(normalize(harness.attachedTabs), [{ target: { tabId: 8 }, version: '1.3' }]);
  const state = harness.context.NetworkOverridesTabState.get(8);
  assert.equal(state.attached, true);
  assert.deepEqual(normalize(state.overrides), [
    { pattern: 'users', body: '{"mocked":true}', mode: 'text' },
  ]);
});

test('Background startup removes legacy recentApis_* keys from storage.local', async () => {
  const harness = createBackgroundHarness({
    storageState: {
      recentApis_42: { 'https://x.test/a': { url: 'https://x.test/a', type: 'xhr' } },
      recentApiBodies_42: { 'https://x.test/a': '{}' },
      'overrides_https://x.test': [{ pattern: 'keep', body: '', mode: 'text' }],
      enabled: true,
    },
  });

  await harness.context.NetworkOverridesBackground.ready;

  assert.equal(harness.storageState.recentApis_42, undefined);
  assert.equal(harness.storageState.recentApiBodies_42, undefined);
  assert.deepEqual(normalize(harness.storageState['overrides_https://x.test']), [
    { pattern: 'keep', body: '', mode: 'text' },
  ]);
  assert.equal(harness.storageState.enabled, true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `ready` is undefined.

- [ ] **Step 3: Implement startup init in `src/background.ts`**

At the bottom of the `NetworkOverridesBackground` namespace:

```ts
async function migrateLegacyLocalKeys(): Promise<void> {
  try {
    const all: Record<string, unknown> = await Promise.resolve(chrome.storage.local.get(null));
    const legacy = Object.keys(all || {}).filter(
      key => key.startsWith('recentApis_') || key.startsWith('recentApiBodies_')
    );
    if (legacy.length > 0) {
      await Promise.resolve(chrome.storage.local.remove(legacy));
    }
  } catch {
    // Non-fatal: migration retries on the next worker start.
  }
}

export const ready: Promise<void> = (async () => {
  const reattach = await TabState.rehydrate();
  for (const tabId of reattach) {
    try {
      await attachDebugger(tabId);
    } catch (error) {
      console.error('[NetworkOverrides] Re-attach failed for tab', tabId, error);
      const state = TabState.get(tabId);
      if (state) {
        state.enabled = false;
        TabState.schedulePersist(tabId);
      }
    }
  }
  await migrateLegacyLocalKeys();
})();
```

Also update the `createBackgroundContext` mock (from Task 2 step 2f) if the promise-less `storage.local.get(null)` path throws there — `entrypoints.test.mjs` boots that context and top-level `ready` must not reject unhandled.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Update README storage table**

Replace the `recentApis_{tabId}` and `recentApiBodies_{tabId}` rows with one row: `tabState_{tabId}` | per-tab snapshot (rules, origin, captured APIs/bodies) | `chrome.storage.session` — cleared when the browser exits. Note the automatic cleanup of legacy keys.

- [ ] **Step 6: Commit**

```bash
git add src/background.ts tests/background-flow.test.mjs tests/test-harness.mjs README.md
git commit -m "feat: rehydrate tab state and re-attach debugger on worker startup"
```

---

### Task 5: Navigation handling + cross-origin capture removal

**Files:**

- Modify: `src/background.ts` (`tabs.onUpdated` listener; delete `urlMatchesDomain` and its check in `Network.requestWillBeSent`)
- Modify: `tests/test-harness.mjs` (capture `onUpdated` listener, add `navigateTab` helper)
- Test: `tests/background-flow.test.mjs`

**Interfaces:**

- Consumes: `TabState.get/ensure/schedulePersist`, `NetworkOverridesUtils.getOrigin`.
- Produces: harness helper `navigateTab(tabId, url)` → invokes the registered `onUpdated` listener with `(tabId, { url }, { id: tabId, url })`.

- [ ] **Step 1: Harness support**

In `createBackgroundHarness`: register `onUpdated` in `listeners` (`listeners.onUpdated = null`), mock `chrome.tabs.onUpdated.addListener` to store it, and return:

```js
navigateTab(tabId, url) {
  listeners.onUpdated?.(tabId, { url }, { id: tabId, url });
},
```

- [ ] **Step 2: Write the failing tests**

```js
test('Navigating to a new origin loads that origin saved rules and clears captured APIs', async () => {
  const harness = createBackgroundHarness({
    storageState: {
      'overrides_https://new.test': [{ pattern: 'orders', body: '{"new":true}', mode: 'text' }],
    },
  });
  await harness.context.NetworkOverridesBackground.ready;

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: 'https://old.test/',
    enabled: true,
    overrides: [{ pattern: 'users', body: '{"old":true}', mode: 'text' }],
  });
  await Promise.resolve();
  harness.emitDebuggerEvent('Network.requestWillBeSent', {
    request: { url: 'https://old.test/api/users' },
    type: 'Fetch',
  });

  harness.navigateTab(7, 'https://new.test/home');
  await new Promise(resolve => setTimeout(resolve, 0));

  const state = harness.context.NetworkOverridesTabState.get(7);
  assert.equal(state.origin, 'https://new.test');
  assert.deepEqual(normalize(state.overrides), [
    { pattern: 'orders', body: '{"new":true}', mode: 'text' },
  ]);
  assert.equal(state.recentApis.size, 0);
});

test('Same-origin navigation leaves rules and captured APIs untouched', async () => {
  const harness = createBackgroundHarness();
  await harness.context.NetworkOverridesBackground.ready;

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: 'https://old.test/',
    enabled: true,
    overrides: [{ pattern: 'users', body: '{}', mode: 'text' }],
  });
  await Promise.resolve();
  harness.emitDebuggerEvent('Network.requestWillBeSent', {
    request: { url: 'https://old.test/api/users' },
    type: 'Fetch',
  });

  harness.navigateTab(7, 'https://old.test/other-page');
  await new Promise(resolve => setTimeout(resolve, 0));

  const state = harness.context.NetworkOverridesTabState.get(7);
  assert.equal(state.overrides.length, 1);
  assert.equal(state.recentApis.size, 1);
});

test('Cross-origin requests are captured', async () => {
  const harness = createBackgroundHarness();
  await harness.context.NetworkOverridesBackground.ready;

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: 'https://app.test/',
    enabled: true,
    overrides: [],
  });
  await Promise.resolve();

  harness.emitDebuggerEvent('Network.requestWillBeSent', {
    request: { url: 'https://api.other.test/v1/users' },
    type: 'Fetch',
  });

  const { response } = harness.callMessage({ type: 'getApis', tabId: 7 });
  assert.deepEqual(normalize(response.apis.map(api => api.url)), [
    'https://api.other.test/v1/users',
  ]);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — no `onUpdated` listener registered; cross-origin request filtered out.

- [ ] **Step 4: Implement**

In `src/background.ts`, delete `urlMatchesDomain` and this block in the `debugger.onEvent` listener (as rewritten in Task 3):

```ts
const requestUrl = params?.request?.url || params?.response?.url || '';
const tabDomain = TabState.get(tabId)?.origin ?? '';
if (requestUrl && !urlMatchesDomain(requestUrl, tabDomain)) return;
```

Add next to the other listeners:

```ts
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (typeof changeInfo.url !== 'string') return;
  const state = TabState.get(tabId);
  if (!state) return;
  const newOrigin = NetworkOverridesUtils.getOrigin(changeInfo.url);
  if (!newOrigin || newOrigin === state.origin) return;

  state.origin = newOrigin;
  state.recentApis.clear();
  state.recentApiBodies.clear();
  const overridesKey = `overrides_${newOrigin}`;
  chrome.storage.local.get([overridesKey], (data: any) => {
    const saved = data?.[overridesKey];
    state.overrides = Array.isArray(saved) ? saved : [];
    TabState.schedulePersist(tabId);
  });
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/background.ts tests/background-flow.test.mjs tests/test-harness.mjs
git commit -m "feat: follow tab navigation across origins and capture cross-origin requests"
```

---

### Task 6: Attach status + double-attach race (background side)

**Files:**

- Modify: `src/background.ts` (`attachDebugger`, `detachDebugger`, `broadcastStatus`, new `getStatus` message case)
- Test: `tests/background-flow.test.mjs`

**Interfaces:**

- Consumes: `TabState.runtime(tabId).attachPromise`, `subscriberPorts`.
- Produces (Task 7's UI contract):
  - Port push: `{ type: 'status', tabId: number, attached: boolean, error?: string }` on every attach-state change.
  - Message: `{ type: 'getStatus', tabId }` → `sendResponse({ type: 'statusResponse', attached: boolean, error?: string })`.

- [ ] **Step 1: Write the failing tests**

The harness's `chrome.debugger.attach` always succeeds; make failure injectable — add to `createBackgroundHarness` a mutable `let attachError = null;` used as `if (attachError) { chrome.runtime.lastError = { message: attachError }; callback?.(); chrome.runtime.lastError = null; return; }` inside the attach mock (set/restore `lastError` around the callback), and expose `setAttachError(message)`.

```js
test('getStatus reports attach success and failure', async () => {
  const harness = createBackgroundHarness();
  await harness.context.NetworkOverridesBackground.ready;

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: 'https://a.test/',
    enabled: true,
    overrides: [],
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  let { response } = harness.callMessage({ type: 'getStatus', tabId: 7 });
  assert.deepEqual(normalize(response), { type: 'statusResponse', attached: true });

  const failing = createBackgroundHarness();
  await failing.context.NetworkOverridesBackground.ready;
  failing.setAttachError('Another debugger is already attached');
  failing.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: 'https://a.test/',
    enabled: true,
    overrides: [],
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  ({ response } = failing.callMessage({ type: 'getStatus', tabId: 7 }));
  assert.deepEqual(normalize(response), {
    type: 'statusResponse',
    attached: false,
    error: 'Another debugger is already attached',
  });
  assert.equal(failing.context.NetworkOverridesTabState.get(7).enabled, false);
});

test('Concurrent update messages attach the debugger exactly once', async () => {
  const harness = createBackgroundHarness();
  await harness.context.NetworkOverridesBackground.ready;

  const msg = { type: 'update', tabId: 7, tabUrl: 'https://a.test/', enabled: true, overrides: [] };
  harness.callMessage(msg);
  harness.callMessage(msg);
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(harness.attachedTabs.length, 1);
});
```

Note: the concurrent test may already pass if the harness attach callback is synchronous — make the harness attach callback asynchronous (`setTimeout(() => callback?.(), 0)`) so the race window is real. Check existing tests still pass with the async callback (they `await Promise.resolve()` after updates — bump those to `await new Promise(r => setTimeout(r, 0))` where needed).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `getStatus` falls through to the default case; concurrent test sees 2 attaches.

- [ ] **Step 3: Implement**

Add `'getStatus'` to the `Msg` union: `| { type: 'getStatus'; tabId: number }`. New case in the message listener:

```ts
case 'getStatus': {
  const tabId = Number(msg.tabId);
  if (Number.isNaN(tabId)) return;
  const state = TabState.get(tabId);
  if (typeof sendResponse === 'function') {
    const payload: { type: string; attached: boolean; error?: string } = {
      type: 'statusResponse',
      attached: !!state?.attached,
    };
    if (state?.attachError) payload.error = state.attachError;
    sendResponse(payload);
  }
  return;
}
```

Add the broadcaster:

```ts
function broadcastStatus(tabId: number): void {
  const state = TabState.get(tabId);
  if (!state) return;
  const payload: { type: string; tabId: number; attached: boolean; error?: string } = {
    type: 'status',
    tabId,
    attached: state.attached,
  };
  if (state.attachError) payload.error = state.attachError;
  TabState.runtime(tabId).subscriberPorts.forEach(port => {
    try {
      port.postMessage(payload);
    } catch {}
  });
}
```

Rewrite `attachDebugger` with the in-flight promise and status recording:

```ts
function attachDebugger(tabId: number): Promise<void> {
  const state = TabState.ensure(tabId);
  const rt = TabState.runtime(tabId);
  if (state.attached) return Promise.resolve();
  if (rt.attachPromise) return rt.attachPromise;

  const attempt = new Promise<void>((resolve, reject) => {
    try {
      chrome.debugger.attach({ tabId }, '1.3', async () => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        try {
          await sendDebugCommand(tabId, 'Network.enable', {});
          await sendDebugCommand(tabId, 'Fetch.enable', {
            patterns: [{ requestStage: 'Request' }, { requestStage: 'Response' }],
          });
          resolve();
        } catch (err) {
          chrome.debugger.detach({ tabId }, () => {});
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  })
    .then(() => {
      state.attached = true;
      state.attachError = undefined;
      TabState.schedulePersist(tabId);
      broadcastStatus(tabId);
    })
    .catch(error => {
      state.attached = false;
      state.attachError = error instanceof Error ? error.message : String(error);
      state.enabled = false;
      TabState.schedulePersist(tabId);
      broadcastStatus(tabId);
      throw error;
    })
    .finally(() => {
      rt.attachPromise = null;
    });

  rt.attachPromise = attempt;
  return attempt;
}
```

In `detachDebugger`'s detach callback, before `TabState.dispose(tabId)` runs there is nothing to broadcast (dispose disconnects the ports anyway) — leave as Task 3 wrote it. Task 4's re-attach catch block already flips `enabled` — with this rewrite that's now handled inside `attachDebugger`'s catch; simplify Task 4's loop body to `await attachDebugger(tabId).catch(() => {})`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/background.ts tests/background-flow.test.mjs tests/test-harness.mjs
git commit -m "feat: record and report debugger attach status, dedupe concurrent attaches"
```

---

### Task 7: UI attach-status line

**Files:**

- Modify: `popup.html:16-22` and `panel.html` (inside `.switch-container`), `styles.css`
- Modify: `src/ui.ts` (`Elements`, `getElements`, port `onMessage`, init flow, enable-toggle handler)
- Modify: `tests/test-harness.mjs` (`buildUiHtml` + expose the UI port for pushing messages)
- Test: `tests/ui-behavior.test.mjs`

**Interfaces:**

- Consumes: Task 6's port push `{ type: 'status', tabId, attached, error? }` and `getStatus`/`statusResponse` message pair.
- Produces: harness helper `emitPortMessage(msg)` — delivers a message to the UI's connected port listeners.

- [ ] **Step 1: HTML + CSS**

In `popup.html` (and the equivalent block in `panel.html`), inside the `.switch-container` div after the switch label:

```html
<span id="attach-status" class="attach-status" style="display: none"></span>
```

In `styles.css`, append:

```css
.attach-status {
  font-size: 11px;
  margin-left: 8px;
}
.attach-status--on {
  color: #2e7d32;
}
.attach-status--error {
  color: #c62828;
}
```

In `tests/test-harness.mjs` `buildUiHtml()`, add `<span id="attach-status" style="display:none"></span>` after the `#enable` input.

- [ ] **Step 2: Harness port exposure**

In `createUiHarness`'s `chrome.runtime.connect` mock, keep a reference to each created port's `listeners` set outside the function (`const uiPorts = [];` then push `{ listeners }` per connect) and return from the harness:

```js
emitPortMessage(msg) {
  uiPorts.forEach(({ listeners }) => listeners.forEach(fn => fn(structuredClone(msg))));
},
```

- [ ] **Step 3: Write the failing tests**

Add to `tests/ui-behavior.test.mjs`:

```js
test('UI shows attach status and unchecks the toggle on attach failure', async () => {
  const harness = createUiHarness({ storageState: { enabled: true } });
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
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — no status element handling, no `getStatus` message.

- [ ] **Step 5: Implement in `src/ui.ts`**

Add to `Elements`: `attachStatus: HTMLElement;` and in `getElements()`: `attachStatus: document.getElementById('attach-status') as HTMLElement,`.

Inside `init` add:

```ts
function renderAttachStatus(attached: boolean, error?: string): void {
  const el = elements.attachStatus;
  if (!el) return;
  el.classList.remove('attach-status--on', 'attach-status--error');
  if (error) {
    el.classList.add('attach-status--error');
    el.textContent = `Attach failed: ${error}`;
    el.style.display = '';
  } else if (attached) {
    el.classList.add('attach-status--on');
    el.textContent = 'Intercepting requests';
    el.style.display = '';
  } else {
    el.textContent = '';
    el.style.display = 'none';
  }
}

async function refreshAttachStatus(): Promise<void> {
  const tab = await getActiveTab();
  if (typeof tab?.id !== 'number') return;
  const response = await new Promise<any>(resolve => {
    chrome.runtime.sendMessage({ type: 'getStatus', tabId: tab.id }, resolve);
  });
  if (response?.type === 'statusResponse') {
    renderAttachStatus(!!response.attached, response.error);
  }
}
```

In `startApiStream`'s `port.onMessage` listener, add before the existing branches:

```ts
if (msg.type === 'status') {
  renderAttachStatus(!!msg.attached, msg.error);
  if (msg.error) {
    elements.enableCheckbox.checked = false;
    void chrome.storage.local.set({ enabled: false });
  }
  return;
}
```

In the init IIFE, after `await notifyBackground();` add `await refreshAttachStatus();`. In the `enableCheckbox` change handler, after `await notifyBackground();` add `await refreshAttachStatus();` (the port broadcast will correct it moments later if attach is still in flight).

The UI-harness `sendMessage` mock must answer `getStatus` — in `tests/test-harness.mjs` add before the fallback:

```js
if (message.type === 'getStatus') {
  callback?.({ type: 'statusResponse', attached: false });
  return;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ui.ts popup.html panel.html styles.css tests/ui-behavior.test.mjs tests/test-harness.mjs
git commit -m "feat: surface debugger attach status in the popup and panel"
```

---

### Task 8: Import validation hardening

**Files:**

- Modify: `src/ui.ts:871-902` (`isValidRule` + the clean-copy mapper)
- Test: `tests/ui-behavior.test.mjs`

**Interfaces:**

- Consumes: `KNOWN_METHODS` (module-level const in `ui.ts`).
- Produces: no new API — stricter validation of imported JSON.

- [ ] **Step 1: Write the failing tests**

The existing import tests (search `import-rules-input` in `tests/ui-behavior.test.mjs`) drive a fake file through the input. If the file already defines an equivalent helper, reuse it; otherwise add this one near the top of the file:

```js
async function importRulesFile(harness, payload) {
  const input = harness.document.getElementById('import-rules-input');
  const file = { text: async () => JSON.stringify(payload) };
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new harness.window.Event('change'));
  await flushUi(harness.window);
}
```

```js
test('Import rejects rules with an unknown mode or method', async () => {
  const harness = createUiHarness();
  await flushUi(harness.window);

  const badMode = {
    version: 1,
    domain: 'https://example.test',
    overrides: [{ pattern: 'x', mode: 'yaml', body: '' }],
  };
  await importRulesFile(harness, badMode); // reuse/extract the existing helper pattern in this file
  assert.equal(harness.alerts.length, 1);
  assert.match(harness.alerts[0], /invalid/i);

  const badMethod = {
    version: 1,
    domain: 'https://example.test',
    overrides: [{ pattern: 'x', mode: 'text', body: '', method: 'TRACE' }],
  };
  await importRulesFile(harness, badMethod);
  assert.equal(harness.alerts.length, 2);
});

test('Import normalizes method casing to uppercase', async () => {
  const harness = createUiHarness();
  await flushUi(harness.window);

  await importRulesFile(harness, {
    version: 1,
    domain: 'https://example.test',
    overrides: [{ pattern: 'x', mode: 'text', body: '', method: 'get' }],
  });
  const saved = harness.storageSets.findLast(set => 'overrides_https://example.test' in set);
  assert.equal(saved['overrides_https://example.test'][0].method, 'GET');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `mode: 'yaml'` and `method: 'TRACE'` are currently accepted; `'get'` is stored lowercase.

- [ ] **Step 3: Implement**

In `src/ui.ts`, replace the two relevant lines of `isValidRule`:

```ts
const isValidRule = (rule: any): boolean =>
  !!rule &&
  typeof rule.pattern === 'string' &&
  (rule.mode === 'text' || rule.mode === 'file') &&
  (rule.method === undefined ||
    (typeof rule.method === 'string' && KNOWN_METHODS.includes(rule.method.toUpperCase()))) &&
  (rule.body === undefined || typeof rule.body === 'string') &&
  (rule.redirectUrl === undefined || typeof rule.redirectUrl === 'string') &&
  (rule.enabled === undefined || typeof rule.enabled === 'boolean');
```

Update the alert copy: `'Invalid file: a rule has a missing/invalid "pattern", "mode", "method", or field type.'`

In the clean-copy mapper, change the method line to `if (rule.method !== undefined) clean.method = rule.method.toUpperCase();`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui.ts tests/ui-behavior.test.mjs
git commit -m "fix: validate mode and method values on rule import"
```

---

### Task 9: Final verification

**Files:**

- Modify (if needed): anything the checks below flag.

- [ ] **Step 1: Full suite + lint + coverage**

Run: `npm test && npm run lint && npm run coverage`
Expected: all tests pass, lint clean, coverage report generated without errors. Skim the coverage summary for `tab-state.ts` — new module should not be an outlier (>80% lines).

- [ ] **Step 2: Cross-check against the spec**

Walk `docs/superpowers/specs/2026-07-09-phase1-reliability-design.md` section by section and confirm each landed: TabStateStore + session mirror + dispose + rehydrate (Task 2-4), migration (Task 4), navigation (Task 5), cross-origin removal (Task 5), attach status both sides (Tasks 6-7), all six small fixes (Tasks 1, 3, 6, 8). Fix any gap found.

- [ ] **Step 3: Manual smoke test note**

Automated coverage cannot exercise a real debugger. Tell the user the recommended manual check: load the unpacked extension, enable overrides on a page, wait >30s idle, confirm interception still works (worker restarted + re-attached); navigate across origins and watch rules switch; open DevTools on the same tab to force an attach failure and confirm the red status line + toggle unchecks.

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "fix: address phase 1 verification findings"
```

(Skip the commit if Step 1-2 found nothing.)
