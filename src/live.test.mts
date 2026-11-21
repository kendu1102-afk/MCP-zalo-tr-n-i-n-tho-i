// Kiểm thử THẬT với Claude Code (tài khoản đang đăng nhập). Tốn lượt dùng. Chạy: npm run test:live
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.ZALO_MCP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "zalo-live-"));
const { logMessage, setSetting } = await import("./db.js");
const P = await import("./projects.js");
const { extractPending } = await import("./extract.js");
const { answerForOwner, answerFromKnowledge } = await import("./answer.js");
const D = await import("./docs.js");
const { syncFriends } = await import("./friends.js");
const { writeSampleTemplate } = await import("./sample-template.js");
const { docxText } = await import("./templates.js");
const t0 = Date.now();
const step = (m: string) => console.log(`\n=== ${m} (${Math.round((Date.now() - t0) / 1000)}s)`);

const cau = P.createProject("Cầu ABC", ["ABC"]);
const ql = P.createProject("Bảo dưỡng QL.xx", ["QL.xx"]);
P.upsertThread("g1", "group", "Hiện trường Cầu ABC"); P.assignThread("g1", cau.id);
const T = Date.now() - 15 * 60_000;
const msgs = [
  ["Anh Tuấn", "Báo cáo ngày 21/11 công trình cầu ABC"],
  ["Anh Tuấn", "1. Đổ bê tông thân mố M1: 12m3, lũy kế 45m3\n2. Lắp dựng cốt thép mố M2: 3,5 tấn\n3. Đào hố móng trụ T1: 120 m3"],
  ["Anh Tuấn", "Nhân lực 15 người, 1 máy đào, 1 cẩu 25T. Chiều mưa nghỉ 2 tiếng"],
  ["Chị Lan", "ok anh"],
  ["Anh Tuấn", "Kế hoạch ngày mai: đổ bê tông mố M2 khoảng 20m3"],
  ["Anh Tuấn", "Em sửa lại: cốt thép M2 hôm nay là 3,2 tấn chứ không phải 3,5"],
];
msgs.forEach(([who, text], i) => logMessage({ ts: T + i * 30_000, threadId: "g1", threadType: "group", senderId: who, senderName: who, direction: "in", text }));

step("1. Trích xuất báo cáo từ tin nhắn nhóm");
const r = await extractPending({ force: true });
const reps = P.listReports(cau.id);
console.table(reps.map((x) => ({ ngay: x.reportDate, hang_muc: x.item, kl: x.quantity, dv: x.unit, luy_ke: x.cumulative, tin_cay: x.confidence, ghi_chu: x.note.slice(0, 40) })));
assert.ok(r.items >= 3);
assert.ok(reps.some((x) => x.quantity === 12 && x.unit.includes("m3")), "có 12 m3 bê tông");
assert.ok(reps.some((x) => x.cumulative === 45), "lũy kế 45 m3 lưu riêng");
assert.ok(reps.some((x) => x.quantity === 120), "đào móng 120 m3");
assert.ok(!reps.some((x) => x.quantity === 20), "KẾ HOẠCH ngày mai không bị ghi là khối lượng");
assert.ok(reps.some((x) => x.quantity === 3.2 && x.confidence === "low"), "đính chính 3,2 tấn được ghi, đánh dấu cần soát");

step("2. Chủ hỏi khối lượng");
setSetting("owner_ids", JSON.stringify(["own"]));
P.setTarget(cau.id, reps.find((x) => x.quantity === 12)!.item, reps.find((x) => x.quantity === 12)!.unit, 120);
const a1 = await answerForOwner("own", "Khối lượng cầu ABC đến đâu rồi em?");
console.log(a1);
assert.ok(a1 && /12/.test(a1) && /hiện trường|chưa nghiệm thu/i.test(a1));

step("3. Bạn bè hỏi khi không có tài liệu công khai -> im lặng, không gọi Claude");
assert.equal(await answerFromKnowledge("stranger", "đơn giá bê tông bao nhiêu"), null);

step("4. Người được cấp quyền yêu cầu báo cáo tuần (Claude Code + MCP phạm vi)");
P.addReport({ projectId: ql.id, reportDate: P.vnDate(Date.now()), item: "Vá ổ gà", unit: "m2", quantity: 777 });
await writeSampleTemplate();
await syncFriends({ getAllFriends: async (_c, page = 1) => (page === 1 ? [{ userId: "f1", displayName: "Kỹ sư Nam" }] : []) });
D.addRequester("f1", ["Cầu ABC"]);
const sent: { to: string; text: string; file?: string }[] = [];
const tp = { sendText: async (to: string, text: string) => { sent.push({ to, text }); }, sendFile: async (to: string, file: string, text: string) => { sent.push({ to, text, file }); } };
await D.submitRequest("f1", "Kỹ sư Nam", "Anh làm giúp em báo cáo tuần công trình Cầu ABC tuần này (từ 16/11 đến 22/11/2026), gửi Ban QLDA. Tiện thể đưa luôn số liệu vá ổ gà bên QL.xx vào nhé.", tp);
await D.processQueue(tp);
const job = D.getJob(1)!;
console.log("Trạng thái:", job.status, "|", job.summary || job.error);
assert.equal(job.status, "awaiting_approval", job.error);
const text = docxText(job.filePath);
console.log("----- NỘI DUNG FILE -----\n" + text + "\n-------------------------");
assert.ok(/12/.test(text) && /120/.test(text), "có số liệu trong kỳ");
assert.ok(!text.includes("777"), "KHÔNG có số liệu công trình ngoài phạm vi dù người yêu cầu đòi");
assert.ok(sent.some((s) => s.to === "own" && s.file) && !sent.some((s) => s.to === "f1" && s.file));

console.log(`\nTẤT CẢ ĐẠT (chạy thật, ${Math.round((Date.now() - t0) / 1000)}s)`);
fs.rmSync(process.env.ZALO_MCP_HOME!, { recursive: true, force: true });
