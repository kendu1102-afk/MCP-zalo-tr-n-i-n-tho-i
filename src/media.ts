/**
 * Ảnh/video/file hiện trường gửi trong nhóm: tải về ngay (link Zalo có thể hết hạn), xếp theo "Công trình/Ngày/",
 * kèm nhật ký chữ mỗi ngày, rồi dùng rclone chuyển lên Google Drive (thư mục do bạn chỉ định) và xoá bản tạm.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DRIVE_OUT_DIR, READ_DIR } from "./config.js";
import { db, getSetting, getSettingRaw, setSettingRaw } from "./db.js";
import { projectsOfThread, vnDate, type Project } from "./projects.js";

const MAX_BYTES = 500 * 1024 * 1024;
const MAX_ATTEMPTS = 5;
const RCLONE = process.env.RCLONE_BIN ?? "rclone";
const UNASSIGNED = "_Chua ghep cong trinh";
const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[drive]", ...a);

/** Tên an toàn cho Drive/Linux/Windows, giữ tiếng Việt. */
export const safeName = (s: string, max = 80) =>
  s.normalize("NFC").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max).replace(/[. ]+$/, "") || "khong-ten";

type Attachment = { kind: "photo" | "video" | "file"; url: string; caption: string; ext: string };
const extOf = (u: string) => { try { return path.extname(new URL(u).pathname).replace(".", "").toLowerCase().slice(0, 5); } catch { return ""; } };

/** Đọc tin đính kèm của Zalo. Trả null nếu không phải ảnh/video/file. */
export function parseAttachment(msgType: string, content: unknown): Attachment | null {
  if (!content || typeof content !== "object") return null;
  const c = content as { href?: string; title?: string; description?: string; params?: string };
  let params: Record<string, unknown> = {};
  try { params = typeof c.params === "string" && c.params ? JSON.parse(c.params) : {}; } catch { /* bỏ qua */ }
  const caption = String(c.title || c.description || "").trim();
  if (msgType === "chat.photo") {
    const url = String(params.hd || c.href || "");
    return url ? { kind: "photo", url, caption, ext: extOf(url) || "jpg" } : null;
  }
  if (msgType === "chat.video.msg") {
    const url = String(c.href || "");
    return url ? { kind: "video", url, caption, ext: extOf(url) || "mp4" } : null;
  }
  if (msgType === "share.file") {
    const url = String(c.href || "");
    const name = String(c.title || "");
    const ext = String(params.fileExt || path.extname(name).replace(".", "") || extOf(url) || "bin").toLowerCase();
    return url ? { kind: "file", url, caption: name, ext } : null;
  }
  return null;
}

export const attachmentLabel = (a: Attachment) => `[${a.kind === "photo" ? "ảnh" : a.kind === "video" ? "video" : "tệp"}${a.caption ? `: ${a.caption}` : ""}]`;

function folderFor(threadId: string, ts: number): { dir: string; project: Project | null } | null {
  const ps = projectsOfThread(threadId);
  if (ps.length) return { dir: path.join(safeName(ps[0].name), vnDate(ts)), project: ps[0] };
  if (getSetting("media_scope") !== "all_groups") return null;
  const g = (db.prepare("SELECT name FROM threads WHERE thread_id=?").get(threadId) as { name: string } | undefined)?.name || threadId;
  return { dir: path.join(UNASSIGNED, safeName(g), vnDate(ts)), project: null };
}

/** Ghi nhận một tệp đính kèm từ nhóm (gọi khi nhận tin). Trả true nếu được xếp hàng tải. */
export function queueMedia(m: { msgId: string; threadId: string; ts: number; sender: string; msgType: string; content: unknown }): boolean {
  const a = parseAttachment(m.msgType, m.content);
  if (!a || !getSetting("media_kinds").split(",").map((s) => s.trim()).includes(a.kind)) return false;
  const f = folderFor(m.threadId, m.ts);
  if (!f) return false;
  const hhmmss = new Date(m.ts).toLocaleTimeString("sv-SE", { timeZone: "Asia/Ho_Chi_Minh" }).replace(/:/g, "");
  const base = a.kind === "file" && a.caption
    ? `${hhmmss}_${safeName(m.sender, 30)}_${safeName(path.parse(a.caption).name, 60)}`
    : `${hhmmss}_${safeName(m.sender, 30)}${a.caption ? `_${safeName(a.caption, 50)}` : ""}`;
  const rel = path.join(f.dir, `${base}_${safeName(m.msgId, 24)}.${a.ext}`);
  const r = db.prepare(
    `INSERT OR IGNORE INTO media(msg_id,thread_id,project_id,ts,sender,kind,caption,url,rel_path) VALUES(?,?,?,?,?,?,?,?,?)`,
  ).run(m.msgId, m.threadId, f.project?.id ?? null, m.ts, m.sender, a.kind, a.caption, a.url, rel);
  return Number(r.changes) > 0;
}

