# MyTranslate

Dịch Nhật - Việt ngay trong Teams và Slack, không phải rời cửa sổ chat.
Bôi đen tin nhắn tiếng Nhật rồi nhấn `Ctrl+Alt+T` để đọc; viết tiếng Việt vào ô chat rồi nhấn `Ctrl+Alt+T` để gửi bằng tiếng Nhật, đúng mức kính ngữ.
App đọc cả thread, nên câu nhắc lại chuyện trước đó vẫn được dịch đúng ý.

*Japanese-Vietnamese translation inside Teams and Slack, for Windows.
It uses the AI account you already have (Claude, ChatGPT or an API key), and keys stay on your machine.*

Trang chủ và bản tải: https://mytranslate.pages.dev

## Tính năng

- Dịch tin đang bôi đen, hoặc câu đang viết trong ô chat, bằng phím tắt hoặc thanh thao tác nhanh.
- Hiểu ngữ cảnh: đọc các tin trước trong cùng cuộc trò chuyện để dịch đúng chỗ nhắc lại.
- Viết tiếng Nhật: chọn mức kính ngữ, xem nghĩa khi đọc lại, kiểm tra câu tự viết kèm góp ý.
- Glossary để thuật ngữ và tên người được dịch nhất quán.
- Giao diện tiếng Việt và tiếng Nhật.

## Cài đặt

Tải bản cho Windows 10 và 11 ở https://mytranslate.pages.dev.
Hướng dẫn chi tiết: [tiếng Việt](docs/install.md), [日本語](docs/install-ja.md).

App dùng AI của chính bạn: tài khoản Claude qua Claude Code, tài khoản ChatGPT qua Codex CLI, hoặc API key của OpenAI, Gemini.
API key được lưu trong Windows Credential Manager, không gửi đi đâu ngoài nhà cung cấp AI bạn chọn.

## Phát triển

Cần: Windows, Rust (MSVC), gói "Desktop development with C++" của Visual Studio, Node 20 trở lên.

```sh
cd app
npm install
npm run tauri dev
```

Kiểm tra trước khi gửi pull request:

```sh
cd app
npm run lint
npx tsc -b
npm test
npm run e2e
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

Chi tiết về cấu trúc app và bản prototype chạy trên trình duyệt: [app/README.md](app/README.md).
Thiết kế sản phẩm và kiến trúc: [docs/design.md](docs/design.md).

| Thư mục | Nội dung |
| --- | --- |
| `app/src` | Giao diện React: popup dịch, cửa sổ chính, onboarding |
| `app/src-tauri` | Lõi Rust (Tauri 2): phím tắt, đọc cửa sổ chat, gọi AI, lịch sử SQLite, cập nhật |
| `app/e2e` | Test Playwright |
| `docs` | Hướng dẫn sử dụng và tài liệu thiết kế |

## Đóng góp

Báo lỗi và đề xuất tính năng ở [Issues](https://github.com/jscaothe/mytranslate/issues).
Pull request luôn được chào đón; với thay đổi lớn, nên mở issue trao đổi trước.
CI chạy lint, test và build bộ cài cho mọi pull request.

## Giấy phép

[MIT](LICENSE)
