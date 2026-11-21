# MCP Zalo + bot tự trả lời

Kết nối **Claude Code** với **Zalo cá nhân** (qua thư viện không chính thức `zca-js`):

1. **MCP server** (`src/mcp.ts`): Claude Code nạp/tìm kiến thức, đọc tin nhắn, đặt lệnh gửi tin.
2. **Bot** (`src/bot.ts`): giữ kết nối Zalo, ghi nhật ký tin nhắn, **tự trả lời tin nhắn riêng** dựa trên kiến thức đã nạp.
3. Hai phần dùng chung một file SQLite (`data/zalo.db`). Bộ nhớ kiến thức nằm trong đó nên **nạp một lần, nhớ mãi** (kể cả khi khởi động lại).

> ⚠️ `zca-js` giả lập Zalo Web, **không chính thức**: có thể bị Zalo khoá tài khoản. Nên dùng nick phụ. Zalo chỉ cho một listener mỗi tài khoản: mở Zalo Web/PC cùng lúc sẽ ngắt bot.

## Bộ não là Claude (tài khoản của bạn)

Bot Zalo chỉ là **cầu nối**. Mọi việc đọc tin để tổng hợp số liệu, trả lời câu hỏi, soạn báo cáo và tờ trình đều do **Claude Code chạy bằng tài khoản Claude đang đăng nhập trên máy chạy bot** đảm nhận (`claude -p`, không cần API key; `engine=claude-code`, mặc định).

- **An toàn:** mỗi lần gọi, Claude Code bị tắt toàn bộ công cụ có sẵn (không chạy lệnh, không đọc/sửa file, không lên web) và chỉ được nạp MCP do bot chỉ định. Khi soạn hồ sơ, MCP đó **chỉ đọc** và **chỉ thấy các công trình người yêu cầu được cấp**; phạm vi này do bot đặt, Claude không tự nới được.
- **Bộ nhớ tài khoản** (`~/.claude/CLAUDE.md` và cài đặt cấp user của Claude Code) **chỉ được nạp cho nick bạn cho phép**: tài khoản chủ (đã `/ketnoi`) và người được `requester_add ... account_memory=true`. Nick khác không được dùng.
- **Hạn mức:** dùng gói Claude của bạn nên chịu giới hạn lượt dùng của gói. Khi chạm giới hạn, bot sẽ trả lời chậm hoặc không trả lời được cho tới khi hạn mức hồi lại. Muốn ổn định hơn có thể chuyển `engine=api` (tính phí theo API key).
- **Điều khoản:** gói Claude cá nhân dành cho chính bạn sử dụng. Dùng nó để bot tự động phục vụ người khác (đồng nghiệp, hiện trường) có thể vượt phạm vi điều khoản sử dụng; bạn nên tự kiểm tra điều khoản của Anthropic, và chuyển sang `engine=api` nếu cần.

## Cài đặt (máy tính/VPS bật liên tục, cần Node >= 22.13 và Claude Code)

```bash
npm install
claude                 # chạy một lần, đăng nhập tài khoản Claude của bạn, rồi thoát
npm run login          # mở data/qr.png, quét bằng Zalo của NICK BOT và xác nhận
npm run bot            # giữ chạy (systemd/pm2), xem DEPLOY.md để chạy 24/24 trên đám mây
```

Claude Code đọc `.mcp.json` trong thư mục này (chạy `claude` tại đây và chấp nhận server `zalo`).

## Dùng

- Nạp kiến thức: nói với Claude Code "nạp file /đường/dẫn/quy-trinh.pdf vào bộ nhớ" hoặc dán nội dung. Hỗ trợ txt, md, csv, json, docx, pdf (PDF scan ảnh thì không đọc được chữ).
- Hỏi Claude Code: nó tự `kb_search` rồi trả lời kèm nguồn.
- **Bật bot tự trả lời** (mặc định TẮT): "đặt bot_enabled = true".
- Người lạ nhắn riêng → bot tìm trong kiến thức (chỉ tài liệu `bot_visible`) → trả lời có tiền tố `🤖`. Không đủ căn cứ → **im lặng** và ghi vào danh sách chưa trả lời (`zalo_unanswered`), không bịa.

