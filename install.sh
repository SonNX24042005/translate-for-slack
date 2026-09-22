#!/usr/bin/env bash
set -e

REPO_URL="${REPO_URL:-https://github.com/SonNX24042005/translate-for-slack.git}"
ZIP_URL="https://github.com/SonNX24042005/translate-for-slack/archive/refs/heads/main.zip"
INSTALL_DIR="${INSTALL_DIR:-$HOME/Downloads/translate-for-slack}"

echo "=========================================="
echo "  Cài đặt tiện ích Translate for Slack"
echo "=========================================="
echo ""

# 1. Chọn trình duyệt (hỗ trợ đọc bàn phím cả khi chạy qua curl pipe)
echo "Chọn trình duyệt bạn muốn cài đặt tiện ích:"
echo "  1) Google Chrome"
echo "  2) Cốc Cốc"
echo "  3) Microsoft Edge"
echo "  4) Brave"
echo "  5) Chromium"
echo "  6) Mở trình duyệt mặc định"
echo ""

prompt_user() {
  local prompt_text="$1"
  local var_name="$2"
  if [ -t 0 ]; then
    read -r -p "$prompt_text" "$var_name"
  elif [ -e /dev/tty ]; then
    read -r -p "$prompt_text" "$var_name" < /dev/tty
  else
    eval "$var_name=\"\""
  fi
}

prompt_user "Nhập lựa chọn của bạn (1-6) [mặc định: 1]: " BROWSER_CHOICE
BROWSER_CHOICE="${BROWSER_CHOICE:-1}"

BROWSER_CMD=""
EXTENSIONS_URL="chrome://extensions"

case "$BROWSER_CHOICE" in
  1)
    EXTENSIONS_URL="chrome://extensions"
    if command -v google-chrome &>/dev/null; then
      BROWSER_CMD="google-chrome"
    elif command -v google-chrome-stable &>/dev/null; then
      BROWSER_CMD="google-chrome-stable"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
      BROWSER_CMD="open -a 'Google Chrome'"
    fi
    ;;
  2)
    EXTENSIONS_URL="coccoc://extensions"
    if command -v coccoc-browser &>/dev/null; then
      BROWSER_CMD="coccoc-browser"
    elif command -v coccoc &>/dev/null; then
      BROWSER_CMD="coccoc"
    elif [ -x "/opt/coccoc/browser/coccoc" ]; then
      BROWSER_CMD="/opt/coccoc/browser/coccoc"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
      BROWSER_CMD="open -a 'CocCoc'"
    fi
    ;;
  3)
    EXTENSIONS_URL="edge://extensions"
    if command -v microsoft-edge-stable &>/dev/null; then
      BROWSER_CMD="microsoft-edge-stable"
    elif command -v microsoft-edge &>/dev/null; then
      BROWSER_CMD="microsoft-edge"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
      BROWSER_CMD="open -a 'Microsoft Edge'"
    fi
    ;;
  4)
    EXTENSIONS_URL="brave://extensions"
    if command -v brave-browser &>/dev/null; then
      BROWSER_CMD="brave-browser"
    elif command -v brave &>/dev/null; then
      BROWSER_CMD="brave"
    elif [ -x "/snap/bin/brave" ]; then
      BROWSER_CMD="/snap/bin/brave"
    elif [[ "$OSTYPE" == "darwin"* ]]; then
      BROWSER_CMD="open -a 'Brave Browser'"
    fi
    ;;
  5)
    EXTENSIONS_URL="chrome://extensions"
    if command -v chromium &>/dev/null; then
      BROWSER_CMD="chromium"
    elif command -v chromium-browser &>/dev/null; then
      BROWSER_CMD="chromium-browser"
    elif [ -x "/snap/bin/chromium" ]; then
      BROWSER_CMD="/snap/bin/chromium"
    fi
    ;;
  *)
    EXTENSIONS_URL="chrome://extensions"
    ;;
esac

# 2. Tải mã nguồn tiện ích từ kho lưu trữ
echo ""
echo "→ Đang tải mã nguồn tiện ích..."
mkdir -p "$(dirname "$INSTALL_DIR")"

