/**
 * Yêu cầu làm hồ sơ: người được cấp quyền (đã là bạn bè) nhắn "làm báo cáo tuần Cầu ABC" -> bot soạn theo mẫu công ty
 * -> (mặc định) gửi CHỦ duyệt -> gửi file cho người yêu cầu.
 */
import { db, getJsonList, getSetting } from "./db.js";
import { generateDocument, type AgentCtx } from "./docagent.js";
import { isFriend } from "./friends.js";
import * as P from "./projects.js";
import { renderTemplate } from "./templates.js";
import { vnDate } from "./projects.js";

export type Transport = {
  sendText(uid: string, text: string): Promise<void>;
  sendFile(uid: string, filePath: string, caption: string): Promise<void>;
};
export type Job = {
  id: number; requesterUid: string; requesterName: string; requestText: string; status: string;
  templateId: string; filePath: string; summary: string; error: string; createdAt: number; updatedAt: number;
};
export type Requester = { uid: string; name: string; projects: string[]; kbPrivate: boolean };

const log = (...a: unknown[]) => console.log(new Date().toISOString(), "[hồ sơ]", ...a);
const DRAFT_NOTE = "⚠️ DỰ THẢO do trợ lý soạn tự động từ số liệu hiện trường CHƯA nghiệm thu. Cần soát lại trước khi ký/gửi đi.";

// ---------- người được phép yêu cầu ----------
type RRow = { uid: string; name: string; projects: string; kb_private: number };
const toReq = (r: RRow): Requester => ({ uid: r.uid, name: r.name, projects: (() => { try { return JSON.parse(r.projects) as string[]; } catch { return []; } })(), kbPrivate: !!r.kb_private });

export function addRequester(uid: string, projects: string[], kbPrivate = false): Requester {
  if (!isFriend(uid)) throw new Error("Người này chưa là bạn bè của nick bot (hoặc danh sách bạn bè chưa đồng bộ).");
  if (!projects.length) throw new Error('Phải nêu công trình được phép, hoặc ["*"] cho tất cả.');
  if (!projects.includes("*")) for (const n of projects) if (!P.resolveProject(n)) throw new Error(`Không tìm thấy công trình "${n}".`);
  const names = projects.includes("*") ? ["*"] : projects.map((n) => P.resolveProject(n)!.name);
  const name = (db.prepare("SELECT name FROM friends WHERE uid=?").get(uid) as { name: string } | undefined)?.name ?? "";
  db.prepare(
    `INSERT INTO requesters(uid,name,projects,kb_private,created_at) VALUES(?,?,?,?,?)
     ON CONFLICT(uid) DO UPDATE SET name=excluded.name, projects=excluded.projects, kb_private=excluded.kb_private`,
  ).run(uid, name, JSON.stringify(names), kbPrivate ? 1 : 0, Date.now());
  return { uid, name, projects: names, kbPrivate };
}
export const removeRequester = (uid: string) => Number(db.prepare("DELETE FROM requesters WHERE uid=?").run(uid).changes) > 0;
export const listRequesters = (): Requester[] => (db.prepare("SELECT uid,name,projects,kb_private FROM requesters ORDER BY name").all() as RRow[]).map(toReq);
export const getRequester = (uid: string): Requester | null => {
  const r = db.prepare("SELECT uid,name,projects,kb_private FROM requesters WHERE uid=?").get(uid) as RRow | undefined;
  return r ? toReq(r) : null;
};
export const isOwnerUid = (uid: string) => getJsonList("owner_ids").includes(uid);
export const canRequestDocs = (uid: string) => isOwnerUid(uid) || !!getRequester(uid);

/** Tìm bạn bè theo tên (một phần, không phân biệt dấu) để chọn người trong danh sách bạn bè. */
export function findFriends(query: string): { uid: string; name: string }[] {
  const q = P.norm(query);
  return (db.prepare("SELECT uid,name FROM friends").all() as { uid: string; name: string }[]).filter((f) => f.uid === query || (q && P.norm(f.name).includes(q)));
}

