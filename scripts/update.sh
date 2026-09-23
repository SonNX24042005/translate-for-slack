#!/usr/bin/env bash
set -euo pipefail

ZIP_URL="${ZIP_URL:-https://github.com/SonNX24042005/translate-for-slack/archive/refs/heads/main.zip}"
if [[ "$OSTYPE" == "darwin"* ]]; then
  DEFAULT_INSTALL_DIR="$HOME/Library/Application Support/translate-for-slack"
else
  DEFAULT_INSTALL_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/translate-for-slack"
fi
LEGACY_INSTALL_DIR="$HOME/Downloads/translate-for-slack"

if [ -n "${INSTALL_DIR:-}" ]; then
  TARGET_DIR="$INSTALL_DIR"
elif [ -d "$DEFAULT_INSTALL_DIR" ]; then
  TARGET_DIR="$DEFAULT_INSTALL_DIR"
elif [ -d "$LEGACY_INSTALL_DIR" ]; then
  TARGET_DIR="$LEGACY_INSTALL_DIR"
  echo "Đang cập nhật bản cài cũ trong Downloads để giữ nguyên tiện ích đã tải vào trình duyệt."
else
  echo "Không tìm thấy tiện ích đã cài. Hãy chạy lệnh cài đặt trước." >&2
  exit 1
fi

if [ ! -f "$TARGET_DIR/manifest.json" ]; then
  echo "Thư mục không chứa tiện ích Translate for Slack: $TARGET_DIR" >&2
  exit 1
fi

echo "Đang cập nhật: $TARGET_DIR"
if [ -d "$TARGET_DIR/.git" ]; then
  command -v git >/dev/null || { echo "Cần cài Git để cập nhật bản cài bằng Git." >&2; exit 1; }
  git -C "$TARGET_DIR" pull --ff-only
else
  command -v curl >/dev/null || { echo "Cần cài curl để cập nhật bản cài từ tệp zip." >&2; exit 1; }
  command -v unzip >/dev/null || { echo "Cần cài unzip để cập nhật bản cài từ tệp zip." >&2; exit 1; }
  PARENT_DIR="$(dirname "$TARGET_DIR")"
  WORK_DIR="$(mktemp -d "$PARENT_DIR/.tfs-update.XXXXXX")"
  KEEP_BACKUP=false
  trap 'if [ "$KEEP_BACKUP" = true ]; then echo "Bản cũ được giữ tại: $WORK_DIR/backup" >&2; else rm -rf "$WORK_DIR"; fi' EXIT
  curl -fsSL "$ZIP_URL" -o "$WORK_DIR/latest.zip"
  unzip -q "$WORK_DIR/latest.zip" -d "$WORK_DIR/extracted"
  NEW_DIR="$WORK_DIR/extracted/translate-for-slack-main"
  if [ ! -f "$NEW_DIR/manifest.json" ]; then
    echo "Bản tải về không hợp lệ; bản đang dùng chưa bị thay đổi." >&2
    exit 1
  fi
  mv "$TARGET_DIR" "$WORK_DIR/backup"
  KEEP_BACKUP=true
  if ! mv "$NEW_DIR" "$TARGET_DIR"; then
    if mv "$WORK_DIR/backup" "$TARGET_DIR"; then
      KEEP_BACKUP=false
      echo "Cập nhật thất bại; đã khôi phục bản cũ." >&2
    else
      echo "Không thể khôi phục tự động." >&2
    fi
    exit 1
  fi
  KEEP_BACKUP=false
fi

echo "Đã cập nhật tại: $TARGET_DIR"
echo "Mở trang quản lý tiện ích trong trình duyệt, nhấn Tải lại cho Translate for Slack, rồi tải lại các trang Slack đang mở."
