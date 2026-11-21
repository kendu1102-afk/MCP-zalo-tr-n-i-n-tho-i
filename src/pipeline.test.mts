// Kiểm thử đầu-cuối với LLM giả lập (không gọi API thật, không cần Zalo). Chạy: npm test
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.ZALO_MCP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "zalo-test-")); // DB tạm, xoá sau khi chạy
const { db, logMessage, setSettingRaw, getJsonList } = await import("./db.js");
const P = await import("./projects.js");
const { extractPending } = await import("./extract.js");
const { answerForOwner, answerFromKnowledge } = await import("./answer.js");
const { addDoc } = await import("./knowledge.js");
const { setLlmForTest } = await import("./llm.js");
const { tryPairCommand } = await import("./pairing.js");

const ok = (m: string) => console.log("✔", m);
const cau = P.createProject("Cầu ABC", ["cau abc", "ABC"], "Sửa chữa cầu ABC");
const ql = P.createProject("Bảo dưỡng QL.xx", ["QL.xx"], "BDTX QL.xx Km10-Km50");

// --- ghép nhóm theo tên ---
P.upsertThread("g1", "group", "Hiện trường CẦU ABC");
assert.equal(P.autoAssignByName("g1", "Hiện trường CẦU ABC")?.id, cau.id);
P.upsertThread("g2", "group", "Nhóm QL.xx Km10-Km50");
assert.equal(P.autoAssignByName("g2", "Nhóm QL.xx Km10-Km50")?.id, ql.id);
P.upsertThread("g3", "group", "Nhóm bạn bè");
assert.equal(P.autoAssignByName("g3", "Nhóm bạn bè"), null);
ok("tự ghép nhóm theo tên (bỏ dấu, không phân biệt hoa thường), nhóm lạ không bị ghép");

// --- tin nhắn nhóm ---
const T = Date.now() - 10 * 60_000;
const msg = (tid: string, who: string, text: string, dt: number) => logMessage({ ts: T + dt, threadId: tid, threadType: "group", senderId: who, senderName: who, direction: "in", text });
msg("g1", "Anh Tuấn", "Báo cáo ngày hôm nay cầu ABC: đổ bê tông mố M1 được 12m3", 0);
msg("g1", "Anh Tuấn", "Cốt thép mố M2 lắp được 3,5 tấn, lũy kế 8 tấn", 1000);
msg("g1", "Anh Tuấn", "ok", 2000);            // vô nghĩa -> bỏ qua
msg("g1", "Anh Tuấn", "[tệp/ảnh/nội dung đặc biệt]", 3000);
msg("g2", "Chị Hoa", "Vá ổ gà Km12+300 30m2 BTN nguội", 0);
msg("g3", "Bạn", "Cuối tuần đi nhậu không 100 chai", 0); // nhóm chưa ghép -> không xử lý
msg("g1", "Anh Tuấn", "Ngày mai sẽ đổ bê tông 20m3 mố M2", 4000); // kế hoạch, LLM không ghi

// --- LLM giả: trích xuất bằng cách đọc các id trong prompt ---
let calls = 0, lastSystem = "";
setLlmForTest(async (p) => {
  calls++;
  const user = (p.messages[0].content as string);
  if (p.tools?.length) {
    const id = (needle: string) => Number(new RegExp(`\\[id=(\\d+)[^\\]]*\\] ${needle}`).exec(user.split("TIN NHẮN CẦN TRÍCH XUẤT:")[1])?.[1]);
    const items: any[] = [];
    if (user.includes("Cầu ABC")) items.push(
      { msg_id: id("Báo cáo ngày"), project: "Cầu ABC", report_date: "bad", item: "Đổ bê tông mố M1", unit: "m3", quantity: 12, cumulative: null, location: "Mố M1", note: "", correction: false, confidence: "high" },
      { msg_id: id("Cốt thép"), project: "Cầu ABC", report_date: "2099-01-01", item: "Lắp cốt thép mố M2", unit: "tấn", quantity: 3.5, cumulative: 8, location: "Mố M2", note: "", correction: false, confidence: "high" },
      { msg_id: 99999, project: "Cầu ABC", report_date: "2026-11-21", item: "ma", unit: "m", quantity: 1, cumulative: null, location: "", note: "", correction: false, confidence: "high" }, // id lạ -> bỏ
    );
    if (user.includes("Bảo dưỡng QL.xx")) items.push({ msg_id: id("Vá ổ gà"), project: "Sai tên", report_date: "2026-11-21", item: "Vá ổ gà", unit: "m2", quantity: 30, cumulative: null, location: "Km12+300", note: "BTN nguội", correction: false, confidence: "high" });
    return { content: [{ type: "tool_use", id: "x", name: "ghi_bao_cao", input: { items } }] } as any;
  }
  lastSystem = p.system as string;
  return { content: [{ type: "text", text: "TRẢ LỜI GIẢ" }] } as any;
});

