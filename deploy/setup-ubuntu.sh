#!/usr/bin/env bash
# Cài bot lên máy chủ Ubuntu 22.04/24.04 (Oracle Cloud Always Free hoặc Google Cloud e2-micro).
# Chạy TRONG thư mục repo, bằng user thường có quyền sudo:   bash deploy/setup-ubuntu.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
USER_NAME="$(id -un)"
cd "$DIR"
say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }

say "1/8 Múi giờ Việt Nam"
sudo timedatectl set-timezone Asia/Ho_Chi_Minh || true

say "2/8 Bộ nhớ ảo (swap) nếu RAM dưới 2 GB"
RAM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$RAM_MB" -lt 2048 ] && ! swapon --show | grep -q .; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

say "3/8 Node.js 22"
if ! command -v node >/dev/null || ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)'; then
  sudo apt-get update -y
  sudo apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
node -v

say "4/8 Thư viện của bot"
npm ci --no-audit --no-fund

say "5/8 Claude Code"
if ! command -v claude >/dev/null; then
  sudo npm install -g @anthropic-ai/claude-code
fi
claude --version

say "6/8 rclone (đẩy ảnh hiện trường và sao lưu lên Google Drive)"
if ! command -v rclone >/dev/null; then
  sudo apt-get install -y unzip
  curl -fsSL https://rclone.org/install.sh | sudo bash
fi
rclone version | head -1

say "7/8 Dịch vụ chạy 24/24 (systemd)"
sed -e "s#__USER__#$USER_NAME#g" -e "s#__DIR__#$DIR#g" -e "s#__HOME__#$HOME#g" \
    -e "s#__NODE__#$(command -v node)#g" -e "s#__CLAUDE__#$(command -v claude)#g" -e "s#__PATH__#$PATH#g" \
    deploy/zalo-bot.service | sudo tee /etc/systemd/system/zalo-bot.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable zalo-bot >/dev/null

say "8/8 Sao lưu tự động 2 giờ sáng mỗi ngày"
chmod +x deploy/backup.sh
( crontab -l 2>/dev/null | grep -v 'deploy/backup.sh' ; echo "0 2 * * * cd $DIR && bash deploy/backup.sh >> $DIR/data/backup.log 2>&1" ) | crontab -

cat <<MSG

Cài xong. Các bước tiếp theo (làm một lần):
  1) claude                  -> đăng nhập tài khoản Claude của bạn (mở đường link hiện ra trên điện thoại/máy tính, dán mã lại), rồi gõ /exit
  2) npm run login           -> tạo data/qr.png; tải về máy bạn để quét bằng ZALO CỦA NICK BOT:
                                scp $USER_NAME@<IP-máy-chủ>:$DIR/data/qr.png .
                                Xong sẽ in MÃ GHÉP NỐI: dùng Zalo chính nhắn cho nick bot  /ketnoi <mã>
  3) rclone config           -> kết nối Google Drive (xem DEPLOY.md, mục "Google Drive")
  4) sudo systemctl start zalo-bot
     journalctl -u zalo-bot -f       (xem nhật ký; Ctrl+C để thoát)
  5) npm run kiemtra         -> xem còn thiếu bước nào. Các bước còn lại làm ngay trên Zalo (nhắn /huongdan cho nick bot).
MSG