// ---------- nhận dạng yêu cầu làm hồ sơ ----------
// Ranh giới từ theo chữ Unicode (\b của JS không hiểu chữ có dấu như "ơ", "ư")
const words = (alts: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts})(?![\\p{L}\\p{N}])`, "iu");
const DOC_WORD = words("báo cáo|bao cao|tờ trình|to trinh|công văn|cong van|biên bản|bien ban|văn bản|van ban|hồ sơ|ho so|đề xuất|de xuat");
const VERB = words("làm|lam|soạn|soan|lập|lap|viết|viet|tạo|tao|xuất|xuat|gửi|gui|chuẩn bị|chuan bi|cần|can|nhờ|nho|xin");
const QUESTION = /(đến đâu|den dau|bao nhiêu|bao nhieu|chưa\?|chưa vậy|đã.*chưa)/i;
/** Heuristic: có động từ yêu cầu + loại văn bản, và không giống câu hỏi tiến độ. Người yêu cầu luôn nhận xác nhận nên nhận nhầm là thấy ngay. */
export const looksLikeDocRequest = (t: string) => DOC_WORD.test(t) && VERB.test(t) && !QUESTION.test(t);

// ---------- hàng đợi ----------
type JRow = { id: number; requester_uid: string; requester_name: string; request_text: string; status: string; template_id: string; file_path: string; summary: string; error: string; created_at: number; updated_at: number };
const toJob = (r: JRow): Job => ({ id: r.id, requesterUid: r.requester_uid, requesterName: r.requester_name, requestText: r.request_text, status: r.status, templateId: r.template_id, filePath: r.file_path, summary: r.summary, error: r.error, createdAt: r.created_at, updatedAt: r.updated_at });
export const getJob = (id: number): Job | null => { const r = db.prepare("SELECT * FROM doc_jobs WHERE id=?").get(id) as JRow | undefined; return r ? toJob(r) : null; };
export const listJobs = (status?: string, limit = 30): Job[] =>
  (db.prepare(`SELECT * FROM doc_jobs ${status ? "WHERE status=?" : ""} ORDER BY id DESC LIMIT ?`).all(...(status ? [status, limit] : [limit])) as JRow[]).map(toJob);
function patchJob(id: number, f: Partial<{ status: string; template_id: string; file_path: string; summary: string; error: string }>) {
  const cur = db.prepare("SELECT * FROM doc_jobs WHERE id=?").get(id) as JRow;
  const n = { ...cur, ...f };
  db.prepare("UPDATE doc_jobs SET status=?,template_id=?,file_path=?,summary=?,error=?,updated_at=? WHERE id=?").run(n.status, n.template_id, n.file_path, n.summary, n.error, Date.now(), id);
}
const requestsLast24h = (uid: string) => (db.prepare("SELECT COUNT(*) AS n FROM doc_jobs WHERE requester_uid=? AND created_at>?").get(uid, Date.now() - 86_400_000) as { n: number }).n;

/** Nhận yêu cầu (gọi từ bot khi nhận DM). Trả lời xác nhận hoặc từ chối cho người yêu cầu; không gọi LLM ở bước này. */
export async function submitRequest(uid: string, name: string, text: string, tp: Transport): Promise<Job | null> {
  const owner = isOwnerUid(uid);
  if (!owner && requestsLast24h(uid) >= Number(getSetting("doc_max_per_day"))) {
    await tp.sendText(uid, `Bạn đã đạt giới hạn ${getSetting("doc_max_per_day")} yêu cầu hồ sơ trong 24 giờ. Vui lòng thử lại sau.`);
    return null;
  }
  const r = db.prepare("INSERT INTO doc_jobs(requester_uid,requester_name,request_text,created_at,updated_at) VALUES(?,?,?,?,?)").run(uid, name, text.slice(0, 2000), Date.now(), Date.now());
  const id = Number(r.lastInsertRowid);
  const review = !owner && getSetting("doc_delivery") !== "auto";
  await tp.sendText(uid, `Mình đã nhận yêu cầu làm hồ sơ (mã #${id}). Đang soạn theo mẫu của công ty${review ? ", sẽ được chủ tài khoản duyệt rồi gửi lại cho bạn" : ", xong sẽ gửi lại cho bạn"}.`);
  return getJob(id);
}

