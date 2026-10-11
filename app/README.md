# MyTranslate

App Tauri v2: `src/` là giao diện React, `src-tauri/` là lõi Rust.
Thiết kế: [docs/design.md](../docs/design.md) · Tiến độ: [docs/tasks.md](../docs/tasks.md).

## Chạy app thật (Tauri)

Cần: Rust (MSVC), gói "Desktop development with C++" của Visual Studio, Node 20+, và Claude Code đã đăng nhập.

```sh
npm install
npm run tauri dev
```

Hiện app thật có tab **Dịch**: dán văn bản, nhấn Ctrl+Enter, bản dịch đi qua tài khoản Claude của bạn và hiện kèm thời gian đo.
Các màn hình khác vẫn dùng dữ liệu giả cho đến khi các task tương ứng xong.

Kiểm tra lõi Rust: `cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings`.

## Chạy prototype giao diện (trình duyệt)

```sh
npm run dev
```

Mở http://localhost:5173 trên trình duyệt thường, nên dùng cửa sổ rộng từ 1280 px.
Ở chế độ này không gọi Claude, không đọc cửa sổ Windows, không lưu dữ liệu.

## Thử nghiệm

- **Mô phỏng sử dụng**: một cửa sổ Slack/Teams giả.
  Bôi đen tin tiếng Nhật rồi nhấn `Ctrl+Alt+J`, gõ tiếng Việt vào ô chat rồi nhấn `Ctrl+Alt+K`, viết tiếng Nhật rồi nhấn `Ctrl+Alt+L`.
  Bôi đen bằng chuột sẽ hiện thanh thao tác nhanh (Dịch, Kiểm tra, Dịch và chép).
  Kéo thanh tiêu đề popup để di chuyển, kéo mép trái/phải/dưới hoặc góc dưới để đổi kích thước; popup sau nhớ vị trí và kích thước cho đến khi tải lại trang.
  Trong Cài đặt chỉnh được ứng dụng áp dụng (bỏ Slack khỏi danh sách thì thanh không hiện trong Slack giả lập), thứ tự nút, và kiểu icon và chữ hoặc chỉ icon.
- **Cửa sổ chính**: Threads, Glossary, Người liên hệ, Cài đặt (`Ctrl+Alt+M` hoặc icon khay hệ thống).
- **Onboarding**: 4 bước cài đặt lần đầu.
- **Trạng thái giả lập** trên thanh công cụ: xem các màn hình lỗi (chưa đăng nhập, hết hạn mức, lỗi mạng, không chắc thread).

Bản dịch là câu mẫu cố định trong `src/lib/mockEngine.ts`, chỉ đúng với các tin có sẵn và một số câu mẫu.

## Cấu trúc

| Thư mục | Nội dung |
| --- | --- |
| `src/windows/popup` | Popup dịch, kiểm tra tiếng Nhật, chọn thread (S01, S02) |
| `src/windows/main` | Cửa sổ chính (S04-S07) |
| `src/windows/onboarding` | Onboarding (S08) |
| `src/playground` | Desktop giả lập: app chat, phím tắt, hướng dẫn thử |
| `src/lib/mockEngine.ts` | Dữ liệu dịch giả, sẽ được thay bằng lời gọi Tauri command |

Khi chuyển sang Tauri, các thư mục `src/windows/*` được giữ nguyên làm giao diện thật.
