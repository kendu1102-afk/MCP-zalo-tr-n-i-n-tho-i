/**
 * Lấy toàn bộ lịch sử nhóm Zalo.
 *   npm run lay-lich-su                      -> 3 nhóm ghim đầu
 *   npm run lay-lich-su -- --ghim 5          -> 5 nhóm ghim đầu
 *   npm run lay-lich-su -- --nhom 123,456    -> các nhóm theo mã
 *   npm run lay-lich-su -- --tu 2026-01-01   -> chỉ lấy từ ngày này
 */
import { getSetting } from "./db.js";
import { importGroupHistory, pinnedGroups, type HistoryApi } from "./history.js";
import { downloadPending, syncToDrive } from "./media.js";
import { loginWithSession } from "./zalo.js";

const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const api = (await loginWithSession()) as unknown as HistoryApi;
const ids = arg("--nhom")?.split(",").map((s) => s.trim().replace(/^g/, "")) ?? (await pinnedGroups(api, Number(arg("--ghim") ?? 3)));
if (!ids.length) { console.log("Không tìm thấy nhóm nào được ghim trên nick này. Ghim nhóm trong Zalo, hoặc dùng --nhom <mã nhóm>."); process.exit(1); }
const since = arg("--tu") ? Date.parse(`${arg("--tu")}T00:00:00+07:00`) : undefined;
const fmt = (ts: number | null) => (ts ? new Date(ts).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false }) : "?");

console.log(`Sẽ lấy lịch sử ${ids.length} nhóm${since ? ` từ ${arg("--tu")}` : " (toàn bộ)"}...`);
for (const id of ids) {
  try {
    const r = await importGroupHistory(api, id, { since, onPage: (p, n) => process.stdout.write(`\r  nhóm ${id}: trang ${p}, đã đọc ${n} tin`) });
    console.log(`\n✅ "${r.name}": ${r.fetched} tin (${r.added} tin mới), ${r.media} ảnh/tệp chờ tải. Từ ${fmt(r.first)} đến ${fmt(r.last)}.\n   Bản chép: ${r.transcript}`);
  } catch (e) {
    console.log(`\n⚠ Nhóm ${id}: ${e instanceof Error ? e.message : e}`);
  }
}
console.log("\nĐang tải ảnh/tệp (link cũ có thể đã hết hạn)...");
let n = 0, k: number;
while ((k = await downloadPending(20)) > 0) { n += k; process.stdout.write(`\r  đã tải ${n}`); }
console.log(`\n  Tải xong ${n} tệp.`);
if (getSetting("drive_remote")) { const s = await syncToDrive(); console.log(s ? `☁️ Đã chuyển ${s.moved} tệp lên ${getSetting("drive_remote")}` : "⚠ Chưa chuyển được lên Drive (xem drive_status)."); }
else console.log("(Chưa đặt drive_remote: tệp và bản chép đang ở data/drive-out.)");
console.log("\nTiếp theo: ghép các nhóm này với công trình (/nhom, /ghep) để bot trích xuất khối lượng từ toàn bộ lịch sử.");
process.exit(0);
