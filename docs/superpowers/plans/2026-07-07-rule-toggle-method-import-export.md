# Per-rule toggle, method matching, and import/export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-rule enable/disable, HTTP-method-scoped matching, and JSON import/export to the existing override-rule system in this Chrome extension.

**Architecture:** Extend the existing `OverrideRule` schema with two optional fields (`enabled`, `method`), add one shared matching helper in `utils.ts` consumed by both `background.ts` (service worker, via the existing `importScripts` wiring) and `ui.ts` (devtools panel / popup, via the existing `NetworkOverridesUtils` namespace delegation), then layer UI for toggling, method selection, and file-based import/export on top.

**Tech Stack:** TypeScript (compiled via `tsc` to `dist/`), vanilla DOM (no framework), `node:test` + `jsdom` + `node:vm` for tests (see `tests/test-harness.mjs`).

## Global Constraints

- `OverrideRule.enabled` is optional; `undefined` or `true` means enabled, only `false` means disabled. No migration step for existing stored rules.
- `OverrideRule.method` is optional; `undefined` or `'ANY'` means it matches every HTTP method. Only method matching is in scope — no status-code matching (explicitly out of scope per spec).
- Import/Export operates on the **currently active domain only** — never all domains at once.
- Import merge-vs-replace choice uses the native `confirm()` dialog: `OK` (`true`) = merge/append, `Cancel` (`false`) = replace. There is no third "abort" choice once a valid file is selected.
- Export file JSON shape: `{ "version": 1, "domain": string, "exportedAt": ISO-8601 string, "overrides": OverrideRule[] }`.
- Every task must leave `npm run build`, `npm run lint`, and `npm run test` passing before moving to the next task.
- Spec reference: `docs/superpowers/specs/2026-07-07-rule-toggle-method-import-export-design.md`.

---

### Task 1: Data model + shared `matchesMethod` helper

**Files:**

- Modify: `src/shared.ts`
- Modify: `src/utils.ts`
- Test: `tests/helpers.test.mjs`

**Interfaces:**

- Produces: `NetworkOverridesShared.OverrideRule.enabled?: boolean`, `NetworkOverridesShared.OverrideRule.method?: string`; `NetworkOverridesUtils.matchesMethod(ruleMethod: string | undefined, requestMethod: string | undefined): boolean`.

- [ ] **Step 1: Write the failing test**

Add to `tests/helpers.test.mjs` (append at the end of the file, after the last existing `test(...)` block):

```js
test('matchesMethod matches ANY/undefined and is case-insensitive', () => {
  const { NetworkOverridesUtils } = createUiContext();

  assert.equal(NetworkOverridesUtils.matchesMethod(undefined, 'GET'), true);
  assert.equal(NetworkOverridesUtils.matchesMethod('ANY', 'POST'), true);
  assert.equal(NetworkOverridesUtils.matchesMethod('get', 'GET'), true);
  assert.equal(NetworkOverridesUtils.matchesMethod('GET', 'get'), true);
  assert.equal(NetworkOverridesUtils.matchesMethod('POST', 'GET'), false);
  assert.equal(NetworkOverridesUtils.matchesMethod('POST', undefined), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test tests/helpers.test.mjs`
Expected: FAIL — `TypeError: NetworkOverridesUtils.matchesMethod is not a function`

- [ ] **Step 3: Implement the schema change and helper**

In `src/shared.ts`, change the `OverrideRule` interface (currently lines 5-10) to:

```ts
interface OverrideRule {
  pattern: string;
  body: string;
  mode: OverrideMode;
  redirectUrl?: string;
  enabled?: boolean; // undefined/true = enabled, false = disabled
  method?: string; // undefined/'ANY' = any method, or 'GET'|'POST'|'PUT'|'PATCH'|'DELETE'
}
```

In `src/utils.ts`, add this function inside the `namespace NetworkOverridesUtils { ... }` block, after `export function getOrigin` (currently the last function, ending at line 61):

```ts
export function matchesMethod(
  ruleMethod: string | undefined,
  requestMethod: string | undefined
): boolean {
  if (!ruleMethod || ruleMethod.toUpperCase() === 'ANY') return true;
  if (!requestMethod) return false;
  return ruleMethod.toUpperCase() === requestMethod.toUpperCase();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test tests/helpers.test.mjs`
Expected: PASS (all tests in the file, including the new one)

- [ ] **Step 5: Run the full suite and lint**