const r = await extractPending({ force: true });
assert.equal(calls, 2, "2 nhóm đã ghép => 2 lượt gọi, nhóm g3 không bị gọi");
const reps = P.listReports(cau.id);
assert.equal(reps.length, 2, "id lạ bị loại");
assert.ok(reps.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.reportDate)));
assert.equal(reps.find((x) => x.item.includes("M1"))!.reportDate, P.vnDate(T), "ngày 'bad' -> dùng ngày gửi tin");
assert.equal(P.listReports(ql.id)[0].quantity, 30, "nhóm 1 công trình: ép đúng công trình dù LLM ghi sai tên");
assert.equal(db.prepare("SELECT COUNT(*) n FROM messages WHERE extracted=0 AND direction='in' AND thread_id IN ('g1','g2')").get()!.n, 0);
assert.equal(db.prepare("SELECT COUNT(*) n FROM messages WHERE extracted=0 AND thread_id='g3'").get()!.n, 1, "nhóm g3 giữ nguyên chờ");
assert.equal(db.prepare("SELECT COUNT(*) n FROM messages WHERE extracted=2").get()!.n, 2, "tin vô nghĩa bị bỏ qua không tốn LLM");
const m2r = reps.find((x) => x.item.includes("M2"))!;
assert.equal(m2r.reportDate, P.vnDate(T), "ngày 2099 (tương lai) bị thay bằng ngày gửi tin");
assert.equal(m2r.confidence, "low"); assert.ok(m2r.note.includes("không hợp lý"));
ok(`trích xuất: ${r.items} mục, bỏ qua tin vô nghĩa, chặn id lạ, sửa ngày sai, nhóm chưa ghép không bị đọc`);

// --- chạy lại không nhân đôi ---
const before = P.listReports(cau.id).length;
await extractPending({ force: true });
assert.equal(P.listReports(cau.id).length, before);
ok("chạy lại không tạo dòng trùng");

// --- cộng dồn: thêm ngày sau ---
P.addReport({ projectId: cau.id, reportDate: P.vnDate(Date.now()), item: "Đổ bê tông mố M1", unit: "m3", quantity: 8.5, manual: true });
P.addReport({ projectId: cau.id, reportDate: P.vnDate(Date.now()), item: "Đổ bê tông mố M1", unit: "m3", quantity: null, note: "không nêu số" });
P.setTarget(cau.id, "Đổ bê tông mố M1", "m3", 82);
const agg = P.aggregate(cau.id);
const m1 = agg.find((a) => a.item.includes("M1"))!;
assert.equal(m1.total, 20.5); assert.equal(m1.reports, 3); assert.equal(m1.percent, 25);
const m2 = agg.find((a) => a.item.includes("M2"))!;
assert.equal(m2.total, 3.5); assert.equal(m2.lastCumulative, 8);
ok("cộng dồn đúng bằng SQL: 12 + 8,5 = 20,5 m3 (null không tính), 25% so với 82 m3, lũy kế hiện trường 8 tấn lưu riêng");

// --- hỏi tiến độ ---
let r1 = await answerForOwner("owner", "Khối lượng công trình Cầu ABC đến đâu rồi?");
assert.equal(r1, "TRẢ LỜI GIẢ");
assert.ok(lastSystem.includes("CÔNG TRÌNH: Cầu ABC") && lastSystem.includes("tổng 20.5 m3") && lastSystem.includes("đạt 25%") && lastSystem.includes("lũy kế do hiện trường tự nêu: 8 tấn"));
assert.ok(!lastSystem.includes("QL.xx") || !lastSystem.includes("Vá ổ gà"), "không lẫn dữ liệu công trình khác");
ok("câu hỏi nhắc tên công trình -> ngữ cảnh chỉ chứa công trình đó, đủ tổng/%/lũy kế");

