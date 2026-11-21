// Kiểm thử luồng làm hồ sơ với LLM giả lập + mẫu .docx thật. Chạy: npm test
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.ZALO_MCP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "zalo-doctest-"));
const { setSetting } = await import("./db.js");
const P = await import("./projects.js");
const D = await import("./docs.js");
const { syncFriends } = await import("./friends.js");
const { addDoc } = await import("./knowledge.js");
const { setLlmForTest } = await import("./llm.js");
const { writeSampleTemplate } = await import("./sample-template.js");
const { docxText } = await import("./templates.js");

const ok = (m: string) => console.log("✔", m);

// ---- dữ liệu ----
const cau = P.createProject("Cầu ABC", ["ABC"]);
const ql = P.createProject("Bảo dưỡng QL.xx", ["QL.xx"]);
P.addReport({ projectId: cau.id, reportDate: "2026-11-16", item: "Đổ bê tông mố M1", unit: "m3", quantity: 12 });
P.addReport({ projectId: cau.id, reportDate: "2026-11-18", item: "Đổ bê tông mố M1", unit: "m3", quantity: 8.5 });
P.addReport({ projectId: cau.id, reportDate: "2026-11-01", item: "Đổ bê tông mố M1", unit: "m3", quantity: 100 }); // ngoài kỳ
P.addReport({ projectId: ql.id, reportDate: "2026-11-17", item: "Vá ổ gà", unit: "m2", quantity: 777 });
addDoc({ title: "Đơn giá nội bộ", text: "Đơn giá nội bộ đổ bê tông là 1.234.000 đồng", botVisible: false });
addDoc({ title: "Quy định chung", text: "Báo cáo tuần gửi chủ đầu tư trước thứ Hai đổ bê tông", botVisible: true });
await writeSampleTemplate();
await syncFriends({ getAllFriends: async (_c, page = 1) => (page === 1 ? [{ userId: "f1", displayName: "Kỹ sư Nam" }, { userId: "own", displayName: "Chủ" }] : []) });
setSetting("owner_ids", JSON.stringify(["own"]));

// ---- quyền ----
assert.throws(() => D.addRequester("stranger", ["*"]), /chưa là bạn bè/);
assert.throws(() => D.addRequester("f1", ["Không có"]), /Không tìm thấy/);
D.addRequester("f1", ["abc"]);
assert.deepEqual(D.getRequester("f1")!.projects, ["Cầu ABC"]);
assert.deepEqual(D.findFriends("ky su nam").map((f) => f.uid), ["f1"]);
assert.ok(D.canRequestDocs("f1") && D.canRequestDocs("own") && !D.canRequestDocs("stranger"));
ok("chỉ cấp quyền được cho BẠN BÈ, phạm vi công trình được chuẩn hoá theo tên thật, tìm bạn theo tên không dấu");

assert.ok(D.looksLikeDocRequest("Làm giúp anh báo cáo tuần Cầu ABC"));
assert.ok(D.looksLikeDocRequest("soạn tờ trình xin kinh phí"));
assert.ok(!D.looksLikeDocRequest("Khối lượng cầu ABC đến đâu rồi"));
assert.ok(!D.looksLikeDocRequest("chào anh"));
ok("nhận dạng yêu cầu làm hồ sơ, không bắt nhầm câu hỏi tiến độ");

// ---- transport giả ----
type Sent = { to: string; text: string; file?: string };
let sent: Sent[] = [];
const tp = { sendText: async (to: string, text: string) => { sent.push({ to, text }); }, sendFile: async (to: string, file: string, text: string) => { sent.push({ to, text, file }); } };

