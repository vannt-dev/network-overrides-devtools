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
  - **Rules (N)**: Danh sách các override rules.
- **Thanh tìm kiếm**: Lọc API theo URL.

### 3.2. DevTools Panel

Mở DevTools (F12) → tab **Overrides**. Giống popup nhưng có thêm:

- **Manual editor**: Form nhập pattern + body nhanh phía trên tab Rules.
- **Auto-load HAR**: Tự động load lịch sử request từ `chrome.devtools.network.getHAR()` khi mở panel.

### 3.3. Modal tạo/sửa Override

Khi click vào một API, modal hiện ra với:

- **Pattern**: URL pattern để matching.
- **HTTP Method**: Dropdown chọn method (`Any`, `GET`, `POST`, `PUT`, `PATCH`, `DELETE`) để giới hạn rule chỉ áp dụng cho một method cụ thể. Mặc định là `Any`, khớp với mọi method (giống như hành vi trước khi có field này). Khi mở modal từ một API đã capture, method sẽ được điền sẵn theo method của request đó.
- **Override body / Redirect to URL**: Chọn loại override.
- **Response body**: Nội dung response ghi đè (nếu chọn Override body).
- **Redirect URL**: URL chuyển hướng (nếu chọn Redirect to URL).
- **Format JSON**: Làm đẹp JSON body.
- **Body type badge**: Nhãn tự động phát hiện `text` hoặc `json`.
- **Save Override**: Lưu rule.

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
2. Click vào API muốn ghi đè.
3. Modal hiện ra với pattern được điền sẵn, và dropdown **Method** được chọn sẵn theo method của request đã capture nếu đó là `GET`/`POST`/`PUT`/`PATCH`/`DELETE` (nếu không, mặc định là `Any`).
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

Rules được duyệt theo thứ tự trong danh sách. **Rule đầu tiên** khớp sẽ được áp dụng. Kéo thả không hỗ trợ — nếu cần ưu tiên, xóa và tạo lại rule theo thứ tự mong muốn.

### 5.6. HTTP method

Bên cạnh URL pattern, một rule còn có thể được giới hạn theo HTTP method cụ thể thông qua field **Method** trong modal (xem mục 3.3 và 4 ở trên). Rule có method cụ thể (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`) chỉ áp dụng cho request dùng đúng method đó; `Any` (mặc định) khớp với mọi method, không phân biệt loại pattern.

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
- **Pattern**: In đậm màu xanh.
- **Method badge** (nếu khác `Any`): một badge nhỏ (ví dụ `POST`) cạnh phần preview body.
- **Redirect URL** (nếu có): Mũi tên → kèm URL.
- **Body preview**: 80 ký tự đầu của body, kèm mode (`text`/`file`).

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
  "overrides": [
    /* OverrideRule[] */
  ]
}
```

Export chỉ bao gồm rules của domain đang mở trong panel, không phải tất cả các domain.

### 8.7. Import rules

Click **Import** trong tab **Rules** và chọn một file JSON đã export trước đó (hoặc tự tạo tay):

- Nếu field `domain` trong file có giá trị và khác với domain đang active trong panel, một hộp thoại confirm sẽ cảnh báo và hỏi có muốn import vào domain hiện tại không. Nhấn Cancel sẽ hủy import, không có gì thay đổi.
- Nếu domain hiện tại **đã có rules**, một hộp thoại confirm sẽ hỏi cách kết hợp: **OK** = merge — các rule import được nối thêm vào cuối danh sách hiện có; **Cancel** = replace — toàn bộ rule hiện có của domain này bị thay thế bằng các rule trong file import.
- Nếu domain hiện tại **chưa có rule nào**, import sẽ được áp dụng ngay, không hỏi.
- File không hợp lệ (không phải JSON hợp lệ, thiếu mảng `overrides`, hoặc có rule thiếu field bắt buộc) sẽ bị từ chối kèm cảnh báo (alert), và không có gì thay đổi.
- Chỉ các field hợp lệ của rule (`pattern`, `mode`, `body`, `redirectUrl`, `method`, `enabled`) được giữ lại từ mỗi rule import; các property khác trong file sẽ bị bỏ qua.

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

### 9.5. Headers đánh dấu

Khi một request bị ghi đè, extension thêm các header sau vào response:

- `x-network-overrides: true`
- `x-network-overrides-pattern: <pattern>`

Điều này giúp bạn dễ dàng nhận biết request nào đã bị can thiệp ngay trong Network tab của DevTools.

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

Không. Extension chỉ hoạt động với HTTP request (XHR, Fetch) thông qua Fetch domain của CDP. WebSocket không nằm trong phạm vi này.

### Q: Có thể import file rules được export từ domain khác không?

Có. Import luôn ghi vào domain đang active trong panel, bất kể field `domain` trong file được export từ domain nào — nhưng nếu field đó khác domain hiện tại, một hộp thoại confirm sẽ cảnh báo trước, để sự khác biệt này không bị bỏ qua âm thầm.
