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
   git clone -b claude/hopeful-lamport-bf8qqw https://github.com/kendu1102-afk/MCP-zalo-tr-n-i-n-tho-i.git zalo-bot && cd zalo-bot
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
   Mở ảnh rồi quét bằng Zalo **của nick bot** trên điện thoại, bấm xác nhận. Màn hình máy chủ sẽ in **MÃ GHÉP NỐI** (hiệu lực 24 giờ): giữ lại cho bước 8.
7. **Chạy bot:**
   ```bash
   sudo systemctl start zalo-bot
   ```
   Xem nhật ký:
   ```bash
   journalctl -u zalo-bot -f
   ```

Bot tự khởi động lại khi máy chủ khởi động lại hoặc khi gặp lỗi.

8. **Ghép nối tài khoản chủ:** kết bạn giữa Zalo chính của bạn và nick bot, rồi từ Zalo chính nhắn cho nick bot `/ketnoi <mã>`. Tự trả lời sẽ được bật luôn.
9. **Kiểm tra:** chạy `npm run kiemtra` để xem còn thiếu bước nào. Các bước còn lại (công trình, ghép nhóm, cấp quyền, mẫu hồ sơ, thư mục Drive) **làm ngay trên Zalo**: nhắn `/huongdan` cho nick bot.

## Google Drive: ảnh hiện trường, nhật ký, sao lưu

Bot tải **mọi ảnh, video và tệp** (Excel, PDF...) mà hiện trường gửi trong các nhóm đã ghép công trình, rồi chuyển lên thư mục bạn chỉ định trên Google Drive:

```
<Thư mục bạn chỉ định>/
├── Cầu ABC/
│   └── 2026-11-21/
│       ├── 081530_Anh Tuấn_Đổ bê tông mố M1_<mã>.jpg
│       ├── 091002_Chị Lan_KL tuần 47_<mã>.xlsx
│       └── Nhat ky 2026-11-21.txt   ← toàn bộ tin nhắn trong ngày + bảng khối lượng đã tổng hợp
├── Bảo dưỡng QL.xx/ ...
└── _Sao luu/                         ← bản sao lưu dữ liệu hằng ngày (không kèm phiên Zalo)
```

- Tải ngay khi tin đến, vì link ảnh của Zalo có thể hết hạn. Ảnh lấy bản **HD** nếu có. Mỗi tệp tối đa 500 MB.
- Mỗi 10 phút, bot chuyển các tệp đã tải lên Drive rồi **xoá bản tạm** trên máy chủ, nên ổ đĩa máy chủ không bị đầy. Gặp lỗi (mạng, token hết hạn) thì tệp được giữ lại và thử lại ở lần sau.
- Nhật ký ngày của hôm nay và hôm qua được ghi lại mỗi lần đồng bộ (tin đến muộn vẫn được cập nhật).
- Chỉ lấy tệp từ **nhóm đã ghép công trình**. Muốn lấy cả nhóm chưa ghép: `media_scope = all_groups`; khi đó tệp nằm trong thư mục `_Chua ghep cong trinh/<tên nhóm>/`.
- Chỉ lấy từ lúc bot đã ở trong nhóm và đang chạy; ảnh gửi trước đó không tải lại được.

### Kết nối Google Drive (làm một lần)

Máy chủ không có trình duyệt, nên bạn cấp quyền Drive bằng máy tính của bạn:

1. Trên **máy tính của bạn** (Windows), tải rclone tại rclone.org/downloads và giải nén.
2. Trên **máy chủ**, chạy `rclone config` và trả lời lần lượt:
   - `n` (tạo mới); name: `gdrive`; storage: chọn **Google Drive** (`drive`).
   - `client_id` và `client_secret`: để trống, Enter.
   - **scope: chọn `drive.file`** (khuyên dùng). Với quyền này máy chủ **chỉ thấy các tệp do chính nó tạo**, không đọc được phần còn lại trong 5 TB của bạn. Nếu máy chủ bị lộ, dữ liệu khác của bạn vẫn an toàn.
   - `root_folder_id`, `service_account_file`: để trống. "Edit advanced config?": `n`.
   - "Use web browser to automatically authenticate?": **`n`**. rclone in ra một lệnh dạng `rclone authorize "drive" "..."`.
