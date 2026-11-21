import { DatabaseSync } from "node:sqlite";
import { DB_PATH } from "./config.js";

process.removeAllListeners("warning"); // tắt cảnh báo "SQLite is experimental"

export const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS docs (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT '',
  bot_visible INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY,
  doc_id INTEGER NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  text TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text, tokenize = 'unicode61 remove_diacritics 2'
); -- rowid = chunks.id

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  thread_id TEXT NOT NULL,
  thread_type TEXT NOT NULL,           -- 'user' | 'group'
  sender_id TEXT NOT NULL,
  sender_name TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL,             -- 'in' | 'out_bot' | 'out_manual' | 'out_claude'
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, ts);

CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY,
  thread_id TEXT NOT NULL,
  thread_type TEXT NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | sent | failed
  error TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS unanswered (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  thread_id TEXT NOT NULL,
  sender_name TEXT NOT NULL DEFAULT '',
  question TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0
);

-- Người (đã là bạn bè) được phép nhờ bot làm hồ sơ; chỉ trong phạm vi công trình được cấp
CREATE TABLE IF NOT EXISTS requesters (
  uid TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  projects TEXT NOT NULL DEFAULT '[]',   -- JSON: tên công trình, hoặc ["*"] = tất cả
  kb_private INTEGER NOT NULL DEFAULT 0, -- 1 = bot được dùng cả tài liệu riêng tư khi soạn cho người này
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS doc_jobs (
  id INTEGER PRIMARY KEY,
  requester_uid TEXT NOT NULL,
  requester_name TEXT NOT NULL DEFAULT '',
  request_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
    -- queued | working | awaiting_approval | approved | sent | rejected | needs_info | failed
  template_id TEXT NOT NULL DEFAULT '',
  file_path TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',      -- tóm tắt gửi kèm: nguồn số liệu, mục thiếu
  error TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON doc_jobs(status);
CREATE TABLE IF NOT EXISTS friends (uid TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- Công trình / nhóm hiện trường / báo cáo khối lượng
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  aliases TEXT NOT NULL DEFAULT '[]',   -- JSON: tên gọi khác, tên viết tắt, mã tuyến
  description TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS threads (
  thread_id TEXT PRIMARY KEY,
  thread_type TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS thread_project (
  thread_id TEXT NOT NULL,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  PRIMARY KEY (thread_id, project_id)
);
CREATE TABLE IF NOT EXISTS work_reports (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  report_date TEXT NOT NULL,            -- YYYY-MM-DD (giờ Việt Nam)
  item TEXT NOT NULL,                   -- hạng mục / công việc
  unit TEXT NOT NULL DEFAULT '',
  quantity REAL,                        -- khối lượng làm TRONG NGÀY (null nếu không nêu)
  cumulative REAL,                      -- lũy kế do hiện trường tự nêu (nếu có)
  location TEXT NOT NULL DEFAULT '',    -- lý trình / vị trí
  note TEXT NOT NULL DEFAULT '',
  reporter TEXT NOT NULL DEFAULT '',
  thread_id TEXT NOT NULL DEFAULT '',
  source_msg_id INTEGER,
  confidence TEXT NOT NULL DEFAULT 'high',  -- high | low
  manual INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_project ON work_reports(project_id, report_date);
CREATE TABLE IF NOT EXISTS work_targets (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  item TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  target REAL NOT NULL,
  PRIMARY KEY (project_id, item, unit)
);
`);
// extracted: 0 = chờ xử lý, 1 = đã trích xuất, 2 = bỏ qua (không phải báo cáo)
try { db.exec("ALTER TABLE messages ADD COLUMN extracted INTEGER NOT NULL DEFAULT 0"); } catch { /* đã có */ }
db.exec("PRAGMA foreign_keys = ON;");

// ---------- settings ----------
export const DEFAULT_SETTINGS = {
  bot_enabled: "false",            // phải bật thủ công
  friends_only: "true",            // chỉ trả lời người ĐÃ KẾT BẠN với nick này (chủ đã ghép nối luôn được)
  reply_scope: "all_dm",           // all_dm | allowlist
  allowlist: "[]",                 // JSON: mảng thread_id (khi reply_scope = allowlist)
  blocklist: "[]",                 // JSON: không bao giờ tự trả lời
  disclose_bot: "true",            // thêm tiền tố nhận biết là trợ lý tự động
  disclose_prefix: "🤖 ",
  fallback_reply: "",              // rỗng = im lặng khi không biết (chỉ ghi vào 'unanswered')
  max_replies_per_hour: "10",      // mỗi hội thoại
  human_takeover_minutes: "30",    // bạn tự nhắn tay -> bot tạm dừng ở hội thoại đó
  owner_ids: "[]",                 // JSON: uid Zalo của bạn (nick chính) -> được hỏi tiến độ/khối lượng
  pair_code: "",                   // mã ghép nối tạm thời "code:hạn" (xem zalo_new_pair_code)
  doc_delivery: "approve",         // approve = soạn xong gửi CHỦ duyệt rồi mới gửi người yêu cầu | auto = gửi thẳng
  doc_max_per_day: "5",            // số yêu cầu làm hồ sơ tối đa mỗi người mỗi ngày
  persona: "Bạn là trợ lý của một kỹ sư quản lý dự án cầu đường và bảo dưỡng thường xuyên đường bộ.",
} as const;
export type SettingKey = keyof typeof DEFAULT_SETTINGS;

export function getSetting(key: SettingKey): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? DEFAULT_SETTINGS[key];
}
export function setSetting(key: SettingKey, value: string): void {
  db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
}
export function allSettings(): Record<SettingKey, string> {
  const out = {} as Record<SettingKey, string>;
  for (const k of Object.keys(DEFAULT_SETTINGS) as SettingKey[]) out[k] = getSetting(k);
  return out;
}
export function getJsonList(key: SettingKey): string[] {
  try { const v = JSON.parse(getSetting(key)); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}

export function getSettingRaw(key: string): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? "";
}
export function setSettingRaw(key: string, value: string): void {
  db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key, value);
}

// heartbeat do bot ghi, MCP đọc
export function setHeartbeat(): void {
  db.prepare("INSERT INTO settings(key,value) VALUES('heartbeat',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(Date.now()));
}
export function getHeartbeat(): number | null {
  const row = db.prepare("SELECT value FROM settings WHERE key='heartbeat'").get() as { value: string } | undefined;
  return row ? Number(row.value) : null;
}

// ---------- messages ----------
export function logMessage(m: {
  ts?: number; threadId: string; threadType: "user" | "group"; senderId: string; senderName?: string;
  direction: "in" | "out_bot" | "out_manual" | "out_claude"; text: string;
}): void {
  db.prepare(
    "INSERT INTO messages(ts,thread_id,thread_type,sender_id,sender_name,direction,text) VALUES(?,?,?,?,?,?,?)",
  ).run(m.ts ?? Date.now(), m.threadId, m.threadType, m.senderId, m.senderName ?? "", m.direction, m.text);
}
