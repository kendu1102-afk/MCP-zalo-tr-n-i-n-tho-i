#!/usr/bin/env bash
# Sao lưu dữ liệu (CSDL + mẫu văn bản + phiên Zalo) vào data/backups, giữ 14 bản gần nhất.
# Tuỳ chọn: đặt BACKUP_REMOTE (ví dụ "gdrive:zalo-backup") nếu đã cấu hình rclone để đẩy thêm lên Google Drive.
set -euo pipefail
cd "$(dirname "$0")/.."
DATA="${ZALO_MCP_HOME:-$PWD/data}"
OUT="$DATA/backups"
mkdir -p "$OUT"
chmod 700 "$OUT"
STAMP="$(date +%Y-%m-%d_%H%M)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Ảnh chụp CSDL nhất quán kể cả khi bot đang ghi
node -e '
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(process.argv[1]);
  db.exec("VACUUM INTO " + JSON.stringify(process.argv[2]).replace(/"/g, "\x27"));
' "$DATA/zalo.db" "$TMP/zalo.db" 2>/dev/null

ITEMS=(zalo.db)
cp -r "$DATA/templates" "$TMP/" 2>/dev/null && ITEMS+=(templates)
cp "$DATA/session.json" "$TMP/" 2>/dev/null && ITEMS+=(session.json)
tar -czf "$OUT/zalo-$STAMP.tar.gz" -C "$TMP" "${ITEMS[@]}"
chmod 600 "$OUT/zalo-$STAMP.tar.gz"

ls -1t "$OUT"/zalo-*.tar.gz | tail -n +15 | xargs -r rm -f
# Mặc định đẩy bản sao lưu lên "<thư mục Drive của bot>/_Sao luu" nếu đã đặt drive_remote
if [ -z "${BACKUP_REMOTE:-}" ]; then
  DR="$(node -e 'try{const {DatabaseSync}=require("node:sqlite");const r=new DatabaseSync(process.argv[1]).prepare("select value from settings where key=\x27drive_remote\x27").get();process.stdout.write(r?r.value:"")}catch{}' "$DATA/zalo.db" 2>/dev/null || true)"
  [ -n "$DR" ] && BACKUP_REMOTE="$DR/_Sao luu"
fi
if [ -n "${BACKUP_REMOTE:-}" ] && command -v "${RCLONE_BIN:-rclone}" >/dev/null; then
  # Bản đẩy lên Drive KHÔNG kèm session.json (phiên Zalo = quyền đăng nhập nick bot)
  REMOTE_ITEMS=()
  for i in "${ITEMS[@]}"; do [ "$i" != "session.json" ] && REMOTE_ITEMS+=("$i"); done
  tar -czf "$TMP/zalo-$STAMP.tar.gz" -C "$TMP" "${REMOTE_ITEMS[@]}"
  "${RCLONE_BIN:-rclone}" copy "$TMP/zalo-$STAMP.tar.gz" "$BACKUP_REMOTE" && echo "Đã đẩy lên $BACKUP_REMOTE (không kèm phiên Zalo)"
fi
echo "Đã sao lưu: $OUT/zalo-$STAMP.tar.gz"