3. Chạy đúng lệnh đó trên **máy tính của bạn** (trong thư mục rclone). Trình duyệt mở ra, bạn đăng nhập tài khoản Google có 5 TB và cho phép. Chép đoạn mã hiện ra rồi dán vào máy chủ.
4. "Configure this as a Shared Drive?": `n`. Xác nhận `y`, rồi `q` để thoát.
5. Kiểm tra trên máy chủ:
   ```bash
   rclone lsd gdrive:
   ```
6. Đặt thư mục đích (nói với Claude Code, hoặc dùng `bot_config`): `drive_remote = gdrive:Cong trinh/Anh hien truong`. Bot sẽ **tạo** thư mục này trong "Drive của tôi".

**Muốn dùng một thư mục ĐÃ CÓ sẵn trên Drive?** Quyền `drive.file` không nhìn thấy thư mục do bạn tự tạo. Khi đó, ở bước scope chọn `drive` (toàn quyền) và điền `root_folder_id` bằng mã thư mục (phần cuối đường link `drive.google.com/drive/folders/<mã>`). rclone sẽ chỉ làm việc bên trong thư mục đó, nhưng token trên máy chủ vẫn có toàn quyền với Drive của bạn.

Kiểm tra tình trạng bằng `drive_status`; đồng bộ ngay bằng `drive_sync_now`; xem tệp của một công trình bằng `media_list`.

## Quản lý từ Claude Code

Dữ liệu nằm trên máy chủ, nên hãy quản lý ngay trên đó: `ssh` vào máy chủ, `cd zalo-bot`, chạy `claude`. Claude Code tự nạp MCP `zalo` từ `.mcp.json`; mọi công cụ (`project_*`, `report_*`, `doc_*`, `bot_config`...) dùng được như trên máy bạn.

## Sao lưu

- Mỗi ngày 2 giờ sáng, bot sao lưu vào `data/backups/` và giữ 14 bản gần nhất. Bản sao lưu gồm CSDL, mẫu văn bản và phiên Zalo; **giữ bí mật** vì phiên Zalo cho phép đăng nhập nick bot.
- Sao lưu tay: `npm run backup`.
- Khi đã đặt `drive_remote`, bản sao lưu tự được đẩy lên `<thư mục Drive>/_Sao luu/` (không kèm phiên Zalo). Bản trên máy chủ vẫn có phiên để khôi phục nhanh.
- Có thể tải thêm một bản về máy bạn:
  ```bash
  scp -i duong-dan-khoa-ssh "ubuntu@<IP-máy-chủ>:zalo-bot/data/backups/*" .
  ```
- **Khôi phục:** giải nén bản sao lưu vào `data/`, rồi chạy `sudo systemctl restart zalo-bot`.

## Những việc bot KHÔNG tự xử lý được

- **Phiên Zalo hết hạn hoặc bị Zalo đăng xuất:** bot ghi cảnh báo (xem `zalo_status` hoặc nhật ký) và chờ 30 phút giữa các lần thử để tránh bị khoá. Bạn cần `npm run login` và quét QR lại.
- **Mở nick bot trên Zalo Web/PC** sẽ đá bot ra; bot thử lại sau 10 phút. Mở nick bot trên **điện thoại** thì không sao.
- **Zalo có thể nghi ngờ đăng nhập từ máy chủ nước ngoài** (vì vậy nên chọn vùng Singapore). `zca-js` là thư viện không chính thức, nick bot có thể bị khoá.
- **Gói Claude hết lượt** trong khung giờ: bot không trả lời được cho tới khi hạn mức hồi lại.
