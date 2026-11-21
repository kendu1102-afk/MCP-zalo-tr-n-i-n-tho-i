// Kiểm thử tải ảnh/video/tệp hiện trường + đẩy lên "Drive" (rclone giả lập bằng thư mục cục bộ). Chạy: npm test
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "zalo-mediatest-"));
process.env.ZALO_MCP_HOME = path.join(HOME, "data");
const DRIVE = path.join(HOME, "GoogleDrive", "Drive"); // rclone giả ánh xạ "fakedrive:<x>" -> HOME/GoogleDrive/<x>
// rclone giả: "move SRC DST ..." -> chép sang DST rồi xoá nguồn (trừ *.part); "copy FILE DST" -> chép; FAIL=1 -> lỗi
const fake = path.join(HOME, "rclone");
fs.writeFileSync(fake, `#!/bin/sh
[ -f "${HOME}/FAIL" ] && { echo "Failed to create file system: token expired" >&2; exit 1; }
cmd="$1"; src="$2"; dst="${HOME}/GoogleDrive/\${3#fakedrive:}"
mkdir -p "$dst"
if [ "$cmd" = move ]; then cp -r "$src"/. "$dst"/ && find "$src" -type f ! -name '*.part' -delete && find "$src" -mindepth 1 -type d -empty -delete; fi
if [ "$cmd" = copy ]; then cp "$src" "$dst"/; fi
`, { mode: 0o755 });
process.env.RCLONE_BIN = fake;

const { db, logMessage, setSetting } = await import("./db.js");
const P = await import("./projects.js");
const M = await import("./media.js");
const { DRIVE_OUT_DIR } = await import("./config.js");
const ok = (m: string) => console.log("✔", m);

// máy chủ ảnh giả (thay cho CDN Zalo)
const srv = http.createServer((req, res) => {
  if (req.url?.startsWith("/hd/")) { res.writeHead(200, { "content-type": "image/jpeg" }); return res.end(Buffer.from("ANH-HD")); }
  if (req.url?.startsWith("/thumb/")) { res.writeHead(200); return res.end("ANH-NHO"); }
  if (req.url?.startsWith("/file/")) { res.writeHead(200); return res.end("NOI-DUNG-EXCEL"); }
  res.writeHead(404); res.end();
});
await new Promise<void>((r) => srv.listen(0, r));
const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;

const cau = P.createProject("Cầu ABC", ["ABC"]);
P.upsertThread("g1", "group", "Hiện trường Cầu ABC"); P.assignThread("g1", cau.id);
P.upsertThread("g9", "group", "Nhóm khác");
const ts = Date.parse("2026-11-21T08:15:30+07:00");
const photo = { title: "Đổ bê tông mố M1", href: `${base}/thumb/a.jpg`, params: JSON.stringify({ hd: `${base}/hd/a.jpg` }) };

// ---- phân loại & đặt tên ----
assert.equal(M.parseAttachment("chat.sticker", { href: "x" }), null);
assert.equal(M.parseAttachment("chat.photo", photo)!.url, `${base}/hd/a.jpg`, "ưu tiên ảnh HD");
assert.equal(M.parseAttachment("share.file", { title: "KL tuần 47.xlsx", href: `${base}/file/x`, params: JSON.stringify({ fileExt: "xlsx" }) })!.ext, "xlsx");
assert.ok(M.queueMedia({ msgId: "m1", threadId: "g1", ts, sender: "Anh Tuấn", msgType: "chat.photo", content: photo }));
assert.ok(!M.queueMedia({ msgId: "m1", threadId: "g1", ts, sender: "Anh Tuấn", msgType: "chat.photo", content: photo }), "trùng tin không tải lại");
assert.ok(M.queueMedia({ msgId: "m2", threadId: "g1", ts, sender: "Chị Lan", msgType: "share.file", content: { title: "KL tuần 47.xlsx", href: `${base}/file/x`, params: JSON.stringify({ fileExt: "xlsx" }) } }));
assert.ok(M.queueMedia({ msgId: "m3", threadId: "g1", ts, sender: "Anh Tuấn", msgType: "chat.photo", content: { href: `${base}/mat/404.jpg` } }));
assert.ok(!M.queueMedia({ msgId: "m4", threadId: "g9", ts, sender: "X", msgType: "chat.photo", content: photo }), "nhóm chưa ghép: không tải (mặc định)");
setSetting("media_scope", "all_groups");
assert.ok(M.queueMedia({ msgId: "m5", threadId: "g9", ts, sender: "X", msgType: "chat.photo", content: photo }), "all_groups: có tải");
setSetting("media_scope", "mapped");
setSetting("media_kinds", "photo,file");
assert.ok(!M.queueMedia({ msgId: "m6", threadId: "g1", ts, sender: "X", msgType: "chat.video.msg", content: { href: `${base}/hd/v.mp4` } }), "loại không chọn thì bỏ qua");
const rel = (id: string) => (db.prepare("SELECT rel_path FROM media WHERE msg_id=?").get(id) as { rel_path: string }).rel_path;
assert.equal(rel("m1"), path.join("Cầu ABC", "2026-11-21", "081530_Anh Tuấn_Đổ bê tông mố M1_m1.jpg"));
assert.equal(rel("m2"), path.join("Cầu ABC", "2026-11-21", "081530_Chị Lan_KL tuần 47_m2.xlsx"));
assert.ok(rel("m5").startsWith(path.join("_Chua ghep cong trinh", "Nhóm khác", "2026-11-21")));
ok("phân loại theo Công trình/Ngày, tên tệp có giờ + người gửi + chú thích, chống trùng, lọc nhóm và loại tệp");