## Cơ chế an toàn

| Cơ chế | Mặc định |
|---|---|
| Bot tắt cho đến khi bạn bật | `bot_enabled=false` |
| **Chỉ trả lời người đã kết bạn với nick bot** (danh sách bạn bè đồng bộ khi khởi động, mỗi 10 phút và khi có thay đổi; chưa đồng bộ được thì không trả lời ai) | `friends_only=true` |
| Chỉ trả lời DM dạng chữ, không bao giờ trả lời nhóm | cố định |
| Số liệu công trình chỉ cho tài khoản đã ghép nối (`/ketnoi`) | `owner_ids` rỗng |
| Chỉ dùng tài liệu `bot_visible=true`; tài liệu riêng tư chỉ Claude Code thấy | `kb_set_visibility` |
| Không biết thì không trả lời | `fallback_reply` rỗng |
| Bạn tự nhắn tay trong hội thoại → bot tạm dừng ở đó | 30 phút |
| Giới hạn tốc độ mỗi hội thoại | 10 tin/giờ |
| Trễ 2–5 giây trước khi trả lời, có tiền tố nhận biết bot | bật |
| `reply_scope=allowlist` để chỉ trả lời một số người | `all_dm` |

**Lưu ý quan trọng:** bất kỳ ai nhắn riêng đều có thể khiến bot trích nội dung tài liệu `bot_visible`. Đừng để hồ sơ nội bộ, đơn giá, thông tin thanh tra/kiểm toán ở chế độ bot được dùng. Bot cũng không nên trả lời các nội dung cần chịu trách nhiệm pháp lý (khối lượng, quyết toán, nghiệm thu) mà chưa có người duyệt: hãy chỉ nạp tài liệu thật sự an toàn để công khai.

## Theo dõi khối lượng công trình từ nhóm hiện trường

**Nick bot phải là một tài khoản Zalo riêng (nick phụ)**, vì bạn không thể nhắn tin cho chính nick của mình. Bạn nhắn hỏi nick phụ từ Zalo chính.

```
Nhóm hiện trường ──► bot ghi tin ──► Claude trích xuất (hạng mục, khối lượng, vị trí, ngày)
                                          │
                       Bảng báo cáo ◄─────┘   (hệ thống tự CỘNG DỒN bằng SQL, LLM không tự tính)
                            │
Bạn nhắn "Cầu ABC đến đâu rồi?" ──► bot trả lời từ số liệu đã cộng dồn
```

**Thiết lập một lần** (nói với Claude Code, nó gọi các công cụ tương ứng):

1. Thêm nick phụ vào các nhóm hiện trường (làm tay trong Zalo).
2. `project_create` từng công trình, kèm bí danh/mã tuyến hiện trường hay dùng. Nhóm nào có tên chứa tên công trình sẽ **tự được ghép**; nhóm còn lại xem bằng `group_list` rồi `group_assign`. Một nhóm có thể ghép nhiều công trình.
3. Cho phép chính bạn hỏi: `zalo_new_pair_code`, rồi từ Zalo chính nhắn tới nick phụ `/ketnoi <mã>` (mã 6 số, dùng một lần, hết hạn sau 15 phút).
4. (Tuỳ chọn) `report_set_target` để nhập khối lượng cần thực hiện từ hợp đồng/dự toán, nhờ đó bot trả lời được **% hoàn thành**.
5. Bật bot: `bot_enabled = true`.

**Từ đó:** hiện trường báo trong nhóm → sau khi nhóm yên 90 giây bot tự trích xuất → bạn hỏi "khối lượng Cầu ABC đến đâu rồi?" là có đáp ngay (bot xử lý nốt các tin chưa trích xuất trước khi trả lời). Hỏi mà không nêu công trình, khi có nhiều công trình, bot sẽ hỏi lại thay vì đoán.

