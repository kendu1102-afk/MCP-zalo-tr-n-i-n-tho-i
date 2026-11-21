// Kiểm thử Claude đọc ảnh/tệp hiện trường (LLM giả lập, Excel thật) + bản tổng hợp ngày. Chạy: npm test
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "zalo-readtest-"));
process.env.ZALO_MCP_HOME = HOME;
const { db, setSetting } = await import("./db.js");
const P = await import("./projects.js");
const M = await import("./media.js");
const { readPendingMedia } = await import("./mediaread.js");
const { extractPending } = await import("./extract.js");
const { buildDigest, digestDue } = await import("./digest.js");
const { setLlmForTest } = await import("./llm.js");
const { READ_DIR } = await import("./config.js");
const { default: ExcelJS } = await import("exceljs");
const ok = (m: string) => console.log("✔", m);

// tệp mẫu: PNG thật 1x1, JPEG giả (đầu FFD8), Excel thật, tệp .dwg không hỗ trợ
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100)]);
const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("KL ngày 21-11");
ws.addRow(["TT", "Hạng mục", "ĐV", "KL ngày"]);
ws.addRow([1, "Rải thảm BTN C12.5 Km15+200-Km15+600", "m2", 2400]);
const XLSX = Buffer.from(await wb.xlsx.writeBuffer());
const srv = http.createServer((req, res) => {
  const body = req.url === "/bang.png" ? PNG : req.url === "/cong-truong.jpg" ? JPG : req.url === "/kl.xlsx" ? XLSX : req.url === "/ban-ve.dwg" ? Buffer.from("AC1027") : null;
  if (!body) { res.writeHead(404); return res.end(); }
  res.writeHead(200); res.end(body);
});
await new Promise<void>((r) => srv.listen(0, r));
const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;

const ql = P.createProject("Bảo dưỡng QL.xx", ["QL.xx"]);
P.upsertThread("g1", "group", "BDTX QL.xx"); P.assignThread("g1", ql.id);
P.upsertThread("g2", "group", "Nhóm im lặng"); P.assignThread("g2", ql.id);
const ts = Date.now() - 5 * 60_000;
const q = (id: string, msgType: string, content: object) => M.queueMedia({ msgId: id, threadId: "g1", ts, sender: "Chị Hoa", msgType, content });
q("p1", "chat.photo", { href: `${base}/bang.png`, title: "Báo cáo ngày" });
q("p2", "chat.photo", { href: `${base}/cong-truong.jpg` });
q("f1", "share.file", { href: `${base}/kl.xlsx`, title: "KL ngay 21-11.xlsx", params: JSON.stringify({ fileExt: "xlsx" }) });
q("f2", "share.file", { href: `${base}/ban-ve.dwg`, title: "ban ve.dwg", params: JSON.stringify({ fileExt: "dwg" }) });
assert.equal(await M.downloadPending(), 4);
assert.equal(fs.readdirSync(READ_DIR).length, 4, "giữ bản sao để đọc");
assert.equal((db.prepare("SELECT COUNT(*) n FROM media WHERE read_status='pending'").get() as { n: number }).n, 4);

// LLM giả: ảnh 0 (PNG) là bảng số liệu, ảnh 1 (JPG) là ảnh công trường; trích xuất thì đọc tin tổng hợp
let imgCalls = 0, imgCount = 0;
const extractInputs: string[] = [];
setLlmForTest(async (p) => {
  const content = p.messages[0].content;
  if (p.tools?.some((t: any) => t.name === "ket_qua")) {
    imgCalls++;
    imgCount = (content as any[]).filter((b) => b.type === "image").length;
    return { content: [{ type: "tool_use", id: "k", name: "ket_qua", input: { items: [
      { i: 0, has_info: true, text: "BÁO CÁO NGÀY\nVá ổ gà Km12+300 | m2 | 45,5" },
      { i: 1, has_info: false, text: "Công nhân rải nhựa, có xe lu" },
    ] } }] } as any;
  }
  extractInputs.push(String(content));
  return { content: [{ type: "tool_use", id: "e", name: "ghi_bao_cao", input: { items: [] } }] } as any;
});