Run: `npm run lint && npm run test`
Expected: `npm run lint` exits 0 (warnings about namespace names being "unused" are pre-existing and expected — see `eslint.config.mjs` comment); all tests in `npm run test` PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared.ts src/utils.ts tests/helpers.test.mjs
git commit -m "feat: add enabled/method fields to OverrideRule and matchesMethod helper"
```

---

### Task 2: Background enforcement — `findOverride` respects `enabled` and `method`

**Files:**

- Modify: `src/background.ts:522-533` (`findOverride`), `src/background.ts:571` and `src/background.ts:615` (call sites)
- Test: `tests/background-flow.test.mjs`

**Interfaces:**

- Consumes: `NetworkOverridesUtils.matchesMethod` (Task 1).
- Produces: `findOverride(url: string, method: string | undefined, overrides: OverrideRule[]): { override: OverrideRule; captures: string[] } | null` (signature change — one new required parameter in the middle).

- [ ] **Step 1: Write the failing test**

Add to `tests/background-flow.test.mjs` (append at the end of the file):

```js
test('Background skips disabled rules and method-mismatched rules, falling through to the next match', async () => {
  const harness = createBackgroundHarness();

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [
      { pattern: '/users$/', body: '{"disabled":true}', mode: 'text', enabled: false },
      { pattern: '/users$/', body: '{"wrongMethod":true}', mode: 'text', method: 'POST' },
      { pattern: '/users$/', body: '{"matched":true}', mode: 'text', method: 'GET' },
    ],
  });
  await Promise.resolve();

  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-method',
    request: { url: TEST_API_URL, method: 'GET' },
    responseStatusCode: 200,
    resourceType: 'Fetch',
  });

  const fulfill = harness.commandLog.find(
    ({ method, params }) => method === 'Fetch.fulfillRequest' && params.requestId === 'req-method'
  );
  assert.ok(fulfill);
  assert.equal(Buffer.from(fulfill.params.body, 'base64').toString('utf8'), '{"matched":true}');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test tests/background-flow.test.mjs`
Expected: FAIL — the first (disabled) rule currently wins the match, so `fulfill.params.body` decodes to `{"disabled":true}`, not `{"matched":true}`.

- [ ] **Step 3: Implement**

In `src/background.ts`, replace the `findOverride` function (currently lines 522-533):

```ts
function findOverride(
  url: string,
  method: string | undefined,
  overrides: OverrideRule[]
): { override: OverrideRule; captures: string[] } | null {
  for (const test of overrides) {
    if (test.enabled === false) continue;
    if (!NetworkOverridesUtils.matchesMethod(test.method, method)) continue;
    const captures = matchPattern(test.pattern, url);
    if (captures !== null) {
      return { override: test, captures };
    }
  }
  return null;
}
```

Then update both call sites. At line 571 (inside `handleRequestPaused`, request stage):

```ts
const match = findOverride(url, params.request?.method, info.overrides);
```

(replacing `const match = findOverride(url, info.overrides);`)

At line 615 (inside `handleRequestPaused`, response stage):

```ts
const match = findOverride(url, params.request?.method, info.overrides);
```

(replacing `const match = findOverride(url, info.overrides);`)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test tests/background-flow.test.mjs`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Run the full suite and lint**