**Quyền truy cập:** người lạ chưa kết bạn không được bot trả lời. Chỉ tài khoản đã ghép nối (`owner_ids`) mới xem được báo cáo công trình và tài liệu riêng tư. Người khác nhắn riêng chỉ nhận câu trả lời từ tài liệu `bot_visible`, **không bao giờ** thấy số liệu công trình. Bot không trả lời trong nhóm.

### Giới hạn bạn cần biết (quan trọng với hồ sơ thanh tra, kiểm toán)

- Đây là **số liệu báo cáo hiện trường, chưa nghiệm thu**; bot luôn nói rõ như vậy. Không dùng làm căn cứ thanh toán/quyết toán nếu chưa đối chiếu hồ sơ.
- Tin nhắn Zalo là văn bản tự do nên **việc trích xuất có thể sai** (nhầm số, đơn vị, ngày, công trình). Dòng nghi ngờ được gắn "độ tin cậy thấp"; tin đính chính ("nhầm, sửa lại") được ghi thêm chứ không tự ghi đè dòng cũ nên có thể bị tính hai lần: kiểm tra bằng `report_list`, sửa/xoá bằng `report_update` / `report_delete`, gộp tên hạng mục khác nhau bằng `report_merge_items`. Mọi dòng đều lưu id tin nhắn nguồn.
- Hiện trường báo **lũy kế** và **trong ngày** lẫn lộn: hệ thống chỉ cộng khối lượng trong ngày, còn lũy kế hiện trường tự nêu được lưu riêng và bot nêu cả hai khi chúng lệch nhau.
- **Ảnh/tệp đính kèm chưa được đọc** (ảnh hiện trường, bảng khối lượng chụp lại, file Excel/PDF gửi trong nhóm sẽ bị bỏ qua).
- Báo cáo chỉ được ghi từ lúc bot đang chạy và nick đã ở trong nhóm.

## Làm hồ sơ theo mẫu công ty (báo cáo, tờ trình...)

Người bạn chọn từ danh sách bạn bè nhắn cho nick bot, ví dụ *"Làm báo cáo tuần Cầu ABC từ 16/11 đến 22/11"*. Bot sẽ:

1. Xác nhận đã nhận (mã #id).
2. Cho Claude tự tra cứu: khối lượng đã cộng dồn trong kỳ, chi tiết báo cáo hiện trường, bộ nhớ tài liệu. **Chỉ trong các công trình người đó được cấp**; giới hạn này do code ép buộc, không phụ thuộc lời dặn mô hình.
3. Điền vào **mẫu .docx của công ty** rồi xuất file. Chỗ không có dữ liệu ghi rõ `[CHƯA CÓ DỮ LIỆU]`, không bịa.
4. **Mặc định gửi file cho bạn duyệt trước.** Bạn nhắn `duyệt 12` thì bot gửi cho người yêu cầu, nhắn `hủy 12 <lý do>` thì bot báo lại lý do. Muốn gửi thẳng không qua duyệt: `doc_delivery = auto` (bạn vẫn được báo mỗi lần gửi).
5. Thiếu thông tin bắt buộc (công trình, kỳ, loại hồ sơ, chưa có mẫu phù hợp) thì bot hỏi lại người yêu cầu thay vì đoán.

Bạn (tài khoản chủ) cũng nhắn yêu cầu được; khi đó bot gửi file cho bạn ngay, không qua bước duyệt.

**Thiết lập** (nói với Claude Code):

- Chọn người: `friend_list` (tìm theo tên) → `requester_add` với danh sách công trình được phép (hoặc `["*"]`). Người đó **phải là bạn bè** của nick bot. Mặc định bot chỉ dùng tài liệu công khai khi soạn cho người này; `kb_private=true` để cho dùng cả tài liệu riêng tư.
- Nạp mẫu: mở mẫu thật của công ty trong Word, thay các chỗ cần điền bằng thẻ `{ten_truong}` (chữ không dấu, ví dụ `{so_van_ban}`, `{kinh_gui}`, `{noi_dung}`). Với bảng khối lượng, đặt `{#hang_muc}` ở ô đầu và `{/hang_muc}` ở ô cuối của **một dòng**, các cột ở giữa (`{ten}`, `{don_vi_tinh}`, `{khoi_luong}`). Sau đó gọi `template_import` kèm mô tả từng thẻ. `template_create_sample` tạo một mẫu thử để bạn xem cách đặt thẻ.
- Giới hạn: mỗi người tối đa `doc_max_per_day` (mặc định 5) yêu cầu trong 24 giờ.

**Giới hạn cần biết:**

- Dữ liệu bot dùng là bộ nhớ trong `data/zalo.db` (báo cáo hiện trường, tài liệu đã nạp) cộng với **bộ nhớ Claude Code** của tài khoản (xem mục "Bộ não là Claude"). Bot **không** đọc được lịch sử chat, bộ nhớ hay Project trên claude.ai: hãy nạp tài liệu dự án bằng `kb_add_file`.
- Chỉ xuất **.docx**, chưa xuất PDF (cần LibreOffice trên máy chạy bot).
- Hồ sơ là **dự thảo**: số liệu lấy từ báo cáo hiện trường chưa nghiệm thu, và câu chữ do mô hình viết. Phải soát trước khi ký hoặc gửi chủ đầu tư; đừng dùng thẳng cho thanh toán, quyết toán.
- Việc nhận ra một tin là "yêu cầu làm hồ sơ" dựa trên từ khoá (có động từ như làm/soạn/lập + loại văn bản như báo cáo/tờ trình/hồ sơ). Nhận nhầm thì người gửi thấy ngay tin xác nhận, và mỗi lần nhầm tốn một lượt trong giới hạn ngày.
- Gửi file qua Zalo dùng `zca-js` (không chính thức), chưa được thử trên Zalo thật.

## Công cụ MCP

- Kiến thức: `kb_add_text`, `kb_add_file`, `kb_search`, `kb_list`, `kb_delete`, `kb_set_visibility`
- Zalo: `zalo_status`, `zalo_list_conversations`, `zalo_read_messages`, `zalo_send_message`, `zalo_unanswered`, `zalo_new_pair_code`, `bot_config`
- Công trình/nhóm: `project_create`, `project_update`, `project_delete`, `project_list`, `group_list`, `group_assign`, `group_unassign`, `extract_now`
- Hồ sơ theo mẫu: `friend_list`, `requester_add`, `requester_list`, `requester_remove`, `template_list`, `template_import`, `template_create_sample`, `doc_jobs`, `doc_approve`, `doc_reject`
- Báo cáo khối lượng: `report_summary`, `report_list`, `report_add`, `report_update`, `report_delete`, `report_merge_items`, `report_set_target`

## Kiểm thử

`npm run test:live` chạy kiểm thử **thật** với Claude Code (tốn lượt dùng): trích xuất tin nhắn hiện trường thật, trả lời chủ, soạn báo cáo tuần có chặn phạm vi.

`npm test` chạy hai bài kiểm thử đầu-cuối với LLM giả lập: (1) ghép nhóm, trích xuất, cộng dồn, phân quyền, ghép nối, bạn bè; (2) làm hồ sơ với mẫu .docx thật: phạm vi công trình, tài liệu riêng tư, duyệt/hủy, chế độ tự động, hỏi lại, giới hạn ngày, lỗi API. Bài này **không** đánh giá chất lượng trích xuất của mô hình thật trên tin nhắn thật của hiện trường: hãy chạy thử vài ngày rồi đối chiếu `report_list` với tin nhắn gốc.
