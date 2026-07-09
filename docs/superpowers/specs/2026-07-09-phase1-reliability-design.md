# Phase 1: Background reliability — Design

Date: 2026-07-09
Status: Approved by user, pending implementation plan

## Summary

First phase of a five-phase improvement roadmap. This phase fixes the reliability class of bugs in the background service worker, all rooted in the same cause: per-tab state lives only in in-memory Maps scattered across `background.ts`, with manual, incomplete cleanup.

1. **State loss on service-worker restart** — MV3 kills the worker after ~30s idle; all override rules and attachment state vanish, and overrides silently stop working until the UI is reopened.
2. **Storage leak** — `cleanupTabData` never removes the persisted `recentApis_{tabId}` / `recentApiBodies_{tabId}` keys from `chrome.storage.local`; they accumulate forever toward the 10 MB quota, and recycled tab ids can read stale data.
3. **Stale state on navigation** — no `tabs.onUpdated` listener, so navigating an attached tab to a different origin keeps applying the old origin's rules.
4. **Cross-origin capture gap** — the `Network.requestWillBeSent` path drops any request whose origin differs from the tab's, so SPAs calling `api.foo.com` from `app.foo.com` never show those calls in the popup.
5. **Silent attach failures** — `chrome.debugger.attach` errors (e.g. "Another debugger is already attached") only reach `console.error`; the UI checkbox stays checked while nothing is intercepted.

Plus six small bug fixes listed at the end.

Out of scope for this phase (later phases): regex caching, incremental rendering, in-page dialogs replacing `alert`/`confirm`, badge, status-code/header overrides, delay/fail mocking, GraphQL matching, JSON patch, profiles, ES-module build modernization.

## Decisions made with the user

- **Cross-origin capture**: remove the origin filter entirely; capture every request the tab makes (consistent with the `Fetch.requestPaused` path, which already captures everything when enabled).
- **Navigation**: on origin change, the background auto-loads the new origin's saved rules from `storage.local` and keeps overriding — no UI visit required.
- **SW restart**: full recovery — persist per-tab state in `chrome.storage.session`, rehydrate on worker startup, and automatically re-attach the debugger to tabs that were enabled.
- **Architecture**: extract a `TabStateStore` module that owns all per-tab state, rather than patching the nine existing Maps individually.

## Architecture: `TabStateStore` (`src/tab-state.ts`)

New namespace `NetworkOverridesTabState` (same triple-slash/namespace style as the rest of the codebase; loaded in the worker via the existing `importScripts` wiring). It owns all per-tab state:

```ts
interface TabState {
  enabled: boolean;
  origin: string;
  overrides: OverrideRule[];
  attached: boolean;
  attachError?: string; // last attach failure message, for the UI
  recentApis: Map<string, ApiEntry>; // insertion-ordered, capped at 500
  recentApiBodies: Map<string, string>; // capped at 100
}
```

Non-serializable runtime artifacts (persist timers, broadcast queues/timers, subscriber ports, in-flight attach promises) also move under the store, keyed by tabId, but are **not** mirrored to storage.

### Persistence (write-through mirror)