// ---- LLM giả: một agent theo kịch bản ----
let scenario = "normal";
const seen: string[] = [];
setLlmForTest(async (p) => {
  if (p.tools?.some((t: any) => t.name === "ghi_bao_cao")) return { content: [{ type: "tool_use", id: "e", name: "ghi_bao_cao", input: { items: [] } }] } as any;
  if (scenario === "boom") throw new Error("API quá tải");
  const step = p.messages.filter((m) => m.role === "assistant").length;
  const toolResults = p.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b: any) => b.type === "tool_result") as any[];
  seen.push(...toolResults.map((r) => `${r.is_error ? "ERR " : ""}${r.content}`));
  const use = (name: string, input: object, id = name) => ({ type: "tool_use", id, name, input });
  if (scenario === "clarify") return { content: [use("hoi_lai", { question: "Bạn cần báo cáo kỳ nào?" })] } as any;
  if (scenario === "textonly") return { content: [{ type: "text", text: "Bạn muốn làm loại hồ sơ nào?" }] } as any;
  if (step === 0) return { content: [use("liet_ke_mau", {}), use("liet_ke_cong_trinh", {})] } as any;
  if (step === 1) return { content: [
    use("tong_hop_khoi_luong", { project: "Cầu ABC", from_date: "2026-11-16", to_date: "2026-11-22" }, "a"),
    use("tong_hop_khoi_luong", { project: "Bảo dưỡng QL.xx" }, "b"),
    use("tim_tai_lieu", { query: "đơn giá đổ bê tông" }, "c"),
  ] } as any;
  return { content: [use("tao_ho_so", {
    template_id: "bao-cao-tuan-mau",
    fields: { don_vi: "CÔNG TY X", ky_bao_cao: "TUẦN 47 (16/11 - 22/11/2026)", ten_cong_trinh: "Cầu ABC", kinh_gui: "", tinh_hinh_chung: "Theo báo cáo hiện trường đến 18/11/2026 (chưa nghiệm thu).",
      hang_muc: [{ ten: "Đổ bê tông mố M1", don_vi_tinh: "m3", khoi_luong: "20,5", ghi_chu: "" }], ton_tai_kien_nghi: "", noi_ky: "", ngay_thang: "", nguoi_ky: "", truong_la: "bị bỏ" },
    projects_used: ["Cầu ABC", "Bảo dưỡng QL.xx"], missing: ["Đơn vị nhận"], notes: "Số liệu tuần 47",
  })] } as any;
});