/** Tải các tệp đang chờ vào thư mục chờ. */
export async function downloadPending(limit = 10): Promise<number> {
  const rows = db.prepare("SELECT id,url,rel_path,kind FROM media WHERE status='pending' AND attempts<? ORDER BY id LIMIT ?").all(MAX_ATTEMPTS, limit) as { id: number; url: string; rel_path: string; kind: string }[];
  let ok = 0;
  for (const r of rows) {
    const dest = path.join(DRIVE_OUT_DIR, r.rel_path);
    try {
      const res = await fetch(r.url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const len = Number(res.headers.get("content-length") || 0);
      if (len > MAX_BYTES) throw new Error(`tệp quá lớn (${Math.round(len / 1e6)} MB)`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_BYTES) throw new Error("tệp quá lớn");
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest + ".part", buf);
      fs.renameSync(dest + ".part", dest);
      // giữ một bản riêng để Claude đọc nội dung (bản trong thư mục chờ sẽ bị chuyển lên Drive)
      const mode = getSetting("media_read");
      const readIt = mode === "all" || (mode === "files" && r.kind === "file");
      if (readIt) fs.writeFileSync(path.join(READ_DIR, `${r.id}${path.extname(dest)}`), buf);
      db.prepare("UPDATE media SET status='downloaded', size=?, error='', read_status=? WHERE id=?").run(buf.length, readIt ? "pending" : "", r.id);
      ok++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      db.prepare(`UPDATE media SET attempts=attempts+1, error=?, status=CASE WHEN attempts+1>=? THEN 'failed' ELSE status END WHERE id=?`).run(msg, MAX_ATTEMPTS, r.id);
      log(`tải #${r.id} lỗi: ${msg}`);
    }
  }
  return ok;
}

/** Nhật ký chữ theo ngày cho từng công trình: toàn bộ tin nhắn các nhóm + bảng khối lượng đã tổng hợp. */
export function writeDailyLogs(dates: string[]): number {
  if (getSetting("drive_text_logs") !== "true") return 0;
  let n = 0;
  const projects = db.prepare("SELECT id,name FROM projects").all() as { id: number; name: string }[];
  for (const p of projects) {
    const threads = (db.prepare("SELECT tp.thread_id, t.name FROM thread_project tp LEFT JOIN threads t ON t.thread_id=tp.thread_id WHERE tp.project_id=?").all(p.id) as { thread_id: string; name: string | null }[]);
    for (const date of dates) {
      const start = Date.parse(`${date}T00:00:00+07:00`), end = start + 86_400_000;
      const lines: string[] = [];
      for (const t of threads) {
        const msgs = db.prepare("SELECT ts,sender_name,direction,text FROM messages WHERE thread_id=? AND ts>=? AND ts<? ORDER BY ts").all(t.thread_id, start, end) as { ts: number; sender_name: string; direction: string; text: string }[];
        if (!msgs.length) continue;
        lines.push(`\n## Nhóm: ${t.name || t.thread_id}\n`);
        for (const m of msgs) lines.push(`[${new Date(m.ts).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false })}] ${m.direction === "in" ? m.sender_name || "?" : "(nick bot)"}: ${m.text}`);
      }
      const reps = db.prepare("SELECT item,unit,quantity,cumulative,location,reporter,note,confidence FROM work_reports WHERE project_id=? AND report_date=? ORDER BY item").all(p.id, date) as { item: string; unit: string; quantity: number | null; cumulative: number | null; location: string; reporter: string; note: string; confidence: string }[];
      if (!lines.length && !reps.length) continue;
      const media = (db.prepare("SELECT COUNT(*) AS n FROM media WHERE project_id=? AND ts>=? AND ts<?").get(p.id, start, end) as { n: number }).n;
      const out = [
        `NHẬT KÝ HIỆN TRƯỜNG - ${p.name} - ngày ${date}`,
        `(Tự động tổng hợp từ nhóm Zalo. Số liệu là báo cáo hiện trường, CHƯA nghiệm thu. Ảnh/tệp trong ngày: ${media}, lưu cùng thư mục.)`,
        `\n# KHỐI LƯỢNG TRÍCH XUẤT TRONG NGÀY`,
        ...(reps.length ? reps.map((r) => `- ${r.item}: ${r.quantity ?? "không nêu"} ${r.unit}${r.cumulative !== null ? ` (lũy kế nêu: ${r.cumulative})` : ""}${r.location ? ` | ${r.location}` : ""}${r.reporter ? ` | ${r.reporter}` : ""}${r.note ? ` | ${r.note}` : ""}${r.confidence === "low" ? " | CẦN SOÁT" : ""}`) : ["(không có)"]),
        ...mediaSection(p.id, start, end),
        `\n# TIN NHẮN`,
        ...(lines.length ? lines : ["(không có)"]),
        "",
      ].join("\n");
      const dest = path.join(DRIVE_OUT_DIR, safeName(p.name), date, `Nhat ky ${date}.txt`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, out);
      n++;
    }
  }
  return n;
}

