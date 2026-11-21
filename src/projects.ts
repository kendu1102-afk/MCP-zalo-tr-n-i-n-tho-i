import { db } from "./db.js";

// ---------- tiện ích ----------
/** Chữ thường, bỏ dấu, chỉ giữ chữ-số, cách nhau 1 dấu cách. Để so khớp tên công trình bất kể dấu. */
export function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "d").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
/** Ngày YYYY-MM-DD theo giờ Việt Nam. */
export function vnDate(ts: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
}
const parseAliases = (j: string): string[] => { try { const v = JSON.parse(j); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };

export type Project = { id: number; name: string; aliases: string[]; description: string };
type ProjectRow = { id: number; name: string; aliases: string; description: string };
const toProject = (r: ProjectRow): Project => ({ id: r.id, name: r.name, aliases: parseAliases(r.aliases), description: r.description });

// ---------- công trình ----------
export function createProject(name: string, aliases: string[] = [], description = ""): Project {
  const r = db.prepare("INSERT INTO projects(name,aliases,description,created_at) VALUES(?,?,?,?)").run(name.trim(), JSON.stringify(aliases), description, Date.now());
  return { id: Number(r.lastInsertRowid), name: name.trim(), aliases, description };
}
export function updateProject(id: number, f: { name?: string; aliases?: string[]; description?: string }): boolean {
  const p = getProjectById(id);
  if (!p) return false;
  db.prepare("UPDATE projects SET name=?, aliases=?, description=? WHERE id=?").run(f.name ?? p.name, JSON.stringify(f.aliases ?? p.aliases), f.description ?? p.description, id);
  return true;
}
export function deleteProject(id: number): boolean {
  return Number(db.prepare("DELETE FROM projects WHERE id=?").run(id).changes) > 0; // báo cáo/ghép nhóm xoá theo CASCADE
}
export function listProjects(): Project[] {
  return (db.prepare("SELECT id,name,aliases,description FROM projects ORDER BY id").all() as ProjectRow[]).map(toProject);
}
export function getProjectById(id: number): Project | null {
  const r = db.prepare("SELECT id,name,aliases,description FROM projects WHERE id=?").get(id) as ProjectRow | undefined;
  return r ? toProject(r) : null;
}
/** Tìm công trình theo id, tên đầy đủ hoặc bí danh (bỏ dấu); chấp nhận khi chỉ có đúng 1 kết quả chứa chuỗi. */
export function resolveProject(ref: string | number): Project | null {
  const all = listProjects();
  if (typeof ref === "number" || /^\d+$/.test(String(ref))) {
    const byId = all.find((p) => p.id === Number(ref));
    if (byId) return byId;
  }
  const q = norm(String(ref));
  if (!q) return null;
  const exact = all.find((p) => [p.name, ...p.aliases].some((n) => norm(n) === q));
  if (exact) return exact;
  const partial = all.filter((p) => [p.name, ...p.aliases].some((n) => norm(n).includes(q)));
  return partial.length === 1 ? partial[0] : null;
}
/** Các công trình được nhắc tới trong một đoạn văn (khớp theo cụm từ nguyên vẹn, bỏ dấu). */
export function findProjectsInText(text: string): Project[] {
  const t = ` ${norm(text)} `;
  return listProjects().filter((p) => [p.name, ...p.aliases].some((n) => { const x = norm(n); return x.length >= 2 && t.includes(` ${x} `); }));
}

// ---------- nhóm Zalo <-> công trình ----------
export function upsertThread(threadId: string, type: "user" | "group", name?: string): void {
  db.prepare(
    `INSERT INTO threads(thread_id,thread_type,name,updated_at) VALUES(?,?,?,?)
     ON CONFLICT(thread_id) DO UPDATE SET name=CASE WHEN excluded.name<>'' THEN excluded.name ELSE threads.name END, updated_at=excluded.updated_at`,
  ).run(threadId, type, name ?? "", Date.now());
}
export function assignThread(threadId: string, projectId: number): void {
  db.prepare("INSERT OR IGNORE INTO thread_project(thread_id,project_id) VALUES(?,?)").run(threadId, projectId);
}
export function unassignThread(threadId: string, projectId?: number): number {
  return Number(projectId === undefined
    ? db.prepare("DELETE FROM thread_project WHERE thread_id=?").run(threadId).changes
    : db.prepare("DELETE FROM thread_project WHERE thread_id=? AND project_id=?").run(threadId, projectId).changes);
}
export function projectsOfThread(threadId: string): Project[] {
  return (db.prepare("SELECT p.id,p.name,p.aliases,p.description FROM thread_project tp JOIN projects p ON p.id=tp.project_id WHERE tp.thread_id=?").all(threadId) as ProjectRow[]).map(toProject);
}
/** Nếu tên nhóm chứa đúng 1 công trình đã biết và nhóm chưa được ghép, tự ghép. Trả về công trình đã ghép. */
export function autoAssignByName(threadId: string, groupName: string): Project | null {
  if (!groupName || projectsOfThread(threadId).length) return null;
  const found = findProjectsInText(groupName);
  if (found.length !== 1) return null;
  assignThread(threadId, found[0].id);
  return found[0];
}
export type GroupRow = { threadId: string; name: string; projects: string[]; messages: number; lastTs: number | null; pending: number };
export function listGroups(): GroupRow[] {
  const rows = db.prepare(
    `SELECT t.thread_id AS threadId, t.name,
       (SELECT COUNT(*) FROM messages m WHERE m.thread_id=t.thread_id) AS messages,
       (SELECT MAX(ts) FROM messages m WHERE m.thread_id=t.thread_id) AS lastTs,
       (SELECT COUNT(*) FROM messages m WHERE m.thread_id=t.thread_id AND m.extracted=0 AND m.direction='in') AS pending
     FROM threads t WHERE t.thread_type='group' ORDER BY lastTs DESC`,
  ).all() as Omit<GroupRow, "projects">[];
  return rows.map((r) => ({ ...r, projects: projectsOfThread(r.threadId).map((p) => p.name) }));
}

// ---------- báo cáo khối lượng ----------
export type ReportInput = {
  projectId: number; reportDate: string; item: string; unit?: string; quantity?: number | null; cumulative?: number | null;
  location?: string; note?: string; reporter?: string; threadId?: string; sourceMsgId?: number | null; confidence?: "high" | "low"; manual?: boolean;
};
export function addReport(r: ReportInput): number {
  const x = db.prepare(
    `INSERT INTO work_reports(project_id,report_date,item,unit,quantity,cumulative,location,note,reporter,thread_id,source_msg_id,confidence,manual,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(r.projectId, r.reportDate, r.item.trim(), (r.unit ?? "").trim(), r.quantity ?? null, r.cumulative ?? null, r.location ?? "", r.note ?? "", r.reporter ?? "", r.threadId ?? "", r.sourceMsgId ?? null, r.confidence ?? "high", r.manual ? 1 : 0, Date.now());
  return Number(x.lastInsertRowid);
}
export type ReportRow = { id: number; projectId: number; reportDate: string; item: string; unit: string; quantity: number | null; cumulative: number | null; location: string; note: string; reporter: string; confidence: string; manual: number };
const REPORT_COLS = "id,project_id AS projectId,report_date AS reportDate,item,unit,quantity,cumulative,location,note,reporter,confidence,manual";
export function listReports(projectId: number, opts: { fromDate?: string; toDate?: string; item?: string; limit?: number } = {}): ReportRow[] {
  const rows = db.prepare(
    `SELECT ${REPORT_COLS} FROM work_reports WHERE project_id=? AND report_date>=? AND report_date<=? ORDER BY report_date DESC, id DESC LIMIT ?`,
  ).all(projectId, opts.fromDate ?? "0000-00-00", opts.toDate ?? "9999-99-99", opts.limit ?? 100) as ReportRow[];
  return opts.item ? rows.filter((r) => norm(r.item).includes(norm(opts.item!))) : rows;
}
export function updateReport(id: number, f: Partial<Pick<ReportRow, "reportDate" | "item" | "unit" | "quantity" | "cumulative" | "location" | "note">>): boolean {
  const cur = db.prepare(`SELECT ${REPORT_COLS} FROM work_reports WHERE id=?`).get(id) as ReportRow | undefined;
  if (!cur) return false;
  const n = { ...cur, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) } as ReportRow;
  db.prepare("UPDATE work_reports SET report_date=?,item=?,unit=?,quantity=?,cumulative=?,location=?,note=?,confidence='high',manual=1 WHERE id=?")
    .run(n.reportDate, n.item, n.unit, n.quantity, n.cumulative, n.location, n.note, id);
  return true;
}
export function deleteReport(id: number): boolean {
  return Number(db.prepare("DELETE FROM work_reports WHERE id=?").run(id).changes) > 0;
}
/** Gộp hai tên hạng mục (do hiện trường gọi khác nhau) thành một. */
export function mergeItems(projectId: number, from: string, to: string): number {
  return Number(db.prepare("UPDATE work_reports SET item=? WHERE project_id=? AND item=?").run(to, projectId, from).changes);
}
export function setTarget(projectId: number, item: string, unit: string, target: number): void {
  db.prepare("INSERT INTO work_targets(project_id,item,unit,target) VALUES(?,?,?,?) ON CONFLICT(project_id,item,unit) DO UPDATE SET target=excluded.target").run(projectId, item, unit, target);
}
export function itemNames(projectId: number): string[] {
  return (db.prepare("SELECT DISTINCT item FROM work_reports WHERE project_id=? ORDER BY item").all(projectId) as { item: string }[]).map((r) => r.item);
}

export type ItemTotal = {
  item: string; unit: string; total: number; reports: number; firstDate: string; lastDate: string;
  lastCumulative: number | null; lastCumulativeDate: string | null; target: number | null; percent: number | null; percentCumulative: number | null; lowConfidence: number;
};
/** Cộng dồn khối lượng theo hạng mục (do code tính bằng SQL, không để LLM tự cộng). */
export function aggregate(projectId: number, opts: { fromDate?: string; toDate?: string } = {}): ItemTotal[] {
  const to = opts.toDate ?? "9999-99-99";
  const from = opts.fromDate ?? "0000-00-00";
  const rows = db.prepare(
    `SELECT item, unit, COALESCE(SUM(quantity),0) AS total, COUNT(*) AS reports, MIN(report_date) AS firstDate, MAX(report_date) AS lastDate,
            SUM(CASE WHEN confidence='low' THEN 1 ELSE 0 END) AS lowConfidence
     FROM work_reports WHERE project_id=? AND report_date<=? AND report_date>=? GROUP BY item, unit ORDER BY item`,
  ).all(projectId, to, from) as { item: string; unit: string; total: number; reports: number; firstDate: string; lastDate: string; lowConfidence: number }[];
  const cum = db.prepare("SELECT cumulative, report_date FROM work_reports WHERE project_id=? AND item=? AND unit=? AND cumulative IS NOT NULL AND report_date<=? ORDER BY report_date DESC, id DESC LIMIT 1");
  const tgt = db.prepare("SELECT target FROM work_targets WHERE project_id=? AND item=? AND unit=?");
  return rows.map((r) => {
    const c = cum.get(projectId, r.item, r.unit, to) as { cumulative: number; report_date: string } | undefined;
    const t = tgt.get(projectId, r.item, r.unit) as { target: number } | undefined;
    return {
      ...r, lastCumulative: c?.cumulative ?? null, lastCumulativeDate: c?.report_date ?? null,
      target: t?.target ?? null, percent: t ? Math.round((r.total / t.target) * 1000) / 10 : null,
      percentCumulative: t && c ? Math.round((c.cumulative / t.target) * 1000) / 10 : null,
    };
  });
}
export function lastReportDate(projectId: number): string | null {
  return (db.prepare("SELECT MAX(report_date) AS d FROM work_reports WHERE project_id=?").get(projectId) as { d: string | null }).d;
}
