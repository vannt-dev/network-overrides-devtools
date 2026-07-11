# Network Overrides DevTools

A Chrome/Edge DevTools extension that intercepts network responses and replaces their content during debugging. It uses `chrome.debugger` and the Chrome DevTools Protocol (Fetch domain) to pause requests, then returns a mocked body or redirects to a different URL based on configured rules.

## Features

- **Enable/disable** overrides per active tab via a toggle switch.
- **Per-rule enable/disable toggle**: disable an individual rule without deleting it; it stays visible (dimmed) and is skipped by the background worker until re-enabled.
- **HTTP method matching**: scope a rule to `GET`/`POST`/`PUT`/`PATCH`/`DELETE`, or leave it at `Any` to match every method (default, pre-filled from the captured request when available).
- **Import/export rules as JSON**: back up or share the current domain's rules as a downloadable file, and load them back in with a merge-or-replace choice.
- **Three pattern matching modes** for override rules:
  - URL substring match (e.g. `/api/users`)
  - Wildcard `*` glob (e.g. `https://old.com/api/*/users` → `*` captures matching segments)
  - Regex `/pattern/flags` (e.g. `/api\/v1\/users\/\d+/i`)
  - `*` or `all` matches every request.
- **Two override types:**
  - **Override body**: Replace the response body with custom text or raw base64 content.
  - **Redirect URL**: Redirect the request to a different URL (supports `*` wildcard substitution from captured groups).
- **Status, headers, delay, and fail mocking**: a body rule can force the response status (100–599), add or overwrite response headers, and delay the response up to 120 s; a fail rule kills the request at the network layer (`Failed`, `TimedOut`, `ConnectionRefused`, `NameNotResolved`, `InternetDisconnected`).
- **View captured APIs**, grouped by resource type (XHR, Fetch, JS, CSS, Img, Doc, WS, etc.), with real-time updates from the background service worker.
- **Search APIs** by URL substring.
- **One-click override creation**: Click any API in the list to open the modal and create/edit an override rule.
- **Auto-fill response body**: When creating a new override, the current response body is automatically fetched from the background worker and pre-filled into the editor.
- **JSON formatting**: Auto-detect and format JSON bodies with a single button.
- **Copy cURL**: Copy any API request as a cURL command.
- **Manual rule editor** (DevTools panel only): Quickly add a rule without opening the modal.
- **Persistent storage**: All rules and settings survive browser restarts via `chrome.storage.local`.

## Architecture

```
src/
├── shared.ts          # Shared type definitions (OverrideRule, ApiEntry, FetchHeader, etc.)
├── background.ts      # Service worker: debugger lifecycle, request interception, override fulfillment
├── devtools.ts        # Registers the "Overrides" tab in Chrome DevTools
├── panel.ts           # DevTools panel UI initialization + HAR log & real-time network listener
├── popup.ts           # Popup UI initialization (simpler UI, no manual editor)
├── ui.ts              # Shared UI logic (rendering, modal, tabs, search, cURL, etc.)
└── utils.ts           # Helpers: pattern matching, wildcards, origin parsing

dist/                  # Compiled JavaScript (from tsc)
styles.css             # Shared styles for popup and panel
panel.html             # DevTools panel HTML
popup.html             # Popup HTML
devtools.html          # DevTools bootstrap page
manifest.json          # Manifest V3 configuration
```

### Key flows

1. **Initialization**: `devtools.ts` creates a DevTools panel → `panel.ts` fires up UI + listens to `chrome.devtools.network` events (HAR + `onRequestFinished`). Popup uses `popup.ts` instead, without HAR or manual editor.

2. **Debugger attachment**: When "Enable Overrides" is checked, `background.ts` calls `chrome.debugger.attach` on the active tab, then enables `Network` and `Fetch` domains (both Request and Response stages). Detachment happens on disable, tab close, or debugger disconnect.

