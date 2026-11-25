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

🛒 **Chrome Web Store**: [Network Overrides API (DevTools)](https://chromewebstore.google.com/detail/network-overrides-api-dev/holdjgmcnpelgclhopiejilhhkfcmpba)

**Common use cases:**

- Mock API responses to test the frontend when the backend isn't ready.
- Inject or override Request Headers (e.g. `Authorization: Bearer token`).
- Debug by altering responses to simulate different states (errors, empty data, edge cases, etc.).
- Redirect requests from an old API to a new one without changing frontend code.
- 1-click Duplicate Rules and manage Rule Profiles / Presets per domain.
- Real-time Image and SVG visual preview inside the modal editor.
- Quickly inspect captured API requests and copy them as cURL commands.

---

## 2. Installation

### Requirements

- Chrome or Microsoft Edge (latest version).
- Install from [Chrome Web Store](https://chromewebstore.google.com/detail/network-overrides-api-dev/holdjgmcnpelgclhopiejilhhkfcmpba) or load as unpacked from source.

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
  - **Rules (N)**: List of all saved override rules, one line each: what the rule matches → what it does (for example `GET /api/orders → 500 · slow 3 s`).
- **Search bar**: Filter APIs by URL substring.

### 3.2. DevTools Panel

Open DevTools (F12) → **Overrides** tab. Same as popup, plus:

- **Manual editor**: A quick-add form (pattern + body) above the Rules tab.
- **HAR auto-load**: Automatically loads request history from `chrome.devtools.network.getHAR()` on panel open.

### 3.3. Override Modal

Click **Mock this** on an API (or the API row) to open the modal. It shows the everyday fields first:

- **Presets**: one click fills the fields below.
  - **Empty list**: status 200 and `[]` (or, when the body is a JSON object, the same object with its lists emptied; `{}` when it has none).
  - **Server error**: status 500 and `{"error":"Internal Server Error"}`.
  - **Slow (3 s)**: a 3000 ms delay; the body stays as it is.
  - **Offline**: a network error (`InternetDisconnected`).
  - **No CSP**: keep the real response and remove its `Content-Security-Policy` headers (see [6.11](#611-keep-the-real-response-remove-headers)).
  - **No cache**: keep the real response and remove its caching headers (`Cache-Control`, `Expires`, `ETag`, `Last-Modified`, `Pragma`, `Age`).
- **URL pattern**: URL pattern for matching. You can edit it, also after **Mock this**: change `/api/users/42` to `/api/users/*` so one rule matches more URLs.
- **Method**: Dropdown (`Any`, `GET`, `POST`, `PUT`, `PATCH`, `DELETE`) to scope the rule to a specific request method. Defaults to `Any`, which matches every method. Pre-filled from the captured request's method when opening the modal from a captured API.
- **Mock response / Redirect / Network error / WebSocket / Inject JS/CSS / CRUD collection**: Choose the rule type (see [6.13](#613-crud-collection-a-fake-rest-api) for CRUD collection).
- **Status code** (mock response): blank keeps the real status. Pre-filled from the captured request when it can carry a body (not 204, 304 or other 3xx).
- **Response body**: Custom response content (for a mock response).
- **Redirect URL**: Target URL (for redirect).
- **Format JSON**: Pretty-print JSON body.
- **Save Override**: Save the rule.

Everything else is in the collapsed **Advanced** section, in groups:

- **Conditions**: **GraphQL operation** (see [5.7](#57-graphql-operation)), query parameters, request headers and a text the request body must contain (see [5.8](#58-query-header-and-body-conditions)), and **Apply on every site (global rule)** (see [9.6](#96-global-rules)).
- **Timing & failure**: **Delay (ms)**, **Simulate a network error** (for the Network error type: the error the page sees), and **Answer without calling the server** (mock response; see [6.6](#66-answer-without-calling-the-server)).
- **Response headers**: headers to add to the response, and **Headers to remove from the response** (see [6.11](#611-keep-the-real-response-remove-headers)).
- **Body type: patch & script**: **The response body is** `Text`, `Raw base64`, `Script (JavaScript)`, `Patch the real JSON response` (see [6.7](#67-patch-the-real-json-response)) or `Keep the real response (headers only)` (see [6.11](#611-keep-the-real-response-remove-headers)), and **Fill in {{...}} placeholders**.
- **Random responses**: more answers for the rule, each with a weight, and a seed for a repeatable order (see [6.12](#612-random-responses-by-weight)).
- **Change the request**: replace the request body sent to the server, and add or replace request headers.

A group that holds a value shows a count on its header, and opens by itself when you edit the rule, so no setting is hidden. Choosing **Network error** opens **Timing & failure** to show the error to simulate.

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
2. Click **Mock this** on the API you want to override (clicking the row does the same). If a rule already covers the API, that rule opens for editing instead of a new one.
3. The modal opens with the pattern and the real status pre-filled, and the **Method** dropdown pre-selected to the captured request's method if it's one of `GET`/`POST`/`PUT`/`PATCH`/`DELETE` (otherwise it defaults to `Any`).
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

Rules are evaluated in list order. **The first matching rule wins**. To change priority, drag a rule by its `⠿` handle and drop it on the upper or lower half of another rule, or focus the handle and press the up or down arrow key. The new order is saved at once.

Domain rules always run before global rules, so a rule can only be moved within its own group: a domain rule among the domain rules, a global rule among the global rules.

### 5.6. HTTP method

Besides the URL pattern, a rule can also be scoped to a specific HTTP method via the **Method** field in the override modal (see [3.3](#33-override-modal) and [4](#4-basic-usage)). A rule with a specific method (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`) only applies to requests using that method; `Any` (the default) matches every method, regardless of pattern type.

### 5.7. GraphQL operation

GraphQL apps usually send every query to one URL, such as `/graphql`. Fill **GraphQL Operation** in the modal to apply the rule to one operation only. The rule matches when the request body is JSON whose `operationName` equals the value (case does not matter); failing that, when its `query` text contains the value; failing that, when the raw request body contains it. A request without a body does not match. Leave the field empty to match every request to the URL.

### 5.8. Query, header and body conditions

Open **Advanced → Conditions** in the modal to narrow a rule to some requests of the same URL. Every condition you fill in must hold, together with the pattern, method and GraphQL operation. Leave them empty and the rule matches as before.

- **Query parameters**: write them as in a URL, for example `page=2&debug`. `page=2` needs `page` to equal `2` (one of its values, if it repeats; values are compared after URL decoding). `debug` alone needs `debug` to be present, with any value. Names are case-sensitive.
- **Request headers**: one per line. `X-Tenant: acme` needs that header with that exact value; `Authorization` alone needs the header to be present. Header names ignore case.
- **Request body contains**: the request body must contain this text, for example `"plan":"pro"`. Case matters. If the browser does not hand the body to the extension (for example a streamed upload), the condition does not match.

A rule's line in the rules list shows its conditions, such as `+ query page=2`. A CORS preflight carries neither the headers nor the body of the request behind it, so only the query conditions are checked for the preflight.

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

### 6.6. Answer without calling the server

A body rule normally waits for the real response and then replaces it, so the server is always called first: a `POST` still has its side effects, and the mock fails when the host is down or the endpoint does not exist yet.

Tick **Answer without calling the server** to answer the request in the browser instead, before it is sent. The body, **Status code** and **Response headers** of the rule make the whole response, and the delay still applies. A host that cannot be reached gets the mock too. Its line in the Rules tab ends with `no server`.

Compared with a normal body rule:

- There is no original response. A blank status means `200`, and the only headers are the ones you add (plus `Content-Type: application/json; charset=utf-8` when you set none, and the CORS headers below).
- Templates such as `{{now}}`, `{{uuid}}` and `{{$queryParam(name)}}` work, since they do not need the server.
- In Script mode, `request.response` is `{ status: null, headers: {}, body: null }`.
- The rule's request header and request body changes are not used, since no request is sent.
- Cross-origin requests work with no extra headers: the CORS preflight is answered for you, and the mock allows the page's origin unless you set your own `Access-Control-Allow-*` headers.

### 6.7. Patch the real JSON response

Pick **Patch the real JSON response** in the Response body mode list when you want the real data with a few fields changed, for example to turn on a paid plan or hide a banner, instead of copying the whole response into a rule. The request goes to the server; the rule changes only the fields you list in its JSON response.

Write one change per line:

```text
set data.user.plan = "pro"
remove data.ads
set data.items[0].price = 0
set data.flags = {"beta": true}
```

- `set <path> = <value>` puts a value at the path. The value is JSON: write text in double quotes (`"pro"`), and numbers, `true`, `false`, `null`, objects and arrays as they are.
- `remove <path>` deletes a field, or an array item (the items after it move up).
- A path uses dots for fields and `[0]` for array items: `data.items[0].name`. A key with dots, spaces or `=` goes in quotes: `data["user.name"]`. A path that starts with `/` is a JSON Pointer: `/data/items/0/name`.
- `[-]` (or `-` in a JSON Pointer) means the end of an array: `set data.items[-] = {"id": 99}` appends an item.
- When a `set` path does not exist yet, the missing objects are created (an array when the next part is `[0]` or `[-]`). A `remove` of something that is not there does nothing.

The real status and headers are kept; **Status code**, **Response headers** and **Delay** still apply when you fill them. `Content-Length` is worked out again for the new body. The JSON is sent back compact, without the server's spacing. Templates such as `{{now}}` are not processed in patch values, and **Answer without calling the server** is not offered, since a patch needs the real response.

When the response is not JSON or has no body (an HTML page, a `204`, a redirect), it passes through unchanged and the panel shows a warning. A change that cannot apply, such as a path through a text field or an array index past the end, is skipped and named in the same warning; the other changes still apply. The rule's line in the Rules tab ends with `patch N fields`; hover it to see the changes.

### 6.8. Script response

Pick **Script (JavaScript)** in the Response body mode list to compute the response instead of holding one. The body is the body of an async function that receives `request` and returns the response:

```js
// Keep the real response, but only its first three items.
const data = JSON.parse(request.response.body);
return { status: 200, body: { ...data, items: data.items.slice(0, 3) } };
```

- `request` holds `url`, `method`, `headers` (names in lower case), `query` (the first value of each parameter), `params` (what each `*` of the pattern matched), `body` (the request payload, or `null`), `response`: the original `status`, `headers` and `body`, and `vars`: your variables (see [9.14](#914-variables)).
- Return a string for the body, `{ status, headers, body }` (any of them; `body` is sent as JSON when it is not a string), or any other value to send it as JSON. A status or header the script returns wins over the rule's own; the delay still applies. Templates such as `{{now}}` are not processed in a script.
- The script runs in the inspected page, so it can use `fetch`, `localStorage` and the page's own globals. It has 5 seconds. A script that throws, returns nothing, returns a status outside 100–599 or runs out of time is answered with status `500`, the error as its text and the header `x-network-overrides-error: script`.
- Rules imported from a file may contain scripts, which run in the pages they match: import only files you trust.

### 6.9. Replace a static file

A **Mock response** rule also answers scripts, stylesheets, images, fonts and pages. Point the URL pattern at the file (for example `/static/app.js`) and click **Use a local file…** under the response body.

- A text file (JS, CSS, HTML, JSON, SVG, XML) goes into the body box and stays editable. Any other file (an image, a font) is kept as is and shown as _From file name (size)_, with a **Remove file** button.
- The `Content-Type` is set from the file; change it under **Advanced → Response headers**. The rule answers with status `200` unless you set another, so a file the server does not have (404) still loads.
- Rules live in browser storage, about 10 MB in all. The editor warns above 2 MB.
- While a tab is intercepted its browser cache is bypassed, so the rule also applies to a file the page had cached. Reload the page after adding the rule.
- A script or stylesheet with an `integrity` attribute (SRI) refuses a replaced file. Requests a service worker answers itself are not intercepted.

### 6.10. Inject JS/CSS into a page

Choose the type **Inject JS/CSS** to add your own script and stylesheet to the pages a rule matches, such as `https://example.com/*`. The real page still loads; the rule only adds to it.

- The stylesheet goes at the end of `<head>`; the script goes at the end of `<body>`, so the page's elements exist when it runs.
- Only pages (documents) are changed, and only successful (2xx) UTF-8 HTML responses. Other rules, such as API mocks, keep working on the same page.
- A page with a Content-Security-Policy keeps it: the SHA-256 hash of the injected script and stylesheet is added to the policy, so exactly that code runs, while the page's own inline code and the rest of the policy stay as they were. A CSP `sandbox` without `allow-scripts` still stops the script, and the panel warns you.
- If your code loads other scripts, uses `eval` or inline event handlers, the policy may still block that part. As a last resort tick **Remove the page's Content-Security-Policy**: the matched pages then load without their CSP while the rule is on, which lowers their protection.
- Reload the page after adding or changing the rule.

### 6.11. Keep the real response, remove headers

A rule can drop headers from a response, for example a `Content-Security-Policy` that stops your debugging, or the caching headers that keep an old file around.

- Pick **Keep the real response (headers only)** in **Advanced → Body type** to leave the server's body as it is. The request goes to the server; only the status (when you set one) and the headers change. The **No CSP** and **No cache** presets set this up in one click.
- List the headers under **Advanced → Response headers → Headers to remove from the response**, one per line (or separated by commas). Case does not matter. A name ending in `*` removes every header that starts with it: `x-debug-*`.
- Removal works with every mock response too: the server's headers that would be kept are removed, then the rule's own **Response headers** are added. So you can remove `Cache-Control` and add `Cache-Control: no-store`.
- The extension's marker headers (see [9.12](#912-marker-headers)) are never removed.
- A response whose body cannot be read, such as a redirect, passes through unchanged and the panel warns you. **Answer without calling the server** is not offered, since the rule needs the real response.

### 6.12. Random responses by weight

A **Mock response** rule (Text or Raw base64 body) can answer with one of several responses, to see how a page copes with a flaky API.

1. Write the usual body and status: this is the first response.
2. Open **Advanced → Random responses**, click **+ Add a response** and fill its **Weight**, **Status** (blank keeps the rule's status), **Body** and **Headers** (`Name: value`, added over the rule's headers).
3. Set **Weight of the response above** for the first response (blank is 1).

Each request gets one response, picked by weight: weights `80` and `20` give the first one about 8 times in 10. A weight of `0` is never picked. Templates and variables work in every body. The answer carries the header `x-network-overrides-response`, the number of the response it gave (`1` is the rule's own).

**Seed (repeatable order)**: blank picks at random. With a number, the picks follow the same order every time, which suits automated tests. The order follows how many times the rule was applied, so it goes on across a browser worker restart; **Reset counts** in the Rules tab, or an edit of the rule, starts it over.

### 6.13. CRUD collection (a fake REST API)

Choose the type **CRUD collection** to mock a whole REST resource that remembers changes, for a page you build before its API exists, or to try a create/edit/delete flow without touching real data. The server is never called, so the address does not have to exist.

1. **URL pattern**: the address of the list, such as `/api/todos`. A plain pattern matches an address that ends with it; a `*` pattern or a `/regex/` must match the list address (`*/api/todos`).
2. **Response body** is the **seed**: a JSON array of objects, such as `[{"id": 1, "title": "Buy milk", "done": false}]`. Blank is an empty list.
3. **ID field**: the field that holds each item's id (blank is `id`). **New items get** the next number (one more than the largest number id; an id is never given twice, even after a delete) or a random UUID.

The rule then answers:

| Request               | Answer                                                                                                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/todos`      | `200` and the list. `?done=true&user=2` keeps the items whose fields equal those values (compared as text); `_limit=10&_page=2` returns one page. The header `X-Total-Count` gives the number of matching items before paging. |
| `GET /api/todos/1`    | `200` and the item, or `404` and `{"error":"Not found"}`. Ids are compared as text, so `/1` finds `"id": 1`.                                                                                                                   |
| `POST /api/todos`     | `201` and the new item with its id. An id in the body is kept, or `409` when it is taken.                                                                                                                                      |
| `PUT /api/todos/1`    | `200` and the item replaced by the body (the id stays), or `404`.                                                                                                                                                              |
| `PATCH /api/todos/1`  | `200` and the item with the body's top-level fields merged in (the id stays), or `404`.                                                                                                                                        |
| `DELETE /api/todos/1` | `204` with no body, or `404`.                                                                                                                                                                                                  |

A `POST`, `PUT` or `PATCH` whose body is not a JSON object gets `400`; a method the address does not take gets `405`; an address below an item (`/api/todos/1/comments`) does not match the rule. A cross-origin request works too: its preflight is answered, and the page's origin is allowed.

- **The data lasts for the browser session**, for the tab: it survives a reload, a visit to another site in the tab and a restart of the extension's worker, and goes when the tab or the browser is closed. Changing the seed, the ID field or the id type starts again from the seed; changing the delay, the headers or the conditions keeps the data.
- **Current data** (in the editor, once the rule is saved) shows the list as the page sees it now. Edit it and press **Save data**, press **Refresh** after the page changed it, or **Reset to seed** to start over.
- `{{...}}` placeholders and variables in the seed are filled once, when the list is made from it, so `{{$uuid}}` gives each item a fixed id-like value. A seed with placeholders outside strings is checked only once they are filled.
- **Delay**, **Response headers**, **Method** and the conditions under **Advanced** work as for a mock response. A collection is limited to about 1 MB of JSON; a change that would make it larger gets `413`.

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
- **`GLOBAL` badge**: the rule applies on every site (see [9.6](#96-global-rules)).
- **One-line summary**: what the rule matches → what it does. The left side holds the method (left out for `Any`), the pattern, the GraphQL operation as `(op: GetUser)` and any conditions as `+ query page=2`, `+ header X-Tenant: acme`, `+ body has "plan":"pro"`. The right side holds the status or `mock body`, `patch 2 fields`, `script`, `base64 body`, `redirect to …`, `network error (TimedOut)`, then `no server`, `slow 3 s`, `+1 response header`, `new request body`, `+2 request headers` and `templates off` when they apply. WebSocket rules read like `ws wss://example.com/socket (send, contains "ping") → block frames`. Hover the line for the details; click it to open the editor.
- **Applied count**: a small number after the rule, the times it was applied in this session. `0` is grey, a higher number is blue. Hover it (or move to it with Tab) to see when the rule was last applied and to which URL. A request counts when the rule really changes it: a rule that only matches behind an earlier rule, or a patch rule that lets a non-JSON response through, is not counted. An enabled rule still at `0` after requests went by gets a dashed outline: check its pattern, method and conditions. The count follows the rule when you reorder it or turn it off and on, and starts again when you edit it. **Reset counts** above the list sets every count back to 0, and so does turning interception off. Counts are never saved, exported or imported with the rules.

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
  "overrides": [/* OverrideRule[] */]
}
```

Export only includes rules for the domain currently open in the panel, not all domains.

### 8.7. Import rules

Click **Import → Rules file (.json)** in the **Rules** tab and pick a previously exported (or hand-crafted) JSON file:

- If the file's `domain` field is present and doesn't match the domain currently active in the panel, a confirm dialog warns you and asks whether to import into the current domain anyway. Canceling aborts the import with no changes.
- If the current domain **already has rules**, a confirm dialog asks how to combine them: **OK** merges — the imported rules are appended to the end of the existing list; **Cancel** replaces — all existing rules for the current domain are overwritten by the imported ones.
- If the current domain **has no rules yet**, the import is applied directly with no prompt.
- Invalid files (not valid JSON, missing the `overrides` array, or a rule missing required fields) are rejected with an alert, and nothing is changed.
- Only known rule fields (`pattern`, `mode`, `body`, `redirectUrl`, `method`, `enabled`) are kept from each imported rule; any other properties in the file are dropped.
- The match conditions `matchQuery`, `matchHeaders` and `matchBody` (see [5.8](#58-query-header-and-body-conditions)) are kept too. Files exported before they existed import unchanged.
- A patch rule (`"mode": "patch"`, see [6.7](#67-patch-the-real-json-response)) keeps its `patch` list of `{ "op": "set" | "remove", "path": "...", "value": ... }` operations. A file whose patch operations are malformed is rejected like any other invalid file.
- `removeResponseHeaders` (header names), `"mode": "passthrough"`, and the random responses `responses` (`{ "weight", "statusCode", "body", "responseHeaders" }`), `weight` and `randomSeed` are kept too. Variables are not part of the file: set them again in **Variables** (see [9.14](#914-variables)).

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

| Type     | Label |
| -------- | ----- |
| XHR      | XHR   |
| Fetch    | Fetch |
| JS       | JS    |
| CSS      | CSS   |
| Image    | Img   |
| Media    | Media |
| Font     | Font  |
| Document | Doc   |

### 9.5. Dynamic Response Templating

Insert dynamic placeholders into mock response bodies:

- `{{$uuid}}`: Generates a random UUID v4 (e.g. `c9bf9e57-1685-4c89-bafb-ff5af830be8a`).
- `{{$isoDate}}`: Current ISO 8601 timestamp (`2026-08-09T10:30:00.000Z`).
- `{{$epoch}}`: Current Unix epoch timestamp in milliseconds.
- `{{$randomEmail}}`: Generates a random test email (`user_x82a9@example.com`).
- `{{$randomName}}`: Generates a random full name (`Alex Rivers`).
- `{{$randomInt(min, max)}}`: Generates a random integer between `min` and `max`.
- `{{$query(paramName)}}`: Extracts the query parameter `paramName` directly from the request URL.
- `{{$jwt}}`: A well-formed fake JWT (`header.payload.signature`, base64url) for a mocked login or token response. The payload has `sub`, `iat` (now) and `exp` (now + 1 hour), in seconds.
  - Add or change claims with a JSON object: `{{$jwt({"sub":"42","role":"admin"})}}`. A claim you give wins over the default one, so `"exp":1767225600` sets a fixed expiry.
  - Set how long the token lasts, in seconds, as the last argument: `{{$jwt(300)}}`, `{{$jwt({"sub":"42"}, 300)}}`. Use `0` or a negative number for a token that has already expired.
  - Inside a JSON string, the quotes may be written as `\"` to keep the body valid JSON: `"token": "{{$jwt({\"sub\":\"42\"})}}"`.
  - Claims may hold variables and the other placeholders, such as `{"sub":"{{param:1}}"}`.
  - An argument that is not a JSON object and/or a whole number leaves the placeholder as written, so you can see it in the response.
  - **The token is NOT validly signed.** Its header says HS256, but the signature is random bytes made without a secret. It is good for code that only decodes a token (reads the user, the role or the expiry); a server or library that checks the signature rejects it.

### 9.6. Global Rules

Check **Advanced → Conditions → Apply on every site (global rule)** when creating or editing a rule to apply it across **all domains**. Global rules display a prominent `GLOBAL` badge in the rules list.

### 9.7. Request Payload Modification

Override outgoing POST, PUT, or PATCH request payloads before they reach the server by filling in **Advanced → Change the request → Replace the request body sent to the server** in the editor modal.

### 9.8. Network Throttling and Traffic Analytics

Use the **Network** selector to simulate **Fast 3G**, **Slow 3G**, or **Offline** conditions for the attached tab. The toolbar also shows live overridden and failed request counters, and restores them after a service-worker restart.

### 9.9. HAR File Import

Import `.har` files (HTTP Archive exported from DevTools Network tab) to automatically convert recorded network requests into mock rules: in the **Rules** tab, click **Import → cURL or OpenAPI / Swagger…**, then paste the file or choose it. The same dialog takes a cURL command or an OpenAPI / Swagger spec.

#### Exporting a HAR file

Click **HAR** next to the search box in the Captured APIs tab to download every request captured for the current tab as a `.har` file. Each entry holds the method, URL, query string, request headers and payload, the response status, and the response body when it was captured (see the _Capture Body_ checkboxes). Response headers and timings are not recorded by the capture: they are written empty, and every entry carries the time of the export.

The file opens in any HAR viewer and can be imported back to turn a captured session into mock rules.

### 9.10. Editor Keyboard Shortcuts

In the Override Modal editor:

- **`Ctrl + Enter`** (or **`Cmd + Enter`** on macOS): Save override rule.
- **`Ctrl + Shift + F`** (or **`Cmd + Shift + F`** on macOS): Format JSON response body.
  | WebSocket | WS |
  | Manifest | Manifest |
  | EventSource | EventSource |
  | TextTrack | TextTrack |
  | Other | Other |

Click a group header (e.g. "XHR ▼") to collapse/expand. Collapse state is persisted in storage.

### 9.11. WebSocket frames

To change what a WebSocket carries, open the override dialog (or click a **WS** entry in the API list) and choose **WebSocket frames**. Set the socket URL pattern, the direction, an optional match, and the action.

A WebSocket rule matches the socket URL (`wss://api.example.com/*`), the direction (send, receive or both) and optionally the frame text (contains, or a regular expression). The first enabled rule that fits is applied:

| Action     | Effect                                                                     |
| ---------- | -------------------------------------------------------------------------- |
| Replace    | The frame becomes the body (templates such as `{{now}}` work).             |
| Substitute | Every match is replaced by the body; `$1`… refer to regex groups.          |
| Block      | The frame is dropped.                                                      |
| Delay      | The frame waits the given milliseconds; frames behind it keep their order. |

Limits: only text frames are changed (binary frames pass untouched); sockets opened from Web Workers or cross-origin iframes are not covered; frames the page receives after a rule has changed them are dispatched by the extension, so their `event.isTrusted` is `false`. Reload the page after adding the first WebSocket rule if the socket was already open. Turning interception off empties the rules in the page; pressing "Cancel" on Chrome's debugging bar does not, so reload the page after that.

### 9.12. Marker headers

When a request is overridden, the extension adds these response headers:

- `x-network-overrides: true`
- `x-network-overrides-pattern: <pattern>`
- `x-network-overrides-response: <n>`, only for a rule with random responses: which response it gave (`1` is the rule's own)

This lets you easily identify overridden requests in the DevTools Network tab.

### 9.13. Interface language

The interface is in English and Vietnamese. By default it follows the browser's language. The language menu beside the **Enable Overrides** switch changes to **English** or **Tiếng Việt**; **Auto** goes back to the browser's language. The choice is saved locally, and both languages ship inside the extension, so switching needs no network.

### 9.14. Variables

Variables keep a value you use in many rules, such as a host or a token, in one place. Click **Variables** in the **Rules** tab and add `name: value` pairs:

- **This site**: only for the site open in the panel. **Every site**: for all sites. A site value wins over one of the same name for every site.
- Write `{{name}}` in a URL pattern, a redirect URL, a response or request header value, a response body (Text mode and random responses) or the request body sent to the server. Script rules read them as `request.vars.name`.
- A name starts with a letter or `_`, then letters, digits, `_`, `.` or `-`. The names of the built-in placeholders (`now`, `timestamp`, `epoch`, `uuid`) are taken.
- A `{{name}}` no variable defines is left as written. A value is put in once: a `{{name}}` inside a value is not filled again (in a body, a built-in placeholder inside a value, such as `{{$uuid}}`, still is).
- Variables are not filled in WebSocket rules, request conditions, patch values or injected JS/CSS.
- `\{{name}}` keeps `{{name}}` as written. With **Fill in {{...}} placeholders** off, the body is sent exactly as written, variables included; patterns and headers are still filled.
- Saving the variables applies them at once. They are stored in the browser with the rules, not in exported rule files or profiles.

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

Yes, the text frames a page sends or receives on a WebSocket: replace, substitute, block or delay them with a WebSocket frames rule. See [9.11. WebSocket frames](#911-websocket-frames).

### Q: Can I import rules exported from a different domain?

Yes. Import always writes into the domain that's currently active in the panel, regardless of which domain the file's `domain` field says it was exported from — but if that field doesn't match the current domain, a confirm dialog warns you first, so the mismatch isn't silent.