Run: `npm run lint && npm run test`
Expected: both pass with no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/background.ts tests/background-flow.test.mjs
git commit -m "feat: findOverride skips disabled rules and method-mismatched rules"
```

---

### Task 3: UI — `wouldApply` split for tab classification + dim API items matched by a disabled rule

**Files:**

- Modify: `src/ui.ts` (add `wouldApply`; update `renderApis`, `updateTabLabels`, `renderApiSection`)
- Modify: `styles.css` (add `.api-item--rule-disabled`)
- Test: `tests/ui-behavior.test.mjs`

**Interfaces:**

- Consumes: `NetworkOverridesUtils.matchesMethod` (Task 1), existing `patternMatches` (unchanged).
- Produces: namespace-level `wouldApply(override: OverrideRule, api: ApiEntry): boolean` in `ui.ts`, usable by later tasks.

- [ ] **Step 1: Write the failing test**

Add to `tests/ui-behavior.test.mjs` (append at the end of the file):

```js
test('A disabled rule still counts an API as Overridden but dims it; a method-mismatched rule does not count it at all', async () => {
  const harness = createUiHarness({
    storageState: {
      enabled: true,
      overrides: [
        { pattern: 'users', body: '{}', mode: 'text', enabled: false },
        { pattern: 'orders', body: '{}', mode: 'text', method: 'POST' },
      ],
    },
    apis: [
      { url: `${TEST_DOMAIN}/api/users`, type: 'fetch', method: 'GET' },
      { url: `${TEST_DOMAIN}/api/orders`, type: 'fetch', method: 'GET' },
    ],
  });

  await flushUi(harness.window);

  harness.document
    .querySelector('[data-tab="overridden"]')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  const overriddenItems = harness.document.querySelectorAll('.api-item');
  assert.equal(overriddenItems.length, 1);
  assert.equal(overriddenItems[0].classList.contains('api-item--rule-disabled'), true);

  harness.document
    .querySelector('[data-tab="other"]')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  assert.equal(harness.document.querySelectorAll('.api-item').length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test tests/ui-behavior.test.mjs`
Expected: FAIL — today, `patternMatches` alone decides "Overridden", so the method-mismatched `orders` rule still counts `orders` as Overridden (both APIs end up in the Overridden tab, or the dimmed class doesn't exist at all).

- [ ] **Step 3: Implement**

In `src/ui.ts`, add a new namespace-level function right after the `patternMatches` export (currently lines 51-53):

```ts
function wouldApply(override: OverrideRule, api: ApiEntry): boolean {
  return (
    NetworkOverridesUtils.matchesMethod(override.method, api.method) &&
    patternMatches(override.pattern, api.url)
  );
}
```

In `renderApis()` (currently lines 352-381), replace the `overriddenApis`/`otherApis` computation:

```ts
const overriddenApis = visibleApis.filter(api =>
  state.overrides.some(override => wouldApply(override, api))
);
const otherApis = visibleApis.filter(
  api => !state.overrides.some(override => wouldApply(override, api))
);
```

(replacing the two `state.overrides.some(override => patternMatches(override.pattern, api.url))` lines)

In `updateTabLabels()` (currently lines 402-414), replace the `overriddenCount` computation:

```ts
const overriddenCount = state.apis.filter(api =>
  state.overrides.some(override => wouldApply(override, api))
).length;
```

In `renderApiSection()` (currently lines 416-483), replace this block:

```ts
const isOverridden = state.overrides.some(override => patternMatches(override.pattern, api.url));
const isSelected = state.selectedApi ? patternMatches(state.selectedApi, api.url) : false;
if (isOverridden) li.classList.add('active');
if (isSelected) li.classList.add('selected');
```

with:

```ts
const matchedOverride = state.overrides.find(override => wouldApply(override, api));
const isOverridden = !!matchedOverride;
const isSelected = state.selectedApi ? patternMatches(state.selectedApi, api.url) : false;
if (isOverridden) li.classList.add('active');
if (matchedOverride?.enabled === false) li.classList.add('api-item--rule-disabled');
if (isSelected) li.classList.add('selected');
```

In `styles.css`, add after the `.api-status` rule block (search for `.api-status {` — currently starts at line 616):

```css
.api-item--rule-disabled {
  opacity: 0.55;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test tests/ui-behavior.test.mjs`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Run the full suite and lint**

Run: `npm run lint && npm run test`
Expected: both pass with no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/ui.ts styles.css tests/ui-behavior.test.mjs
git commit -m "feat: split rule matching from enabled state so disabled rules stay visible but dimmed"
```

---

### Task 4: UI — per-rule enable/disable checkbox in the Rules list

**Files:**

- Modify: `src/ui.ts` (`renderList`; add a `change` listener on `elements.listEl`)
- Modify: `styles.css` (`.override-item--disabled`, `.override-enabled-toggle`, `.override-method-badge`)
- Test: `tests/ui-behavior.test.mjs`

**Interfaces:**

- Consumes: none new.
- Produces: none new (internal UI wiring only).

- [ ] **Step 1: Write the failing test**

Add to `tests/ui-behavior.test.mjs` (append at the end of the file):

```js
test('Toggling a rule checkbox persists its enabled state, dims the row, and notifies background', async () => {
  const harness = createUiHarness({
    storageState: {
      enabled: true,
      overrides: [{ pattern: 'users', body: '{"ok":true}', mode: 'text' }],
    },
    apis: [{ url: `${TEST_DOMAIN}/api/users`, type: 'fetch' }],
  });

  await flushUi(harness.window);

  harness.document
    .querySelector('[data-tab="overrides"]')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  const checkbox = harness.document.querySelector('.override-enabled-toggle');
  assert.equal(checkbox.checked, true);

  checkbox.checked = false;
  checkbox.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
  await flushUi(harness.window);

  assert.equal(harness.localState.overrides[0].enabled, false);
  assert.equal(
    harness.document.querySelector('.override-item').classList.contains('override-item--disabled'),
    true
  );

  const lastUpdate = harness.sentMessages.filter(message => message.type === 'update').at(-1);
  assert.equal(lastUpdate.overrides[0].enabled, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test tests/ui-behavior.test.mjs`
Expected: FAIL — `harness.document.querySelector('.override-enabled-toggle')` is `null` today (element doesn't exist), causing a `TypeError` on `checkbox.checked`.

- [ ] **Step 3: Implement**

In `src/ui.ts`, replace `renderList()` (currently lines 221-242):

```ts
function renderList(): void {
  elements.listEl.innerHTML = '';
  state.overrides.forEach((override, index) => {
    const li = document.createElement('li');
    li.className = 'override-item';
    if (override.enabled === false) {
      li.classList.add('override-item--disabled');
    }
    const methodBadge =
      override.method && override.method !== 'ANY'
        ? `<span class="override-method-badge">${escapeHtml(override.method)}</span> `
        : '';
    li.innerHTML = `
          <div class="override-item-main">
            <input
              type="checkbox"
              class="override-enabled-toggle"
              data-index="${index}"
              ${override.enabled === false ? '' : 'checked'}
              title="Enable/disable this rule"
            />
            <div class="override-item-info">
              <b class="override-pattern">${escapeHtml(override.pattern)}</b>
              ${override.redirectUrl ? `<div class="override-redirect">→ ${escapeHtml(override.redirectUrl)}</div>` : ''}
              <div class="override-meta">${methodBadge}${escapeHtml(override.mode)}${override.body ? ` · ${escapeHtml(override.body.substring(0, 80))}${override.body.length > 80 ? '…' : ''}` : ''}</div>
            </div>
            <div class="override-item-actions">
              <button data-index="${index}" class="edit-btn" title="Edit">✎</button>
              <button data-index="${index}" class="del-btn" title="Delete">✕</button>
            </div>
          </div>
        `;
    elements.listEl.appendChild(li);
  });
  updateTabLabels();
}
```

Then add a new `change` listener on `elements.listEl`. Insert it directly after the existing `elements.listEl.addEventListener('click', ...)` block (currently ends at line 649, right before `elements.closeModal.addEventListener('click', closeOverrideModal);` at line 651):

```ts
elements.listEl.addEventListener('change', async event => {
  const target = event.target as HTMLElement;
  if (!target.classList.contains('override-enabled-toggle')) {
    return;
  }
  const index = Number(target.dataset.index);
  if (Number.isNaN(index) || !state.overrides[index]) {
    return;
  }
  state.overrides[index].enabled = (target as HTMLInputElement).checked;
  await chrome.storage.local.set({ [domainKey('overrides')]: state.overrides });
  renderList();
  renderApis();
  await notifyBackground();
});
```

In `styles.css`, add after the `.override-item-actions button:hover` rule (currently ends at line 233):

```css
.override-item--disabled {
  opacity: 0.55;
}
.override-enabled-toggle {
  flex-shrink: 0;
  margin-top: 2px;
  cursor: pointer;
}
.override-method-badge {
  display: inline-block;
  padding: 0 4px;
  border-radius: 3px;
  background: #eef4fa;
  color: #35506b;
  font-weight: 600;
  font-size: 0.78em;
  margin-right: 4px;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test tests/ui-behavior.test.mjs`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Run the full suite and lint**

Run: `npm run lint && npm run test`
Expected: both pass with no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/ui.ts styles.css tests/ui-behavior.test.mjs
git commit -m "feat: add per-rule enable/disable checkbox to the Rules list"
```

---

### Task 5: UI — HTTP method field on the add/edit modal

**Files:**

- Modify: `src/ui.ts` (`Elements` interface, `getElements`, `openOverrideModalForIndex`, `openOverrideModal`, `addApiBtn` handler, `saveOverrideBtn` handler)
- Modify: `panel.html`, `popup.html` (add `<select id="modal-method">`)
- Modify: `tests/test-harness.mjs` (`buildUiHtml` must include the new select, or every existing UI test that opens the modal breaks)
- Test: `tests/ui-behavior.test.mjs`

**Interfaces:**

- Consumes: `apiByUrl.get(url)?.method` (existing `ApiEntry.method`), `wouldApply`/`matchesMethod` (unused here directly, but same `method` semantics).
- Produces: `elements.modalMethod: HTMLSelectElement` (available to later tasks if needed).

- [ ] **Step 1: Write the failing test**

Add to `tests/ui-behavior.test.mjs` (append at the end of the file):

```js
test('Opening the modal from a captured API pre-selects its method; saving persists a non-ANY method', async () => {
  const harness = createUiHarness({
    storageState: { enabled: true, overrides: [] },
    apis: [{ url: `${TEST_DOMAIN}/api/users`, type: 'fetch', method: 'POST' }],
  });

  await flushUi(harness.window);

  harness.document
    .querySelector('.api-item')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  assert.equal(harness.document.getElementById('modal-method').value, 'POST');

  harness.document
    .getElementById('save-override')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  assert.equal(harness.localState.overrides[0].method, 'POST');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test tests/ui-behavior.test.mjs`
Expected: FAIL — `harness.document.getElementById('modal-method')` is `null` today, throwing a `TypeError` on `.value`.

- [ ] **Step 3: Implement**

In `src/ui.ts`, add `modalMethod` to the `Elements` interface (currently lines 87-117), right after `modalPattern: HTMLInputElement;` (line 102):

```ts
modalMethod: HTMLSelectElement;
```

In `getElements()` (currently lines 875-907), add right after `modalPattern: document.getElementById('modal-pattern') as HTMLInputElement,` (line 891):

```ts
      modalMethod: document.getElementById('modal-method') as HTMLSelectElement,
```

In `openOverrideModalForIndex()` (currently lines 275-294), add right after `elements.modalPattern.value = existing.pattern;` (line 286):

```ts
elements.modalMethod.value = existing.method || 'ANY';
```

In `openOverrideModal()` (currently lines 296-341), in the `if (existing)` branch, add right after `elements.modalMode.value = existing.mode || 'text';` (line 317):

```ts
elements.modalMethod.value = existing.method || 'ANY';
```

In the same function's `else` branch (new rule from a captured API), add right after `elements.modalRedirectUrl.value = '';` (line 323):

```ts
const capturedMethod = apiByUrl.get(url)?.method?.toUpperCase();
const knownMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
elements.modalMethod.value =
  capturedMethod && knownMethods.includes(capturedMethod) ? capturedMethod : 'ANY';
```

In the `addApiBtn` click handler (currently lines 741-756), add right after `elements.modalRedirectUrl.value = '';` (line 750):

```ts
elements.modalMethod.value = 'ANY';
```

In the `saveOverrideBtn` click handler (currently lines 658-709), replace everything from `const isRedirect = ...` through `state.overrides.unshift(override);` — i.e. this exact existing block:

```ts
const isRedirect =
  (document.querySelector('input[name="modal-override-type"]:checked') as HTMLInputElement)
    ?.value === 'redirect';

const mode = isRedirect ? 'text' : (elements.modalMode.value as OverrideMode);
const body = isRedirect ? '' : elements.modalBody.value || '';
const redirectUrl = isRedirect ? elements.modalRedirectUrl.value.trim() || undefined : undefined;

const override: OverrideRule = { pattern, body, mode };
if (redirectUrl) {
  override.redirectUrl = redirectUrl;
}

const oldOverride =
  state.currentEditIndex !== null && state.overrides[state.currentEditIndex]
    ? { ...state.overrides[state.currentEditIndex] }
    : null;

if (state.currentEditIndex !== null && state.overrides[state.currentEditIndex]) {
  state.overrides[state.currentEditIndex] = override;
} else {
  state.overrides.unshift(override);
}
```

— with this replacement (it moves the `oldOverride` computation earlier so `override` can read `oldOverride?.enabled`, and adds the `method` field):

```ts
const isRedirect =
  (document.querySelector('input[name="modal-override-type"]:checked') as HTMLInputElement)
    ?.value === 'redirect';

const mode = isRedirect ? 'text' : (elements.modalMode.value as OverrideMode);
const body = isRedirect ? '' : elements.modalBody.value || '';
const redirectUrl = isRedirect ? elements.modalRedirectUrl.value.trim() || undefined : undefined;
const method = elements.modalMethod.value;

const oldOverride =
  state.currentEditIndex !== null && state.overrides[state.currentEditIndex]
    ? { ...state.overrides[state.currentEditIndex] }
    : null;

const override: OverrideRule = { pattern, body, mode };
if (redirectUrl) {
  override.redirectUrl = redirectUrl;
}
if (method && method !== 'ANY') {
  override.method = method;
}
if (oldOverride?.enabled === false) {
  override.enabled = false;
}

if (state.currentEditIndex !== null && state.overrides[state.currentEditIndex]) {
  state.overrides[state.currentEditIndex] = override;
} else {
  state.overrides.unshift(override);
}
```

In both `panel.html` and `popup.html`, add a method `<select>` right after the `Pattern` field (search for `<span>Pattern</span>` in each file):

```html
<label class="modal-field">
  <span>Pattern</span>
  <input id="modal-pattern" type="text" />
</label>
<label class="modal-field">
  <span>Method</span>
  <select id="modal-method">
    <option value="ANY">Any</option>
    <option value="GET">GET</option>
    <option value="POST">POST</option>
    <option value="PUT">PUT</option>
    <option value="PATCH">PATCH</option>
    <option value="DELETE">DELETE</option>
  </select>
</label>
```

(replacing just the existing `<label class="modal-field"><span>Pattern</span><input id="modal-pattern" type="text" /></label>` block with itself plus the new method label — i.e., insert the new `<label>` immediately after the existing pattern one, in both files)

In `tests/test-harness.mjs`, in `buildUiHtml()` (currently lines 75-137), add the same select right after `<input id="modal-pattern" type="text">` (line 98):

```html
<select id="modal-method">
  <option value="ANY">Any</option>
  <option value="GET">GET</option>
  <option value="POST">POST</option>
  <option value="PUT">PUT</option>
  <option value="PATCH">PATCH</option>
  <option value="DELETE">DELETE</option>
</select>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test tests/ui-behavior.test.mjs`
Expected: PASS (all tests in the file, including all pre-existing ones — this confirms the harness HTML update didn't break anything)

- [ ] **Step 5: Run the full suite and lint**

Run: `npm run lint && npm run test`
Expected: both pass with no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/ui.ts panel.html popup.html tests/test-harness.mjs tests/ui-behavior.test.mjs
git commit -m "feat: add HTTP method field to the override add/edit modal"
```

---

### Task 6: UI — Export rules to a JSON file

**Files:**

- Modify: `src/ui.ts` (`Elements` interface, `getElements`, new `exportRulesBtn` handler)
- Modify: `panel.html`, `popup.html` (add `#export-rules-btn`)
- Modify: `tests/test-harness.mjs` (`buildUiHtml` adds the button; `createUiHarness` mocks `URL.createObjectURL`/`revokeObjectURL`)
- Test: `tests/ui-behavior.test.mjs`

**Interfaces:**

- Consumes: `currentDomain` (existing module-level variable), `state.overrides`.
- Produces: none new for later tasks (this is a leaf feature).

- [ ] **Step 1: Write the failing test**

Add to `tests/ui-behavior.test.mjs` (append at the end of the file):

```js
test('Export builds the documented JSON envelope and triggers a download', async () => {
  const harness = createUiHarness({
    storageState: {
      enabled: true,
      overrides: [{ pattern: 'users', body: '{"ok":true}', mode: 'text' }],
    },
    apis: [],
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
  assert.deepEqual(exported.overrides, [{ pattern: 'users', body: '{"ok":true}', mode: 'text' }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test tests/ui-behavior.test.mjs`
Expected: FAIL — `harness.document.getElementById('export-rules-btn')` is `null` today, and `harness.downloads` doesn't exist yet.

- [ ] **Step 3: Implement**

In `tests/test-harness.mjs`, add a `downloads` array and a `Blob`/`URL` mock to `createUiHarness()`. First, add `const downloads = [];` near the other tracking arrays (currently `const sentMessages = [];`, `const storageSets = [];`, `const alerts = [];` around lines 171-173):

```js
const downloads = [];
```

Then, in the same function, extend the `Object.assign(window, { chrome, alert: ... })` block (currently lines 272-275) to also install a `URL.createObjectURL` mock that reads the Blob's text up front (Node's/jsdom's `Blob` supports `.text()`, so the download's content is available a microtask after the click, which is why tests `await flushUi(...)` once more after clicking Export), plus a matching `revokeObjectURL` no-op and an `<a>` click hook that records the intended filename:

```js
Object.assign(window, {
  chrome,
  alert: message => alerts.push(String(message)),
});
window.URL.createObjectURL = blob => {
  const entry = { content: '', filename: '' };
  downloads.push(entry);
  blob
    .text()
    .then(text => {
      entry.content = text;
    })
    .catch(() => {});
  return 'blob:mock-url';
};
window.URL.revokeObjectURL = () => {};
const originalClick = window.HTMLAnchorElement.prototype.click;
window.HTMLAnchorElement.prototype.click = function click() {
  const pending = downloads.at(-1);
  if (pending) {
    pending.filename = this.download;
  }
  return originalClick.call(this);
};
```

Add `downloads` to the object returned by `createUiHarness()` (currently lines 283-293):

```js
    downloads,
```

(added as a new property alongside `alerts`, `localState`, etc.)

In `src/ui.ts`, add `exportRulesBtn` to the `Elements` interface (currently lines 87-117), right after `addApiBtn: HTMLButtonElement;` (line 116):

```ts
exportRulesBtn: HTMLButtonElement;
```

In `getElements()` (currently lines 875-907), add right after `addApiBtn: document.getElementById('add-api-btn') as HTMLButtonElement,` (line 905):

```ts
      exportRulesBtn: document.getElementById('export-rules-btn') as HTMLButtonElement,
```

Add a new click handler. Insert it directly after the `elements.addApiBtn.addEventListener('click', ...)` block (currently ends at line 756, right before `elements.tabsContainer.addEventListener('click', ...)`):

```ts
elements.exportRulesBtn.addEventListener('click', () => {
  const payload = {
    version: 1,
    domain: currentDomain,
    exportedAt: new Date().toISOString(),
    overrides: state.overrides,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const safeDomain = currentDomain.replace(/[^a-z0-9.-]+/gi, '_') || 'rules';
  const a = document.createElement('a');
  a.href = url;
  a.download = `network-overrides-${safeDomain}-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});
```

In both `panel.html` and `popup.html`, add the button inside `#overrides-section`, before `<ul id="list"></ul>`:

```html
<div id="overrides-section" class="tab-content" style="display: none">
  <div class="rules-io-row">
    <button id="export-rules-btn" type="button" class="rules-io-btn">Export</button>
  </div>
  <ul id="list"></ul>
</div>
```

(replacing the existing `<div id="overrides-section" class="tab-content" style="display: none"><ul id="list"></ul></div>` block)

In `tests/test-harness.mjs`'s `buildUiHtml()`, add the button before `<ul id="list"></ul>` (currently line 134):

```html
<button id="export-rules-btn" type="button">Export</button>
```

In `styles.css`, add after the `.override-item-actions button:hover` rule (same area touched in Task 4):

```css
.rules-io-row {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}
.rules-io-btn {
  border: 1px solid #c9d7e6;
  border-radius: 4px;
  background: #f7fafd;
  color: #35506b;
  padding: 4px 10px;
  cursor: pointer;
  font-size: 0.85rem;
}
.rules-io-btn:hover {
  background: #eef4fa;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test tests/ui-behavior.test.mjs`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Run the full suite and lint**

Run: `npm run lint && npm run test`
Expected: both pass with no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/ui.ts panel.html popup.html styles.css tests/test-harness.mjs tests/ui-behavior.test.mjs
git commit -m "feat: export current domain's override rules as a JSON file"
```

---

### Task 7: UI — Import rules from a JSON file (merge/replace, validation)

**Files:**

- Modify: `src/ui.ts` (`Elements` interface, `getElements`, new `importRulesBtn`/`importRulesInput` handlers)
- Modify: `panel.html`, `popup.html` (add `#import-rules-btn`, `#import-rules-input`)
- Modify: `tests/test-harness.mjs` (`buildUiHtml` adds both elements; `createUiHarness` mocks `confirm()`)
- Test: `tests/ui-behavior.test.mjs`

**Interfaces:**

- Consumes: none new.
- Produces: none new (leaf feature).

- [ ] **Step 1: Write the failing test**

Add to `tests/ui-behavior.test.mjs` (append at the end of the file):

```js
function selectImportFile(harness, jsonText) {
  const file = new harness.window.File([jsonText], 'rules.json', { type: 'application/json' });
  const input = harness.document.getElementById('import-rules-input');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
}

test('Import merges when confirm() returns true and there are existing rules', async () => {
  const harness = createUiHarness({
    storageState: {
      enabled: true,
      overrides: [{ pattern: 'existing', body: '{}', mode: 'text' }],
    },
    apis: [],
  });

  await flushUi(harness.window);
  harness.document
    .querySelector('[data-tab="overrides"]')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  harness.setConfirmResult(true);
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

  assert.equal(harness.localState.overrides.length, 2);
  assert.equal(harness.localState.overrides[0].pattern, 'existing');
  assert.equal(harness.localState.overrides[1].pattern, 'imported');
});

test('Import replaces when confirm() returns false and there are existing rules', async () => {
  const harness = createUiHarness({
    storageState: {
      enabled: true,
      overrides: [{ pattern: 'existing', body: '{}', mode: 'text' }],
    },
    apis: [],
  });

  await flushUi(harness.window);
  harness.document
    .querySelector('[data-tab="overrides"]')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  harness.setConfirmResult(false);
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
});

test('Import shows an alert and makes no changes when the file is not valid JSON', async () => {
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
  assert.equal(harness.alerts.length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test tests/ui-behavior.test.mjs`
Expected: FAIL — `harness.document.getElementById('import-rules-input')` is `null` today, and `harness.setConfirmResult` doesn't exist yet.

- [ ] **Step 3: Implement**

In `tests/test-harness.mjs`, add a mutable `confirm` mock in `createUiHarness()`. Near the top of the function, alongside `const alerts = [];` (line 173), add:

```js
let confirmResult = true;
const confirms = [];
```

In the `Object.assign(window, { chrome, alert: ... })` block, add a `confirm` property:

```js
Object.assign(window, {
  chrome,
  alert: message => alerts.push(String(message)),
  confirm: message => {
    confirms.push(String(message));
    return confirmResult;
  },
});
```

Add `confirms` and `setConfirmResult` to the object returned by `createUiHarness()` (alongside `downloads` from Task 6):

```js
    confirms,
    setConfirmResult: value => {
      confirmResult = value;
    },
```

In `src/ui.ts`, add `importRulesBtn` and `importRulesInput` to the `Elements` interface, right after `exportRulesBtn: HTMLButtonElement;` (added in Task 6):

```ts
importRulesBtn: HTMLButtonElement;
importRulesInput: HTMLInputElement;
```

In `getElements()`, add right after `exportRulesBtn: document.getElementById('export-rules-btn') as HTMLButtonElement,` (added in Task 6):

```ts
      importRulesBtn: document.getElementById('import-rules-btn') as HTMLButtonElement,
      importRulesInput: document.getElementById('import-rules-input') as HTMLInputElement,
```

Add the import handlers right after the `elements.exportRulesBtn.addEventListener('click', ...)` block added in Task 6:

```ts
elements.importRulesBtn.addEventListener('click', () => {
  elements.importRulesInput.value = '';
  elements.importRulesInput.click();
});

elements.importRulesInput.addEventListener('change', async () => {
  const file = elements.importRulesInput.files?.[0];
  if (!file) {
    return;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(await file.text());
  } catch (e) {
    alert(`File không hợp lệ: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  if (!parsed || !Array.isArray(parsed.overrides)) {
    alert('File không hợp lệ: thiếu danh sách "overrides".');
    return;
  }

  const isValidRule = (rule: any): boolean =>
    !!rule && typeof rule.pattern === 'string' && typeof rule.mode === 'string';
  if (!parsed.overrides.every(isValidRule)) {
    alert('File không hợp lệ: có rule thiếu "pattern" hoặc "mode".');
    return;
  }

  const importedRules = parsed.overrides as OverrideRule[];

  if (state.overrides.length > 0) {
    const merge = confirm(
      'Rules đã tồn tại cho domain này.\nOK = nối thêm rule mới vào cuối danh sách.\nCancel = xoá hết rule cũ và thay bằng file import.'
    );
    state.overrides = merge ? [...state.overrides, ...importedRules] : importedRules;
  } else {
    state.overrides = importedRules;
  }

  await chrome.storage.local.set({ [domainKey('overrides')]: state.overrides });
  renderList();
  renderApis();
  await notifyBackground();
});
```

In both `panel.html` and `popup.html`, add the button and hidden file input next to `#export-rules-btn` (from Task 6):

```html
<div class="rules-io-row">
  <button id="export-rules-btn" type="button" class="rules-io-btn">Export</button>
  <button id="import-rules-btn" type="button" class="rules-io-btn">Import</button>
  <input id="import-rules-input" type="file" accept="application/json" style="display: none" />
</div>
```

(replacing the `.rules-io-row` div added in Task 6 with this version that has all three elements)

In `tests/test-harness.mjs`'s `buildUiHtml()`, add next to the export button added in Task 6:

```html
<button id="import-rules-btn" type="button">Import</button>
<input id="import-rules-input" type="file" />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test tests/ui-behavior.test.mjs`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Run the full suite and lint**

Run: `npm run lint && npm run test`
Expected: both pass with no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/ui.ts panel.html popup.html tests/test-harness.mjs tests/ui-behavior.test.mjs
git commit -m "feat: import override rules from a JSON file with merge/replace choice"
```

---

## Manual verification (after all 7 tasks)

Automated tests cover logic; do this once in a real Chrome load to confirm the UI actually works end to end (per this project's `verify` skill/process — the automated suite runs in jsdom/vm, not a real browser):

1. `npm run build`, then load the unpacked extension (`chrome://extensions` → Developer mode → Load unpacked → repo root).
2. Open DevTools on any page → "Overrides" panel → Rules tab.
3. Add a rule via "+" on a captured API with a POST request; confirm the modal pre-selects `POST` in the new Method dropdown.
4. Uncheck the rule's checkbox; confirm the row dims and the matching API in "Overridden" also dims but stays in that tab (doesn't move to "Other").
5. Click Export; confirm a `.json` file downloads with `version`/`domain`/`exportedAt`/`overrides`.
6. Click Import, pick that same file: confirm the merge/replace `confirm()` dialog appears (since a rule already exists), and both choices behave as expected.
