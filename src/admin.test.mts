// Kiểm thử quản lý bot bằng lệnh Zalo + nạp tệp qua Zalo + mã ghép nối lần đầu. Chạy: npm test
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.ZALO_MCP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "zalo-admintest-"));
const { getSetting, getJsonList, setSetting } = await import("./db.js");
const P = await import("./projects.js");
const D = await import("./docs.js");
const { syncFriends } = await import("./friends.js");
const { isAdminCommand, runAdminCommand } = await import("./admin.js");
const { handleOwnerFile } = await import("./inbox.js");
const { firstRunPairCode, tryPairCommand } = await import("./pairing.js");
const { buildSampleTemplate } = await import("./sample-template.js");
const { listTemplates } = await import("./templates.js");
const { listDocs, search } = await import("./knowledge.js");
const { Document, Packer, Paragraph } = await import("docx");
const ok = (m: string) => console.log("✔", m);
const cmd = (t: string) => runAdminCommand("own", t);

// ---- ghép nối lần đầu ----
const code = firstRunPairCode()!;
assert.match(code, /^\d{6}$/);
assert.equal(firstRunPairCode(), code, "gọi lại trả cùng mã còn hạn");
assert.equal(tryPairCommand("own", `/ketnoi ${code}`), "ok");
assert.equal(firstRunPairCode(), null, "đã có chủ thì không tạo mã nữa");
assert.equal(getSetting("bot_enabled"), "true", "chủ đầu tiên ghép nối -> tự bật trả lời");
ok("mã ghép nối lần đầu (24 giờ) hiện khi đăng nhập/khởi động, dùng xong thì thôi");

// ---- lệnh quản trị ----
assert.ok(isAdminCommand("/nhom") && isAdminCommand("/capquyen 1 *") && !isAdminCommand("nhóm nào") && !isAdminCommand("/ketnoi 123456"));
assert.match(cmd("/huongdan"), /LỆNH QUẢN TRỊ/);
P.upsertThread("g1", "group", "Hiện trường Cầu ABC");
P.upsertThread("g2", "group", "Đội 3 - QL.xx Km10-Km50");
P.upsertThread("g3", "group", "Nhóm kỹ thuật chung");
const r1 = cmd("/congtrinh them Cầu ABC | ABC, cau abc");
assert.match(r1, /Đã tạo công trình "Cầu ABC"/); assert.match(r1, /Tự ghép 1 nhóm.*Hiện trường Cầu ABC/);
assert.match(cmd("/congtrinh them Bảo dưỡng QL.xx | QL.xx"), /Tự ghép 1 nhóm.*Đội 3/);
const list = cmd("/nhom");
assert.match(list, /^1\. Nhóm kỹ thuật chung → CHƯA GHÉP/, "nhóm chưa ghép lên đầu");
assert.match(cmd("/ghep 1 cau abc"), /Đã ghép nhóm số 1 → "Cầu ABC"/);
assert.deepEqual(P.projectsOfThread("g3").map((p) => p.name), ["Cầu ABC"]);
assert.match(cmd("/ghep 9 Cầu ABC"), /Gõ \/nhom trước/);
assert.match(cmd("/ghep 1 Không có"), /Không tìm thấy công trình/);
ok("tạo công trình tự ghép nhóm theo tên; /nhom đánh số, /ghep theo số; báo lỗi rõ ràng");

await syncFriends({ getAllFriends: async (_c, page = 1) => (page === 1 ? [{ userId: "u1", displayName: "Nguyễn Văn Nam" }, { userId: "u2", displayName: "Trần Thị Hoa" }, { userId: "own", displayName: "Chủ" }] : []) });
assert.match(cmd("/banbe nam"), /^1\. Nguyễn Văn Nam/);
const cq = cmd("/capquyen 1 Cầu ABC, QL.xx bonho");
assert.match(cq, /Nguyễn Văn Nam được nhờ bot làm hồ sơ cho: Cầu ABC, Bảo dưỡng QL\.xx \| dùng bộ nhớ tài khoản/);
assert.equal(D.getRequester("u1")!.accountMemory, true); assert.equal(D.getRequester("u1")!.kbPrivate, false);
assert.match(cmd("/capquyen 1 Không tồn tại"), /⚠ Không tìm thấy công trình/);
assert.match(cmd("/quyen"), /1\. Nguyễn Văn Nam: Cầu ABC, Bảo dưỡng QL\.xx \| bộ nhớ/);
assert.match(cmd("/thuhoi 1"), /Đã thu hồi/);
assert.equal(D.getRequester("u1"), null);
ok("/banbe tìm theo tên không dấu, /capquyen theo số kèm phạm vi + bộ nhớ, /quyen, /thuhoi");