while ((await readPendingMedia()) > 0) { /* đọc hết */ }
assert.equal(imgCalls, 1, "2 ảnh cùng nhóm -> 1 lần gọi (theo lô)");
assert.equal(imgCount, 2);
const st = (id: string) => db.prepare("SELECT read_status,content_text FROM media WHERE msg_id=?").get(id) as { read_status: string; content_text: string };
assert.equal(st("p1").read_status, "done"); assert.match(st("p1").content_text, /45,5/);
assert.match(st("p2").content_text, /^Mô tả: Công nhân rải nhựa/);
assert.equal(st("f1").read_status, "done"); assert.match(st("f1").content_text, /Rải thảm BTN C12\.5.*\| m2 \| 2400/);
assert.equal(st("f2").read_status, "skipped");
assert.equal(fs.readdirSync(READ_DIR).length, 0, "đọc xong xoá bản sao");
const synth = db.prepare("SELECT text FROM messages WHERE sender_id='media' ORDER BY id").all() as { text: string }[];
assert.equal(synth.length, 2, "chỉ ảnh có số liệu + Excel được đưa vào trích xuất; ảnh công trường thường thì không");
assert.match(synth[0].text, /^\[Nội dung tệp "KL ngay 21-11\.xlsx" do Chị Hoa gửi\]/);
assert.match(synth[1].text, /^\[Nội dung ảnh "Báo cáo ngày" do Chị Hoa gửi\]\nBÁO CÁO NGÀY/);
await extractPending({ force: true });
assert.ok(extractInputs.some((t) => t.includes("Rải thảm BTN C12.5") && t.includes("45,5")), "bộ trích xuất nhận được nội dung ảnh + Excel");
ok("đọc ảnh theo lô; ảnh có số liệu và Excel được chép lại rồi đưa vào trích xuất; ảnh thường chỉ được mô tả; tệp không hỗ trợ bỏ qua");

// lỗi Claude -> thử lại tối đa 3 lần
q("p3", "chat.photo", { href: `${base}/bang.png` });
await M.downloadPending();
setLlmForTest(async () => { throw new Error("hết lượt"); });
for (let i = 0; i < 3; i++) await readPendingMedia();
assert.equal(st("p3").read_status, "failed");
ok("Claude lỗi (vd hết lượt): thử lại 3 lần rồi bỏ qua, ảnh vẫn được lưu Drive");

// nhật ký ngày có mục ảnh/tệp
M.writeDailyLogs([P.vnDate(ts)]);
const logTxt = fs.readFileSync(path.join(HOME, "drive-out", "Bảo dưỡng QL.xx", P.vnDate(ts), `Nhat ky ${P.vnDate(ts)}.txt`), "utf8");
assert.ok(logTxt.includes("# ẢNH / VIDEO / TỆP") && logTxt.includes("Mô tả: Công nhân rải nhựa") && logTxt.includes("45,5"));
ok("nhật ký ngày liệt kê ảnh/tệp kèm nội dung Claude đọc được");

// bản tổng hợp ngày
P.addReport({ projectId: ql.id, reportDate: P.vnDate(ts), item: "Vá ổ gà", unit: "m2", quantity: 45.5, reporter: "Chị Hoa" });
P.addReport({ projectId: ql.id, reportDate: P.vnDate(ts), item: "Rải thảm BTN", unit: "m2", quantity: 2400, reporter: "Chị Hoa", confidence: "low" });
const d = buildDigest(P.vnDate(ts));
console.log("\n" + d + "\n");
assert.ok(d.includes("Vá ổ gà: 45,5 m2") && d.includes("Rải thảm BTN: 2.400 m2 ⚠ cần soát") && d.includes("Nhóm im lặng cả ngày: Nhóm im lặng") && d.includes("Ảnh: 3"));
assert.equal(digestDue("18:00", "", Date.parse("2026-11-21T17:59:00+07:00")), false);
assert.equal(digestDue("18:00", "", Date.parse("2026-11-21T18:00:00+07:00")), true);
assert.equal(digestDue("18:00", "2026-11-21", Date.parse("2026-11-21T20:00:00+07:00")), false, "đã gửi hôm nay");
assert.equal(digestDue("8:30", "2026-11-20", Date.parse("2026-11-21T09:00:00+07:00")), true);
assert.equal(digestDue("", "", Date.now()), false, "trống = tắt");
ok("bản tổng hợp ngày: số kiểu Việt Nam, cảnh báo cần soát, nhóm im lặng, số ảnh; gửi đúng giờ, mỗi ngày một lần");

srv.close();
console.log("TẤT CẢ ĐẠT (đọc ảnh/tệp + tổng hợp ngày)");
fs.rmSync(HOME, { recursive: true, force: true });
