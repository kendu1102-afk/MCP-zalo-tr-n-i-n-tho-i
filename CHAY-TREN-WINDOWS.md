# Chạy trên máy tính Windows của bạn

Cách nhanh nhất để **lấy ngay toàn bộ lịch sử 3 nhóm ghim** và lưu thẳng vào **ổ G: (Google Drive for desktop, tài khoản kendu1102@gmail.com)**, chưa cần máy chủ đám mây. Mất khoảng 15 phút.

## 1. Cài một lần

1. Cài **Node.js 22 LTS** tại nodejs.org (bấm Next đến hết).
2. Tải mã nguồn: trên GitHub mở repo, chọn nhánh `claude/hopeful-lamport-bf8qqw` → **Code → Download ZIP**, rồi giải nén vào ví dụ `D:\zalo-bot`.
3. Mở **PowerShell** tại thư mục đó (trong File Explorer: chuột phải vào khoảng trống → *Open in Terminal*), chạy:
   ```powershell
   npm install
   ```

## 2. Đăng nhập nick Zalo của bot

```powershell
npm run login
```

Mở file `data\qr.png` và quét bằng Zalo **của nick bot** ("Hiếu Chatbot") trên điện thoại, rồi xác nhận. Tab Zalo Web trong Edge có thể bị đăng xuất, không sao.

## 3. Chọn nơi lưu: ổ G: (không cần rclone)

```powershell
npm run lenh -- "/drive G:\My Drive\Zalo hien truong"
```

## 4. Lấy toàn bộ lịch sử 3 nhóm ghim đầu

```powershell
npm run lay-lich-su
```

Lệnh này:
- Đọc từ tin **mới nhất lùi về tin cũ nhất** mà máy chủ Zalo còn lưu cho nick này. Thường là từ lúc nick vào nhóm; Zalo có thể không giữ tin quá cũ.
- Lưu tất cả vào CSDL để bot tổng hợp và trả lời, và vào **bộ nhớ** (riêng tư, mỗi tháng một tài liệu).
- Ghi **bản chép toàn văn** từng nhóm vào `G:\My Drive\Zalo hien truong\_Lich su nhom\<tên nhóm>\`.
- Tải **ảnh và tệp** về `G:\My Drive\Zalo hien truong\<Công trình>\<Ngày>\`. Link ảnh quá cũ có thể đã hết hạn.

Muốn lấy 5 nhóm ghim: `npm run lay-lich-su -- --ghim 5`. Chỉ lấy từ một ngày: `npm run lay-lich-su -- --tu 2026-01-01`.

## 5. Phân loại theo công trình (để Claude trích xuất khối lượng)

```powershell
npm run lenh -- "/congtrinh them SCĐX QL3 Km285-Km297 | QL3 Km285, Km285"
npm run lenh -- "/congtrinh them SCĐK Km0-Km6 | Km0-Km6"
npm run lenh -- "/congtrinh them CBQL Trường Lộ 2025 | Trường Lộ"
npm run lenh -- /nhom
```

Đổi tên và bí danh cho đúng công trình thật. Nhóm có tên khớp sẽ tự ghép; nhóm còn lại ghép bằng `npm run lenh -- "/ghep <số> <tên công trình>"`.

Muốn Claude đọc lịch sử và trích xuất khối lượng ngay trên máy này, cần cài thêm Claude Code bản cho Windows (bộ cài chính thức, có `claude.exe`) và đăng nhập. Sau đó chạy bot:

```powershell
$env:CLAUDE_BIN = "đường dẫn tới claude.exe"; npm run bot
```

Hoặc để phần này cho máy chủ 24/24 (DEPLOY.md): chép thư mục `data` lên máy chủ là có đủ lịch sử.

## Lưu ý

- **Đừng mở nick bot trên Zalo Web hoặc Zalo PC** khi bot đang chạy, vì sẽ đá bot ra. Chỉ lấy lịch sử (bước 4) thì không ảnh hưởng.
- Thư mục `data` chứa phiên đăng nhập Zalo (`session.json`): **không chia sẻ** cho ai.
