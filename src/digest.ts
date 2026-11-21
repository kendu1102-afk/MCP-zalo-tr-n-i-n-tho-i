/** Bản tổng hợp hiện trường trong ngày, gửi chủ tài khoản qua Zalo. Tạo bằng code từ số liệu đã trích xuất (không tốn lượt Claude). */
import { db, getSetting } from "./db.js";
import { listProjects, vnDate } from "./projects.js";

const n = (v: number | null) => (v === null ? "?" : (Math.round(v * 1000) / 1000).toLocaleString("vi-VN"));
const ddmm = (d: string) => d.split("-").reverse().join("/");

export function buildDigest(date = vnDate(Date.now())): string {
  const start = Date.parse(`${date}T00:00:00+07:00`), end = start + 86_400_000;
  const out: string[] = [`📋 TỔNG HỢP HIỆN TRƯỜNG NGÀY ${ddmm(date)}`, "(Theo báo cáo hiện trường qua Zalo, CHƯA nghiệm thu)"];
  const projects = listProjects();
  if (!projects.length) out.push("\nChưa khai báo công trình nào.");
  for (const p of projects) {
    const threads = db.prepare("SELECT tp.thread_id, COALESCE(t.name, tp.thread_id) AS name FROM thread_project tp LEFT JOIN threads t ON t.thread_id=tp.thread_id WHERE tp.project_id=?").all(p.id) as { thread_id: string; name: string }[];
    const reps = db.prepare("SELECT item,unit,SUM(quantity) AS q,COUNT(*) AS c,SUM(confidence='low') AS low,GROUP_CONCAT(DISTINCT reporter) AS who FROM work_reports WHERE project_id=? AND report_date=? GROUP BY item,unit ORDER BY item").all(p.id, date) as { item: string; unit: string; q: number | null; c: number; low: number; who: string | null }[];
    const media = db.prepare("SELECT kind, COUNT(*) AS c FROM media WHERE project_id=? AND ts>=? AND ts<? GROUP BY kind").all(p.id, start, end) as { kind: string; c: number }[];
    const silent = threads.filter((t) => !(db.prepare("SELECT 1 FROM messages WHERE thread_id=? AND ts>=? AND ts<? AND direction='in' LIMIT 1").get(t.thread_id, start, end)));
    const pending = (db.prepare("SELECT COUNT(*) AS c FROM messages m JOIN thread_project tp ON tp.thread_id=m.thread_id WHERE tp.project_id=? AND m.extracted=0 AND m.direction='in'").get(p.id) as { c: number }).c;
    out.push(`\n🏗 ${p.name}`);
    if (!threads.length) { out.push("  (chưa ghép nhóm Zalo nào)"); continue; }
    if (reps.length) {
      for (const r of reps) out.push(`  • ${r.item}: ${r.q === null ? "không nêu số" : `${n(r.q)} ${r.unit}`}${r.low ? " ⚠ cần soát" : ""}`);
      const who = [...new Set(reps.flatMap((r) => (r.who ?? "").split(",")).filter(Boolean))];
      if (who.length) out.push(`  Người báo: ${who.join(", ")}`);
    } else out.push("  ❗ Không có khối lượng nào được báo trong ngày");
    const m = Object.fromEntries(media.map((x) => [x.kind, x.c]));
    if (media.length) out.push(`  Ảnh: ${m.photo ?? 0}, video: ${m.video ?? 0}, tệp: ${m.file ?? 0} (${getSetting("drive_remote") ? "lưu trên Google Drive" : "lưu trên máy chủ, chưa kết nối Drive"})`);
    if (silent.length) out.push(`  Nhóm im lặng cả ngày: ${silent.map((t) => t.name).join("; ")}`);
    if (pending) out.push(`  Còn ${pending} tin chưa xử lý`);
  }
  const unassigned = db.prepare("SELECT COUNT(DISTINCT m.thread_id) AS c FROM messages m WHERE m.thread_type='group' AND m.ts>=? AND m.ts<? AND m.thread_id NOT IN (SELECT thread_id FROM thread_project)").get(start, end) as { c: number };
  const awaiting = (db.prepare("SELECT COUNT(*) AS c FROM doc_jobs WHERE status='awaiting_approval'").get() as { c: number }).c;
  const unanswered = (db.prepare("SELECT COUNT(*) AS c FROM unanswered WHERE resolved=0").get() as { c: number }).c;
  const extra = [
    unassigned.c ? `${unassigned.c} nhóm chưa ghép công trình có tin hôm nay` : "",
    awaiting ? `${awaiting} hồ sơ chờ bạn duyệt` : "",
    unanswered ? `${unanswered} câu hỏi bot chưa trả lời được` : "",
  ].filter(Boolean);
  if (extra.length) out.push(`\n📌 ${extra.join(" | ")}`);
  out.push("\nHỏi chi tiết: nhắn \"khối lượng <tên công trình> đến đâu rồi\".");
  return out.join("\n");
}

/** Đã đến giờ gửi bản tổng hợp hôm nay chưa (theo giờ Việt Nam), và chưa gửi. */
export function digestDue(time: string, lastSentDate: string, now = Date.now()): boolean {
  if (!/^\d{1,2}:\d{2}$/.test(time)) return false;
  const today = vnDate(now);
  if (lastSentDate === today) return false;
  const hm = new Date(now).toLocaleTimeString("en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour12: false }).slice(0, 5);
  return hm >= time.padStart(5, "0");
}
