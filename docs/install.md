# MyTranslate - Hướng dẫn cài đặt và sử dụng

MyTranslate dịch Nhật - Việt ngay tại ô chat Teams/Slack bằng phím tắt, dùng tài khoản Claude của chính bạn.
Tài liệu này dành cho người dùng trong team; thiết kế chi tiết ở [design.md](design.md).

## Yêu cầu

| Yêu cầu | Ghi chú |
| --- | --- |
| Windows 10 22H2 hoặc Windows 11 | WebView2 có sẵn trên Windows 11; Windows 10 được trình cài tự tải |
| Claude Code đã cài và đã đăng nhập | Cài theo hướng dẫn của Anthropic, rồi mở terminal chạy `claude` một lần để đăng nhập |
| Tài khoản Claude riêng của bạn (Pro, Max, Team hoặc Enterprise) | Không dùng chung tài khoản; mỗi lần dịch dùng hạn mức của gói bạn |

## Cài đặt

1. Chạy file `MyTranslate_<phiên bản>_x64-setup.exe` (cài cho riêng bạn, không cần quyền admin) hoặc `MyTranslate_<phiên bản>_x64_en-US.msi` (dùng khi IT cài hàng loạt).
2. Mở MyTranslate từ menu Start.
   Lần đầu, app hiện **Hướng dẫn ban đầu**: kiểm tra Claude Code, dịch thử một câu, nhập hồ sơ của bạn.
3. Xong hướng dẫn, đóng cửa sổ: app vẫn chạy ở **khay hệ thống** (góc dưới bên phải) và phím tắt luôn sẵn sàng.

### Nếu Windows chặn file cài đặt

Bản thử nghiệm hiện **chưa được ký số**.

- SmartScreen báo "Windows protected your PC": bấm **More info**, rồi **Run anyway**.
- Máy bật **Smart App Control** sẽ chặn hẳn app chưa ký số và không có nút bỏ qua.
  Kiểm tra tại Windows Security > App & browser control > Smart App Control.
  Cách xử lý chính thức là chờ bản đã ký số; tắt Smart App Control là thay đổi bảo mật của máy, cần hỏi IT trước.

## Sử dụng hằng ngày

| Phím tắt | Việc |
| --- | --- |
| `Ctrl+Alt+J` | Bôi đen tin tiếng Nhật, nhấn: xem bản dịch tiếng Việt |
| `Ctrl+Alt+K` | Gõ tiếng Việt trong ô chat (không cần bôi đen), nhấn: xem bản tiếng Nhật, **Enter** để thay vào ô chat |
| `Ctrl+Alt+L` | Câu tiếng Nhật bạn tự viết: kiểm tra ngữ pháp, kính ngữ, **Enter** để dùng câu đề xuất |
| `Ctrl+Alt+T` | Tự nhận diện hướng dịch |
| `Ctrl+Alt+M` | Mở cửa sổ chính |

Trong popup:

- `Tab` đổi mức kính ngữ (Thân mật / Lịch sự / Trang trọng); `Esc` đóng; `Ctrl+P` ghim popup.
- Bấm tên thread (hoặc `Ctrl+T`) để chuyển tin sang thread khác hoặc tạo thread mới.
- Kéo thanh tiêu đề để di chuyển, kéo mép hoặc góc dưới để đổi kích thước; popup nhớ vị trí và kích thước cho đến khi tắt app.

App **không bao giờ tự gửi tin**: bạn vẫn tự nhấn gửi trong Teams/Slack.

### Mẹo để dịch tốt hơn

- **Cài đặt > Hồ sơ**: viết vài câu về bạn, dự án, cách xưng hô với khách, chữ ký. Nội dung này đi kèm mọi lần dịch.
- **Glossary**: thêm tên màn hình, tên tính năng, thuật ngữ khách hay dùng (ví dụ `仕訳` = `bút toán`). Thuật ngữ xuất hiện trong đoạn cần dịch sẽ được dịch đúng như glossary.
- App tự gom tin theo cuộc trò chuyện và chủ đề (thread), và gửi kèm vài tin gần nhất để Claude hiểu các câu như 先ほどの件, それ.
  Xem lại ở cửa sổ chính, tab **Threads**.

## Dữ liệu và quyền riêng tư

- Lịch sử dịch, thread, glossary nằm trên máy bạn: `%LOCALAPPDATA%\com.mytranslate.desktop\history.db`.
- Cài đặt: `%APPDATA%\com.mytranslate.desktop\settings.json`.
- Nội dung chỉ được gửi tới Claude qua Claude Code của chính bạn; app không có máy chủ riêng và không thu thập dữ liệu.
- Clipboard của bạn được khôi phục sau mỗi lần app lấy hoặc dán văn bản; chữ tạm của app không vào lịch sử clipboard (Win+V).

## Xử lý sự cố

| Hiện tượng | Cách xử lý |
| --- | --- |
| Nhấn phím tắt không có gì xảy ra | Kiểm tra icon MyTranslate ở khay còn không; chuột phải icon, bỏ chọn "Tạm dừng phím tắt"; tổ hợp có thể bị app khác chiếm, đổi trong Cài đặt > Phím tắt |
| Popup báo "Chưa chọn đoạn văn bản nào" | Bôi đen lại tin cần dịch; với `Ctrl+Alt+K` đặt con trỏ trong ô chat có chữ |
| Popup báo "Claude Code chưa đăng nhập" | Mở terminal, chạy `claude`, đăng nhập, rồi bấm "Thử lại" |
| Popup báo hết hạn mức | Gói Claude đã dùng hết hạn mức của kỳ; chờ đến giờ làm mới ghi trong thông báo |
| Bản dịch hơi chậm (4-7 giây) thỉnh thoảng | Model đôi khi "suy nghĩ" trước khi trả lời; hiện chưa tắt được qua Claude Code (xem `spikes/sp1-latency/README.md`) |
| Muốn làm lại các bước ban đầu | Cài đặt > Dữ liệu > Hướng dẫn ban đầu > Xem lại |
