# Network Overrides DevTools

A Chrome/Edge DevTools extension that intercepts network responses and replaces their content during debugging. It uses `chrome.debugger` and the Chrome DevTools Protocol to pause requests at the `Response` stage, then returns a mocked body based on the rules you configure.

## Features

- Enable or disable overrides per active tab.
- Create override rules using:
  - a URL substring
  - `*` or `all` to match everything
  - a regex in `/pattern/flags` format
- View recently captured API requests.
- Click an API directly from the list to create or edit an override.
- Auto-fill the editor with the current response body when available.
- Manage overrides from both the popup and the DevTools panel.
- Persist state with `chrome.storage.local`.

## Main Structure

- `src/background.ts`: manages the debugger, intercepts requests/responses, applies overrides, and stores recent APIs and response bodies.
- `src/ui.ts`: shared UI logic for the popup and panel.
- `src/popup.ts`: initializes the popup UI.
- `src/panel.ts`: initializes the DevTools panel UI.
- `src/devtools.ts`: registers the `Overrides` tab in DevTools.
- `scripts/`: utility scripts, including store packaging.
- `tests/`: unit and interaction tests, including shared test harness utilities.
- `manifest.json`: Manifest V3 extension configuration.
- `dist/`: compiled JavaScript output generated from TypeScript.
- `old-backup/`: legacy JavaScript files kept only for reference and no longer used as the main entry points.

## Setup and Build

Requirements:

- Node.js
- Chrome or Microsoft Edge

Steps:

1. Install dependencies:

```bash
npm install
```

2. Build the TypeScript sources:

```bash
npm run build
```

3. Load the extension:

- Open `chrome://extensions` or `edge://extensions`
- Enable `Developer mode`
- Click `Load unpacked`
- Select the project root folder containing `manifest.json`

Note:

- `manifest.json` points to files inside `dist/`, so you need to build before loading the extension and after any TypeScript changes.

## Usage

### 1. Open the extension UI

You can use either of these entry points:

- Click the extension icon to open the popup.
- Open DevTools and switch to the `Overrides` tab.

### 2. Enable overrides

Check `Enable Overrides` to attach the debugger to the current tab and start intercepting responses.

### 3. Choose an API to override

- In the `Recent APIs` section, the extension shows recently captured requests.
- Click an API to open the create/edit override dialog.
- If `Auto-fill from payload` is enabled, the current response body is prefilled when captured data is available.

### 4. Define the pattern

Examples:

- `/api/users`
- `all`
- `*`
- `/api\\/v1\\/users\\/\\d+/i`

Rules are evaluated in the same order they appear in the `Overrides` list, and the first matching rule is used for a URL.

### 5. Choose the mode

- `Text`: the input content is encoded and returned as the response body.
- `Raw base64`: use this when you already have the body in base64 format.

### 6. Save the override

After saving:

- The rule is stored in `chrome.storage.local`
- The background script receives the updated configuration
- Future matching requests will receive the overridden body

## How It Works

- The extension attaches to a tab with `chrome.debugger.attach`.
- `Network.requestWillBeSent` is used to store the recent request list.
- `Fetch.requestPaused` at the `Response` stage is used to:
  - retrieve the original response body
  - or replace the response body with `Fetch.fulfillRequest`
- The extension also adds these headers:
  - `x-network-overrides: true`
  - `x-network-overrides-pattern: <pattern>`

## Notes

- The extension requires `debugger`, `storage`, and `host_permissions: <all_urls>`.
- Overrides only apply to the tab currently attached to the debugger.
- Recent data is intentionally capped to avoid memory growth:
  - up to 500 recent API URLs
  - up to 100 recent response bodies

## Development Standards

We enforce code quality and commit message standards using **Husky**, **lint-staged**, and **commitlint**.

### Formatting

Prettier is used for code formatting. A Git `pre-commit` hook automatically formats staged files (`.ts, .js, .json, .md, .html, .css, .yaml, .yml`) using `lint-staged` before they are committed.

### Commit Messages

Commit messages must follow the [Conventional Commits](https://www.conventionalcommits.org/) specification. This is enforced via Husky hooks:

- **`commit-msg`**: Validates your current commit message format.
- **`pre-push`**: Validates the entire commit range against the upstream branch before pushing.

Supported commit types (configured in `commitlint.config.mjs`):

- `add`: Add new files, assets, or dependencies
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes only
- `style`: Formatting, missing semicolons, etc. (no logic change)
- `refactor`: Code refactoring (not a feature or fix)
- `perf`: Performance improvement
- `test`: Add or update tests
- `chore`: Build process, tooling, or dependency updates
- `ci`: CI configuration changes
- `revert`: Revert a previous commit
- `build`: Build system changes

## Scripts

```bash
npm run build
npm test
npm run coverage
npm run ci:test
npm run package:store
```

## Testing

- `npm test`: builds the project and runs the full test suite.
- `npm run coverage`: builds the project, runs the tests, and generates coverage reports in `coverage/`.
- `npm run ci:test`: the same pipeline used by GitHub Actions.

Current test coverage includes:

- helper logic
- popup and panel UI behavior with DOM-based mocks
- `chrome.runtime.sendMessage` flows
- background debugger event handling
- entrypoint bootstrapping for popup, panel, and DevTools

## CI

GitHub Actions is configured in `.github/workflows/ci.yml` to:

- install dependencies with `npm ci`
- run the test and coverage pipeline
- upload the generated `coverage/` report as a workflow artifact

## Store Packaging

To create an uploadable ZIP for the Chrome Web Store or Edge Add-ons store, run:

```bash
npm run package:store
```

This command will:

- build the TypeScript output
- collect only the files needed for the extension package
- generate a ZIP file inside `release/`
- exclude source map files (`.map`) from the store package
- try to keep one ZIP per extension version while preserving ZIPs from older versions
- clean old staging folders when they are not locked by another process

Packaging notes:

- If the current version ZIP is not locked, it is replaced in place.
- If Windows or another tool is locking the existing ZIP, the script falls back to a timestamped ZIP in `release/` so packaging still succeeds.
- If old staging folders or ZIP files are locked by the OS, they may remain until those handles are released.

The ZIP includes the runtime assets only, such as:

- `manifest.json`
- `devtools.html`
- `panel.html`
- `popup.html`
- `styles.css`
- `dist/`
- `icons/`

## Legacy Version

The `old-backup/` folder contains the older JavaScript version from before the TypeScript migration. It can still be useful for reference, but the active implementation now lives in `src/` and is compiled into `dist/`.