if [ -d "$INSTALL_DIR/.git" ]; then
  echo "• Thư mục đã tồn tại, tiến hành cập nhật bản mới nhất..."
  git -C "$INSTALL_DIR" pull --ff-only || true
elif [ -d "$INSTALL_DIR" ]; then
  echo "• Thư mục $INSTALL_DIR đã tồn tại."
else
  if command -v git &>/dev/null; then
    echo "• Sử dụng git clone để tải mã nguồn..."
    git clone "$REPO_URL" "$INSTALL_DIR"
  elif command -v curl &>/dev/null && command -v unzip &>/dev/null; then
    echo "• Tải tệp nén zip và giải nén..."
    TMP_ZIP=$(mktemp)
    curl -sSL "$ZIP_URL" -o "$TMP_ZIP"
    TMP_DIR=$(mktemp -d)
    unzip -q "$TMP_ZIP" -d "$TMP_DIR"
    EXTRACTED=$(find "$TMP_DIR" -mindepth 1 -maxdepth 1 -type d | head -n 1)
    mv "$EXTRACTED" "$INSTALL_DIR"
    rm -rf "$TMP_ZIP" "$TMP_DIR"
  else
    echo "Lỗi: Không tìm thấy git hoặc curl/unzip để tải mã nguồn."
    exit 1
  fi
fi

echo "✓ Mã nguồn đã sẵn sàng tại: $INSTALL_DIR"

# 3. Sao chép đường dẫn vào clipboard
COPIED=false
if command -v wl-copy &>/dev/null; then
  echo "$INSTALL_DIR" | wl-copy
  COPIED=true
elif command -v xclip &>/dev/null; then
  echo -n "$INSTALL_DIR" | xclip -selection clipboard
  COPIED=true
elif command -v xsel &>/dev/null; then
  echo -n "$INSTALL_DIR" | xsel --clipboard --input
  COPIED=true
elif command -v pbcopy &>/dev/null; then
  echo -n "$INSTALL_DIR" | pbcopy
  COPIED=true
fi

# 4. Mở trình duyệt đến trang quản lý tiện ích
echo ""
echo "→ Đang mở trang quản lý tiện ích trên trình duyệt..."
if [ -n "$BROWSER_CMD" ]; then
  if [[ "$OSTYPE" == "darwin"* ]]; then
    $BROWSER_CMD --args "--app=$EXTENSIONS_URL" >/dev/null 2>&1 &
  else
    $BROWSER_CMD --app="$EXTENSIONS_URL" >/dev/null 2>&1 &
  fi
elif command -v xdg-open &>/dev/null; then
  xdg-open "$EXTENSIONS_URL" >/dev/null 2>&1 &
elif [[ "$OSTYPE" == "darwin"* ]]; then
  open "$EXTENSIONS_URL" >/dev/null 2>&1 &
fi

# 5. Hướng dẫn người dùng hoàn tất
echo ""
echo "=========================================="
echo "  Hướng dẫn hoàn tất cài đặt"
echo "=========================================="
if [ "$COPIED" = true ]; then
  echo "✓ Đã tự động sao chép đường dẫn thư mục vào clipboard!"
else
  echo "• Đường dẫn thư mục cài đặt:"
  echo "  $INSTALL_DIR"
fi
echo ""
echo "• Địa chỉ trang tiện ích: $EXTENSIONS_URL"
echo "  (Nếu trình duyệt mở trang chủ, hãy dán địa chỉ trên vào thanh URL rồi Enter)"
echo ""
echo "1. Bật công tắc 'Chế độ dành cho nhà phát triển' (Developer mode) ở góc trên bên phải."
echo "2. Nhấn nút 'Tải tiện ích đã giải nén' (Load unpacked) ở góc trên bên trái."
echo "3. Dán (Ctrl+V) hoặc chọn thư mục: $INSTALL_DIR"
echo "=========================================="
echo "Hoàn tất! Extension Translate for Slack đã sẵn sàng hoạt động."
