/** Kiểm tra cài đặt: bước nào đã xong, bước nào còn thiếu. Chạy: npm run kiemtra */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { SESSION_PATH } from "./config.js";
import { db, getHeartbeat, getJsonList, getSetting, getSettingRaw } from "./db.js";
import { friendsCount } from "./friends.js";
import { listGroups, listProjects } from "./projects.js";
import { listRequesters } from "./docs.js";
import { listTemplates } from "./templates.js";

const rows: [boolean | null, string, string][] = [];
const add = (ok: boolean | null, what: string, fix = "") => rows.push([ok, what, fix]);
const run = (bin: string, args: string[]) => { const r = spawnSync(bin, args, { encoding: "utf8", timeout: 20_000 }); return r.status === 0 ? r.stdout.trim() : null; };

const [maj, min] = process.versions.node.split(".").map(Number);
add(maj > 22 || (maj === 22 && min >= 13), `Node.js ${process.versions.node}`, "Cài Node 22.13 trở lên (bash deploy/setup-ubuntu.sh)");
const cc = run(process.env.CLAUDE_BIN ?? "claude", ["--version"]);
add(!!cc || getSetting("engine") === "api", `Claude Code: ${cc ?? "không tìm thấy"} (engine=${getSetting("engine")})`, "Cài Claude Code rồi chạy `claude` một lần để đăng nhập tài khoản Claude");
add(fs.existsSync(SESSION_PATH), "Phiên đăng nhập Zalo của nick bot", "Chạy `npm run login`, quét QR bằng Zalo của nick bot");
const hb = getHeartbeat();
add(hb !== null && Date.now() - hb < 30_000, `Bot đang chạy${hb ? ` (heartbeat ${new Date(hb).toLocaleString("vi-VN")})` : ""}`, "sudo systemctl start zalo-bot  (hoặc npm run bot)");
const problem = getSettingRaw("bot_problem");
if (problem) add(false, `Sự cố gần nhất: ${problem}`, "Xem nhật ký: journalctl -u zalo-bot -n 50");
add(getJsonList("owner_ids").length > 0, `Tài khoản chủ đã ghép nối: ${getJsonList("owner_ids").length}`, "Từ Zalo chính nhắn cho nick bot: /ketnoi <mã> (mã in ra khi chạy npm run login / khởi động bot)");
add(getSetting("bot_enabled") === "true", `Tự trả lời: ${getSetting("bot_enabled") === "true" ? "BẬT" : "TẮT"}`, "Nhắn /batbot cho nick bot");
add(friendsCount() > 0, `Danh sách bạn bè đã đồng bộ: ${friendsCount()}`, "Bot tự đồng bộ khi chạy; kết bạn nick bot với những người cần dùng");
const ps = listProjects(), gs = listGroups();
add(ps.length > 0, `Công trình: ${ps.length}`, "Nhắn: /congtrinh them Tên công trình | bí danh");
add(gs.length > 0 && gs.every((g) => g.projects.length), `Nhóm Zalo đã ghép công trình: ${gs.filter((g) => g.projects.length).length}/${gs.length}`, gs.length ? "Nhắn /nhom rồi /ghep <số> <công trình>" : "Thêm nick bot vào các nhóm hiện trường");
add(listTemplates().length > 0, `Mẫu hồ sơ: ${listTemplates().map((t) => t.id).join(", ") || "chưa có"}`, "Gửi file .docx mẫu (đã đặt thẻ {ten_truong}) cho nick bot");
add(listRequesters().length > 0 ? true : null, `Người được nhờ làm hồ sơ: ${listRequesters().length}`, "Nhắn /banbe <tên> rồi /capquyen <số> <công trình>");
const rc = run(process.env.RCLONE_BIN ?? "rclone", ["listremotes"]);
add(rc !== null && rc.length > 0, `rclone: ${rc === null ? "chưa cài" : rc ? `remote ${rc.replace(/\n/g, " ")}` : "chưa có remote"}`, "Chạy `rclone config` để kết nối Google Drive (DEPLOY.md, mục Google Drive)");
add(!!getSetting("drive_remote"), `Thư mục Google Drive: ${getSetting("drive_remote") || "chưa đặt"}`, "Nhắn: /drive gdrive:Cong trinh/Anh hien truong");
const last = getSettingRaw("drive_last_sync").split("|");
if (last[0]) add(last[1] === "ok", `Đồng bộ Drive gần nhất: ${new Date(Number(last[0])).toLocaleString("vi-VN")} ${last[1] === "ok" ? "thành công" : `LỖI: ${last[1]}`}`, "Kiểm tra `rclone lsd gdrive:`; nếu token hết hạn chạy `rclone config reconnect gdrive:`");
const docs = (db.prepare("SELECT COUNT(*) n FROM docs").get() as { n: number }).n;
add(docs > 0 ? true : null, `Tài liệu trong bộ nhớ: ${docs}`, "Gửi tài liệu (PDF/Word/Excel) cho nick bot để nạp");

console.log("\nKIỂM TRA CÀI ĐẶT BOT ZALO\n");
for (const [ok, what, fix] of rows) console.log(`${ok === true ? "✅" : ok === null ? "➖" : "❌"} ${what}${ok === true || !fix ? "" : `\n     → ${fix}`}`);
const todo = rows.filter((r) => r[0] === false).length;
console.log(todo ? `\nCòn ${todo} bước cần làm.` : "\nĐã cài đặt đầy đủ.");
