# MyTranslate - Hướng dẫn cài đặt và sử dụng

MyTranslate dịch Nhật - Việt ngay tại ô chat Teams/Slack bằng phím tắt, dùng tài khoản Claude của chính bạn.
Tài liệu này dành cho người dùng trong team; thiết kế chi tiết ở [design.md](design.md).
Người dùng Nhật xem bản tiếng Nhật: [install-ja.md](install-ja.md).
App hiện tiếng Nhật khi Windows dùng tiếng Nhật; đổi ở Cài đặt > Ngôn ngữ, đổi ngôn ngữ thì hướng "đọc" và "viết" cũng đổi theo.

## Yêu cầu

| Yêu cầu | Ghi chú |
| --- | --- |
| Windows 10 22H2 hoặc Windows 11 | WebView2 có sẵn trên Windows 11; Windows 10 được trình cài tự tải |
| Claude Code đã cài và đã đăng nhập | Cài theo hướng dẫn của Anthropic, rồi mở terminal chạy `claude` một lần để đăng nhập |
| Tài khoản Claude riêng của bạn (Pro, Max, Team hoặc Enterprise) | Không dùng chung tài khoản; mỗi lần dịch dùng hạn mức của gói bạn |

## Cài đặt

1. Chạy file `MyTranslate_<phiên bản>_x64-setup.exe` (cài cho riêng bạn, không cần quyền admin) hoặc `MyTranslate_<phiên bản>_x64_en-US.msi` (dùng khi IT cài hàng loạt).
2. Mở MyTranslate từ menu Start.
   Lần đầu, app hiện **Hướng dẫn ban đầu**: kiểm tra Claude Code và dịch thử một câu.
3. Xong hướng dẫn, trang **Bắt đầu dùng MyTranslate** nhắc lại ba cách dùng chính và có nút mở Teams / Slack.
4. Đóng cửa sổ: app vẫn chạy ở **khay hệ thống** (góc dưới bên phải) và phím tắt luôn sẵn sàng.
   Lần đầu đóng, Windows hiện một thông báo nhắc điều này.

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
- Với tin của khách: `G` để Claude gợi ý 3 câu trả lời tiếng Nhật (bấm một câu để sao chép), `Enter` để tự gõ câu trả lời tiếng Việt.

Dùng chuột: bôi đen chữ trong Teams/Slack, một thanh nhỏ hiện cạnh con trỏ với các nút Dịch, Kiểm tra, Dịch và sao chép.
Bật/tắt và chọn ứng dụng ở Cài đặt > Thao tác nhanh khi bôi đen.

App **không bao giờ tự gửi tin**: bạn vẫn tự nhấn gửi trong Teams/Slack.

### Mẹo để dịch tốt hơn

- **Người liên hệ**: ghi chú tên, vai trò, cách xưng hô cho từng cuộc trò chuyện; ghi chú này đi kèm mỗi lần dịch trong cuộc trò chuyện đó.
- **Glossary**: thêm tên màn hình, tên tính năng, thuật ngữ khách hay dùng (ví dụ `仕訳` = `bút toán`). Thuật ngữ xuất hiện trong đoạn cần dịch sẽ được dịch đúng như glossary.
- App tự gom tin theo cuộc trò chuyện và chủ đề (thread), và gửi kèm vài tin gần nhất để Claude hiểu các câu như 先ほどの件, それ.
  Xem lại ở cửa sổ chính, tab **Threads**: ghim một thread để mọi tin mới của cuộc trò chuyện vào đó, gộp thread trùng, lưu trữ thread đã xong, bấm **Tóm tắt** để Claude tóm tắt bằng tiếng Việt, xuất Markdown để bàn giao.
- **Người liên hệ**: đặt mức kính ngữ cho từng cuộc trò chuyện (ví dụ Trang trọng với PM khách, Lịch sự trong kênh nội bộ) và ghi chú về người ở đó (tên, vai trò, cách gọi). Đổi kính ngữ trong popup cũng được nhớ cho cuộc trò chuyện đó.
- **Glossary chung của team**: ở tab Glossary, bấm "Chọn file..." ở thanh dưới cùng và trỏ tới file `glossary.yaml` của dự án (trong repo hoặc thư mục OneDrive). App chỉ đọc file, thuật ngữ cá nhân được ưu tiên khi trùng.

