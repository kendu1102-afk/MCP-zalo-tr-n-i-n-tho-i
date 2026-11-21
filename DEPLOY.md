# Chạy bot 24/24 trên đám mây (miễn phí)

Sau khi cài, bot chạy trên một máy chủ ảo miễn phí. **Máy tính của bạn tắt, điện thoại tắt, bot vẫn tự trả lời**, vì bot giữ phiên đăng nhập Zalo riêng trên máy chủ (giống một tab Zalo Web luôn mở) và Claude Code cũng chạy trên máy chủ đó.

Toàn bộ dữ liệu tổng hợp (báo cáo hiện trường, tài liệu, mẫu, hồ sơ đã xuất) nằm trên ổ đĩa của máy chủ, và được sao lưu mỗi ngày.

## Chọn nhà cung cấp

| | **Oracle Cloud Always Free** (khuyên dùng) | Google Cloud e2-micro |
|---|---|---|
| Cấu hình miễn phí | Máy ARM (Ampere A1): năm 2026 Oracle đã giảm còn khoảng **2 nhân / 12 GB RAM**, vẫn dư cho bot | 1 nhân dùng chung / **1 GB RAM** (hơi chật cho Claude Code, script sẽ tạo thêm swap) |
| Vị trí | Chọn **Singapore** làm vùng chính lúc đăng ký (gần Việt Nam; không đổi được sau) | Chỉ vùng ở **Mỹ** |
| Thẻ ngân hàng | Cần để xác minh | Cần để xác minh |
| Rủi ro | Oracle **có thể thu hồi máy "nhàn rỗi"** (CPU thấp hơn 20% trong 7 ngày); bot dùng ít CPU nên có rủi ro này | Ít RAM, chậm hơn khi soạn hồ sơ |

Điều kiện miễn phí do nhà cung cấp quyết định và **thay đổi được bất cứ lúc nào**. Hãy xem trang chính thức trước khi đăng ký: [Oracle Always Free](https://docs.oracle.com/iaas/Content/FreeTier/resourceref.htm), [Google Cloud Free](https://docs.cloud.google.com/free). Với Oracle, nhiều người nâng tài khoản lên Pay As You Go (vẫn 0 đồng nếu dùng trong hạn mức Always Free) để tránh bị thu hồi máy nhàn rỗi; hãy tự xác nhận với Oracle trước khi làm.

**Chi phí thật sự:** máy chủ 0 đồng. Claude dùng gói Claude bạn đang trả (Pro/Max), nên bị giới hạn lượt dùng của gói (xem README, mục "Bộ não là Claude").

## Các bước (Oracle, Ubuntu 24.04)

1. **Tạo máy ảo:** Compute → Instances → Create. Image *Ubuntu 24.04*, Shape *VM.Standard.A1.Flex* (1–2 OCPU, 6–12 GB). Tải về khoá SSH.
2. **Đăng nhập máy chủ** từ máy tính của bạn:
   ```bash
   ssh -i duong-dan-khoa-ssh ubuntu@<IP-máy-chủ>
   ```
3. **Đưa mã nguồn lên.** Repo đang ở chế độ riêng tư nên cần token GitHub (quyền đọc repo). Lệnh sẽ hỏi mật khẩu, bạn dán token vào:
   ```bash
   git clone https://github.com/kendu1102-afk/MCP-zalo-tr-n-i-n-tho-i.git zalo-bot && cd zalo-bot
   ```
4. **Cài đặt** (Node 22, thư viện, Claude Code, dịch vụ 24/24, sao lưu hằng ngày):
   ```bash
   bash deploy/setup-ubuntu.sh
   ```
5. **Đăng nhập Claude** bằng tài khoản của bạn: chạy `claude`, mở đường link hiện ra trên điện thoại hoặc máy tính, dán mã trở lại, rồi gõ `/exit`.
6. **Đăng nhập Zalo cho nick bot:** chạy `npm run login`. Trên **máy tính của bạn**, tải ảnh QR về:
   ```bash
   scp -i duong-dan-khoa-ssh ubuntu@<IP-máy-chủ>:zalo-bot/data/qr.png .
   ```
   Mở ảnh rồi quét bằng Zalo **của nick bot** trên điện thoại, bấm xác nhận.
7. **Chạy bot:**
   ```bash
   sudo systemctl start zalo-bot
   ```
   Xem nhật ký:
   ```bash
   journalctl -u zalo-bot -f
   ```

Bot tự khởi động lại khi máy chủ khởi động lại hoặc khi gặp lỗi.

## Quản lý từ Claude Code

Dữ liệu nằm trên máy chủ, nên hãy quản lý ngay trên đó: `ssh` vào máy chủ, `cd zalo-bot`, chạy `claude`. Claude Code tự nạp MCP `zalo` từ `.mcp.json`; mọi công cụ (`project_*`, `report_*`, `doc_*`, `bot_config`...) dùng được như trên máy bạn.

## Sao lưu

- Mỗi ngày 2 giờ sáng, bot sao lưu vào `data/backups/` và giữ 14 bản gần nhất. Bản sao lưu gồm CSDL, mẫu văn bản và phiên Zalo; **giữ bí mật** vì phiên Zalo cho phép đăng nhập nick bot.
- Sao lưu tay: `npm run backup`.
- **Nên có bản ngoài máy chủ** (phòng máy bị thu hồi). Cách đơn giản là tải về máy bạn:
  ```bash
  scp -i duong-dan-khoa-ssh "ubuntu@<IP-máy-chủ>:zalo-bot/data/backups/*" .
  ```
  Hoặc cấu hình `rclone` tới Google Drive rồi đặt `BACKUP_REMOTE=gdrive:zalo-backup` trong crontab.
- **Khôi phục:** giải nén bản sao lưu vào `data/`, rồi chạy `sudo systemctl restart zalo-bot`.

## Những việc bot KHÔNG tự xử lý được

- **Phiên Zalo hết hạn hoặc bị Zalo đăng xuất:** bot ghi cảnh báo (xem `zalo_status` hoặc nhật ký) và chờ 30 phút giữa các lần thử để tránh bị khoá. Bạn cần `npm run login` và quét QR lại.
- **Mở nick bot trên Zalo Web/PC** sẽ đá bot ra; bot thử lại sau 10 phút. Mở nick bot trên **điện thoại** thì không sao.
- **Zalo có thể nghi ngờ đăng nhập từ máy chủ nước ngoài** (vì vậy nên chọn vùng Singapore). `zca-js` là thư viện không chính thức, nick bot có thể bị khoá.
- **Gói Claude hết lượt** trong khung giờ: bot không trả lời được cho tới khi hạn mức hồi lại.
