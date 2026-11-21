# Việc bạn cần làm (khi rảnh)

Những phần mình làm được thì đã làm xong. Còn lại là các bước **cần chính bạn thao tác**: tài khoản, thẻ ngân hàng, quét mã QR, cấp quyền Google. Làm theo thứ tự dưới đây, tổng cộng khoảng **1 đến 1,5 giờ**. Phần lớn chỉ làm một lần.

Mỗi bước có hướng dẫn chi tiết trong [DEPLOY.md](DEPLOY.md). Kẹt ở đâu, chụp màn hình gửi Claude.

## A. Chuẩn bị (10 phút)

- [ ] **A1. Nick Zalo phụ cho bot.** Dùng một số điện thoại khác số chính. Bot chạy trên nick này; Zalo chính của bạn dùng để hỏi và quản lý.
- [ ] **A2. Kết bạn** giữa Zalo chính và nick bot. Từ nick bot, kết bạn với những người sẽ hỏi bot hoặc nhờ bot làm hồ sơ (bot chỉ trả lời bạn bè).
- [ ] **A3. Thêm nick bot vào các nhóm hiện trường** của từng công trình.

## B. Máy chủ miễn phí chạy 24/24 (40 đến 60 phút)

- [ ] **B1. Đăng ký Oracle Cloud** (cloud.oracle.com, cần thẻ để xác minh, không bị trừ tiền). **Chọn vùng Singapore**, vì không đổi được sau này.
- [ ] **B2. Tạo máy ảo** Ubuntu 24.04, shape *VM.Standard.A1.Flex*, 1 đến 2 OCPU, 6 đến 12 GB. Tải khoá SSH về máy.
- [ ] **B3. Tạo token GitHub** (Settings → Developer settings → Fine-grained token, chỉ quyền đọc repo này) để tải mã nguồn lên máy chủ.
- [ ] **B4. SSH vào máy chủ**, tải mã nguồn, rồi chạy:
  ```bash
  bash deploy/setup-ubuntu.sh
  ```
- [ ] **B5. Đăng nhập Claude:** chạy `claude`, mở link trên điện thoại, dán mã lại, gõ `/exit`.
- [ ] **B6. Đăng nhập Zalo cho nick bot:** chạy `npm run login`, tải `data/qr.png` về, quét bằng **Zalo của nick bot**. **Ghi lại MÃ GHÉP NỐI** in ra màn hình.
- [ ] **B7. Chạy bot:**
  ```bash
  sudo systemctl start zalo-bot
  ```

## C. Google Drive 5 TB (15 phút)

- [ ] **C1. Kết nối Drive:** trên máy chủ chạy `rclone config`, chọn quyền `drive.file`. Bước cấp quyền dùng rclone trên máy tính của bạn để đăng nhập Google (xem DEPLOY.md, mục "Google Drive").
- [ ] **C2. Đặt thư mục lưu:** nhắn cho nick bot `/drive gdrive:Cong trinh/Anh hien truong` (đổi tên thư mục tùy ý).

## D. Cài đặt ngay trên Zalo bằng điện thoại (15 phút)

- [ ] **D1.** Từ Zalo chính nhắn cho nick bot: `/ketnoi <mã ở bước B6>`. Bot sẽ tự bật chế độ trả lời.
- [ ] **D2.** Tạo từng công trình, kèm tên gọi tắt hiện trường hay dùng:
  ```
  /congtrinh them Cầu ABC | ABC, cau abc
  ```
- [ ] **D3.** Nhắn `/nhom`, ghép các nhóm chưa tự ghép: `/ghep <số> <công trình>`.
- [ ] **D4.** Cấp quyền nhờ làm hồ sơ: `/banbe <tên>`, rồi `/capquyen <số> <công trình> [bonho]`.
- [ ] **D5. Mẫu hồ sơ:** mở mẫu báo cáo, tờ trình của công ty bằng Word. Thay chỗ cần điền bằng thẻ như `{kinh_gui}`, `{noi_dung}`. Với bảng khối lượng, đặt `{#hang_muc}` ở ô đầu và `{/hang_muc}` ở ô cuối của một dòng. Gửi file cho nick bot, bot tự nạp. *(Muốn Claude đặt thẻ giúp thì làm bước E1 trước.)*
- [ ] **D6.** Gửi các tài liệu dự án (PDF/Word/Excel) cho nick bot để nạp vào bộ nhớ.
- [ ] **D7.** Trên máy chủ chạy `npm run kiemtra`: mọi dòng đều ✅ là xong.

## E. Không bắt buộc

- [ ] **E1. Kết nối lại Google Drive cho Claude** (claude.ai → Settings → Connectors → Google Drive → kết nối lại và cho đủ quyền). Đêm nay Claude thử tìm mẫu báo cáo, tờ trình của công ty trong Drive của bạn nhưng connector **thiếu quyền**. Kết nối lại xong, nhắn Claude: "tìm mẫu báo cáo, tờ trình trong Drive và đặt thẻ giúp tôi".
- [ ] **E2. Điều khoản:** bot dùng gói Claude cá nhân của bạn để phục vụ cả người khác. Nên đọc điều khoản của Anthropic; nếu cần thì chuyển `engine=api` (trả phí theo API key).
- [ ] **E3.** Thỉnh thoảng tải bản sao lưu về máy, đề phòng Oracle thu hồi máy chủ nhàn rỗi. Bản sao lưu đã tự đẩy lên `Drive/_Sao luu` mỗi đêm.

## Đã làm xong (để bạn biết)

| Yêu cầu của bạn | Tình trạng |
|---|---|
| Bot chỉ là cầu nối, mọi việc do Claude làm bằng tài khoản của bạn | ✅ Đã chạy thử thật |
| Tự đọc tin nhóm, tổng hợp khối lượng theo từng công trình | ✅ Đã chạy thử thật |
| Hỏi khối lượng thì bot trả lời ngay | ✅ Đã chạy thử thật |
| Chỉ trả lời người đã kết bạn | ✅ |
| Nạp kiến thức, bot nhớ mãi | ✅ Nạp được ngay trên Zalo bằng cách gửi file hoặc `/ghinho` |
| Làm báo cáo, tờ trình theo mẫu công ty rồi gửi cho người yêu cầu | ✅ Đã chạy thử thật; mặc định bạn duyệt trước (`duyệt 12`) |
| Dùng bộ nhớ tài khoản Claude, chỉ cho nick bạn cho phép | ✅ `/capquyen ... bonho` |
| Chạy 24/24 miễn phí, máy tính và điện thoại tắt vẫn trả lời | ✅ Bộ cài sẵn sàng, chờ bạn làm mục B |
| Tải hết ảnh, tệp hiện trường lên thư mục Google Drive chỉ định | ✅ Chờ bạn làm mục C |
| Claude đọc ảnh chụp bảng khối lượng, Excel, PDF để lấy số liệu | ✅ Đã chạy thử thật |
| Tổng hợp gửi bạn mỗi tối 18:00 | ✅ |
| Quản lý mọi thứ ngay trên Zalo điện thoại | ✅ `/huongdan` |

**Chưa kiểm chứng được** (vì cần tài khoản của bạn): đăng nhập Zalo thật, gửi và nhận tin Zalo thật, rclone với Google Drive thật, cài đặt trên máy Oracle thật. Lần chạy đầu tiên có lỗi gì, bạn gửi nhật ký (`journalctl -u zalo-bot -n 100`) cho Claude.