## Dùng ChatGPT hoặc Gemini thay cho Claude

1. Tạo API key: ChatGPT tại https://platform.openai.com/api-keys, Gemini tại https://aistudio.google.com/apikey.
2. Cài đặt > Kết nối AI: chọn ChatGPT hoặc Gemini, dán key, bấm **Lưu** (key được lưu trong Windows Credential Manager của máy bạn).
3. Bấm **Dịch thử** để kiểm tra key và xem tốc độ; chọn model mặc định và đánh dấu ☆ các model muốn có trong menu chọn nhanh.
4. Đổi AI hoặc model hằng ngày: bấm tên model ở đầu popup (hoặc `Ctrl+M`), hoặc chuột phải icon khay > **AI dịch**. Popup dịch lại ngay bằng lựa chọn mới và dùng nó cho các lần sau.
5. Nếu muốn, bật **Tự chuyển sang AI khác khi lỗi**: khi AI đang chọn hết hạn mức hoặc lỗi, app dịch bằng AI khác đã cài đặt.

Dùng API được tính phí theo lượng chữ, tách khỏi gói ChatGPT Plus hay Gemini Advanced.
Không dùng gói miễn phí của Gemini cho tin nhắn của khách, vì Google có thể dùng dữ liệu đó để cải thiện model.

## Cập nhật

App tự kiểm tra bản mới. Khi có, bạn thấy thông báo "Có phiên bản mới" ở đầu cửa sổ chính, một dòng nhỏ dưới bản dịch trong popup, và mục "Cập nhật lên phiên bản ..." trong menu khay.
Bấm **Cập nhật và khởi động lại**: app tự tải, cài và mở lại sau vài giây; lịch sử và cài đặt giữ nguyên.
Muốn kiểm tra ngay: Cài đặt > Cập nhật > Kiểm tra ngay.

## Dữ liệu và quyền riêng tư

- Lịch sử dịch, thread, glossary nằm trên máy bạn: `%LOCALAPPDATA%\com.mytranslate.desktop\history.db`.
- Cài đặt: `%APPDATA%\com.mytranslate.desktop\settings.json`.
- Nội dung chỉ được gửi tới Claude qua Claude Code của chính bạn; app không có máy chủ riêng và không thu thập dữ liệu.
- Clipboard của bạn được khôi phục sau mỗi lần app lấy hoặc dán văn bản; chữ tạm của app không vào lịch sử clipboard (Win+V).
- Cài đặt > Dữ liệu: chọn thời gian giữ lịch sử, sao lưu ra một file `.db` (ví dụ trước khi đổi máy), khôi phục từ file đó, hoặc xóa toàn bộ dữ liệu.

## Xử lý sự cố

| Hiện tượng | Cách xử lý |
| --- | --- |
| Nhấn phím tắt không có gì xảy ra | Kiểm tra icon MyTranslate ở khay còn không; chuột phải icon, bỏ chọn "Tạm dừng phím tắt"; tổ hợp có thể bị app khác chiếm, đổi trong Cài đặt > Phím tắt |
| Popup báo "Chưa chọn đoạn văn bản nào" | Bôi đen lại tin cần dịch; với `Ctrl+Alt+K` đặt con trỏ trong ô chat có chữ |
| Popup báo "Claude Code chưa đăng nhập" | Mở terminal, chạy `claude`, đăng nhập, rồi bấm "Thử lại" |
| Popup báo hết hạn mức | Gói Claude đã dùng hết hạn mức của kỳ; chờ đến giờ làm mới ghi trong thông báo |
| Bản dịch hơi chậm (4-7 giây) thỉnh thoảng | Model đôi khi "suy nghĩ" trước khi trả lời; hiện chưa tắt được qua Claude Code (xem `spikes/sp1-latency/README.md`) |
| Muốn làm lại các bước ban đầu | Cài đặt > Dữ liệu > Hướng dẫn ban đầu > Xem lại |
