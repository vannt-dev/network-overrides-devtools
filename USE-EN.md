# Network Overrides DevTools — User Guide

## Table of Contents

1. [Introduction](#1-introduction)
2. [Installation](#2-installation)
3. [Interface Overview](#3-interface-overview)
4. [Basic Usage](#4-basic-usage)
5. [URL Patterns](#5-url-patterns)
6. [Override Body](#6-override-body)
7. [Redirect URL](#7-redirect-url)
8. [Managing Rules](#8-managing-rules)
9. [Additional Features](#9-additional-features)
10. [Important Notes](#10-important-notes)
11. [FAQ](#11-faq)

---

## 1. Introduction

**Network Overrides DevTools** is a Chrome/Edge extension for developers that **intercepts and overrides** API response data directly in the browser, without modifying backend code.

**Common use cases:**

- Mock API responses to test the frontend when the backend isn't ready.
- Debug by altering responses to simulate different states (errors, empty data, edge cases, etc.).
- Redirect requests from an old API to a new one without changing frontend code.
- Quickly inspect captured API requests and copy them as cURL commands.

---

## 2. Installation

### Requirements

- Chrome or Microsoft Edge (latest version).
- Extension loaded as unpacked from source.

### Steps

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select the project root directory (the folder containing `manifest.json`).
5. The "Network Overrides API (DevTools)" extension will appear.

### Verify

- The extension icon appears on the toolbar.
- Open DevTools (F12) → **Overrides** tab.

---

## 3. Interface Overview

The extension has **2 entry points**:

### 3.1. Popup

Click the extension icon on the toolbar. Contains:

- **Header**: "Network Overrides API"
- **Refresh button** (↻): Reload the captured API list.
- **Enable Overrides toggle**: Turn override functionality on/off.
- **3 tabs**:
  - **Captured APIs (N)**: List of captured requests, grouped by resource type (XHR, Fetch, JS, CSS, etc.).
  - **Overridden (N)**: APIs currently matched by an active rule.
  - **Rules (N)**: List of all saved override rules.
- **Search bar**: Filter APIs by URL substring.

### 3.2. DevTools Panel

Open DevTools (F12) → **Overrides** tab. Same as popup, plus:

- **Manual editor**: A quick-add form (pattern + body) above the Rules tab.
- **HAR auto-load**: Automatically loads request history from `chrome.devtools.network.getHAR()` on panel open.

### 3.3. Override Modal

Click an API to open the modal with:

- **Pattern**: URL pattern for matching.
- **HTTP Method**: Dropdown (`Any`, `GET`, `POST`, `PUT`, `PATCH`, `DELETE`) to scope the rule to a specific request method. Defaults to `Any`, which matches every method (same as before this field existed). Pre-filled from the captured request's method when opening the modal from a captured API.
- **Override body / Redirect to URL**: Choose the override type.
- **Response body**: Custom response content (for body override).
- **Redirect URL**: Target URL (for redirect).
- **Format JSON**: Pretty-print JSON body.
- **Body type badge**: Auto-detects `text` or `json`.
- **Save Override**: Save the rule.

---

## 4. Basic Usage

### Step 1: Open the extension

- **Option A**: Click the extension icon on the toolbar → popup opens.
- **Option B**: Open DevTools (F12) → **Overrides** tab.

### Step 2: Enable Overrides

Flip the **Enable Overrides** toggle ON.

> The extension will attach the debugger to the current tab and start monitoring network requests.

### Step 3: Capture APIs

Browse your application normally. API requests will appear automatically in the **Captured APIs** tab.

### Step 4: Create an Override

**Method 1 (Click API):**

1. Go to **Captured APIs** or **Overridden** tab.
2. Click an API you want to override.
3. The modal opens with the pattern pre-filled, and the **Method** dropdown pre-selected to the captured request's method if it's one of `GET`/`POST`/`PUT`/`PATCH`/`DELETE` (otherwise it defaults to `Any`).
4. If the API has a stored response body, it will be auto-filled into the **Response body** field.
5. Edit the content → **Save Override**.

**Method 2 (Manual — DevTools panel only):**

1. Go to the **Rules** tab.
2. In the form above, enter a **Pattern** and **Response body**.
3. Click **Add override**.

### Step 5: Verify

- Overridden APIs show a blue border in the list (`active` class).
- The **Overridden** tab shows the count and list of matched APIs.
- The real response is replaced with your custom content.

### Step 6: Disable

- Toggle the switch OFF to disable all overrides.
- Or go to **Rules** tab → click ✕ to delete a specific rule.

---

## 5. URL Patterns

### 5.1. Substring (default)

Any URL **containing** the pattern string is a match.

```
Pattern:  /api/users
Matches:  https://example.com/api/users
          https://example.com/api/users/123
          https://example.com/v2/api/users/list
No match: https://example.com/api/admin
```

### 5.2. Wildcard `*`

Use `*` to match any URL segment. Each `*` also **captures** the matched value for use in Redirect URLs.

```
Pattern:  /api/*/users/*
Matches:  /api/v1/users/123  → captures: ["v1", "123"]
          /api/v2/users/abc  → captures: ["v2", "abc"]
```

Multiple `*` wildcards are supported, each corresponding to one capturing group.

### 5.3. Regex `/pattern/flags`

Patterns starting and ending with `/` are treated as regex. Optional flags follow the closing `/`.

```
Pattern:  /\/api\/v\d+\/users/i
Matches:  /api/v1/users (case-insensitive)
          /API/V2/Users
No match: /api/admin/users
```

```
Pattern:  /\/api\/user\/(\d+)/
Matches:  /api/user/42 (captures: ["42"])
```

### 5.4. Match everything

```
Pattern: *
Pattern: all
```

Matches **every request**.

### 5.5. Rule order

Rules are evaluated in list order. **The first matching rule wins**. Drag-and-drop reordering is not supported — to change priority, delete and recreate rules in the desired order.

### 5.6. HTTP method

Besides the URL pattern, a rule can also be scoped to a specific HTTP method via the **Method** field in the override modal (see [3.3](#33-override-modal) and [4](#4-basic-usage)). A rule with a specific method (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`) only applies to requests using that method; `Any` (the default) matches every method, regardless of pattern type.

---

## 6. Override Body

### 6.1. Text mode

Content is base64-encoded and returned as the response body.

```json
// Example: Mock JSON response
{
  "status": "ok",
  "data": [
    { "id": 1, "name": "Alice" },
    { "id": 2, "name": "Bob" }
  ]
}
```

### 6.2. Raw base64 mode

Use when you already have base64-encoded content (e.g., binary data, images, pre-encoded files).

### 6.3. Body type badge

- **`text`**: Content is not valid JSON (blue badge).
- **`json`**: Content is valid JSON (green badge). Auto-detected as you type.

### 6.4. Format JSON

Click **Format JSON** to pretty-print the response body. If the content is not valid JSON, the button has no effect.

### 6.5. Auto-fill

When creating a new override from an API:

- If the API has a stored response body (in `recentApiBodies`), it is pre-filled automatically.
- Otherwise, the extension sends a `getApiData` message to the background worker to retrieve the stored body.
- This feature only works when **Auto-fill on open** is enabled (default: on).

---

## 7. Redirect URL

### 7.1. How it works

When you select **Redirect to URL**, instead of overriding the response body, the extension redirects the request at the **request stage** (before the actual request is sent).

### 7.2. Wildcard substitution

Use `*` in the Redirect URL to substitute captured values from the pattern match.

**Examples:**

| Pattern                    | Request URL                   | Captures        | Redirect URL                  | Result                           |
| -------------------------- | ----------------------------- | --------------- | ----------------------------- | -------------------------------- |
| `/api/*`                   | `https://site.com/api/user`   | `["user"]`      | `https://site.com/api/v2/*`   | `https://site.com/api/v2/user`   |
| `/api/old/*/data`          | `/api/old/v1/data`            | `["v1"]`        | `/api/new/*/data`             | `/api/new/v1/data`               |
| `https://old.com/*/item/*` | `https://old.com/shop/item/5` | `["shop", "5"]` | `https://new.com/*/product/*` | `https://new.com/shop/product/5` |

If any `*` remains unsubstituted in the Redirect URL, the extension logs an error and lets the request proceed normally (no redirect).

**Common mistake:** Pattern has 1 `*` but Redirect URL has 2 `*`:

| Pattern                  | Request URL                 | Captures   | Redirect URL                 | Result                               |
| ------------------------ | --------------------------- | ---------- | ---------------------------- | ------------------------------------ |
| `https://site.com/api/*` | `https://site.com/api/user` | `["user"]` | `https://site.com/api/v2/**` | ❌ Error: second `*` not substituted |

### 7.3. When to use

- Redirect from an old API to a new API without changing frontend code.
- Point requests from production to a staging/local server for debugging.
- Suppress certain requests by redirecting to an empty endpoint.

---

## 8. Managing Rules

### 8.1. View rules

Go to the **Rules** tab. Each rule displays:

- **Enabled checkbox**: at the start of the row. Unchecked means the rule is disabled (see [8.5](#85-enabledisable-a-rule)).
- **Pattern**: Bold blue text.
- **Method badge** (if set to something other than `Any`): a small badge (e.g. `POST`) next to the body preview.
- **Redirect URL** (if set): Arrow → followed by the URL.
- **Body preview**: First 80 characters + mode label (`text`/`file`).

### 8.2. Edit a rule

Click **✎** next to a rule → modal opens with current values → edit → **Save Override**.

### 8.3. Delete a rule

Click **✕** → rule is removed immediately.

### 8.4. Persistence

- Rules are stored in `chrome.storage.local` → **they never disappear** on page refresh, DevTools close, or browser restart.
- No need to worry about losing your configuration.

### 8.5. Enable/disable a rule

Each rule has a checkbox at the start of its row. Unchecking it **disables** the rule (`enabled: false`) without deleting it:

- The rule stays visible in the **Rules** list, dimmed.
- Any API it targets stays in the **Overridden** tab (it still "would apply" by pattern and method) but is also shown dimmed, since a disabled rule is no longer actively applied.
- The background service worker skips disabled rules when deciding which override to apply to a request.

Checking the box re-enables the rule. New rules, and rules that existed before this feature was added, default to **enabled**.

### 8.6. Export rules

Click **Export** in the **Rules** tab to download the rules for the **currently active domain** as a JSON file (named after the domain). The file has this shape:

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

Export only includes rules for the domain currently open in the panel, not all domains.

### 8.7. Import rules

Click **Import** in the **Rules** tab and pick a previously exported (or hand-crafted) JSON file:

- If the current domain **already has rules**, a confirm dialog asks how to combine them: **OK** merges — the imported rules are appended to the end of the existing list; **Cancel** replaces — all existing rules for the current domain are overwritten by the imported ones.
- If the current domain **has no rules yet**, the import is applied directly with no prompt.
- Invalid files (not valid JSON, missing the `overrides` array, or a rule missing required fields) are rejected with an alert, and nothing is changed.

Like Export, Import always operates on the domain currently active in the panel — never all domains at once.

---

## 9. Additional Features

### 9.1. Copy cURL

Each API entry has a **cURL** button. Click to copy the request as a cURL command:

```bash
curl 'https://api.example.com/data' \
  -X 'POST' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer xxx' \
  --data-raw '{"key":"value"}'
```

### 9.2. Search APIs

Search box in the **Captured APIs** and **Overridden** tabs. Searches by URL substring (case-insensitive). Matching text is highlighted with a yellow background.

### 9.3. Refresh API list

Click the **Refresh** button (↻) in the top right. The extension retries up to 5 times (each 250ms apart) to load APIs from the background worker.

### 9.4. Type grouping

APIs are grouped by resource type:

| Type        | Label       |
| ----------- | ----------- |
| XHR         | XHR         |
| Fetch       | Fetch       |
| JS          | JS          |
| CSS         | CSS         |
| Image       | Img         |
| Media       | Media       |
| Font        | Font        |
| Document    | Doc         |
| WebSocket   | WS          |
| Manifest    | Manifest    |
| EventSource | EventSource |
| TextTrack   | TextTrack   |
| Other       | Other       |

Click a group header (e.g. "XHR ▼") to collapse/expand. Collapse state is persisted in storage.

### 9.5. Marker headers

When a request is overridden, the extension adds these response headers:

- `x-network-overrides: true`
- `x-network-overrides-pattern: <pattern>`

This lets you easily identify overridden requests in the DevTools Network tab.

---

## 10. Important Notes

### 10.1. Scope

- Overrides only apply to the **currently attached tab**.
- Each time you toggle ON, the extension attaches to the **active tab**.
- Switching to another tab disables overrides for the new tab until you toggle again.

### 10.2. Capacity limits

- Maximum **500 URLs** in the recent APIs list.
- Maximum **100 response bodies** stored.
- When exceeded, the oldest entries are evicted (FIFO).

### 10.3. Body storage

- Only **XHR** and **Fetch** resource types have their response bodies stored (for auto-fill).
- Other types (JS, CSS, Image, etc.) are not stored.

### 10.4. Tab ID dependency

Recent APIs and response bodies are keyed by `recentApis_{tabId}` and `recentApiBodies_{tabId}`. When you close a tab and reopen it, the new `tabId` differs → old data is not shown.

### 10.5. Not for production use

This extension is designed for **developer debugging only**. Do not use it in end-user production environments.

### 10.6. Required permissions

The extension requires:

- `debugger` — to intercept network requests.
- `storage` — to persist rules and data.
- `<all_urls>` — to attach the debugger to any tab.

---

## 11. FAQ

### Q: Override not working?

**Checklist:**

1. Is **Enable Overrides** turned ON? (Toggle should be blue.)
2. Does the pattern match the URL? Try `*` to match everything.
3. Is the current tab the one being debugged? (Try refreshing the extension.)
4. Open DevTools → extension's Console to check for errors.

### Q: Turned off overrides but requests are still being modified?

Try refreshing the page. If the issue persists, disable and re-enable the extension.

### Q: How do I delete all rules at once?

Go to the **Rules** tab and click ✕ on each rule. There is no "Clear all" button.

### Q: Old API data from yesterday is still showing?

Override rules are permanent and survive restarts. Recent APIs, however, are linked to `tabId`. If you see old data, you might be on the same tab you used before. Closing and reopening the tab assigns a new `tabId`, so old data won't appear.

### Q: Extension doesn't work in incognito mode?

Go to `chrome://extensions` → click **Details** on the extension → enable **Allow in incognito**.

### Q: How can I tell if a request was overridden?

Check the DevTools Network tab:

- Response header `x-network-overrides: true` is added.
- In the extension, the API entry is highlighted in blue and appears in the **Overridden** tab.

### Q: APIs are not showing up in Captured APIs?

Click the **Refresh** button (↻). The extension retries 5 times over 1.25 seconds. If still empty:

1. Verify the toggle is ON.
2. Check the Network tab to confirm requests are being sent.
3. Try the DevTools panel instead of the popup (panel uses `chrome.devtools.network`, which may capture more).

### Q: Does this support localStorage or sync storage?

No. The extension uses `chrome.storage.local` (10MB limit). Sync storage is not used since rules may contain large response bodies.

### Q: Can I override WebSocket connections?

No. The extension only intercepts HTTP requests (XHR, Fetch) via Chrome's Fetch domain. WebSocket is not supported.

### Q: Can I import rules exported from a different domain?

Yes. Import always writes into the domain that's currently active in the panel, regardless of which domain the file's `domain` field says it was exported from.