- Every mutation schedules a debounced (500 ms, per tab — same cadence as today's persist timers) write of the serializable fields to `chrome.storage.session` under key `tabState_{tabId}`. Maps serialize as plain objects (insertion order preserved).
- `recentApis`/`recentApiBodies` move from `storage.local` to `storage.session`: they are per-session data by nature, and session storage self-clears on browser exit, which also fixes the leak for future data.
- The `getApis`/`getApiData` message handlers' storage fallback reads `storage.session` instead of `storage.local`. The legacy string-entry compatibility path in `getApis` is dropped along with the `storage.local` keys it existed for.

### `dispose(tabId)`

Single cleanup entry point: clears the in-memory state, cancels timers, disconnects subscriber ports, and removes `tabState_{tabId}` from `storage.session`. Called from `tabs.onRemoved` and `debugger.onDetach` (replacing today's `cleanupTabData`).

### `rehydrate()`

Runs at worker top level (executes on every SW start, including restarts after idle-kill):

1. Read all `tabState_*` keys from `storage.session`.
2. For each, `chrome.tabs.get(tabId)` — if the tab no longer exists, delete the key.
3. Rebuild the in-memory state for surviving tabs.
4. For tabs with `enabled === true`, re-attach the debugger (`attachDebugger`). On failure, record `attachError` and set `enabled = false` in the store (the UI will reflect it via the status flow below).

### One-time migration

On worker startup, scan `storage.local` for keys matching `recentApis_*` / `recentApiBodies_*` and remove them (garbage accumulated by all prior versions). Runs after rehydrate; failure is non-fatal.

## Navigation handling (`tabs.onUpdated`)

Listener on `changeInfo.url`:

- Compute the new origin. If unchanged, do nothing.
- On origin change for a tab present in the store:
  - Update `origin` in the store.
  - Read `overrides_{newOrigin}` from `storage.local` (missing key → `[]`) and replace the tab's `overrides`.
  - Clear `recentApis` / `recentApiBodies` for that tab (old page's data is meaningless).
  - Keep the debugger attached; the enable flag is unchanged.

The UI's `update` message continues to work as today and remains the authoritative path when the UI is open.

## Attach status surfaced to the UI

- `attachDebugger` failures store `attachError` and set `attached = false`; successes clear it.
- Background pushes `{ type: 'status', tabId, attached, error? }` over the existing `network-overrides-ui` port whenever attach state changes, and answers a new `getStatus` runtime message (`{ type: 'getStatus', tabId }` → `{ type: 'statusResponse', attached, error? }`) so the UI can query on open.
- UI (`ui.ts` + both HTML pages): a small status line next to the Enable checkbox — green "Intercepting requests" when attached, red "Attach failed: {reason}" on error. On attach failure the checkbox unchecks itself and `enabled` is persisted back to `false`.
- Clarification on the two `enabled` flags: the global `storage.local` key `enabled` remains the UI-level toggle (unchanged from today); the store's per-tab `enabled` records whether interception is meant to be active for that specific tab. An attach failure flips only the per-tab flag; the global key is only written when the UI observes the failure and unchecks the box.

## Cross-origin capture

Delete `urlMatchesDomain` and the origin check in the `Network.requestWillBeSent` handler. `currentDomainMap` is replaced by the store's `origin` field (still needed for rule-set keying, not for filtering).

## Small bug fixes

| #   | Bug                                                                                                                                                     | Fix                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `substituteWildcards` re-replaces `*` inside already-substituted captures                                                                               | Build the result with `template.split('*')` joined by captures; leftover slots keep `*` (preserving the existing "unsubstituted `*`" guard in `handleRequestPaused`)                                    |
| 2   | Glob `*` compiles to `(.+)`, so `api/*` never matches `api/`                                                                                            | Change to `(.*)` in `matchPattern` and `isValidPattern`. Behavior change documented in README's pattern reference                                                                                       |
| 3   | `CAPTURED_BODY_TYPES` includes `script` and `image`; image bytes decoded as UTF-8 are garbage and waste quota                                           | Narrow to `['xhr', 'fetch']`                                                                                                                                                                            |
| 4   | Import accepts any string for `mode`/`method`                                                                                                           | `mode` must be `'text'` or `'file'`; `method`, when present, must be in `KNOWN_METHODS` after uppercasing (normalize to uppercase on import)                                                            |
| 5   | Two rapid `update` messages race `attachDebugger` into a double attach                                                                                  | Keep the in-flight attach promise per tab in the store; concurrent callers await the same promise                                                                                                       |
| 6   | `stringToBase64Local` builds the binary string one byte at a time (O(n²)) and its final fallback line crashes when both `Buffer` and `btoa` are missing | Encode via `String.fromCharCode.apply` over fixed-size chunks; drop the dead trailing `Buffer` fallback (`btoa` always exists in the worker; the `Buffer` branch exists only for the Node test harness) |

## Testing

Extend the existing `node --test` suites and chrome-mock harness (`tests/test-harness.mjs`):

- **TabStateStore unit tests**: mutation → debounced mirror to mocked `storage.session`; `dispose` removes both RAM and storage entries; `rehydrate` rebuilds state, drops entries for dead tabs, and re-attaches enabled tabs (including the failure path recording `attachError`).
- **Background flow**: `tabs.onUpdated` origin change loads the new origin's rules and clears captured APIs; cross-origin requests now appear in `getApis`; startup migration removes legacy `recentApis_*`/`recentApiBodies_*` local keys; double-`update` messages attach exactly once.
- **UI behavior**: status line renders attached/error states; checkbox unchecks on attach failure; import rejects bad `mode`/`method` values.
- **Utils**: `substituteWildcards` with captures containing `*`; empty-segment matches under `(.*)`.

The chrome mock needs a `storage.session` implementation (same shape as the existing `storage.local` mock).
