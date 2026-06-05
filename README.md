# Suno Cookie Fetcher - Hệ thống Nuôi Profile

Công cụ tự động lấy Cookie từ Suno.com bằng Playwright với cơ chế "Nuôi Profile" - chỉ cần đăng nhập thủ công **1 lần duy nhất**.

## 🚀 Cài đặt

```bash
npm install
npx playwright install chromium
```

## 📁 Cấu trúc dự án

```
account-fetch-nodejs/
├── src/
│   ├── index.js          # Entry point chính
│   ├── add-account.js    # Thêm tài khoản mới (login lần đầu)
│   ├── fetch-all.js      # Lấy cookie tất cả tài khoản
│   ├── list-accounts.js  # Liệt kê tất cả tài khoản
│   └── lib/
│       ├── browser.js    # Quản lý trình duyệt Playwright
│       ├── cookie-fetcher.js  # Logic lấy cookie
│       └── account-store.js  # Quản lý dữ liệu tài khoản
├── profiles/             # Thư mục lưu Profile (tự tạo)
├── output/               # Thư mục lưu cookie output (tự tạo)
├── accounts.json         # Danh sách tài khoản
├── .env                  # Cấu hình
└── package.json
```

## 🔧 Cách sử dụng

### 1. Thêm tài khoản mới (Login thủ công - 1 lần duy nhất)

```bash
npm run add-account
```

Trình duyệt sẽ mở ra, bạn tự tay đăng nhập vào Suno. Sau đó đóng trình duyệt, cookie sẽ được lưu tự động.

### 2. Lấy cookie tất cả tài khoản (Tự động hoàn toàn)

```bash
npm run fetch:all
```

### 3. Lấy cookie 1 tài khoản cụ thể

```bash
npm run fetch -- --account=ten_tai_khoan
```

### 4. Xem danh sách tài khoản

```bash
npm run list
```

## 📤 Output

Cookie được lưu tại `output/cookies.json` với format:

```json
{
  "accounts": [
    {
      "name": "account_01",
      "fetchedAt": "2024-01-01T00:00:00.000Z",
      "session": "__session_cookie_value",
      "clientApiVersion": "xxx",
      "allCookies": { ... }
    }
  ]
}
```

## ⚠️ Lưu ý

- Không xóa thư mục `profiles/` - đây là "bộ nhớ" của các tài khoản
- Chạy `fetch:all` ít nhất mỗi 20 giờ để đảm bảo cookie luôn mới
- Mỗi tài khoản có profile riêng biệt, không ảnh hưởng lẫn nhau
