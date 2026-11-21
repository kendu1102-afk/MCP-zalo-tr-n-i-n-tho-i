# MCP Zalo + bot tự trả lời

Kết nối **Claude Code** với **Zalo cá nhân** (qua thư viện không chính thức `zca-js`):

1. **MCP server** (`src/mcp.ts`): Claude Code nạp/tìm kiến thức, đọc tin nhắn, đặt lệnh gửi tin.
2. **Bot** (`src/bot.ts`): giữ kết nối Zalo, ghi nhật ký tin nhắn, **tự trả lời tin nhắn riêng** dựa trên kiến thức đã nạp.
3. Hai phần dùng chung một file SQLite (`data/zalo.db`). Bộ nhớ kiến thức nằm trong đó nên **nạp một lần, nhớ mãi** (kể cả khi khởi động lại).

> ⚠️ `zca-js` giả lập Zalo Web, **không chính thức**: có thể bị Zalo khoá tài khoản. Nên dùng nick phụ. Zalo chỉ cho một listener mỗi tài khoản: mở Zalo Web/PC cùng lúc sẽ ngắt bot.

## Cài đặt (chạy trên máy tính/VPS bật liên tục, cần Node >= 22.13)

```bash
npm install
cp .env.example .env   # điền ANTHROPIC_API_KEY, rồi: export $(grep -v '^#' .env | xargs)
npm run login          # mở data/qr.png, quét bằng Zalo trên điện thoại và xác nhận
npm run bot            # giữ chạy (dùng pm2/systemd để chạy nền)
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
| Chỉ trả lời DM dạng chữ, không bao giờ trả lời nhóm | cố định |
| Chỉ dùng tài liệu `bot_visible=true`; tài liệu riêng tư chỉ Claude Code thấy | `kb_set_visibility` |
| Không biết thì không trả lời | `fallback_reply` rỗng |
| Bạn tự nhắn tay trong hội thoại → bot tạm dừng ở đó | 30 phút |
| Giới hạn tốc độ mỗi hội thoại | 10 tin/giờ |
| Trễ 2–5 giây trước khi trả lời, có tiền tố nhận biết bot | bật |
| `reply_scope=allowlist` để chỉ trả lời một số người | `all_dm` |

**Lưu ý quan trọng:** bất kỳ ai nhắn riêng đều có thể khiến bot trích nội dung tài liệu `bot_visible`. Đừng để hồ sơ nội bộ, đơn giá, thông tin thanh tra/kiểm toán ở chế độ bot được dùng. Bot cũng không nên trả lời các nội dung cần chịu trách nhiệm pháp lý (khối lượng, quyết toán, nghiệm thu) mà chưa có người duyệt: hãy chỉ nạp tài liệu thật sự an toàn để công khai.

## Công cụ MCP

`kb_add_text`, `kb_add_file`, `kb_search`, `kb_list`, `kb_delete`, `kb_set_visibility`, `zalo_status`, `zalo_list_conversations`, `zalo_read_messages`, `zalo_send_message`, `zalo_unanswered`, `bot_config`.

## Chưa làm

Ảnh/tệp đính kèm chưa được tải về hay đọc; tin nhắn nhóm chỉ được ghi nhật ký để Claude Code tổng hợp, bot không trả lời nhóm.
