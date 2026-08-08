# Phase 2: Mock power — Design

Date: 2026-07-10
Status: Approved by user, pending implementation plan

## Summary

Second phase of the improvement roadmap. Phase 1 made the background reliable; this phase makes the mocks more powerful. Four capabilities, all built on the `Fetch` domain commands already in use:

1. **Status code override** — a rule can force the mocked response's status (500, 404, 401, …) instead of keeping the original.
2. **Response header injection** — a rule can add or overwrite headers on the mocked response.
3. **Delay** — a rule can hold the response for N ms before answering, to exercise loading states, spinners, and race conditions.
4. **Fail request** — a third rule type that makes the request fail at the network layer (`Fetch.failRequest`), to exercise offline and timeout paths.

Approach chosen with the user: extend `OverrideRule` with optional fields (option A) rather than refactoring rules into an action pipeline (option B, rejected as YAGNI). All existing infrastructure — per-rule toggle, method matching, import/export, session mirror, rehydrate — applies to the new fields automatically.

## Decisions made with the user

- **Scope**: all four capabilities in this phase.
- **Rule scope**: status/headers/delay apply to **body-mock rules only**. Passthrough rules (keep the real body, change only status or timing) are out of scope; they would require reading the real body and re-fulfilling, which belongs to a future phase if ever needed.
- **Fail** is a third override type in the existing radio selector (body / redirect / fail), not a modifier.
- **Delay** applies to body rules and fail rules. Redirect rules cannot be delayed in this phase.

## Data model (`src/shared.ts`)

`OverrideRule` gains four optional fields. Rules without them behave exactly as today — full backward compatibility, no storage migration.

```ts
interface OverrideRule {
  // existing: pattern, body, mode, redirectUrl?, method?, enabled?
  statusCode?: number; // integer 100–599; body rules only
  responseHeaders?: FetchHeader[]; // { name, value }[]; body rules only
  delayMs?: number; // 0–120000; body and fail rules
  failReason?: string; // presence makes the rule a fail rule
}
```

`failReason` must be one of the CDP `Network.ErrorReason` values exposed in the UI:
`Failed`, `TimedOut`, `ConnectionRefused`, `NameNotResolved`, `InternetDisconnected`.

Rule type stays implicit, with precedence `failReason` > `redirectUrl` > body. The UI radio makes the types mutually exclusive; import validation rejects a rule carrying both `failReason` and `redirectUrl`.

## Background (`src/background.ts`)

### Request stage (`handleRequestPaused`, no `responseStatusCode`)

- Matched rule with `failReason`: wait `delayMs` (if set), then
  `Fetch.failRequest({ requestId, errorReason: rule.failReason })`.
  `TimedOut` + a long delay simulates a real timeout. `lastError` in the callback is swallowed as elsewhere (the request may be gone by then).
- Redirect handling is unchanged.

### Response stage (existing fulfill path)

Three additions to the `Fetch.fulfillRequest` call:

- `responseCode = rule.statusCode ?? original` (existing 100–599 clamp keeps applying).
- Header merge, in order: original response headers → default `Content-Type` (only when neither original nor rule headers provide one) → `rule.responseHeaders` (same name case-insensitively overwrites, new names append) → the `x-network-overrides*` markers, which always win and cannot be removed.
- `delayMs` set: `setTimeout(fulfill, delayMs)` instead of fulfilling immediately.

Fail rules are consumed at the request stage; if one is somehow seen at the response stage, it passes through (`proceed()`).

Delays are safe in the MV3 worker: an attached debugger keeps the worker alive, and a tab closing mid-delay surfaces as an ignored `lastError` on the late command.

### Non-goals

- No `statusCode`/`responseHeaders` effect on fail or redirect rules (UI never produces that combination; background ignores stray fields).
- No delay on redirect rules.

## UI (`src/ui.ts`, `popup.html`, `panel.html`, `styles.css`)

### Modal

- The override-type radio gains a third option: **Fail request**. Selecting it hides the body and redirect fields and shows a `<select>` with the five fail reasons (default `Failed`).
- A new **Advanced** row, visible for body rules: **Status** (number input, placeholder "keep original"), **Delay (ms)** (number input, empty = no delay), and **Extra headers** (textarea, one `Header-Name: value` per line). The Delay input is also visible for fail rules.
- On save: status outside 100–599, delay outside 0–120000, or a malformed header line → `alert`, nothing saved. Empty inputs mean "field absent".
- Editing a rule pre-fills all new fields; the type radio reflects `failReason`/`redirectUrl`/body.

### Rules list

Each rule row shows compact badges next to the existing method badge so the list reads at a glance: the status code (e.g. `500`), the delay (e.g. `⏱ 3000ms`), and `FAIL` (with the reason as `title`) for fail rules.

## Import/export (`src/ui.ts`)

`isValidRule` extends:

- `statusCode`: absent, or an integer in 100–599.
- `delayMs`: absent, or a number in 0–120000.
- `responseHeaders`: absent, or an array of `{ name: string, value: string }` with non-empty names.
- `failReason`: absent, or one of the five known values.
- A rule with both `failReason` and `redirectUrl` is invalid.

Any violation rejects the whole file with the existing alert flow. The clean-copy mapper carries the new fields. The export envelope stays `version: 1` (all new fields optional) and keeps the nested-JSON body format: string bodies that parse to a JSON object/array are exported as real nested JSON and converted back to string bodies on import.

## Testing

- **Background** (`tests/background-flow.test.mjs`): fail rule issues `Fetch.failRequest` with the right `errorReason` and no fulfill; fail + delay waits before failing (small real delays, ~20 ms); `statusCode` overrides the fulfilled `responseCode`; header merge overwrites case-insensitively, appends new names, and never loses the `x-network-overrides` markers; `delayMs` defers `fulfillRequest`. Harness: `commandLog` already captures `Fetch.failRequest` via the generic `sendCommand` mock.
- **UI** (`tests/ui-behavior.test.mjs`): saving from the modal persists the new fields; editing pre-fills them; validation alerts for out-of-range status/delay and malformed header lines; import rejects each invalid field shape and the `failReason`+`redirectUrl` combo; list badges render.
- **Smoke** (`scripts/smoke.mjs`): two new checks — a rule with `statusCode: 500` makes `fetch` observe status 500, and a fail rule makes `fetch` reject. (A delay check is omitted: wall-clock assertions are flaky; unit tests cover timing.)

## Documentation

- README: feature list, rule-field reference (new fields + fail reasons), and a note that status/headers/delay apply to body rules only.
- `guide.html`: the user guide gains the fail type and the Advanced row.

## Out of scope (later phases)

Passthrough modification (real body + changed status/timing), delay on redirects, icon badge, in-page dialogs, GraphQL matching, JSON patch, profiles, regex caching, incremental rendering, ES-module build.