const callsBefore = calls;
const r2 = await answerForOwner("owner", "Khối lượng đến đâu rồi?");
assert.ok(r2!.startsWith("Bạn hỏi công trình nào?") && r2!.includes("Cầu ABC") && r2!.includes("Bảo dưỡng QL.xx"));
assert.equal(calls, callsBefore, "hỏi mơ hồ -> không gọi LLM");
ok("hỏi không nêu công trình khi có nhiều công trình -> hỏi lại, không đoán");

// --- quyền: người lạ không thấy báo cáo / tài liệu riêng ---
addDoc({ title: "Công khai", text: "Bảo dưỡng thường xuyên là công tác hàng năm.", botVisible: true });
addDoc({ title: "Nội bộ", text: "Đơn giá nội bộ vá ổ gà là 999.000 đồng", botVisible: false });
lastSystem = "";
await answerFromKnowledge("stranger", "đơn giá vá ổ gà bao nhiêu");
assert.ok(!lastSystem.includes("999.000") && !lastSystem.includes("Cầu ABC"));
ok("người lạ: không thấy tài liệu riêng tư và không thấy báo cáo công trình");
await answerForOwner("owner", "đơn giá vá ổ gà bao nhiêu");
assert.ok(lastSystem.includes("999.000"));
ok("chủ: thấy cả tài liệu riêng tư");

// --- LLM lỗi: tin giữ nguyên để thử lại ---
msg("g1", "Anh Tuấn", "Hôm nay làm thêm 5m3 bê tông", 5000);
setLlmForTest(async () => { throw new Error("mạng lỗi"); });
const rf = await extractPending({ force: true });
assert.equal(rf.items, 0);
assert.equal(db.prepare("SELECT COUNT(*) n FROM messages WHERE extracted=0 AND thread_id='g1'").get()!.n, 1);
ok("LLM lỗi -> tin vẫn ở trạng thái chờ, không mất dữ liệu");

// --- ghép nối ---
assert.equal(tryPairCommand("u1", "xin chào"), "ignored");
assert.equal(tryPairCommand("u1", "/ketnoi 123456"), "fail", "chưa có mã");
setSettingRaw("pair_code", `654321:${Date.now() + 60_000}`);
assert.equal(tryPairCommand("u1", "/ketnoi 111111"), "fail");
assert.deepEqual(getJsonList("owner_ids"), []);
assert.equal(tryPairCommand("u1", "/ketnoi 654321"), "ok");
assert.deepEqual(getJsonList("owner_ids"), ["u1"]);
assert.equal(tryPairCommand("u2", "/ketnoi 654321"), "fail", "mã dùng một lần");
setSettingRaw("pair_code", `222222:${Date.now() - 1}`);
assert.equal(tryPairCommand("u2", "/ketnoi 222222"), "fail", "mã hết hạn");
setSettingRaw("pair_code", `333333:${Date.now() + 60_000}`);
for (let i = 0; i < 5; i++) tryPairCommand("u3", "/ketnoi 000000");
assert.equal(tryPairCommand("u3", "/ketnoi 333333"), "fail", "dò sai 5 lần -> huỷ mã");
assert.deepEqual(getJsonList("owner_ids"), ["u1"]);
ok("ghép nối: đúng mã mới vào, dùng một lần, hết hạn bị từ chối, dò mã 5 lần thì huỷ mã");

// --- xoá công trình -> cascade ---
P.deleteProject(ql.id);
assert.equal(P.projectsOfThread("g2").length, 0);
assert.equal(P.listReports(ql.id).length, 0);
ok("xoá công trình xoá luôn báo cáo và ghép nhóm");
console.log("\nTẤT CẢ ĐẠT");
fs.rmSync(process.env.ZALO_MCP_HOME!, { recursive: true, force: true });