// ---- 1. người được cấp quyền yêu cầu, chế độ duyệt (mặc định) ----
const j1 = (await D.submitRequest("f1", "Kỹ sư Nam", "Làm báo cáo tuần Cầu ABC từ 16/11 đến 22/11", tp))!;
assert.match(sent[0].text, /#1/); assert.match(sent[0].text, /duyệt/);
sent = [];
await D.processQueue(tp);
let job = D.getJob(j1.id)!;
assert.equal(job.status, "awaiting_approval");
const cauResult = seen.find((s) => s.startsWith("Cầu ABC | kỳ"))!;
assert.ok(cauResult.includes("20.5 m3") && !cauResult.includes("100"), "tổng trong kỳ = 12 + 8,5, loại báo cáo ngoài kỳ");
assert.ok(seen.some((s) => s.startsWith("ERR") && s.includes("phạm vi")), "công trình ngoài phạm vi bị từ chối");
assert.ok(!seen.join("\n").includes("777"), "không lộ số liệu công trình khác");
assert.ok(!seen.join("\n").includes("1.234.000"), "không lộ tài liệu riêng tư cho người được cấp quyền thường");
assert.ok(job.summary.includes("Cầu ABC") && !job.summary.includes("QL.xx"), "projects_used ngoài phạm vi bị loại");
assert.ok(job.summary.includes("CHƯA CÓ DỮ LIỆU") && job.summary.includes("Đơn vị nhận"));
const text1 = docxText(job.filePath);
assert.ok(text1.includes("CÔNG TY X") && text1.includes("20,5") && text1.includes("Đổ bê tông mố M1") && text1.includes("[CHƯA CÓ DỮ LIỆU]") && !text1.includes("bị bỏ"));
const toOwner = sent.find((s) => s.to === "own")!;
assert.ok(toOwner.file === job.filePath && toOwner.text.includes("duyệt 1"));
assert.ok(sent.some((s) => s.to === "f1" && !s.file && s.text.includes("chờ")), "người yêu cầu được báo đang chờ duyệt");
assert.ok(!sent.some((s) => s.to === "f1" && s.file), "CHƯA gửi file cho người yêu cầu trước khi duyệt");
ok("soạn theo mẫu: đúng kỳ, chặn công trình/tài liệu ngoài phạm vi, trường trống ghi [CHƯA CÓ DỮ LIỆU], gửi chủ duyệt trước");

// ---- 2. chủ duyệt qua Zalo ----
sent = [];
const replies: string[] = [];
assert.equal(await D.ownerCommand("duyệt 1", tp, async (t) => { replies.push(t); }), true);
assert.equal(D.getJob(1)!.status, "sent");
const delivered = sent.find((s) => s.to === "f1" && s.file)!;
assert.ok(delivered.text.includes("DỰ THẢO"));
await D.ownerCommand("duyet 1", tp, async (t) => { replies.push(t); });
assert.match(replies.at(-1)!, /không thể duyệt/);
assert.equal(await D.ownerCommand("duyệt giúp anh cái", tp, async () => {}), false);
ok("chủ nhắn 'duyệt 1' -> gửi file cho người yêu cầu kèm cảnh báo DỰ THẢO; duyệt lại lần hai bị từ chối");

// ---- 3. chủ hủy ----
sent = [];
await D.submitRequest("f1", "Kỹ sư Nam", "Lập báo cáo tuần Cầu ABC tuần này", tp);
await D.processQueue(tp);
await D.ownerCommand("hủy 2 thiếu số liệu cốt thép", tp, async () => {});
assert.equal(D.getJob(2)!.status, "rejected");
assert.ok(sent.some((s) => s.to === "f1" && s.text.includes("thiếu số liệu cốt thép")));
assert.ok(!sent.some((s) => s.to === "f1" && s.file));
ok("chủ nhắn 'hủy 2 <lý do>' -> không gửi file, báo lý do cho người yêu cầu");

// ---- 4. chế độ tự động ----
setSetting("doc_delivery", "auto");
sent = [];
await D.submitRequest("f1", "Kỹ sư Nam", "Làm báo cáo tuần Cầu ABC", tp);
await D.processQueue(tp);
assert.equal(D.getJob(3)!.status, "sent");
assert.ok(sent.some((s) => s.to === "f1" && s.file));
assert.ok(sent.some((s) => s.to === "own" && !s.file && s.text.includes("tự động gửi")), "chủ vẫn được báo");
setSetting("doc_delivery", "approve");
ok("chế độ auto: gửi thẳng cho người yêu cầu, chủ vẫn nhận thông báo");

// ---- 5. hỏi lại khi thiếu thông tin ----
scenario = "clarify"; sent = [];
await D.submitRequest("f1", "Kỹ sư Nam", "làm báo cáo", tp);
await D.processQueue(tp);
assert.equal(D.getJob(4)!.status, "needs_info");
assert.ok(sent.some((s) => s.to === "f1" && s.text.includes("kỳ nào")));
scenario = "textonly"; sent = [];
await D.submitRequest("f1", "Kỹ sư Nam", "làm hồ sơ", tp);
await D.processQueue(tp);
assert.equal(D.getJob(5)!.status, "needs_info");
ok("thiếu thông tin -> hỏi lại người yêu cầu, không đoán");

// ---- 6. giới hạn mỗi ngày ----
setSetting("doc_max_per_day", "5"); sent = [];
assert.equal(await D.submitRequest("f1", "Kỹ sư Nam", "làm báo cáo nữa", tp), null);
assert.match(sent[0].text, /giới hạn 5/);
ok("vượt giới hạn yêu cầu/ngày -> từ chối, không tạo việc");

// ---- 7. lỗi API ----
setSetting("doc_max_per_day", "50");
scenario = "boom"; sent = [];
await D.submitRequest("f1", "Kỹ sư Nam", "làm báo cáo tuần Cầu ABC", tp);
await D.processQueue(tp);
assert.equal(D.getJob(6)!.status, "failed");
assert.ok(sent.some((s) => s.to === "f1" && s.text.includes("chưa soạn được") && !s.text.includes("quá tải")), "người yêu cầu nhận thông báo chung, không lộ lỗi nội bộ");
assert.ok(sent.some((s) => s.to === "own" && s.text.includes("quá tải")), "chủ nhận chi tiết lỗi");
ok("lỗi API -> thất bại có thông báo, chi tiết lỗi chỉ gửi chủ");

// ---- 8. bị thu hồi quyền trước khi xử lý ----
scenario = "normal"; sent = [];
await D.submitRequest("f1", "Kỹ sư Nam", "làm báo cáo tuần Cầu ABC", tp);
D.removeRequester("f1");
await D.processQueue(tp);
assert.equal(D.getJob(7)!.status, "failed");
assert.ok(!sent.some((s) => s.file));
ok("thu hồi quyền trước khi soạn -> không soạn, không gửi");

// ---- 9. chủ tự yêu cầu: thấy tài liệu riêng tư, nhận file ngay ----
seen.length = 0; sent = [];
await D.submitRequest("own", "Chủ", "làm báo cáo tuần Cầu ABC", tp);
await D.processQueue(tp);
assert.equal(D.getJob(8)!.status, "sent");
assert.ok(seen.join("\n").includes("1.234.000"), "chủ được dùng tài liệu riêng tư");
assert.ok(seen.join("\n").includes("777"), "chủ được xem mọi công trình");
assert.ok(sent.some((s) => s.to === "own" && s.file));
ok("chủ yêu cầu: dùng được mọi công trình và tài liệu riêng tư, nhận file ngay không qua duyệt");

console.log("\nTẤT CẢ ĐẠT (hồ sơ)");
fs.rmSync(process.env.ZALO_MCP_HOME!, { recursive: true, force: true });