function ctxFor(uid: string, name: string): AgentCtx | null {
  if (isOwnerUid(uid)) return { requesterName: name || "chủ tài khoản", isOwner: true, projects: P.listProjects(), kbPrivate: true };
  const rq = getRequester(uid);
  if (!rq) return null;
  const all = P.listProjects();
  const projects = rq.projects.includes("*") ? all : all.filter((p) => rq.projects.includes(p.name));
  return { requesterName: name || rq.name, isOwner: false, projects, kbPrivate: rq.kbPrivate };
}

/** Xử lý lần lượt các yêu cầu đang chờ. */
export async function processQueue(tp: Transport): Promise<void> {
  for (;;) {
    const row = db.prepare("SELECT id FROM doc_jobs WHERE status='queued' ORDER BY id LIMIT 1").get() as { id: number } | undefined;
    if (!row) return;
    await processJob(row.id, tp);
  }
}

async function processJob(id: number, tp: Transport): Promise<void> {
  const job = getJob(id)!;
  patchJob(id, { status: "working" });
  const fail = async (why: string, detail: string) => {
    patchJob(id, { status: "failed", error: detail });
    log(`#${id} thất bại: ${detail}`);
    await tp.sendText(job.requesterUid, `Xin lỗi, mình chưa soạn được hồ sơ #${id}. ${why}`);
    if (!isOwnerUid(job.requesterUid)) for (const o of getJsonList("owner_ids")) await tp.sendText(o, `Hồ sơ #${id} của ${job.requesterName} thất bại: ${detail}`).catch(() => {});
  };
  try {
    const ctx = ctxFor(job.requesterUid, job.requesterName);
    if (!ctx) return fail("Bạn chưa được cấp quyền yêu cầu hồ sơ.", "người yêu cầu không còn trong danh sách được phép");
    const res = await generateDocument(job.requestText, ctx);
    if (res.kind === "clarify") {
      patchJob(id, { status: "needs_info", summary: res.question });
      return await tp.sendText(job.requesterUid, `Về yêu cầu #${id}: ${res.question}\n(Bạn nhắn lại yêu cầu đầy đủ hơn để mình soạn tiếp.)`);
    }
    const proj = res.projectNames[0] ?? "chung";
    const file = renderTemplate(res.templateId, res.fields, `${res.templateId}-${proj}-${vnDate(Date.now())}-job${id}`);
    const lastDates = res.projectNames.map((n) => { const p = P.resolveProject(n); return p ? `${p.name}: báo cáo hiện trường mới nhất ${P.lastReportDate(p.id) ?? "chưa có"}` : ""; }).filter(Boolean);
    const summary = [
      `Mẫu: ${res.templateId}.`,
      lastDates.length ? `Số liệu ${lastDates.join("; ")}.` : "",
      res.missing.length ? `CHƯA CÓ DỮ LIỆU cho: ${res.missing.join("; ")}.` : "",
      res.notes ? `Ghi chú: ${res.notes}` : "",
    ].filter(Boolean).join(" ");
    patchJob(id, { template_id: res.templateId, file_path: file, summary });

    const owner = isOwnerUid(job.requesterUid);
    if (owner) {
      patchJob(id, { status: "sent" });
      return await tp.sendFile(job.requesterUid, file, `Hồ sơ #${id}: ${summary}\n${DRAFT_NOTE}`);
    }
    if (getSetting("doc_delivery") === "auto") {
      patchJob(id, { status: "sent" });
      await tp.sendFile(job.requesterUid, file, `Hồ sơ #${id}: ${summary}\n${DRAFT_NOTE}`);
      for (const o of getJsonList("owner_ids")) await tp.sendText(o, `Đã tự động gửi hồ sơ #${id} cho ${job.requesterName} (yêu cầu: "${job.requestText.slice(0, 120)}"). ${summary}`).catch(() => {});
      return;
    }
    patchJob(id, { status: "awaiting_approval" });
    const owners = getJsonList("owner_ids");
    if (!owners.length) log(`#${id} chờ duyệt nhưng chưa có tài khoản chủ ghép nối; duyệt bằng công cụ doc_approve`);
    for (const o of owners) await tp.sendFile(o, file, `Yêu cầu hồ sơ #${id} từ ${job.requesterName}: "${job.requestText.slice(0, 200)}"\n${summary}\nTrả lời "duyệt ${id}" để gửi cho ${job.requesterName}, hoặc "hủy ${id} <lý do>".`).catch((e) => log("không gửi được file cho chủ:", e));
    await tp.sendText(job.requesterUid, `Hồ sơ #${id} đã soạn xong, đang chờ chủ tài khoản duyệt. Sau khi duyệt mình sẽ gửi ngay.`);
  } catch (e) {
    await fail("Có lỗi khi soạn. Vui lòng thử lại sau.", e instanceof Error ? e.message : String(e));
  }
}