function mediaSection(projectId: number, start: number, end: number): string[] {
  const rows = db.prepare("SELECT ts,sender,kind,rel_path,content_text FROM media WHERE project_id=? AND ts>=? AND ts<? ORDER BY ts").all(projectId, start, end) as { ts: number; sender: string; kind: string; rel_path: string; content_text: string }[];
  if (!rows.length) return [];
  return [`\n# ẢNH / VIDEO / TỆP (${rows.length})`, ...rows.map((r) =>
    `- [${new Date(r.ts).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false })}] ${r.sender}: ${path.basename(r.rel_path)}${r.content_text ? `\n    ${r.content_text.replace(/\s*\n\s*/g, " / ").slice(0, 400)}` : ""}`)];
}

function runRclone(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = spawn(RCLONE, args, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    c.stderr.on("data", (d) => (err += d));
    c.on("error", (e) => reject(new Error(`Không chạy được rclone: ${e.message}. Cài rclone và cấu hình Google Drive (xem DEPLOY.md).`)));
    c.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`rclone lỗi (mã ${code}): ${err.slice(-400)}`))));
  });
}

/** drive_remote là đường dẫn cục bộ (vd "G:\\My Drive\\Cong trinh" của Google Drive for desktop, hoặc "/mnt/drive") -> không cần rclone. */
export const isLocalTarget = (t: string) => /^[A-Za-z]:[\\/]/.test(t) || t.startsWith("/") || t.startsWith("\\\\");

/** Chuyển cây thư mục chờ sang thư mục cục bộ (chép rồi xoá nguồn), bỏ qua *.part. */
function moveLocal(src: string, dst: string): void {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) {
      moveLocal(s, d);
      if (!fs.readdirSync(s).length) fs.rmdirSync(s);
    } else if (!e.name.endsWith(".part")) {
      fs.mkdirSync(dst, { recursive: true });
      fs.copyFileSync(s, d);
      fs.rmSync(s);
    }
  }
}

let syncing = false;
/** Ghi nhật ký hôm nay + hôm qua, rồi chuyển toàn bộ thư mục chờ lên Drive. */
export async function syncToDrive(): Promise<{ moved: number } | null> {
  const remote = getSetting("drive_remote").trim();
  if (!remote || syncing) return null;
  syncing = true;
  try {
    writeDailyLogs([vnDate(Date.now() - 86_400_000), vnDate(Date.now())]);
    const before = db.prepare("SELECT id,rel_path FROM media WHERE status='downloaded'").all() as { id: number; rel_path: string }[];
    // move: lên Drive xong thì xoá bản tạm; bỏ qua tệp đang tải dở (*.part)
    if (isLocalTarget(remote)) moveLocal(DRIVE_OUT_DIR, remote);
    else await runRclone(["move", DRIVE_OUT_DIR, remote, "--exclude", "*.part", "--delete-empty-src-dirs", "--transfers", "4", "--retries", "3"]);
    let moved = 0;
    for (const r of before) {
      if (!fs.existsSync(path.join(DRIVE_OUT_DIR, r.rel_path))) {
        db.prepare("UPDATE media SET status='uploaded' WHERE id=?").run(r.id);
        moved++;
      }
    }
    setSettingRaw("drive_last_sync", `${Date.now()}|ok|${moved}`);
    if (moved) log(`đã chuyển ${moved} tệp lên ${remote}`);
    return { moved };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setSettingRaw("drive_last_sync", `${Date.now()}|${msg}|0`);
    log(msg);
    return null;
  } finally {
    syncing = false;
  }
}

export function driveStatus() {
  const counts = Object.fromEntries((db.prepare("SELECT status, COUNT(*) AS n FROM media GROUP BY status").all() as { status: string; n: number }[]).map((r) => [r.status, r.n]));
  const [ts, result, moved] = (getSettingRaw("drive_last_sync") || "||").split("|");
  let localBytes = 0;
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else localBytes += fs.statSync(p).size; } };
  try { walk(DRIVE_OUT_DIR); } catch { /* trống */ }
  return { remote: getSetting("drive_remote"), counts, lastSync: ts ? Number(ts) : null, lastResult: result, lastMoved: Number(moved) || 0, localMB: Math.round(localBytes / 1e5) / 10 };
}