// ---- tải ----
assert.equal(await M.downloadPending(), 3);
assert.equal(fs.readFileSync(path.join(DRIVE_OUT_DIR, rel("m1")), "utf8"), "ANH-HD");
for (let i = 0; i < 5; i++) await M.downloadPending();
const bad = db.prepare("SELECT status,attempts,error FROM media WHERE msg_id='m3'").get() as { status: string; attempts: number; error: string };
assert.equal(bad.status, "failed"); assert.equal(bad.attempts, 5); assert.match(bad.error, /404/);
ok("tải đúng ảnh HD; link hỏng thử lại 5 lần rồi đánh dấu lỗi");

// ---- nhật ký chữ ----
logMessage({ ts: ts + 60_000, threadId: "g1", threadType: "group", senderId: "t", senderName: "Anh Tuấn", direction: "in", text: "Đổ bê tông mố M1 được 12m3" });
logMessage({ ts: ts + 120_000, threadId: "g1", threadType: "group", senderId: "t", senderName: "Anh Tuấn", direction: "in", text: "[ảnh: Đổ bê tông mố M1]" });
P.addReport({ projectId: cau.id, reportDate: "2026-11-21", item: "Đổ bê tông mố M1", unit: "m3", quantity: 12, reporter: "Anh Tuấn" });
assert.equal(M.writeDailyLogs(["2026-11-21"]), 1);
const logTxt = fs.readFileSync(path.join(DRIVE_OUT_DIR, "Cầu ABC", "2026-11-21", "Nhat ky 2026-11-21.txt"), "utf8");
assert.ok(logTxt.includes("Đổ bê tông mố M1: 12 m3") && logTxt.includes("Anh Tuấn: Đổ bê tông mố M1 được 12m3") && logTxt.includes("CHƯA nghiệm thu"));
ok("nhật ký ngày: bảng khối lượng + toàn bộ tin nhắn, ghi rõ chưa nghiệm thu");

// ---- đẩy lên Drive ----
assert.equal(await M.syncToDrive(), null, "chưa đặt drive_remote thì không làm gì");
setSetting("drive_remote", "fakedrive:Drive");
fs.writeFileSync(path.join(HOME, "FAIL"), "");
assert.equal(await M.syncToDrive(), null);
assert.match(M.driveStatus().lastResult, /token expired/);
assert.equal((db.prepare("SELECT COUNT(*) n FROM media WHERE status='downloaded'").get() as { n: number }).n, 3, "lỗi rclone: giữ nguyên, không mất tệp");
fs.rmSync(path.join(HOME, "FAIL"));
const r = await M.syncToDrive();
assert.equal(r!.moved, 3);
assert.equal(fs.readFileSync(path.join(DRIVE, rel("m1")), "utf8"), "ANH-HD");
// nhật ký được ghi lại cho hôm nay/hôm qua mỗi lần đồng bộ; nhật ký ngày 21/11 đã có trong thư mục chờ từ trước nên cũng được chuyển lên
assert.ok(fs.existsSync(path.join(DRIVE, "Cầu ABC", "2026-11-21", "Nhat ky 2026-11-21.txt")), "nhật ký ngày lên Drive");
assert.equal(fs.existsSync(path.join(DRIVE_OUT_DIR, rel("m1"))), false, "đã xoá bản tạm trên máy chủ");
assert.equal(M.driveStatus().counts.uploaded, 3);
ok("đẩy lên Drive: lỗi thì giữ tệp để thử lại; thành công thì đánh dấu và xoá bản tạm");

// ---- sao lưu lên Drive không kèm phiên Zalo ----
fs.writeFileSync(path.join(process.env.ZALO_MCP_HOME!, "session.json"), '{"cookie":"bi-mat"}');
execFileSync("bash", ["deploy/backup.sh"], { env: { ...process.env }, stdio: "pipe" });
const pushed = fs.readdirSync(path.join(DRIVE, "_Sao luu"));
assert.equal(pushed.length, 1);
const list = execFileSync("tar", ["-tzf", path.join(DRIVE, "_Sao luu", pushed[0])]).toString();
assert.ok(list.includes("zalo.db") && !list.includes("session.json"), "bản trên Drive không chứa phiên Zalo");
const localTar = fs.readdirSync(path.join(process.env.ZALO_MCP_HOME!, "backups"))[0];
assert.ok(execFileSync("tar", ["-tzf", path.join(process.env.ZALO_MCP_HOME!, "backups", localTar)]).toString().includes("session.json"), "bản trên máy chủ vẫn có phiên để khôi phục");
ok("sao lưu hằng ngày tự đẩy lên <thư mục Drive>/_Sao luu, KHÔNG kèm phiên Zalo");

srv.close();
console.log("\nTẤT CẢ ĐẠT (ảnh + Drive)");
fs.rmSync(HOME, { recursive: true, force: true });
