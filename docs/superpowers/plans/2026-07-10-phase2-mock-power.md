# Phase 2: Mock Power Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rules can override the mocked response's status code and headers, delay the response, or fail the request at the network layer.

**Architecture:** Four optional fields on the existing `OverrideRule` (`statusCode`, `responseHeaders`, `delayMs`, `failReason`) — no rule-model refactor, no storage migration. Fail rules act at the `Fetch.requestPaused` request stage via `Fetch.failRequest`; status/headers/delay extend the existing response-stage `Fetch.fulfillRequest` path. The modal gains a third override type (fail) and an Advanced row.

**Tech Stack:** TypeScript namespaces compiled by plain `tsc` (no bundler; `src/*.ts` → `dist/*.js`, loaded via `<script>` tags and `importScripts`). Tests: `node --test` over `dist/*.js` in `node:vm` with the chrome mock in `tests/test-harness.mjs`. Real-browser smoke: `scripts/smoke.mjs` (Playwright).

**Spec:** `docs/superpowers/specs/2026-07-10-phase2-mock-power-design.md`

## Global Constraints

- Node >= 22. Run tests with `npm test` (builds first via `tsc`).
- Code style: namespaces + triple-slash references, NOT ES modules. `src/shared.ts` is a `declare namespace` (ambient types only — no runtime code can live there).
- Commit messages follow commitlint conventional style. Do NOT add a `Co-Authored-By` line (user preference).
- Never edit `dist/*` by hand.
- The harness `chrome.debugger.sendCommand` mock logs every call to `commandLog` and models attachment (commands fail with `lastError` when the target is not attached); the `attach` callback is async (setTimeout 0), so tests `await new Promise(r => setTimeout(r, 0))` after `update` messages before emitting debugger events.
- Field ranges (verbatim from spec): `statusCode` integer 100–599; `delayMs` number 0–120000; `failReason` one of `Failed`, `TimedOut`, `ConnectionRefused`, `NameNotResolved`, `InternetDisconnected`.
- Every task ends with `npm test` green before committing.

---

### Task 1: Fail rules in the background (with optional delay)

**Files:**

- Modify: `src/shared.ts` (add the four optional fields to `OverrideRule`)
- Modify: `src/background.ts` (`handleRequestPaused` request stage + response-stage guard)
- Test: `tests/background-flow.test.mjs`

**Interfaces:**

- Consumes: `findOverride(url, method, overrides)` (existing, returns `{ override, captures } | null`), harness `emitDebuggerEvent`/`commandLog`.
- Produces: `OverrideRule.statusCode?: number`, `responseHeaders?: FetchHeader[]`, `delayMs?: number`, `failReason?: string` (ambient types used by Tasks 2–5). Background behavior: a matched rule with `failReason` issues `Fetch.failRequest { requestId, errorReason }` after `delayMs`.

- [ ] **Step 1: Add the fields to `src/shared.ts`**

Inside `interface OverrideRule` after the `method?` line:

```ts
    statusCode?: number; // integer 100–599; body rules only
    responseHeaders?: FetchHeader[]; // extra/override headers; body rules only
    delayMs?: number; // 0–120000 ms; body and fail rules
    failReason?: string; // presence makes this a fail rule (CDP Network.ErrorReason)
```

- [ ] **Step 2: Write the failing tests**

Append to `tests/background-flow.test.mjs`:

```js
test('Background fails matching requests with the configured error reason', async () => {
  const harness = createBackgroundHarness();

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [{ pattern: '/users$/', body: '', mode: 'text', failReason: 'ConnectionRefused' }],
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-fail',
    request: { url: TEST_API_URL, method: 'GET' },
    resourceType: 'Fetch',
  });

  const failCmd = harness.commandLog.find(
    ({ method, params }) => method === 'Fetch.failRequest' && params.requestId === 'req-fail'
  );
  assert.ok(failCmd);
  assert.equal(failCmd.params.errorReason, 'ConnectionRefused');
  assert.equal(
    harness.commandLog.some(
      ({ method, params }) =>
        (method === 'Fetch.continueRequest' || method === 'Fetch.fulfillRequest') &&
        params.requestId === 'req-fail'
    ),
    false
  );
});

test('Background delays a fail rule before failing the request', async () => {
  const harness = createBackgroundHarness();

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [
      { pattern: '/users$/', body: '', mode: 'text', failReason: 'TimedOut', delayMs: 30 },
    ],
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-fail-delayed',
    request: { url: TEST_API_URL },
    resourceType: 'Fetch',
  });

  const findFail = () =>
    harness.commandLog.find(
      ({ method, params }) =>
        method === 'Fetch.failRequest' && params.requestId === 'req-fail-delayed'
    );
  assert.equal(findFail(), undefined); // not yet — the delay is pending
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.ok(findFail());
  assert.equal(findFail().params.errorReason, 'TimedOut');
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: both new tests FAIL — no `Fetch.failRequest` in `commandLog` (the rule falls through to `continueRequest`).

- [ ] **Step 4: Implement in `src/background.ts`**

In `handleRequestPaused`, the request-stage branch currently reads:

```ts
    if (isRequestStage) {
      if (!state.recentApis.has(url)) {
        recordApi(tabId, { ... });
      }

      try {
        const match = findOverride(url, params.request?.method, state.overrides);
        if (match && match.override.redirectUrl) {
```

Insert the fail handling between `findOverride` and the redirect block (failReason has precedence over redirectUrl):

```ts
      try {
        const match = findOverride(url, params.request?.method, state.overrides);
        if (match && match.override.failReason) {
          const errorReason = match.override.failReason;
          const fail = () => {
            chrome.debugger.sendCommand(
              { tabId },
              'Fetch.failRequest',
              { requestId: params.requestId, errorReason },
              () => {
                if (chrome.runtime.lastError) {
                  // The request may already be gone; nothing to recover.
                }
              }
            );
          };
          const delayMs = typeof match.override.delayMs === 'number' ? match.override.delayMs : 0;
          if (delayMs > 0) {
            setTimeout(fail, delayMs);
          } else {
            fail();
          }
          return;
        }
        if (match && match.override.redirectUrl) {
```

In the response stage, the redirect-only guard currently reads:

```ts
if (match.override.redirectUrl) {
  proceed();
  return;
}
```

Change it to also pass fail rules through (they are consumed at the request stage; seeing one here means a stale pause):

```ts
if (match.override.failReason || match.override.redirectUrl) {
  proceed();
  return;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, including all pre-existing tests.

- [ ] **Step 6: Commit**

```bash
git add src/shared.ts src/background.ts tests/background-flow.test.mjs
git commit -m "feat: fail matching requests at the network layer with optional delay"
```

---

### Task 2: Status code, header merge, and delay on the fulfill path

**Files:**

- Modify: `src/background.ts` (the `Fetch.fulfillRequest` block in `handleRequestPaused`'s response stage)
- Test: `tests/background-flow.test.mjs`

**Interfaces:**

- Consumes: `OverrideRule.statusCode` / `responseHeaders` / `delayMs` (Task 1 types), the existing `ov` (matched rule) and `headers` array in the fulfill block.
- Produces: fulfilled responses honor `statusCode` (else original, clamped as today), merge `responseHeaders` (case-insensitive overwrite, else append; `x-network-overrides*` markers always appended last), and wait `delayMs` before `Fetch.fulfillRequest`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/background-flow.test.mjs`:

```js
test('Background fulfills with the rule statusCode instead of the original status', async () => {
  const harness = createBackgroundHarness();

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [{ pattern: '/users$/', body: '{"m":1}', mode: 'text', statusCode: 503 }],
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-status',
    request: { url: TEST_API_URL },
    responseStatusCode: 200,
    resourceType: 'Fetch',
  });

  const fulfill = harness.commandLog.find(
    ({ method, params }) => method === 'Fetch.fulfillRequest' && params.requestId === 'req-status'
  );
  assert.ok(fulfill);
  assert.equal(fulfill.params.responseCode, 503);
});

test('Background merges rule responseHeaders over the originals and keeps the markers', async () => {
  const harness = createBackgroundHarness();

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [
      {
        pattern: '/users$/',
        body: '{"m":1}',
        mode: 'text',
        responseHeaders: [
          { name: 'content-type', value: 'text/plain' }, // overwrites, case-insensitive
          { name: 'X-Custom', value: 'yes' }, // appends
        ],
      },
    ],
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-headers',
    request: { url: TEST_API_URL },
    responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
    responseStatusCode: 200,
    resourceType: 'Fetch',
  });

  const fulfill = harness.commandLog.find(
    ({ method, params }) => method === 'Fetch.fulfillRequest' && params.requestId === 'req-headers'
  );
  assert.ok(fulfill);
  const headers = fulfill.params.responseHeaders;
  const contentTypes = headers.filter(header => header.name.toLowerCase() === 'content-type');
  assert.equal(contentTypes.length, 1); // overwritten, not duplicated
  assert.equal(contentTypes[0].value, 'text/plain');
  assert.equal(
    headers.some(header => header.name === 'X-Custom' && header.value === 'yes'),
    true
  );
  assert.equal(
    headers.some(header => header.name === 'x-network-overrides' && header.value === 'true'),
    true
  );
});

test('Background delays fulfillment when the rule has delayMs', async () => {
  const harness = createBackgroundHarness();

  harness.callMessage({
    type: 'update',
    tabId: 7,
    tabUrl: `${TEST_DOMAIN}/`,
    enabled: true,
    overrides: [{ pattern: '/users$/', body: '{"m":1}', mode: 'text', delayMs: 30 }],
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  harness.emitDebuggerEvent('Fetch.requestPaused', {
    requestId: 'req-delayed',
    request: { url: TEST_API_URL },
    responseStatusCode: 200,
    resourceType: 'Fetch',
  });

  const findFulfill = () =>
    harness.commandLog.find(
      ({ method, params }) =>
        method === 'Fetch.fulfillRequest' && params.requestId === 'req-delayed'
    );
  assert.equal(findFulfill(), undefined); // still waiting
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.ok(findFulfill());
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `responseCode` is 200, the merged header assertions fail (duplicate content-type), and the delayed fulfill appears immediately.

- [ ] **Step 3: Implement in `src/background.ts`**

Replace the tail of the fulfill block (from `const responseBodyBase64 = bodyToValidBase64();` through the `chrome.debugger.sendCommand(... 'Fetch.fulfillRequest' ...)` call) with:

```ts
const responseBodyBase64 = bodyToValidBase64();

const headers = [...((params.responseHeaders as FetchHeader[]) || [])];
if (Array.isArray(ov.responseHeaders)) {
  for (const extra of ov.responseHeaders) {
    if (!extra || typeof extra.name !== 'string' || !extra.name.trim()) continue;
    const existingIndex = headers.findIndex(
      header => header.name.toLowerCase() === extra.name.toLowerCase()
    );
    if (existingIndex >= 0) {
      headers[existingIndex] = { name: headers[existingIndex].name, value: String(extra.value) };
    } else {
      headers.push({ name: extra.name, value: String(extra.value) });
    }
  }
}
if (!headers.find(h => h.name.toLowerCase() === 'content-type')) {
  headers.push({ name: 'Content-Type', value: 'application/json; charset=utf-8' });
}

// The markers always win and cannot be removed by rule headers.
headers.push({ name: 'x-network-overrides', value: 'true' });
headers.push({ name: 'x-network-overrides-pattern', value: ov.pattern });

const fallbackCode =
  typeof params.responseStatusCode === 'number' &&
  params.responseStatusCode >= 100 &&
  params.responseStatusCode <= 599
    ? params.responseStatusCode
    : 200;
const responseCode =
  typeof ov.statusCode === 'number' && ov.statusCode >= 100 && ov.statusCode <= 599
    ? ov.statusCode
    : fallbackCode;

const doFulfill = () => {
  chrome.debugger.sendCommand(
    { tabId },
    'Fetch.fulfillRequest',
    {
      requestId: params.requestId,
      responseCode,
      responseHeaders: headers,
      body: responseBodyBase64,
    },
    () => {
      if (chrome.runtime.lastError) {
        console.error('fulfillRequest failed:', chrome.runtime.lastError.message);
        proceed();
      }
    }
  );
};
const delayMs = typeof ov.delayMs === 'number' ? ov.delayMs : 0;
if (delayMs > 0) {
  setTimeout(doFulfill, delayMs);
} else {
  doFulfill();
}
```

Note: the existing `Content-Type` default and marker pushes are replaced by this block — do not leave duplicates behind. The rule-header merge runs BEFORE the `Content-Type` default check, so a rule-provided content type suppresses the default.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (the pre-existing fulfill tests — headers/body/file-mode — must stay green).

- [ ] **Step 5: Commit**

```bash
git add src/background.ts tests/background-flow.test.mjs
git commit -m "feat: override status and headers and delay mocked responses"
```

---

### Task 3: Modal — fail type and Advanced fields

**Files:**

- Modify: `popup.html`, `panel.html` (fail radio + Advanced row + fail-reason select, inside `#override-modal`)
- Modify: `tests/test-harness.mjs` (`buildUiHtml()` — same new elements)
- Modify: `src/ui.ts` (`FAIL_REASONS`, `Elements`, `getElements`, `setModalOverrideType`, save handler, modal prefill/reset paths, `parseHeaderLines`)
- Modify: `styles.css` (minor spacing for the advanced row)
- Test: `tests/ui-behavior.test.mjs`

**Interfaces:**

- Consumes: `OverrideRule` fields (Task 1).
- Produces: `FAIL_REASONS` module-level const in `ui.ts` (used by Task 5's import validation): `['Failed', 'TimedOut', 'ConnectionRefused', 'NameNotResolved', 'InternetDisconnected']`. DOM ids used by tests and the smoke script: `#modal-status`, `#modal-delay`, `#modal-headers`, `#modal-fail-reason`, `#modal-advanced-fields`, `#modal-fail-fields`, `#modal-status-field`, `#modal-headers-field`, radio `value="fail"`. Helper `parseHeaderLines(text): FetchHeader[] | null`.

- [ ] **Step 1: HTML — popup.html, panel.html, and the test harness**

In BOTH `popup.html` and `panel.html`, inside `.override-type-selector`, add a third radio after the redirect one:

```html
<label class="type-radio">
  <input type="radio" name="modal-override-type" value="fail" />
  <span>Fail request</span>
</label>
```

Still inside `#override-modal`'s `.modal-content`, right after the `#modal-redirect-fields` div, add:

```html
<div id="modal-fail-fields" style="display: none">
  <label class="modal-field">
    <span>Fail reason</span>
    <select id="modal-fail-reason">
      <option value="Failed">Failed</option>
      <option value="TimedOut">TimedOut</option>
      <option value="ConnectionRefused">ConnectionRefused</option>
      <option value="NameNotResolved">NameNotResolved</option>
      <option value="InternetDisconnected">InternetDisconnected</option>
    </select>
  </label>
</div>
<div id="modal-advanced-fields">
  <label class="modal-field" id="modal-status-field">
    <span>Status (blank = keep original)</span>
    <input id="modal-status" type="number" min="100" max="599" placeholder="e.g. 500" />
  </label>
  <label class="modal-field">
    <span>Delay (ms)</span>
    <input id="modal-delay" type="number" min="0" max="120000" placeholder="0" />
  </label>
  <label class="modal-field" id="modal-headers-field">
    <span>Extra headers (one "Header-Name: value" per line)</span>
    <textarea id="modal-headers" rows="3" placeholder="X-Custom: value"></textarea>
  </label>
</div>
```

In `tests/test-harness.mjs` `buildUiHtml()`, add the same fail radio inside the `.override-type-selector` div, and after the `#modal-redirect-fields` div add:

```html
<div id="modal-fail-fields" style="display:none">
  <select id="modal-fail-reason">
    <option value="Failed">Failed</option>
    <option value="TimedOut">TimedOut</option>
    <option value="ConnectionRefused">ConnectionRefused</option>
    <option value="NameNotResolved">NameNotResolved</option>
    <option value="InternetDisconnected">InternetDisconnected</option>
  </select>
</div>
<div id="modal-advanced-fields">
  <label id="modal-status-field"><input id="modal-status" type="number" /></label>
  <label><input id="modal-delay" type="number" /></label>
  <label id="modal-headers-field"><textarea id="modal-headers"></textarea></label>
</div>
```

In `styles.css`, append:

```css
#modal-advanced-fields {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
#modal-advanced-fields .modal-field {
  flex: 1 1 120px;
}
#modal-advanced-fields #modal-headers-field {
  flex-basis: 100%;
}
```

- [ ] **Step 2: Write the failing tests**

Append to `tests/ui-behavior.test.mjs`:

```js
test('Saving a body override persists status, delay, and extra headers', async () => {
  const harness = createUiHarness({
    apis: [{ url: `${TEST_DOMAIN}/api/users`, type: 'fetch', method: 'GET' }],
    tabUrl: `${TEST_DOMAIN}/`,
  });
  await flushUi(harness.window);

  harness.document
    .querySelector('#apis-list li.api-item')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  harness.document.getElementById('modal-body').value = '{"mock":1}';
  harness.document.getElementById('modal-status').value = '503';
  harness.document.getElementById('modal-delay').value = '1500';
  harness.document.getElementById('modal-headers').value =
    'X-Custom: yes\nContent-Type: text/plain';
  harness.document
    .getElementById('save-override')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  const saved = harness.storageSets.findLast(set => `overrides_${TEST_DOMAIN}` in set)[
    `overrides_${TEST_DOMAIN}`
  ][0];
  assert.equal(saved.statusCode, 503);
  assert.equal(saved.delayMs, 1500);
  assert.deepEqual(saved.responseHeaders, [
    { name: 'X-Custom', value: 'yes' },
    { name: 'Content-Type', value: 'text/plain' },
  ]);
});

test('Saving a fail rule persists failReason and delay with an empty body', async () => {
  const harness = createUiHarness({ apis: [], tabUrl: `${TEST_DOMAIN}/` });
  await flushUi(harness.window);

  harness.document
    .getElementById('add-api-btn')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  harness.document.getElementById('modal-pattern').value = 'api/fail';
  const failRadio = harness.document.querySelector(
    'input[name="modal-override-type"][value="fail"]'
  );
  failRadio.checked = true;
  failRadio.dispatchEvent(new harness.window.Event('change', { bubbles: true }));
  harness.document.getElementById('modal-fail-reason').value = 'TimedOut';
  harness.document.getElementById('modal-delay').value = '2000';
  harness.document
    .getElementById('save-override')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  const saved = harness.storageSets.findLast(set => `overrides_${TEST_DOMAIN}` in set)[
    `overrides_${TEST_DOMAIN}`
  ][0];
  assert.equal(saved.failReason, 'TimedOut');
  assert.equal(saved.delayMs, 2000);
  assert.equal(saved.body, '');
  assert.equal(saved.redirectUrl, undefined);
  assert.equal(saved.statusCode, undefined);
});

test('Modal save rejects out-of-range status and delay and malformed header lines', async () => {
  const harness = createUiHarness({
    apis: [{ url: `${TEST_DOMAIN}/api/users`, type: 'fetch' }],
    tabUrl: `${TEST_DOMAIN}/`,
  });
  await flushUi(harness.window);

  harness.document
    .querySelector('#apis-list li.api-item')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  const save = () =>
    harness.document
      .getElementById('save-override')
      .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));

  harness.document.getElementById('modal-status').value = '99';
  save();
  await flushUi(harness.window);
  assert.equal(harness.alerts.length, 1);
  assert.match(harness.alerts[0], /status/i);

  harness.document.getElementById('modal-status').value = '';
  harness.document.getElementById('modal-delay').value = '-5';
  save();
  await flushUi(harness.window);
  assert.equal(harness.alerts.length, 2);
  assert.match(harness.alerts[1], /delay/i);

  harness.document.getElementById('modal-delay').value = '';
  harness.document.getElementById('modal-headers').value = 'no colon here';
  save();
  await flushUi(harness.window);
  assert.equal(harness.alerts.length, 3);
  assert.match(harness.alerts[2], /header/i);

  const saved = harness.storageSets.find(set => `overrides_${TEST_DOMAIN}` in set);
  assert.equal(saved, undefined); // nothing was persisted
});

test('Editing a fail rule pre-fills the fail type, reason, and delay', async () => {
  const harness = createUiHarness({
    storageState: {
      overrides: [
        {
          pattern: 'api/fail',
          body: '',
          mode: 'text',
          failReason: 'ConnectionRefused',
          delayMs: 500,
        },
      ],
    },
    apis: [],
    tabUrl: `${TEST_DOMAIN}/`,
  });
  await flushUi(harness.window);

  harness.document
    .querySelector('[data-tab="overrides"]')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);
  harness.document
    .querySelector('.edit-btn')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  assert.equal(
    harness.document.querySelector('input[name="modal-override-type"][value="fail"]').checked,
    true
  );
  assert.equal(harness.document.getElementById('modal-fail-reason').value, 'ConnectionRefused');
  assert.equal(harness.document.getElementById('modal-delay').value, '500');
  assert.equal(harness.document.getElementById('modal-fail-fields').style.display, '');
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: the four new tests FAIL (`modal-status` value ignored, fail radio does nothing, no alerts, prefill empty). Pre-existing tests must still pass.

- [ ] **Step 4: Implement in `src/ui.ts`**

(a) Next to `KNOWN_METHODS`, add:

```ts
const FAIL_REASONS = [
  'Failed',
  'TimedOut',
  'ConnectionRefused',
  'NameNotResolved',
  'InternetDisconnected',
];

type ModalOverrideType = 'body' | 'redirect' | 'fail';

// Parses "Header-Name: value" lines; returns null when any non-empty line is malformed.
function parseHeaderLines(text: string): NetworkOverridesShared.FetchHeader[] | null {
  const headers: NetworkOverridesShared.FetchHeader[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon <= 0) return null;
    headers.push({ name: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() });
  }
  return headers;
}
```

(b) Add to `Elements`:

```ts
modalStatus: HTMLInputElement;
modalDelay: HTMLInputElement;
modalHeaders: HTMLTextAreaElement;
modalFailFields: HTMLDivElement;
modalFailReason: HTMLSelectElement;
modalAdvancedFields: HTMLDivElement;
modalStatusField: HTMLElement;
modalHeadersField: HTMLElement;
```

and to `getElements()`:

```ts
      modalStatus: document.getElementById('modal-status') as HTMLInputElement,
      modalDelay: document.getElementById('modal-delay') as HTMLInputElement,
      modalHeaders: document.getElementById('modal-headers') as HTMLTextAreaElement,
      modalFailFields: document.getElementById('modal-fail-fields') as HTMLDivElement,
      modalFailReason: document.getElementById('modal-fail-reason') as HTMLSelectElement,
      modalAdvancedFields: document.getElementById('modal-advanced-fields') as HTMLDivElement,
      modalStatusField: document.getElementById('modal-status-field') as HTMLElement,
      modalHeadersField: document.getElementById('modal-headers-field') as HTMLElement,
```

(c) Replace `setModalOverrideType` with the three-type version:

```ts
function setModalOverrideType(type: ModalOverrideType): void {
  document
    .querySelectorAll<HTMLInputElement>('input[name="modal-override-type"]')
    .forEach(radio => {
      radio.checked = radio.value === type;
    });
  elements.modalBodyFields.style.display = type === 'body' ? '' : 'none';
  elements.modalRedirectFields.style.display = type === 'redirect' ? '' : 'none';
  elements.modalFailFields.style.display = type === 'fail' ? '' : 'none';
  // Advanced row: delay applies to body and fail; status/headers to body only.
  elements.modalAdvancedFields.style.display = type === 'redirect' ? 'none' : '';
  elements.modalStatusField.style.display = type === 'body' ? '' : 'none';
  elements.modalHeadersField.style.display = type === 'body' ? '' : 'none';
  elements.modalPattern.disabled = type === 'body';
}
```

The radio `change` listeners at the bottom of `init` already call `setModalOverrideType((radio as HTMLInputElement).value as ...)` — widen that cast to `ModalOverrideType`.

(d) Add a shared prefill helper inside `init` and use it from BOTH `openOverrideModalForIndex` and the `existing` branch of `openOverrideModal`:

```ts
function prefillAdvancedFields(existing: OverrideRule | null): void {
  elements.modalStatus.value =
    existing && typeof existing.statusCode === 'number' ? String(existing.statusCode) : '';
  elements.modalDelay.value =
    existing && typeof existing.delayMs === 'number' ? String(existing.delayMs) : '';
  elements.modalHeaders.value = (existing?.responseHeaders || [])
    .map(header => `${header.name}: ${header.value}`)
    .join('\n');
  elements.modalFailReason.value =
    existing?.failReason && FAIL_REASONS.includes(existing.failReason)
      ? existing.failReason
      : 'Failed';
}
```

In `openOverrideModalForIndex`, replace the `setModalOverrideType(existing.redirectUrl ? 'redirect' : 'body');` line with:

```ts
prefillAdvancedFields(existing);
setModalOverrideType(existing.failReason ? 'fail' : existing.redirectUrl ? 'redirect' : 'body');
```

In `openOverrideModal`'s `if (existing)` branch, make the same replacement. In the `else` (new rule) branch and in the `addApiBtn` click handler, add `prefillAdvancedFields(null);` before the existing `setModalOverrideType('body');` call.

(e) Rewrite the top of the save handler. Replace:

```ts
const isRedirect =
  (document.querySelector('input[name="modal-override-type"]:checked') as HTMLInputElement)
    ?.value === 'redirect';

const mode = isRedirect ? 'text' : (elements.modalMode.value as OverrideMode);
const body = isRedirect ? '' : elements.modalBody.value || '';
const redirectUrl = isRedirect ? elements.modalRedirectUrl.value.trim() || undefined : undefined;
const method = elements.modalMethod.value;
```

with:

```ts
const overrideType =
  ((document.querySelector('input[name="modal-override-type"]:checked') as HTMLInputElement)
    ?.value as ModalOverrideType) || 'body';

const mode = overrideType === 'body' ? (elements.modalMode.value as OverrideMode) : 'text';
const body = overrideType === 'body' ? elements.modalBody.value || '' : '';
const redirectUrl =
  overrideType === 'redirect' ? elements.modalRedirectUrl.value.trim() || undefined : undefined;
const method = elements.modalMethod.value;

let statusCode: number | undefined;
let delayMs: number | undefined;
let responseHeaders: NetworkOverridesShared.FetchHeader[] | undefined;
if (overrideType !== 'redirect') {
  const delayRaw = elements.modalDelay.value.trim();
  if (delayRaw) {
    const parsedDelay = Number(delayRaw);
    if (!Number.isFinite(parsedDelay) || parsedDelay < 0 || parsedDelay > 120000) {
      alert('Delay must be a number between 0 and 120000 ms');
      return;
    }
    delayMs = parsedDelay;
  }
}
if (overrideType === 'body') {
  const statusRaw = elements.modalStatus.value.trim();
  if (statusRaw) {
    const parsedStatus = Number(statusRaw);
    if (!Number.isInteger(parsedStatus) || parsedStatus < 100 || parsedStatus > 599) {
      alert('Status must be an integer between 100 and 599');
      return;
    }
    statusCode = parsedStatus;
  }
  if (elements.modalHeaders.value.trim()) {
    const parsedHeaders = parseHeaderLines(elements.modalHeaders.value);
    if (!parsedHeaders) {
      alert('Extra headers must be one "Header-Name: value" per line');
      return;
    }
    if (parsedHeaders.length > 0) responseHeaders = parsedHeaders;
  }
}
```

and after the existing `const override: OverrideRule = { pattern, body, mode };` block's `if (redirectUrl)` / `if (method ...)` lines, add:

```ts
if (overrideType === 'fail') {
  override.failReason = FAIL_REASONS.includes(elements.modalFailReason.value)
    ? elements.modalFailReason.value
    : 'Failed';
}
if (statusCode !== undefined) override.statusCode = statusCode;
if (delayMs !== undefined) override.delayMs = delayMs;
if (responseHeaders !== undefined) override.responseHeaders = responseHeaders;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all four new tests plus every pre-existing modal test).

- [ ] **Step 6: Commit**

```bash
git add popup.html panel.html styles.css src/ui.ts tests/ui-behavior.test.mjs tests/test-harness.mjs
git commit -m "feat: add fail type and advanced mock fields to the override modal"
```

---

### Task 4: Rules-list badges

**Files:**

- Modify: `src/ui.ts` (`renderList`)
- Modify: `styles.css`
- Test: `tests/ui-behavior.test.mjs`

**Interfaces:**

- Consumes: `OverrideRule` fields (Task 1), `escapeHtml` (existing).
- Produces: badge class names used by nothing else — purely visual.

- [ ] **Step 1: Write the failing test**

Append to `tests/ui-behavior.test.mjs`:

```js
test('Rules list shows status, delay, and FAIL badges', async () => {
  const harness = createUiHarness({
    storageState: {
      overrides: [
        { pattern: 'a', body: '{}', mode: 'text', statusCode: 500, delayMs: 3000 },
        { pattern: 'b', body: '', mode: 'text', failReason: 'TimedOut' },
      ],
    },
    apis: [],
    tabUrl: `${TEST_DOMAIN}/`,
  });
  await flushUi(harness.window);
  harness.document
    .querySelector('[data-tab="overrides"]')
    .dispatchEvent(new harness.window.MouseEvent('click', { bubbles: true }));
  await flushUi(harness.window);

  const items = harness.document.querySelectorAll('#list .override-item');
  assert.equal(items[0].querySelector('.override-status-badge').textContent, '500');
  assert.equal(items[0].querySelector('.override-delay-badge').textContent, '⏱ 3000ms');
  const failBadge = items[1].querySelector('.override-fail-badge');
  assert.equal(failBadge.textContent, 'FAIL');
  assert.equal(failBadge.title, 'TimedOut');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — no badge elements exist.

- [ ] **Step 3: Implement**

In `src/ui.ts` `renderList`, after the `methodBadge` const, add:

```ts
const statusBadge =
  typeof override.statusCode === 'number'
    ? `<span class="override-status-badge">${override.statusCode}</span> `
    : '';
const delayBadge =
  typeof override.delayMs === 'number' && override.delayMs > 0
    ? `<span class="override-delay-badge">⏱ ${override.delayMs}ms</span> `
    : '';
const failBadge = override.failReason
  ? `<span class="override-fail-badge" title="${escapeHtml(override.failReason)}">FAIL</span> `
  : '';
```

and in the `override-meta` div of the template, change `${methodBadge}${escapeHtml(override.mode)}` to `${methodBadge}${failBadge}${statusBadge}${delayBadge}${escapeHtml(override.mode)}`.

In `styles.css`, append:

```css
.override-status-badge,
.override-delay-badge,
.override-fail-badge {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
  margin-right: 4px;
}
.override-status-badge {
  background: #fff3e0;
  color: #e65100;
}
.override-delay-badge {
  background: #e3f2fd;
  color: #0a4f9c;
}
.override-fail-badge {
  background: #ffebee;
  color: #c62828;
  font-weight: 600;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui.ts styles.css tests/ui-behavior.test.mjs
git commit -m "feat: show status, delay, and fail badges on the rules list"
```

---

### Task 5: Import validation for the new fields

**Files:**

- Modify: `src/ui.ts` (`isValidRule` + clean-copy mapper in the import handler)
- Test: `tests/ui-behavior.test.mjs`

**Interfaces:**

- Consumes: `FAIL_REASONS` (Task 3), the existing `selectImportFile(harness, jsonText)` helper in `tests/ui-behavior.test.mjs`.
- Produces: stricter import; clean rules carry `statusCode`/`delayMs`/`responseHeaders`/`failReason`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/ui-behavior.test.mjs`:

```js
test('Import rejects invalid mock-power fields', async () => {
  const harness = createUiHarness({ apis: [], tabUrl: `${TEST_DOMAIN}/` });
  await flushUi(harness.window);

  const attempts = [
    { pattern: 'x', mode: 'text', body: '', statusCode: 99 },
    { pattern: 'x', mode: 'text', body: '', statusCode: 'abc' },
    { pattern: 'x', mode: 'text', body: '', delayMs: -1 },
    { pattern: 'x', mode: 'text', body: '', delayMs: 999999 },
    { pattern: 'x', mode: 'text', body: '', responseHeaders: [{ name: '', value: 'v' }] },
    { pattern: 'x', mode: 'text', body: '', responseHeaders: 'not-an-array' },
    { pattern: 'x', mode: 'text', body: '', failReason: 'Nope' },
    { pattern: 'x', mode: 'text', body: '', failReason: 'Failed', redirectUrl: 'https://a.test/' },
  ];
  for (const rule of attempts) {
    selectImportFile(
      harness,
      JSON.stringify({ version: 1, domain: TEST_DOMAIN, overrides: [rule] })
    );
    await flushUi(harness.window);
  }
  assert.equal(harness.alerts.length, attempts.length);
  assert.equal(
    harness.storageSets.find(set => `overrides_${TEST_DOMAIN}` in set),
    undefined
  );
});

test('Import keeps valid mock-power fields on the cleaned rule', async () => {
  const harness = createUiHarness({ apis: [], tabUrl: `${TEST_DOMAIN}/` });
  await flushUi(harness.window);

  selectImportFile(
    harness,
    JSON.stringify({
      version: 1,
      domain: TEST_DOMAIN,
      overrides: [
        {
          pattern: 'users',
          mode: 'text',
          body: '{}',
          statusCode: 503,
          delayMs: 1500,
          responseHeaders: [{ name: 'X-Custom', value: 'yes' }],
        },
        { pattern: 'fail', mode: 'text', body: '', failReason: 'TimedOut' },
      ],
    })
  );
  await flushUi(harness.window);

  assert.equal(harness.alerts.length, 0);
  const rules = harness.storageSets.findLast(set => `overrides_${TEST_DOMAIN}` in set)[
    `overrides_${TEST_DOMAIN}`
  ];
  assert.deepEqual(rules[0], {
    pattern: 'users',
    mode: 'text',
    body: '{}',
    statusCode: 503,
    delayMs: 1500,
    responseHeaders: [{ name: 'X-Custom', value: 'yes' }],
  });
  assert.deepEqual(rules[1], {
    pattern: 'fail',
    mode: 'text',
    body: '',
    failReason: 'TimedOut',
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: the first test FAILS (bad fields are accepted today, so fewer alerts and a storage write happen); the second may pass except the `deepEqual` — the clean mapper currently drops the new fields.

- [ ] **Step 3: Implement**

In `src/ui.ts`'s import handler, extend `isValidRule` (keep the existing clauses; add these before the final `enabled` clause) and add the header validator above it:

```ts
const isValidImportHeader = (header: any): boolean =>
  !!header &&
  typeof header.name === 'string' &&
  header.name.trim() !== '' &&
  typeof header.value === 'string';
const isValidRule = (rule: any): boolean =>
  !!rule &&
  typeof rule.pattern === 'string' &&
  (rule.mode === 'text' || rule.mode === 'file') &&
  (rule.method === undefined ||
    (typeof rule.method === 'string' && KNOWN_METHODS.includes(rule.method.toUpperCase()))) &&
  (rule.body === undefined ||
    typeof rule.body === 'string' ||
    (typeof rule.body === 'object' && rule.body !== null)) &&
  (rule.redirectUrl === undefined || typeof rule.redirectUrl === 'string') &&
  (rule.statusCode === undefined ||
    (Number.isInteger(rule.statusCode) && rule.statusCode >= 100 && rule.statusCode <= 599)) &&
  (rule.delayMs === undefined ||
    (typeof rule.delayMs === 'number' && rule.delayMs >= 0 && rule.delayMs <= 120000)) &&
  (rule.responseHeaders === undefined ||
    (Array.isArray(rule.responseHeaders) && rule.responseHeaders.every(isValidImportHeader))) &&
  (rule.failReason === undefined ||
    (typeof rule.failReason === 'string' &&
      FAIL_REASONS.includes(rule.failReason) &&
      rule.redirectUrl === undefined)) &&
  (rule.enabled === undefined || typeof rule.enabled === 'boolean');
```

Update the alert copy to: `'Invalid file: a rule has a missing/invalid "pattern", "mode", "method", mock field, or field type.'`

In the clean-copy mapper, after the `if (rule.method !== undefined)` line, add:

```ts
if (rule.statusCode !== undefined) clean.statusCode = rule.statusCode;
if (rule.delayMs !== undefined) clean.delayMs = rule.delayMs;
if (rule.responseHeaders !== undefined) {
  clean.responseHeaders = rule.responseHeaders.map((header: any) => ({
    name: header.name,
    value: header.value,
  }));
}
if (rule.failReason !== undefined) clean.failReason = rule.failReason;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS, including the existing import tests (mode/method/nested-body).

- [ ] **Step 5: Commit**

```bash
git add src/ui.ts tests/ui-behavior.test.mjs
git commit -m "feat: accept and validate mock power fields on rule import"
```

---

### Task 6: Smoke checks for status override and fail

**Files:**

- Modify: `scripts/smoke.mjs`

**Interfaces:**

- Consumes: DOM ids from Task 3 (`#modal-status`, `#modal-pattern`, fail radio, `#save-override`, `#add-api-btn`), the existing smoke structure (`site`, `popup`, `apiItem`, `PORT`, `report`).
- Produces: two new PASS/FAIL checks in the smoke run.

- [ ] **Step 1: Add the checks**

In `scripts/smoke.mjs`, inside the `if (captured) { ... }` block of section 3, after the `x-network-overrides` header check, append:

```js
// ---- 3b. status override: edit the same rule to force status 500
await apiItem.click();
await popup.waitForSelector('#override-modal', { state: 'visible' });
await popup.fill('#modal-status', '500');
await popup.click('#save-override');
await popup.waitForTimeout(1000);
const mockedStatus = await site.evaluate(
  u => fetch(u).then(r => r.status),
  `http://127.0.0.1:${PORT}/api/users`
);
report(
  'status override makes fetch observe the mocked status',
  mockedStatus === 500,
  String(mockedStatus)
);

// ---- 3c. fail rule: a fresh rule makes fetch reject at the network layer
await popup.click('#add-api-btn');
await popup.waitForSelector('#override-modal', { state: 'visible' });
await popup.fill('#modal-pattern', 'api/fail');
await popup.check('input[name="modal-override-type"][value="fail"]');
await popup.click('#save-override');
await popup.waitForTimeout(1000);
const failOutcome = await site.evaluate(
  u =>
    fetch(u).then(
      () => 'resolved',
      () => 'rejected'
    ),
  `http://127.0.0.1:${PORT}/api/fail`
);
report(
  'fail rule makes fetch reject at the network layer',
  failOutcome === 'rejected',
  failOutcome
);
```

Note: the later "worker restart" check fetches `/api/users` and asserts the body is still `{"mocked":true}` — a 500 status does not change `.text()`, so it keeps passing.

- [ ] **Step 2: Run the smoke test**

Run: `npm run smoke`
Expected: `12/12 checks passed` (the 10 existing plus the two new ones). This needs a display; the browser window opens briefly.

- [ ] **Step 3: Commit**

```bash
git add scripts/smoke.mjs
git commit -m "test: smoke-check status override and network-layer fail"
```

---

### Task 7: Documentation

**Files:**

- Modify: `README.md`
- Modify: `guide.html`

**Interfaces:** none — prose only.

- [ ] **Step 1: README**

In the feature list (top of `README.md`, near the import/export bullet), add:

```markdown
- **Status, headers, delay, and fail mocking**: a body rule can force the response status (100–599), add or overwrite response headers, and delay the response up to 120 s; a fail rule kills the request at the network layer (`Failed`, `TimedOut`, `ConnectionRefused`, `NameNotResolved`, `InternetDisconnected`).
```

README has no dedicated rule-field table today — add one right below the Pattern Reference table (the `https://site.com/api/*/list` glob table), introduced with `### Rule fields` and a one-line lead-in ("Optional fields on an override rule:"):

```markdown
| `statusCode` | optional integer 100–599 | Forces the mocked response status (body rules only). |
| `responseHeaders` | optional `{name, value}[]` | Added to the mocked response; same-name headers are overwritten case-insensitively (body rules only). |
| `delayMs` | optional number 0–120000 | Delays the response/failure by N ms (body and fail rules). |
| `failReason` | optional enum | Makes the rule fail the request at the network layer instead of answering. |
```

- [ ] **Step 2: guide.html**

In `guide.html`'s override-types list (near the "Override body / Redirect to URL" bullet around line 324), extend the copy to the three types and document the Advanced row. Add after that bullet:

```html
<li>
  <strong>Fail request</strong>: The request never receives a response — it fails at the network
  layer with the chosen reason (<code>Failed</code>, <code>TimedOut</code>,
  <code>ConnectionRefused</code>, <code>NameNotResolved</code>, <code>InternetDisconnected</code>).
  Use it to test offline and timeout handling.
</li>
<li>
  <strong>Advanced row</strong> (body rules): force a <strong>Status</strong> (100–599), add
  <strong>Extra headers</strong> (one <code>Header-Name: value</code> per line, same names overwrite
  the original), and set a <strong>Delay</strong> in milliseconds (also available for fail rules —
  combine <code>TimedOut</code> with a long delay to simulate a real timeout).
</li>
```

- [ ] **Step 3: Verify and commit**

Run: `npm test` (prettier runs via lint-staged on commit).

```bash
git add README.md guide.html
git commit -m "docs: document status, headers, delay, and fail mocking"
```

---

### Task 8: Final verification

**Files:**

- Modify (if needed): anything the checks below flag.

- [ ] **Step 1: Full suite + lint + coverage + smoke**

Run: `npm test && npm run lint && npm run coverage && npm run smoke`
Expected: all tests pass, lint clean (0 errors, 0 warnings), coverage generated, smoke `12/12 checks passed`.

- [ ] **Step 2: Cross-check against the spec**

Walk `docs/superpowers/specs/2026-07-10-phase2-mock-power-design.md` section by section: data model fields (Task 1), fail at request stage + response-stage passthrough (Task 1), status/header-merge/delay on fulfill (Task 2), modal three types + Advanced row + validation ranges (Task 3), list badges (Task 4), import validation incl. the `failReason`+`redirectUrl` combo (Task 5), smoke checks (Task 6), docs (Task 7). Fix any gap found.

- [ ] **Step 3: Commit any final fixes**

```bash
git add -A
git commit -m "fix: address phase 2 verification findings"
```

(Skip the commit if Steps 1–2 found nothing.)
