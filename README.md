# Translate for Slack

Extension hỗ trợ thu thập và dịch các cuộc trò chuyện trên Slack (channel, tin nhắn trực tiếp và thread) sang ngôn ngữ mong muốn thông qua Google Gemini.

## Tính năng nổi bật

- **Thu thập nội dung linh hoạt**: Hỗ trợ tải và lưu trữ toàn bộ tin nhắn trong channel, tin nhắn trực tiếp (DM) hoặc từng thread riêng biệt.
- **Dịch thông minh qua Gemini**: Tự động dịch nội dung hội thoại với ngữ cảnh tự nhiên dựa trên mô hình Gemini đã chọn.
- **Chế độ dịch đa dạng**:
  - *Dịch toàn bộ đã lưu*: Dịch lại tất cả tin nhắn đã thu thập theo cấu hình hiện tại.
  - *Dịch tin nhắn mới*: Chỉ dịch các tin nhắn mới phát sinh chưa có bản dịch, giúp tối ưu chi phí và thời gian.
  - *Dịch tin nhắn riêng lẻ*: Hỗ trợ dịch nhanh từng tin nhắn cụ thể ngay tại khung chat.
- **Chuyển đổi hiển thị tức thì**: Chuyển đổi qua lại giữa bản dịch và văn bản gốc thuận tiện thông qua nút bấm ngay cạnh tin nhắn.
- **Thu gọn thanh điều khiển**: Hỗ trợ ẩn hoặc hiện cụm nút thao tác trên màn hình để không che khuất nội dung làm việc.
- **Tùy biến cấu hình**: Dễ dàng cài đặt khóa API Gemini, tùy chọn model và ngôn ngữ đích trong popup của extension.
- **Lưu trữ cục bộ an toàn**: Khóa API và dữ liệu bản dịch được lưu trực tiếp trên trình duyệt của bạn, không gửi qua máy chủ trung gian thứ ba.

## Cài đặt và sử dụng

### 1. Cài đặt extension

**Cách 1: Cài đặt nhanh bằng một dòng lệnh (khuyên dùng)**

- Trên Linux hoặc macOS:
  ```bash
  curl -fsSL https://raw.githubusercontent.com/SonNX24042005/translate-for-slack/main/install.sh | bash
  ```

- Trên Windows (PowerShell):
  ```powershell
  irm https://raw.githubusercontent.com/SonNX24042005/translate-for-slack/main/install.ps1 | iex
  ```

*Lệnh trên sẽ tự động tải mã nguồn, sao chép sẵn đường dẫn thư mục vào bộ nhớ tạm (clipboard) và mở trang quản lý tiện ích của trình duyệt.*

**Cách 2: Cài đặt thủ công**
1. Tải mã nguồn về máy hoặc giải nén tệp zip.
2. Mở trang quản lý tiện ích trên trình duyệt (ví dụ: `chrome://extensions` hoặc `coccoc://extensions`).
3. Bật chế độ dành cho nhà phát triển (Developer mode).
4. Nhấn **Tải tiện ích đã giải nén** (Load unpacked) và chọn thư mục chứa mã nguồn extension.

### 2. Thiết lập ban đầu

**Bước 1: Lấy khóa API Gemini miễn phí từ Google AI Studio**
1. Truy cập [Google AI Studio](https://aistudio.google.com/app/apikey) và đăng nhập bằng tài khoản Google của bạn.
2. Nhấn nút **Create API key** ở góc trên bên phải trang:
   ![Nhấn Create API key trên Google AI Studio](docs/images/api_key_step1.png)
3. Trong hộp thoại hiển thị, đặt tên khóa (hoặc để mặc định) rồi nhấn nút **Create key**:
   ![Nhấn Create key trong hộp thoại](docs/images/api_key_step2.png)
4. Nhấn nút **Copy key** (hoặc biểu tượng sao chép) để lưu chuỗi khóa API:
   ![Sao chép khóa API](docs/images/api_key_step3.png)

**Bước 2: Cấu hình extension**
1. Nhấn vào biểu tượng extension trên thanh công cụ của trình duyệt để mở popup.
2. Dán khóa API vừa sao chép vào ô **Khóa API Gemini** (bạn cũng có thể bấm vào dòng *Lấy khóa API tại Google AI Studio* ngay trên giao diện popup để mở trang tạo khóa):
   ![Dán khóa API vào popup extension](docs/images/api_key_step4.png)
3. Lựa chọn model (mặc định: `gemini-3.8-flash`) và thiết lập ngôn ngữ đích cần dịch.

### 3. Sử dụng trên Slack
1. Truy cập Slack trên trình duyệt web.
2. Nhấn nút **Tải và lưu toàn bộ tin nhắn** tại channel hoặc cuộc trò chuyện trực tiếp cần dịch. Đối với từng thread, mở thread và nhấn **Tải và lưu toàn bộ thread**.
3. Nhấn **Dịch toàn bộ đã lưu** hoặc **Dịch tin nhắn mới** để bắt đầu dịch.
4. Nhấn nút **Dịch** / **Bản gốc** tại từng tin nhắn để xem nội dung mong muốn.
