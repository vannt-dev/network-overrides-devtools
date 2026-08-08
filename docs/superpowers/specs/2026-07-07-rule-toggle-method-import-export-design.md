# Per-rule toggle, method matching, and import/export — Design

Date: 2026-07-07
Status: Approved by user, pending implementation plan

## Summary

Three related additions to the override-rule system, designed together because they all touch the same schema (`OverrideRule`), the same matching logic (`findOverride` in `background.ts`), and the same UI (rules list + modal in `ui.ts`):

1. **Per-rule enable/disable toggle** — turn an individual override rule on/off without deleting it.
2. **HTTP method matching** — a rule can be scoped to a specific method (GET/POST/PUT/PATCH/DELETE) instead of always matching every method for a given URL pattern.
3. **Import/Export rules as JSON** — back up or share the current domain's override rules as a downloadable file, and load them back in.

## Data model

`src/shared.ts` — extend `OverrideRule` with two new optional fields:

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

Both fields are optional, so existing stored rules (missing these fields) remain valid with no migration step: absent `enabled` means enabled, absent/`'ANY'` `method` means any method.

### Import/export file format

```json
{
  "version": 1,
  "domain": "https://example.com",
  "exportedAt": "2026-07-07T00:00:00.000Z",
  "overrides": [
    /* OverrideRule[] */
  ]
}
```

Wrapping the array in an envelope (rather than exporting a bare array) lets Import validate the shape before writing anything, and gives a `version` field to branch on if the schema changes again later.

## Matching logic

`src/utils.ts` — new shared helper, used by both `background.ts` (via the existing `importScripts('utils.js')` wiring) and `ui.ts` (via the existing `NetworkOverridesUtils` delegation):

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

`src/background.ts` — `findOverride` gains a `method` parameter and skips rules that are disabled or method-mismatched before pattern matching:

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
    if (captures !== null) return { override: test, captures };
  }
  return null;
}
```

Both existing call sites in `handleRequestPaused` (request-stage redirect check, response-stage fulfill check) pass `params.request?.method` as the new argument.

`src/ui.ts` — the existing `state.overrides.some(o => patternMatches(o.pattern, api.url))` checks (used for tab classification, counts, and highlighting in `renderApis`/`renderApiSection`/`updateTabLabels`) split into two concerns:

- **`wouldApply(rule, api)`** — pattern **and** method match, ignoring `enabled`. Determines whether an API belongs in the "Overridden" tab vs "Other".
- **`rule.enabled === false`** checked separately — if `wouldApply` is true but the matched rule is disabled, the API still counts as "Overridden" but its list item gets a dimmed/greyed CSS class, rather than moving to "Other".

This separation is intentional: `enabled` only gates whether the rule is _applied_ at runtime (background) or _should look inactive_ (UI); it does not change whether a rule _targets_ a given request.

## UI

**Rules list (`renderList()`)**

- Add a small checkbox at the start of each `<li class="override-item">` to toggle `enabled`. On `change`, update `state.overrides[index].enabled`, persist to `chrome.storage.local`, and call `notifyBackground()`.
- Add class `override-item--disabled` when `enabled === false` (CSS: dim/grey, not hidden).
- If `method` is set and not `'ANY'`, show a small badge (e.g. `POST`) next to the mode/body preview in `override-meta`.

**Add/edit modal**

- Add a `<select id="modal-method">` with options Any/GET/POST/PUT/PATCH/DELETE, placed next to `modal-pattern`.
- `openOverrideModalForIndex` and the `saveOverrideBtn` click handler read/write this field.
- `openOverrideModal(url)` (creating a new rule from a captured API row) pre-selects the captured API's `method` instead of defaulting to "Any", since `ApiEntry.method` is already available.

**Import/Export (Overrides tab, next to the add-rule controls)**

- Two buttons: "Export" and "Import".
- **Export**: build `{ version: 1, domain: currentDomain, exportedAt: new Date().toISOString(), overrides: state.overrides }`, serialize to a `Blob`, trigger a download via a hidden `<a download>` named `network-overrides-<domain>-<date>.json`.
- **Import**: clicking triggers a hidden `<input type="file" accept="application/json">`. Read the selected file via `file.text()`, `JSON.parse` it, and validate the shape (`overrides` must be an array; each item must have `pattern` and `mode`). If the current domain already has rules, show `confirm('Rules đã tồn tại cho domain này.\nOK = nối thêm rule mới vào cuối danh sách.\nCancel = xoá hết rule cũ và thay bằng file import.')` — `confirm()` only has two outcomes, so `OK` (`true`) means append/merge and `Cancel` (`false`) means replace; there is no third "abort the import" choice once a valid file has been selected. If there are no existing rules, import writes directly with no prompt. After writing, call `renderList()` and `notifyBackground()`.
- Both `panel.html` and `popup.html` need the new static markup (`modal-method` select, Export/Import buttons, hidden file input) added, since both pages load the same `ui.ts`.

## Error handling

- **Import — unparseable JSON**: wrap `JSON.parse` in `try/catch`; on failure, `alert('File không hợp lệ: ...')` and leave storage untouched.
- **Import — parses but wrong shape** (missing `overrides` array, or an item missing `pattern`/`mode`): validate before writing; on failure, `alert` and abort — no partial import.
- **Import — unrecognized `method` value** (e.g. a hand-edited file): not blocked; `matchesMethod` just won't match anything for that rule. Consistent with how the rest of the codebase handles malformed input (graceful no-op, not a thrown error).
- **Export with zero rules**: allowed; produces a valid JSON file with an empty `overrides` array. No special-casing, consistent with the codebase's existing style of not over-guarding.
- **Merge vs. replace**: uses the native `confirm()` dialog, consistent with the codebase's existing use of native `alert()` for validation messages (e.g. "Pattern is required").

## Testing

Extends the existing test suite; no new test files unless the import/export file-API mocking genuinely requires one.

- `tests/helpers.test.mjs`: unit tests for `matchesMethod()` — undefined ruleMethod, `'ANY'`, exact match, case-insensitive match, mismatch, rule has a method but the request doesn't.
- `tests/background-flow.test.mjs`: `findOverride` skips a rule with `enabled: false`; skips a rule with a mismatched `method`; falls through to the next matching rule when an earlier one is skipped.
- `tests/ui-behavior.test.mjs`:
  - Toggling a rule's checkbox persists `enabled` to storage and calls `notifyBackground`.
  - A disabled rule whose pattern+method still match an API keeps that API in the "Overridden" tab but renders with the disabled/dimmed class.
  - A rule with a mismatched `method` does **not** count its target API as "Overridden".
  - Opening the modal from a captured API pre-selects that API's method.
  - Export produces the documented JSON envelope shape.
  - Import: merge path (existing rules + `confirm()` returns `true` → append), replace path (existing rules + `confirm()` returns `false` → overwrite), no-existing-rules path (writes directly, no `confirm()` call), and invalid-JSON path (no changes to storage, alert shown).
- `tests/test-harness.mjs` needs mocks for `URL.createObjectURL`/`revokeObjectURL` and a way to simulate a selected file on the hidden `<input type="file">`, since jsdom's File/Blob support is incomplete — to be worked out in the implementation plan.

## Out of scope

- Status-code-based rule matching (considered during brainstorming, dropped in favor of method-only matching).
- Export/import across all domains at once (scoped to the currently active domain only).
- Response delay/error simulation, response cycling, HAR/Postman export (separate feature ideas, not part of this spec).
