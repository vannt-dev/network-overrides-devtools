# Hướng dẫn sử dụng Network Overrides DevTools

## Mục lục

1. [Giới thiệu](#1-giới-thiệu)
2. [Cài đặt](#2-cài-đặt)
3. [Giao diện](#3-giao-diện)
4. [Cách sử dụng cơ bản](#4-cách-sử-dụng-cơ-bản)
5. [Pattern (Mẫu URL)](#5-pattern-mẫu-url)
6. [Override body](#6-override-body)
7. [Redirect URL](#7-redirect-url)
8. [Quản lý rules](#8-quản-lý-rules)
9. [Tính năng bổ sung](#9-tính-năng-bổ-sung)
10. [Lưu ý quan trọng](#10-lưu-ý-quan-trọng)
11. [FAQ](#11-faq)

---

## 1. Giới thiệu

**Network Overrides DevTools** là extension cho Chrome/Edge dành cho developer, cho phép **chặn và ghi đè** response của các API request ngay trong trình duyệt mà không cần sửa code backend.

🛒 **Chrome Web Store**: [Network Overrides API (DevTools)](https://chromewebstore.google.com/detail/network-overrides-api-dev/holdjgmcnpelgclhopiejilhhkfcmpba)

**Công dụng chính:**

- Mock API response để test frontend khi backend chưa sẵn sàng.
- Can thiệp / Ghi đè Request Headers (ví dụ: `Authorization: Bearer token`).
- Debug bằng cách thay đổi response để kiểm tra các trạng thái khác nhau (lỗi, timeout, dữ liệu rỗng,...).
- Redirect request từ API cũ sang API mới mà không cần sửa code.
- Nhân bản quy tắc (Duplicate Rule) và quản lý Rule Profiles / Presets linh hoạt.
- Xem trước trực tiếp phản hồi hình ảnh (Base64 PNG/JPG, SVG).
- Xem nhanh các API request đã gửi và copy cURL để dùng lại.

---

## 2. Cài đặt

### Yêu cầu

- Trình duyệt Chrome hoặc Microsoft Edge (bản mới nhất).
- Tải từ [Chrome Web Store](https://chromewebstore.google.com/detail/network-overrides-api-dev/holdjgmcnpelgclhopiejilhhkfcmpba) hoặc cài extension dạng "unpacked" (tải từ source).

### Các bước cài đặt

1. Mở `chrome://extensions` (hoặc `edge://extensions`).
2. Bật **Developer mode** (góc trên bên phải).
3. Click **Load unpacked**.
4. Chọn thư mục chứa `manifest.json` (thư mục gốc của project).
5. Extension "Network Overrides API (DevTools)" sẽ xuất hiện.

### Kiểm tra

- Icon extension xuất hiện trên thanh toolbar.
- Mở DevTools (F12) → tab **Overrides**.

---

## 3. Giao diện

Extension có **2 cửa sổ**:

### 3.1. Popup

Click icon extension trên thanh toolbar. Gồm:

- **Tiêu đề**: "Network Overrides API"
- **Nút Refresh** (↻): Tải lại danh sách API đã capture.
- **Toggle Enable Overrides**: Bật/tắt tính năng ghi đè.
- **3 tabs**:
  - **Captured APIs (N)**: Danh sách API đã capture được, nhóm theo loại (XHR, Fetch, JS, CSS...).
  - **Overridden (N)**: API đang bị ghi đè bởi rule.
  - **Rules (N)**: Danh sách các override rules, mỗi rule một dòng: rule khớp gì → rule làm gì (ví dụ `GET /api/orders → 500 · slow 3 s`).
- **Thanh tìm kiếm**: Lọc API theo URL.

### 3.2. DevTools Panel

Mở DevTools (F12) → tab **Overrides**. Giống popup nhưng có thêm:

- **Manual editor**: Form nhập pattern + body nhanh phía trên tab Rules.
- **Auto-load HAR**: Tự động load lịch sử request từ `chrome.devtools.network.getHAR()` khi mở panel.

### 3.3. Modal tạo/sửa Override

Bấm **Mock this** trên một API (hoặc click vào dòng API) để mở modal. Modal hiện các field hay dùng trước:

- **Presets**: một click điền sẵn các field bên dưới.
  - **Empty list**: status 200 và `[]` (hoặc, nếu body là một object JSON, chính object đó với các danh sách bị làm rỗng; `{}` nếu không có danh sách nào).
  - **Server error**: status 500 và `{"error":"Internal Server Error"}`.
  - **Slow (3 s)**: delay 3000 ms; body giữ nguyên.
  - **Offline**: lỗi mạng (`InternetDisconnected`).
- **URL pattern**: URL pattern để matching. Field này sửa được, kể cả sau **Mock this**: đổi `/api/users/42` thành `/api/users/*` để một rule khớp nhiều URL hơn.
- **Method**: Dropdown chọn method (`Any`, `GET`, `POST`, `PUT`, `PATCH`, `DELETE`) để giới hạn rule chỉ áp dụng cho một method cụ thể. Mặc định là `Any`, khớp với mọi method. Khi mở modal từ một API đã capture, method sẽ được điền sẵn theo method của request đó.
- **Mock response / Redirect / Network error / WebSocket**: Chọn loại rule.
- **Status code** (mock response): để trống thì giữ status thật. Được điền sẵn từ request đã capture nếu status đó mang được body (không phải 204, 304 hay 3xx khác).
- **Response body**: Nội dung response ghi đè (với mock response).
- **Redirect URL**: URL chuyển hướng (với Redirect).
- **Format JSON**: Làm đẹp JSON body.
- **Save Override**: Lưu rule.

Các tùy chọn còn lại nằm trong mục **Advanced** (mặc định thu gọn), chia thành nhóm:

- **Conditions**: **GraphQL operation** (xem mục 5.7), query parameter, request header và đoạn text mà body của request phải chứa (xem mục 5.8), và **Apply on every site (global rule)** (xem mục 9.6).
- **Timing & failure**: **Delay (ms)**, **Simulate a network error** (với loại Network error: lỗi mà trang nhận được), và **Answer without calling the server** (mock response; xem mục 6.6).
- **Response headers**: header thêm vào response.
- **Body type: patch & script**: **The response body is** `Text`, `Raw base64`, `Script (JavaScript)` hoặc `Patch the real JSON response` (xem mục 6.7), và **Fill in {{...}} placeholders**.
- **Change the request**: thay body của request gửi lên server, thêm hoặc thay request header.

Nhóm nào đang có giá trị sẽ hiện số lượng trên tiêu đề và tự mở ra khi bạn sửa rule, nên không có thiết lập nào bị ẩn. Chọn **Network error** sẽ mở nhóm **Timing & failure** để hiện lỗi cần giả lập.

---

## 4. Cách sử dụng cơ bản

### Bước 1: Mở extension

- **Cách 1**: Click icon extension trên toolbar → mở popup.
- **Cách 2**: Mở DevTools (F12) → tab **Overrides**.

### Bước 2: Bật Overrides

Gạt toggle **Enable Overrides** sang ON.

> Khi bật, extension sẽ attach `debugger` vào tab hiện tại và bắt đầu theo dõi request.

### Bước 3: Capture API

Duyệt web / dùng ứng dụng như bình thường. Các API request sẽ tự động xuất hiện trong tab **Captured APIs**.

### Bước 4: Tạo Override

**Cách 1 (Click API):**

1. Vào tab **Captured APIs** hoặc **Overridden**.
2. Bấm **Mock this** trên API muốn ghi đè (click vào dòng API cũng vậy). Nếu đã có rule khớp với API này, modal mở rule đó để sửa thay vì tạo rule mới.
3. Modal hiện ra với pattern và status thật được điền sẵn, và dropdown **Method** được chọn sẵn theo method của request đã capture nếu đó là `GET`/`POST`/`PUT`/`PATCH`/`DELETE` (nếu không, mặc định là `Any`).
4. Nếu API có response body, nó sẽ được tự động điền vào ô **Response body**.
5. Chỉnh sửa nội dung → **Save Override**.

**Cách 2 (Manual - DevTools panel):**

1. Vào tab **Rules**.
2. Ở form phía trên, nhập **Pattern** và **Response body**.
3. Click **Add override**.

### Bước 5: Kiểm tra

- API có override sẽ có viền xanh trong danh sách (class `active`).
- Tab **Overridden** hiển thị số lượng và danh sách API đang bị ghi đè.
- Response thật sẽ được thay thế bằng nội dung bạn đã nhập.

### Bước 6: Tắt Override

- Gạt toggle OFF để tắt hoàn toàn.
- Hoặc vào tab **Rules** → click ✕ để xóa rule.

---

## 5. Pattern (Mẫu URL)

### 5.1. Substring (mặc định)

Pattern là một chuỗi bất kỳ. URL nào **chứa** chuỗi đó sẽ khớp.

```
Pattern:  /api/users
Khớp với: https://example.com/api/users
           https://example.com/api/users/123
           https://example.com/v2/api/users/list
Không:    https://example.com/api/admin
```

### 5.2. Ký tự đại diện `*`

Dùng `*` để match bất kỳ segment nào. `*` cũng **captures** giá trị để dùng trong Redirect URL.

```
Pattern:  /api/*/users/*
Khớp với: /api/v1/users/123  → captures: ["v1", "123"]
           /api/v2/users/abc  → captures: ["v2", "abc"]
```

Có thể capture nhiều `*`, mỗi `*` tương ứng với một capturing group.

### 5.3. Regex `/pattern/flags`

Pattern bắt đầu và kết thúc bằng `/`, có thể kèm flags.

```
Pattern:  /\/api\/v\d+\/users/i
Khớp với: /api/v1/users (case-insensitive)
           /API/V2/Users
Không:    /api/admin/users
```

```
Pattern:  /\/api\/user\/(\d+)/
Khớp với: /api/user/42 (captures: ["42"])
```

### 5.4. Match tất cả

```
Pattern: *
Pattern: all
```

Khớp với **mọi request**.

### 5.5. Thứ tự ưu tiên

Rules được duyệt theo thứ tự trong danh sách. **Rule đầu tiên** khớp sẽ được áp dụng. Để đổi ưu tiên, kéo rule bằng tay nắm `⠿` rồi thả vào nửa trên hoặc nửa dưới của rule khác, hoặc focus vào tay nắm và nhấn phím mũi tên lên/xuống. Thứ tự mới được lưu ngay.

Rule theo domain luôn chạy trước rule global, nên mỗi rule chỉ di chuyển được trong nhóm của nó: rule domain giữa các rule domain, rule global giữa các rule global.

### 5.6. HTTP method

Bên cạnh URL pattern, một rule còn có thể được giới hạn theo HTTP method cụ thể thông qua field **Method** trong modal (xem mục 3.3 và 4 ở trên). Rule có method cụ thể (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`) chỉ áp dụng cho request dùng đúng method đó; `Any` (mặc định) khớp với mọi method, không phân biệt loại pattern.

### 5.7. GraphQL operation

Ứng dụng GraphQL thường gửi mọi query tới cùng một URL, ví dụ `/graphql`. Điền **GraphQL Operation** trong modal để rule chỉ áp dụng cho một operation. Rule khớp khi body của request là JSON có `operationName` bằng giá trị đã điền (không phân biệt hoa thường); nếu không, khi đoạn `query` chứa giá trị đó; nếu vẫn không, khi body thô của request chứa giá trị đó. Request không có body thì không khớp. Để trống field này để khớp mọi request tới URL.

### 5.8. Điều kiện theo query, header và body

Mở mục **Advanced → Conditions** trong modal để rule chỉ áp dụng cho một số request tới cùng URL. Mọi điều kiện đã điền đều phải đúng, cùng với pattern, method và GraphQL operation. Để trống thì rule khớp như trước.

- **Query parameters**: viết như trong URL, ví dụ `page=2&debug`. `page=2` yêu cầu `page` bằng `2` (chỉ cần một trong các giá trị nếu tham số lặp lại; so sánh sau khi giải mã URL). `debug` đứng riêng yêu cầu có tham số `debug`, giá trị nào cũng được. Tên tham số phân biệt hoa thường.
- **Request headers**: mỗi dòng một header. `X-Tenant: acme` yêu cầu header đó có đúng giá trị này; `Authorization` đứng riêng chỉ yêu cầu có header. Tên header không phân biệt hoa thường.
- **Request body contains**: body của request phải chứa đoạn text này, ví dụ `"plan":"pro"`. Có phân biệt hoa thường. Nếu trình duyệt không đưa body cho extension (ví dụ upload dạng stream) thì điều kiện không khớp.

Dòng của rule trong danh sách rule hiện các điều kiện của nó, ví dụ `+ query page=2`. Request preflight CORS không mang header và body của request thật, nên với preflight chỉ điều kiện query được kiểm tra.

---

## 6. Override Body

### 6.1. Chế độ Text

Nội dung nhập vào sẽ được encode thành base64 và trả về như response body.

```json
// Ví dụ: Mock JSON response
{
  "status": "ok",
  "data": [
    { "id": 1, "name": "Alice" },
    { "id": 2, "name": "Bob" }
  ]
}
```

### 6.2. Chế độ Raw base64

Dùng khi bạn đã có sẵn nội dung dạng base64 (ví dụ: binary, image, file đã encode trước).

### 6.3. Body type badge

- **`text`**: Nội dung không phải JSON (màu xanh dương).
- **`json`**: Nội dung là JSON hợp lệ (màu xanh lá), tự động phát hiện khi gõ.

### 6.4. Format JSON

Click **Format JSON** để làm đẹp nội dung JSON (pretty-print). Nếu không phải JSON, nút không có tác dụng.

### 6.5. Auto-fill

Khi tạo override mới từ một API:

- Nếu API có response body trong bộ nhớ (`recentApiBodies`), nó sẽ được tự động điền vào.
- Nếu không, extension sẽ gửi message `getApiData` đến background worker để lấy body đã lưu.
- Tính năng này chỉ hoạt động nếu toggle **Auto-fill on open** được bật (mặc định: có).

### 6.6. Answer without calling the server (trả lời mà không gọi server)

Bình thường rule override body đợi response thật rồi mới thay nó, nên server luôn bị gọi trước: `POST` vẫn gây tác dụng phụ, và mock hỏng khi host chết hoặc endpoint chưa có.

Tick **Answer without calling the server** để trả lời request ngay trong trình duyệt, trước khi gửi đi. Body, **Status code** và **Response headers** của rule tạo nên toàn bộ response; delay vẫn áp dụng. Host không truy cập được cũng nhận được mock. Dòng của rule trong tab Rules kết thúc bằng `no server`.

Khác với rule override body thường:

- Không có response gốc. Status để trống nghĩa là `200`, và chỉ có những header bạn thêm (kèm `Content-Type: application/json; charset=utf-8` nếu bạn không đặt, và các header CORS bên dưới).
- Template như `{{now}}`, `{{uuid}}`, `{{$queryParam(name)}}` vẫn chạy, vì chúng không cần server.
- Ở chế độ Script, `request.response` là `{ status: null, headers: {}, body: null }`.
- Phần sửa request header và request body của rule không được dùng, vì không có request nào được gửi.
- Request khác origin chạy được mà không cần thêm header: preflight CORS được trả lời sẵn, và mock cho phép origin của trang trừ khi bạn tự đặt header `Access-Control-Allow-*`.

### 6.7. Patch the real JSON response (sửa field của response JSON thật)

Chọn **Patch the real JSON response** trong danh sách chế độ của Response body khi bạn cần dữ liệu thật nhưng đổi vài field, ví dụ bật gói trả phí hay ẩn một banner, thay vì chép cả response vào rule. Request vẫn đi tới server; rule chỉ sửa những field bạn liệt kê trong response JSON của nó.

Mỗi dòng một thay đổi:

```text
set data.user.plan = "pro"
remove data.ads
set data.items[0].price = 0
set data.flags = {"beta": true}
```

- `set <path> = <value>` đặt giá trị tại path. Giá trị là JSON: chuỗi viết trong ngoặc kép (`"pro"`); số, `true`, `false`, `null`, object và mảng viết như bình thường.
- `remove <path>` xóa một field, hoặc một phần tử mảng (các phần tử sau nó dồn lên).
- Path dùng dấu chấm cho field và `[0]` cho phần tử mảng: `data.items[0].name`. Key có dấu chấm, khoảng trắng hoặc `=` thì đặt trong ngoặc kép: `data["user.name"]`. Path bắt đầu bằng `/` là JSON Pointer: `/data/items/0/name`.
- `[-]` (hoặc `-` trong JSON Pointer) là cuối mảng: `set data.items[-] = {"id": 99}` thêm một phần tử.
- Khi path của `set` chưa tồn tại, các object còn thiếu được tạo ra (là mảng nếu phần tiếp theo là `[0]` hoặc `[-]`). `remove` một thứ không có thì không làm gì.

Status và header thật được giữ nguyên; **Status code**, **Response headers** và **Delay** vẫn áp dụng nếu bạn điền. `Content-Length` được tính lại theo body mới. JSON được gửi lại ở dạng gọn, không giữ khoảng trắng của server. Template như `{{now}}` không được xử lý trong giá trị của patch, và không có tùy chọn **Answer without calling the server**, vì patch cần response thật.

Khi response không phải JSON hoặc không có body (trang HTML, `204`, redirect), nó được cho qua nguyên vẹn và panel hiện một cảnh báo. Thay đổi nào không áp dụng được, như path đi qua một field dạng chuỗi hay chỉ số mảng vượt quá cuối mảng, sẽ bị bỏ qua và được nêu trong cùng cảnh báo đó; các thay đổi khác vẫn áp dụng. Dòng của rule trong tab Rules kết thúc bằng `patch N fields`; rê chuột lên để xem các thay đổi.

### 6.8. Script response (tính response bằng JavaScript)

Chọn **Script (JavaScript)** trong danh sách chế độ của Response body để rule tự tính response thay vì giữ sẵn một response. Body là thân của một hàm async nhận `request` và trả về response:

```js
// Giữ response thật, nhưng chỉ lấy ba phần tử đầu.
const data = JSON.parse(request.response.body);
return { status: 200, body: { ...data, items: data.items.slice(0, 3) } };
```

- `request` có `url`, `method`, `headers` (tên viết thường), `query` (giá trị đầu tiên của mỗi tham số), `params` (phần mà mỗi `*` của pattern khớp), `body` (payload của request, hoặc `null`) và `response`: `status`, `headers` và `body` gốc.
- Trả về một chuỗi để làm body, `{ status, headers, body }` (có thể thiếu field; `body` không phải chuỗi thì được gửi dạng JSON), hoặc giá trị khác để gửi dạng JSON. Status hay header script trả về được ưu tiên hơn của rule; delay vẫn áp dụng. Template như `{{now}}` không được xử lý trong script.
- Script chạy trong trang đang inspect, nên dùng được `fetch`, `localStorage` và biến toàn cục của trang. Script có 5 giây. Script ném lỗi, không trả về gì, trả status ngoài 100–599 hoặc hết giờ thì request nhận status `500`, nội dung là lỗi, kèm header `x-network-overrides-error: script`.
- Rule import từ file có thể chứa script, và script đó chạy trong các trang mà rule khớp: chỉ import file bạn tin tưởng.

### 6.9. Thay một file tĩnh (Dùng file trên máy)

Rule **Mock response** cũng trả lời được script, stylesheet, ảnh, font và trang. Đặt URL pattern trỏ tới file (ví dụ `/static/app.js`) rồi bấm **Dùng file trên máy…** (Use a local file…) dưới ô body.

- File chữ (JS, CSS, HTML, JSON, SVG, XML) được đưa vào ô body và vẫn sửa được. File khác (ảnh, font) được giữ nguyên và hiện là _Từ file tên (dung lượng)_, kèm nút **Bỏ file**.
- `Content-Type` được đặt theo file; đổi ở **Nâng cao → Response header**. Rule trả về status `200` nếu bạn không đặt status khác, nên file server không có (404) vẫn tải được.
- Rule được lưu trong bộ nhớ trình duyệt, tổng cộng khoảng 10 MB. Editor cảnh báo khi file trên 2 MB.
- Khi tab đang được chặn request, cache của trình duyệt bị bỏ qua, nên rule vẫn áp dụng cho file trang đã cache. Tải lại trang sau khi thêm rule.
- Script hay stylesheet có thuộc tính `integrity` (SRI) sẽ từ chối file đã thay. Request do service worker tự trả lời thì không bị chặn.

### 6.10. Chèn JS/CSS vào trang

Chọn kiểu **Chèn JS/CSS** (Inject JS/CSS) để thêm script và stylesheet của bạn vào các trang khớp rule, ví dụ `https://example.com/*`. Trang thật vẫn tải; rule chỉ thêm vào.

- Stylesheet được đặt ở cuối `<head>`; script ở cuối `<body>`, nên khi chạy thì các phần tử của trang đã có.
- Chỉ trang (document) bị thay đổi, và chỉ response HTML UTF-8 thành công (2xx). Rule khác, như mock API, vẫn chạy trên cùng trang.
- Trang có Content-Security-Policy vẫn giữ nó: hash SHA-256 của script và stylesheet được chèn được thêm vào policy, nên đúng code đó được chạy, còn code inline của chính trang và phần còn lại của policy vẫn như cũ. CSP `sandbox` không có `allow-scripts` vẫn chặn script, và panel sẽ cảnh báo.
- Nếu code của bạn tải thêm script khác, dùng `eval` hoặc event handler inline, policy vẫn có thể chặn phần đó. Khi đó mới tick **Bỏ Content-Security-Policy của trang**: các trang khớp sẽ tải mà không có CSP khi rule đang bật, nên kém an toàn hơn.
- Tải lại trang sau khi thêm hoặc sửa rule.

---

## 7. Redirect URL

### 7.1. Cách hoạt động

Khi chọn **Redirect to URL**, thay vì ghi đè body, extension sẽ chuyển hướng request đến URL khác ngay ở **request stage** (trước khi request thật được gửi đi).

### 7.2. Wildcard substitution

Dùng `*` trong Redirect URL để thay thế bằng giá trị đã capture từ pattern.

**Ví dụ:**

| Pattern                    | Request URL                   | Captures        | Redirect URL                  | Kết quả                          |
| -------------------------- | ----------------------------- | --------------- | ----------------------------- | -------------------------------- |
| `/api/*`                   | `https://site.com/api/user`   | `["user"]`      | `https://site.com/api/v2/*`   | `https://site.com/api/v2/user`   |
| `/api/old/*/data`          | `/api/old/v1/data`            | `["v1"]`        | `/api/new/*/data`             | `/api/new/v1/data`               |
| `https://old.com/*/item/*` | `https://old.com/shop/item/5` | `["shop", "5"]` | `https://new.com/*/product/*` | `https://new.com/shop/product/5` |

Nếu còn `*` chưa được thay thế trong Redirect URL, extension sẽ log lỗi và request sẽ proceed bình thường (không redirect).

**Ví dụ lỗi thường gặp:** Pattern có 1 `*` nhưng Redirect URL có 2 `*`:

| Pattern                  | Request URL                 | Captures   | Redirect URL                 | Kết quả                                 |
| ------------------------ | --------------------------- | ---------- | ---------------------------- | --------------------------------------- |
| `https://site.com/api/*` | `https://site.com/api/user` | `["user"]` | `https://site.com/api/v2/**` | ❌ Lỗi: `*` thứ hai không được thay thế |

### 7.3. Khi nào dùng

- Chuyển từ API cũ sang API mới mà không cần sửa frontend.
- Chuyển request từ production sang staging/local để debug.
- Bỏ qua một số request bằng cách redirect đến một endpoint rỗng.

---

## 8. Quản lý rules

### 8.1. Xem rules

Vào tab **Rules**. Mỗi rule hiển thị:

- **Checkbox enable**: ở đầu dòng. Bỏ tick nghĩa là rule đang bị tắt (xem mục 8.5).
- **Badge `GLOBAL`**: rule áp dụng trên mọi site (xem mục 9.6).
- **Tóm tắt một dòng**: rule khớp gì → rule làm gì. Vế trái gồm method (bỏ qua nếu là `Any`), pattern, GraphQL operation dạng `(op: GetUser)` và các điều kiện dạng `+ query page=2`, `+ header X-Tenant: acme`, `+ body has "plan":"pro"`. Vế phải gồm status hoặc `mock body`, `patch 2 fields`, `script`, `base64 body`, `redirect to …`, `network error (TimedOut)`, rồi `no server`, `slow 3 s`, `+1 response header`, `new request body`, `+2 request headers` và `templates off` khi có. Rule WebSocket có dạng `ws wss://example.com/socket (send, contains "ping") → block frames`. Rê chuột lên dòng để xem chi tiết; click để mở editor.
- **Số lần áp dụng**: một con số nhỏ sau rule, là số lần rule được áp dụng trong phiên này. `0` màu xám, số lớn hơn màu xanh. Rê chuột lên (hoặc chuyển tới bằng phím Tab) để xem lần áp dụng gần nhất là lúc nào và với URL nào. Một request chỉ được tính khi rule thật sự thay đổi nó: rule chỉ khớp phía sau một rule đứng trước, hoặc rule patch cho qua một response không phải JSON, thì không được tính. Rule đang bật mà vẫn `0` sau khi đã có request đi qua sẽ có viền nét đứt: hãy kiểm tra pattern, method và các điều kiện. Con số đi theo rule khi bạn đổi thứ tự hoặc tắt/bật rule, và đếm lại từ đầu khi bạn sửa rule. Nút **Reset counts** phía trên danh sách đưa mọi con số về 0, tắt chặn request cũng vậy. Số đếm không bao giờ được lưu, export hay import cùng rule.

### 8.2. Sửa rule

Click **✎** bên cạnh rule → modal hiện ra với thông tin hiện tại → chỉnh sửa → **Save Override**.

### 8.3. Xóa rule

Click **✕** → rule bị xóa ngay lập tức.

### 8.4. Tính bền vững

- Rules được lưu trong `chrome.storage.local` → **không mất** khi refresh trang, đóng/mở DevTools, restart trình duyệt.
- Không cần lo lắng về việc mất dữ liệu.

### 8.5. Bật/tắt một rule

Mỗi rule có một checkbox ở đầu dòng. Bỏ tick sẽ **tắt** rule đó (`enabled: false`) mà không xóa rule:

- Rule vẫn hiển thị trong danh sách **Rules**, nhưng bị làm mờ (dimmed).
- Các API mà rule này nhắm tới vẫn nằm trong tab **Overridden** (vì vẫn khớp pattern và method), nhưng cũng được hiển thị mờ đi, vì rule đã tắt thì không còn thực sự được áp dụng.
- Background service worker sẽ bỏ qua các rule đang tắt khi quyết định override request nào.

Tick lại checkbox để bật rule trở lại. Rule mới tạo, cũng như các rule đã tồn tại trước khi có tính năng này, mặc định là **đang bật (enabled)**.

### 8.6. Export rules

Click **Export** trong tab **Rules** để tải xuống các rule của **domain đang active** dưới dạng file JSON (đặt tên theo domain). File có cấu trúc:

```json
{
  "version": 1,
  "domain": "https://example.com",
  "exportedAt": "2026-07-07T00:00:00.000Z",
  "overrides": [/* OverrideRule[] */]
}
```

Export chỉ bao gồm rules của domain đang mở trong panel, không phải tất cả các domain.

### 8.7. Import rules

Click **Import → Rules file (.json)** trong tab **Rules** và chọn một file JSON đã export trước đó (hoặc tự tạo tay):

- Nếu field `domain` trong file có giá trị và khác với domain đang active trong panel, một hộp thoại confirm sẽ cảnh báo và hỏi có muốn import vào domain hiện tại không. Nhấn Cancel sẽ hủy import, không có gì thay đổi.
- Nếu domain hiện tại **đã có rules**, một hộp thoại confirm sẽ hỏi cách kết hợp: **OK** = merge — các rule import được nối thêm vào cuối danh sách hiện có; **Cancel** = replace — toàn bộ rule hiện có của domain này bị thay thế bằng các rule trong file import.
- Nếu domain hiện tại **chưa có rule nào**, import sẽ được áp dụng ngay, không hỏi.
- File không hợp lệ (không phải JSON hợp lệ, thiếu mảng `overrides`, hoặc có rule thiếu field bắt buộc) sẽ bị từ chối kèm cảnh báo (alert), và không có gì thay đổi.
- Chỉ các field hợp lệ của rule (`pattern`, `mode`, `body`, `redirectUrl`, `method`, `enabled`) được giữ lại từ mỗi rule import; các property khác trong file sẽ bị bỏ qua.
- Các điều kiện `matchQuery`, `matchHeaders` và `matchBody` (xem mục 5.8) cũng được giữ lại. File export từ trước khi có các field này vẫn import bình thường.
- Rule patch (`"mode": "patch"`, xem mục 6.7) giữ danh sách `patch` gồm các thao tác `{ "op": "set" | "remove", "path": "...", "value": ... }`. File có thao tác patch sai định dạng bị từ chối như mọi file không hợp lệ khác.

Giống Export, Import luôn thao tác trên domain đang active trong panel — không bao giờ áp dụng cho tất cả domain cùng lúc.

---

## 9. Tính năng bổ sung

### 9.1. Copy cURL

Mỗi API entry có nút **cURL**. Click để copy request dưới dạng lệnh cURL:

```bash
curl 'https://api.example.com/data' \
  -X 'POST' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer xxx' \
  --data-raw '{"key":"value"}'
```

### 9.2. Tìm kiếm API

Ô tìm kiếm ở tab **Captured APIs** và **Overridden**. Tìm kiếm theo URL substring, không phân biệt hoa thường. Kết quả tìm kiếm được highlight (nền vàng).

### 9.3. Refresh API list

Click nút **Refresh** (↻) ở góc trên bên phải. Extension sẽ thử 5 lần (mỗi lần cách 250ms) để load APIs từ background worker.

### 9.4. Phân loại API theo type

API được nhóm theo resource type:

- **Fetch / XHR**: API calls
- **JS**: Script files
- **CSS**: Style files
- **Img**: Images
- **Doc**: HTML documents
- **WS**: WebSockets

### 9.5. Templating Động (Dynamic Response Templates)

Cho phép chèn các biến sinh tự động vào nội dung Response Mock Body:

- `{{$uuid}}`: Tạo ngẫu nhiên UUID v4 (ví dụ `c9bf9e57-1685-4c89-bafb-ff5af830be8a`).
- `{{$isoDate}}`: Ngày giờ hiện tại chuẩn ISO 8601 (`2026-08-09T10:30:00.000Z`).
- `{{$epoch}}`: Unix timestamp (tính bằng ms).
- `{{$randomEmail}}`: Tạo email thử nghiệm ngẫu nhiên (`user_x82a9@example.com`).
- `{{$randomName}}`: Tạo tên ngẫu nhiên (`Alex Rivers`).
- `{{$randomInt(1, 100)}}`: Sinh số nguyên ngẫu nhiên trong khoảng `min` tới `max`.
- `{{$query(id)}}`: Trích xuất trực tiếp giá trị của Query Parameter `id` từ Request URL.

### 9.6. Quy tắc Toàn cục (Global Rules)

Tích chọn **Advanced → Conditions → Apply on every site (global rule)** khi tạo/chỉnh sửa quy tắc để áp dụng rule này trên **tất cả các domain**. Các Global Rule sẽ có nhãn badge **GLOBAL** nổi bật trong danh sách Rules.

### 9.7. Can thiệp & Ghi đè Request Payload

Cho phép sửa đổi dữ liệu Request Payload (body của các request `POST`, `PUT`, `PATCH`) trước khi gửi lên Server bằng cách nhập nội dung mới vào **Advanced → Change the request → Replace the request body sent to the server** trong editor modal.

### 9.8. Giới hạn Mạng và Thống kê Traffic

Dùng bộ chọn **Network** để mô phỏng **Fast 3G**, **Slow 3G** hoặc **Offline** cho tab đang được kết nối. Thanh công cụ đồng thời hiển thị trực tiếp số request đã override và bị lỗi, đồng thời khôi phục các số liệu này sau khi service worker khởi động lại.

### 9.9. Import HAR File (HTTP Archive)

Hỗ trợ Import trực tiếp file `.har` (được export từ DevTools Network tab): Hệ thống sẽ tự động phân tích và chuyển đổi lịch sử traffic mạng ghi trong file HAR thành danh sách các Mock Rules sẵn sàng sử dụng: trong tab **Rules**, bấm **Import → cURL or OpenAPI / Swagger…** rồi dán nội dung file hoặc chọn file. Hộp thoại này cũng nhận lệnh cURL hoặc spec OpenAPI / Swagger.

#### Export HAR file

Bấm nút **HAR** cạnh ô tìm kiếm ở tab Captured APIs để tải mọi request đã bắt của tab hiện tại thành file `.har`. Mỗi entry gồm method, URL, query string, request headers và payload, status của response, và response body nếu đã được bắt (xem các ô _Capture Body_). Phần capture không ghi response headers và thời gian, nên các trường này để trống và mọi entry mang thời điểm export.

File mở được bằng mọi trình xem HAR và có thể import lại để biến một phiên đã bắt thành các mock rule.

### 9.10. Phím tắt Thao tác Nhanh (Keyboard Shortcuts)

Tại Editor Modal:

- **`Ctrl + Enter`** (hoặc **`Cmd + Enter`** trên macOS): Lưu quy tắc nhanh (Save Rule).
- **`Ctrl + Shift + F`** (hoặc **`Cmd + Shift + F`** trên macOS): Định dạng JSON tự động (Format JSON).

| Type        | Hiển thị    | Màu/Icon |
| ----------- | ----------- | -------- |
| XHR         | XHR         | --       |
| Fetch       | Fetch       | --       |
| JS          | JS          | --       |
| CSS         | CSS         | --       |
| Image       | Img         | --       |
| Media       | Media       | --       |
| Font        | Font        | --       |
| Document    | Doc         | --       |
| WebSocket   | WS          | --       |
| Manifest    | Manifest    | --       |
| EventSource | EventSource | --       |
| TextTrack   | TextTrack   | --       |
| Khác        | Other       | --       |

Click vào tiêu đề nhóm (ví dụ "XHR ▼") để thu gọn/mở rộng. Trạng thái thu gọn được lưu trong storage.

### 9.11. WebSocket frames

Để sửa nội dung một WebSocket, mở modal override (hoặc bấm vào một mục **WS** trong danh sách API) rồi chọn **WebSocket frames**. Đặt pattern URL của socket, chiều (gửi, nhận hoặc cả hai), chuỗi cần khớp (không bắt buộc; có thể là regex) và hành động. Rule bật đầu tiên khớp với frame sẽ được áp dụng:

| Hành động  | Tác dụng                                                               |
| ---------- | ---------------------------------------------------------------------- |
| Replace    | Frame được thay bằng nội dung body (dùng được template như `{{now}}`). |
| Substitute | Mọi đoạn khớp được thay bằng body; `$1`… là các nhóm của regex.        |
| Block      | Frame bị bỏ.                                                           |
| Delay      | Frame chờ số mili giây đã đặt; các frame phía sau vẫn giữ đúng thứ tự. |

Giới hạn: chỉ frame dạng text được sửa (frame binary đi qua nguyên vẹn); socket mở từ Web Worker hoặc iframe khác origin không được xử lý; frame mà trang nhận sau khi bị rule sửa do extension phát lại nên `event.isTrusted` là `false`. Nếu socket đã mở trước khi thêm rule WebSocket đầu tiên, hãy reload trang. Tắt interception sẽ xóa rule trong trang; còn bấm "Cancel" trên thanh debug của Chrome thì không, nên hãy reload trang sau khi bấm.

### 9.12. Headers đánh dấu

Khi một request bị ghi đè, extension thêm các header sau vào response:

- `x-network-overrides: true`
- `x-network-overrides-pattern: <pattern>`

Điều này giúp bạn dễ dàng nhận biết request nào đã bị can thiệp ngay trong Network tab của DevTools.

### 9.13. Ngôn ngữ giao diện

Giao diện có tiếng Anh và tiếng Việt. Mặc định extension dùng ngôn ngữ của trình duyệt. Menu ngôn ngữ cạnh công tắc **Bật ghi đè** chuyển sang **English** hoặc **Tiếng Việt**; chọn **Tự động** để quay lại theo trình duyệt. Lựa chọn được lưu trong máy, và cả hai ngôn ngữ nằm sẵn trong extension nên đổi ngôn ngữ không cần mạng.

---

## 10. Lưu ý quan trọng

### 10.1. Phạm vi ảnh hưởng

- Override chỉ áp dụng cho **tab hiện tại** (tab đang được attach debugger).
- Mỗi lần bật toggle, extension sẽ attach debugger vào tab **đang active**.
- Chuyển tab khác → override không còn tác dụng cho đến khi bật lại.

### 10.2. Dung lượng

- Tối đa **500 URL** trong danh sách recent APIs.
- Tối đa **100 response bodies** được lưu.
- Khi vượt quá, dữ liệu cũ nhất sẽ bị xóa (FIFO).

### 10.3. Response body storage

- Chỉ **XHR** và **Fetch** mới được lưu response body (dùng cho auto-fill).
- Các loại khác (JS, CSS, Image...) không được lưu body.

### 10.4. Tab ID

Recent APIs và response bodies được lưu với key `recentApis_{tabId}` và `recentApiBodies_{tabId}`. Khi bạn đóng tab và mở lại, `tabId` mới sẽ khác → dữ liệu cũ không hiển thị.

### 10.5. Không dùng cho production

Extension này chỉ dành cho **developer debugging**. Không sử dụng trong môi trường production cho người dùng cuối.

### 10.6. Permissions

Extension yêu cầu các quyền:

- `debugger` — để can thiệp request.
- `storage` — để lưu rules và dữ liệu.
- `<all_urls>` — để attach debugger vào mọi tab.

---

## 11. FAQ

### Q: Override không hoạt động?

**Kiểm tra:**

1. Đã bật **Enable Overrides** chưa? (Toggle phải xanh).
2. Pattern có khớp với URL không? Thử pattern `*` để match all.
3. Tab hiện tại có phải tab đang được debug không? (Thử refresh extension).
4. Mở DevTools → Console của extension để xem lỗi (nếu có).

### Q: Tắt override rồi mà request vẫn bị ảnh hưởng?

Có thể cần refresh lại trang. Nếu vẫn tiếp diễn, tắt hẳn extension và bật lại.

### Q: Làm sao xóa tất cả rules?

Vào tab **Rules**, click ✕ trên từng rule. Extension không có nút "Clear all" — cần xóa thủ công từng cái.

### Q: Dữ liệu API cũ từ hôm qua vẫn còn?

Override rules thì có (lưu vĩnh viễn). Recent APIs thì không — khi tab cũ đóng, tab mới có `tabId` khác. Nếu bạn thấy API cũ, có thể do bạn đang mở lại đúng tab cũ.

### Q: Extension không hoạt động với tab ẩn danh (incognito)?

Vào `chrome://extensions` → click **Details** của extension → bật **Allow in incognito**.

### Q: Làm sao biết request đã bị override?

Kiểm tra Network tab trong DevTools:

- Header `x-network-overrides: true` được thêm vào response.
- Trong extension, API entry có highlight xanh (class `active`) và xuất hiện trong tab **Overridden**.

### Q: Không thấy API hiện ra trong Captured APIs?

Click nút **Refresh** (↻). Extension thử 5 lần trong 1.25 giây. Nếu vẫn không thấy:

1. Kiểm tra toggle đã bật chưa.
2. Kiểm tra tab có thực sự gửi request không (nhìn Network tab).
3. Mở DevTools panel thay vì popup (panel dùng `chrome.devtools.network` nên có thể bắt được nhiều hơn).

### Q: Có hỗ trợ localStorage hoặc sync storage không?

Không. Extension dùng `chrome.storage.local` (dung lượng 10MB). Không dùng sync storage vì rules có thể chứa dữ liệu lớn (response body).

### Q: Có thể override WebSocket không?

Có, với các frame dạng text mà trang gửi hoặc nhận qua WebSocket: thay, thay một phần, chặn hoặc làm chậm chúng bằng rule WebSocket frames. Xem [9.11. WebSocket frames](#911-websocket-frames).

### Q: Có thể import file rules được export từ domain khác không?

Có. Import luôn ghi vào domain đang active trong panel, bất kể field `domain` trong file được export từ domain nào — nhưng nếu field đó khác domain hiện tại, một hộp thoại confirm sẽ cảnh báo trước, để sự khác biệt này không bị bỏ qua âm thầm.