assert.match(cmd("/tatbot"), /TẮT/); assert.equal(getSetting("bot_enabled"), "false");
assert.match(cmd("/batbot"), /BẬT/); assert.equal(getSetting("bot_enabled"), "true");
assert.match(cmd("/drive thumuc khong hop le"), /Phải có dạng/);
assert.match(cmd("/drive gdrive:Cong trinh/Anh hien truong"), /✅/); assert.equal(getSetting("drive_remote"), "gdrive:Cong trinh/Anh hien truong");
assert.match(cmd("/dat owner_ids [\"hacker\"]"), /Khoá không hợp lệ/, "không cho đổi danh sách chủ qua lệnh");
assert.deepEqual(getJsonList("owner_ids"), ["own"]);
assert.match(cmd("/dat daily_digest_time 17:30"), /✅/); assert.equal(getSetting("daily_digest_time"), "17:30");
const gn = cmd("/ghinho Đơn giá nội bộ vá ổ gà năm 2026 là 350.000 đ/m2");
const docId = Number(/mã (\d+)/.exec(gn)![1]);
assert.equal(search("đơn giá vá ổ gà", { botOnly: true }).length, 0, "ghi nhớ mặc định riêng tư");
assert.match(cmd(`/congkhai ${docId}`), /ĐƯỢC dùng/);
assert.equal(search("đơn giá vá ổ gà", { botOnly: true }).length, 1);
assert.match(cmd("/trangthai"), /Tự trả lời: BẬT[\s\S]*Công trình: 2 \| nhóm đã ghép: 3\/3/);
assert.match(cmd("/tonghop"), /TỔNG HỢP HIỆN TRƯỜNG/);
ok("bật/tắt bot, đặt thư mục Drive (có kiểm tra), /dat chặn khoá nhạy cảm, /ghinho riêng tư + /congkhai, /trangthai, /tonghop");

// ---- nạp tệp qua Zalo ----
const plainDocx = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph("Quy trình nghiệm thu vá ổ gà: đo diện tích thực tế, chụp ảnh trước và sau.")] }] }));
const files: Record<string, Buffer> = { "/mau.docx": await buildSampleTemplate(), "/quytrinh.docx": plainDocx, "/x.dwg": Buffer.from("AC1027") };
const fakeFetch = (async (u: string) => { const b = files[new URL(u).pathname]; return b ? new Response(new Uint8Array(b)) : new Response("", { status: 404 }); }) as unknown as typeof fetch;
const t1 = await handleOwnerFile({ url: "http://x/mau.docx", name: "Báo cáo tuần CĐT.docx" }, fakeFetch);
assert.match(t1, /Đã nạp MẪU hồ sơ "bao-cao-tuan-cdt"/); assert.match(t1, /Bảng hang_muc: ten, don_vi_tinh, khoi_luong, ghi_chu/);
assert.ok(listTemplates().some((t) => t.id === "bao-cao-tuan-cdt"));
const t2 = await handleOwnerFile({ url: "http://x/quytrinh.docx", name: "Quy trinh nghiem thu.docx" }, fakeFetch);
assert.match(t2, /Đã nạp "Quy trinh nghiem thu.docx" vào bộ nhớ .*riêng tư/); assert.match(t2, /Nếu đây là MẪU hồ sơ/);
assert.ok(listDocs().some((d) => d.title === "Quy trinh nghiem thu"));
assert.match(await handleOwnerFile({ url: "http://x/x.dwg", name: "ban ve.dwg" }, fakeFetch), /Chưa nạp được.*Chưa hỗ trợ định dạng/);
assert.match(await handleOwnerFile({ url: "http://x/mat.pdf", name: "mat.pdf" }, fakeFetch), /HTTP 404/);
ok("gửi .docx có thẻ -> thành mẫu; tài liệu thường -> bộ nhớ riêng tư (kèm gợi ý đặt thẻ); định dạng lạ/link hỏng báo rõ");

console.log("\nTẤT CẢ ĐẠT (quản trị qua Zalo)");
fs.rmSync(process.env.ZALO_MCP_HOME!, { recursive: true, force: true });