3. **Request interception** (`Fetch.requestPaused`):
   - **Request stage**: Checks override rules for a `redirectUrl`. If found and pattern matches, the request is redirected via `Fetch.continueRequest` with a modified URL. Wildcards (`*`) in the redirect URL are substituted with captured groups from the pattern match.
   - **Response stage**: Checks override rules for a body replacement. If found, `Fetch.fulfillRequest` sends the custom body (base64-encoded) with original headers + `x-network-overrides: true` marker. If no rule matches, XHR/Fetch response bodies are stored for later auto-fill via `Fetch.getResponseBody`.

4. **Recent API tracking**: `Network.requestWillBeSent` captures request metadata into an in-memory Map (per tabId), mirrored to `chrome.storage.session` under key `tabState_{tabId}` (debounced). Capped at 500 URLs and 100 bodies. On worker startup, this state is rehydrated from `chrome.storage.session` and the debugger is re-attached to tabs that were enabled; any legacy `recentApis_{tabId}` / `recentApiBodies_{tabId}` keys left over from older versions in `chrome.storage.local` are removed automatically.

5. **UI state**: `enabled`, `overrides[]`, and `apiSearchTerm` are persisted in `chrome.storage.local` and survive across DevTools sessions and browser restarts.

## Storage

Rule and UI state is stored in `chrome.storage.local` (permanent); per-tab runtime state is stored in `chrome.storage.session` (cleared when the browser exits):

| Key                | Type                                                                      | Persistence                                                                                             |
| ------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `enabled`          | `boolean`                                                                 | Permanent — survives browser restart                                                                    |
| `overrides`        | `OverrideRule[]`                                                          | Permanent — survives browser restart                                                                    |
| `apiSearchTerm`    | `string`                                                                  | Permanent — survives browser restart                                                                    |
| `tabState_{tabId}` | per-tab snapshot (`enabled`, `origin`, `overrides`, captured APIs/bodies) | `chrome.storage.session` — cleared when the browser exits; rehydrated and re-attached on worker startup |

**Important**: Override rules are never lost. Recent API data is keyed by `tabId`, lives only for the current browser session, and is only visible when the same tab is active. Legacy `recentApis_{tabId}` / `recentApiBodies_{tabId}` keys from older extension versions are automatically removed from `chrome.storage.local` on worker startup.

## Pattern Reference

Override rules are evaluated in order; the first matching rule for a URL is used.

| Pattern                       | Matches                                                      |
| ----------------------------- | ------------------------------------------------------------ |
| `/api/users`                  | Any URL containing `/api/users`                              |
| `*` or `all`                  | Every request                                                |
| `https://site.com/api/*/list` | URLs matching the glob; `*` captures zero or more characters |
| `/\/api\/v\d+\/users/`        | Regex match (literal `/` delimiters, no flags)               |
| `/\/api\/user\/(\d+)/gi`      | Regex with flags `g` and `i`                                 |

In redirect URLs, `*` substitutes captured wildcards in order. For example:

- Pattern: `https://old.com/api/*/item/*`
- Redirect: `https://new.com/api/*/product/*`
- Request URL: `https://old.com/api/v2/item/5`
- Redirected to: `https://new.com/api/v2/product/5`

### Rule fields

Optional fields on an override rule:

| Field             | Type                       | Description                                                                                           |
| ----------------- | -------------------------- | ----------------------------------------------------------------------------------------------------- |
| `statusCode`      | optional integer 100–599   | Forces the mocked response status (body rules only).                                                  |
| `responseHeaders` | optional `{name, value}[]` | Added to the mocked response; same-name headers are overwritten case-insensitively (body rules only). |
| `delayMs`         | optional number 0–120000   | Delays the response/failure by N ms (body and fail rules).                                            |
| `failReason`      | optional enum              | Makes the rule fail the request at the network layer instead of answering.                            |

## Usage

### 1. Open the extension UI

Two entry points:

- **Popup**: Click the extension icon in the toolbar. Shows "Captured APIs", "Overridden", and "Rules" tabs.
- **DevTools panel**: Open DevTools (F12) → "Overrides" tab. Same UI plus a manual rule editor row at the top of the "Rules" tab.