// ---------- duyệt / từ chối / gửi ----------
export function approveJob(id: number): Job {
  const j = getJob(id);
  if (!j) throw new Error(`Không có hồ sơ #${id}.`);
  if (j.status !== "awaiting_approval") throw new Error(`Hồ sơ #${id} đang ở trạng thái "${j.status}", không thể duyệt.`);
  patchJob(id, { status: "approved" });
  return getJob(id)!;
}
export async function rejectJob(id: number, reason: string, tp: Transport): Promise<Job> {
  const j = getJob(id);
  if (!j) throw new Error(`Không có hồ sơ #${id}.`);
  if (!["awaiting_approval", "approved", "needs_info"].includes(j.status)) throw new Error(`Hồ sơ #${id} đang ở trạng thái "${j.status}", không thể hủy.`);
  patchJob(id, { status: "rejected", error: reason });
  await tp.sendText(j.requesterUid, `Hồ sơ #${id} chưa được duyệt${reason ? `: ${reason}` : ""}. Bạn có thể liên hệ trực tiếp để trao đổi thêm.`).catch(() => {});
  return getJob(id)!;
}
/** Gửi các hồ sơ đã duyệt cho người yêu cầu. */
export async function deliverApproved(tp: Transport): Promise<void> {
  for (const j of listJobs("approved", 20).reverse()) {
    try {
      await tp.sendFile(j.requesterUid, j.filePath, `Hồ sơ #${j.id}: ${j.summary}\n${DRAFT_NOTE}`);
      patchJob(j.id, { status: "sent" });
      log(`đã gửi hồ sơ #${j.id} cho ${j.requesterName}`);
    } catch (e) {
      patchJob(j.id, { error: String(e) }); // giữ 'approved' để thử lại ở vòng sau
      log(`gửi hồ sơ #${j.id} lỗi, sẽ thử lại:`, e instanceof Error ? e.message : e);
    }
  }
}

/** Lệnh của chủ qua Zalo: "duyệt 12" / "hủy 12 lý do". Trả về true nếu là lệnh. */
export async function ownerCommand(text: string, tp: Transport, reply: (t: string) => Promise<void>): Promise<boolean> {
  const a = /^(?:duyệt|duyet)\s+#?(\d+)\s*$/i.exec(text.trim());
  const r = /^(?:hủy|huy|từ chối|tu choi)\s+#?(\d+)\s*(.*)$/i.exec(text.trim());
  if (!a && !r) return false;
  try {
    if (a) { approveJob(Number(a[1])); await reply(`Đã duyệt hồ sơ #${a[1]}, đang gửi.`); await deliverApproved(tp); }
    else { const j = await rejectJob(Number(r![1]), r![2].trim(), tp); await reply(`Đã hủy hồ sơ #${j.id} và báo cho ${j.requesterName}.`); }
  } catch (e) { await reply(e instanceof Error ? e.message : String(e)); }
  return true;
}