### 2. Enable overrides

Toggle **Enable Overrides** on. The extension attaches the debugger to the current tab.

### 3. Capture APIs

Browse your application as normal. Requests appear in the **Captured APIs** tab, grouped by resource type (XHR, Fetch, JS, CSS, etc.). Use the search bar to filter by URL.

### 4. Create an override

Click any API in the list to open the override modal. You can also add a rule manually (DevTools panel only) by filling in the pattern, body, and clicking "Add override".

In the modal, choose:

- **Override body**: Enter custom response body text. Use `Text` mode for raw text or `Raw base64` for pre-encoded content. The body type badge auto-detects JSON. Use the "Format JSON" button to prettify.
- **Redirect to URL**: Enter the target URL. Use `*` to substitute wildcards captured from the pattern match.

### 5. Manage rules

Switch to the **Rules** tab to view, edit (✎), or delete (✕) all saved rules. Each rule has an enabled checkbox (uncheck to disable without deleting — the rule stays visible but dimmed and is skipped by the background worker) and an optional method field (scope the rule to one HTTP method instead of any). Use the **Export**/**Import** buttons to save the current domain's rules to a JSON file or load them back in (import offers a merge-or-replace choice when rules already exist). The **Overridden** tab shows which captured APIs are currently matched by any rule.

### 6. Copy cURL

Each API entry has a "cURL" button that copies the request as a cURL command (method, headers, and post data included).

## Setup & Build

Requirements: Node.js 22+, Chrome or Edge.

```bash
npm install
npm run build
```

Load the extension:

1. Open `chrome://extensions` or `edge://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the project root (the folder containing `manifest.json`)

The `manifest.json` points to files in `dist/`, so re-run `npm run build` after any TypeScript changes.

## Scripts

```bash
npm run build          # Compile TypeScript → dist/
npm test               # Build + run test suite
npm run coverage       # Build + run tests with coverage report
npm run ci:test        # CI pipeline (same as coverage)
npm run smoke          # Real-browser smoke test (loads the unpacked extension into Chromium)
npm run package:store  # Create a ZIP for Chrome Web Store / Edge Add-ons
```

## Development Standards

- **Formatting**: Prettier via lint-staged (pre-commit hook).
- **Commit messages**: Conventional Commits enforced by commitlint + Husky hooks.
- **Commit types**: `add`, `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `ci`, `revert`, `build`.

## Testing

Tests live in `tests/` and cover:

- Pattern matching logic (`helpers.test.mjs`)
- UI behavior with DOM mocks (`ui-behavior.test.mjs`)
- Background debugger event handling (`background-flow.test.mjs`)
- Entrypoint bootstrapping (`entrypoints.test.mjs`)

`npm run smoke` (`scripts/smoke.mjs`) additionally drives the real unpacked extension in Chromium via Playwright — attach status, interception, worker-restart recovery, cross-origin navigation, and attach failures. Run it before releases; it needs a display (headed browser) and downloads Chromium on first use.

## CI

GitHub Actions (`.github/workflows/ci.yml`) installs dependencies, runs tests with coverage, and uploads the coverage report as an artifact.

## Store Packaging

```bash
npm run package:store
```

Produces a ZIP in `release/` containing only the runtime files: `manifest.json`, `*.html`, `styles.css`, `dist/`, `icons/`.

## Permissions

- `debugger` — required to intercept and modify network requests via Chrome DevTools Protocol.
- `storage` — required to persist override rules, settings, and recent API data.
- `host_permissions: <all_urls>` — required to attach the debugger to any tab.

## Limitations

- Overrides only apply to the tab currently attached to the debugger.
- Recent API data is capped at 500 URLs and 100 response bodies per tab.
- Recent API bodies are only stored for XHR and Fetch resource types by default. Configure `CAPTURED_BODY_TYPES` in `src/background.ts` to add more types.
- Recent API lists are keyed by `tabId` and reset when the tab is closed and reopened.
- The extension is designed for developer debugging only, not for end-user production use.
