/**
 * Lấy TOÀN BỘ lịch sử của các nhóm Zalo (mặc định: các nhóm được ghim đầu danh sách) từ máy chủ Zalo,
 * lưu vào CSDL (để tổng hợp/hỏi đáp), bộ nhớ kiến thức (riêng tư), bản chép toàn văn (lên Drive), và tải ảnh/tệp.
 */
import fs from "node:fs";
import path from "node:path";
import { DRIVE_OUT_DIR } from "./config.js";
import { db, logMessage } from "./db.js";
import { addDoc, deleteDoc, listDocs } from "./knowledge.js";
import { attachmentLabel, parseAttachment, queueMedia, safeName } from "./media.js";
import { autoAssignByName, upsertThread, vnDate } from "./projects.js";

type Msg = { data: { msgId?: string | number; ts?: string | number; uidFrom?: string; dName?: string; content?: unknown; msgType?: string }; isSelf?: boolean };
type Page = { groupMsgs: Msg[]; lastMsgId?: string; hasMore?: number; isOld?: number; isFiltered?: number };
export type HistoryApi = {
  getPinConversations(): Promise<{ conversations: string[] }>;
  getGroupInfo(id: string): Promise<{ gridInfoMap?: Record<string, { name?: string; currentMems?: { id: string; dName?: string; zaloName?: string }[] }> }>;
  getCloudMessage(groupId: string, lastMsgId?: string, options?: { isOld?: boolean | number }): Promise<Page>;
};
export type ImportResult = { groupId: string; name: string; fetched: number; added: number; media: number; first: number | null; last: number | null; transcript: string; pages: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Các nhóm được ghim, theo thứ tự ghim (bỏ hội thoại 1-1). */
export async function pinnedGroups(api: HistoryApi, n = 3): Promise<string[]> {
  const { conversations } = await api.getPinConversations();
  return conversations.filter((c) => c.startsWith("g")).map((c) => c.slice(1)).slice(0, n);
}

export async function importGroupHistory(api: HistoryApi, groupId: string, opts: { since?: number; maxPages?: number; delayMs?: number; onPage?: (n: number, total: number) => void } = {}): Promise<ImportResult> {
  const info = (await api.getGroupInfo(groupId)).gridInfoMap?.[groupId];
  const name = info?.name || groupId;
  const names = new Map((info?.currentMems ?? []).map((m) => [m.id, m.dName || m.zaloName || m.id]));
  upsertThread(groupId, "group", name);
  autoAssignByName(groupId, name);

  let fetched = 0, added = 0, media = 0, pages = 0;
  let page = await api.getCloudMessage(groupId);
  for (;;) {
    pages++;
    let reachedSince = false;
    for (const m of page.groupMsgs) {
      fetched++;
      const ts = Number(m.data.ts) || 0;
      if (opts.since && ts < opts.since) { reachedSince = true; continue; }
      const text = typeof m.data.content === "string" ? m.data.content : null;
      const att = text === null ? parseAttachment(String(m.data.msgType ?? ""), m.data.content) : null;
      const shown = text ?? (att ? attachmentLabel(att) : "[nội dung đặc biệt]");
      const sender = m.data.dName || names.get(String(m.data.uidFrom)) || String(m.data.uidFrom ?? "?");
      const isNew = logMessage({
        ts, threadId: groupId, threadType: "group", senderId: String(m.data.uidFrom ?? ""), senderName: m.isSelf ? "(nick bot)" : sender,
        direction: m.isSelf ? "out_manual" : "in", text: shown, msgId: m.data.msgId !== undefined ? String(m.data.msgId) : undefined,
      });
      if (isNew) added++;
      if (isNew && att && !m.isSelf && queueMedia({ msgId: String(m.data.msgId), threadId: groupId, ts, sender, msgType: String(m.data.msgType), content: m.data.content })) media++;
    }
    opts.onPage?.(pages, fetched);
    if (reachedSince || !page.hasMore || pages >= (opts.maxPages ?? 5000)) break;
    await sleep(opts.delayMs ?? 1200); // nhẹ nhàng với máy chủ Zalo
    const next = await api.getCloudMessage(groupId, page.lastMsgId, { isOld: page.isOld });
    if (!next.groupMsgs.length && (next.isFiltered || next.lastMsgId === page.lastMsgId)) break;
    if (next.lastMsgId && next.lastMsgId === page.lastMsgId) break;
    page = next;
  }

  const span = db.prepare("SELECT MIN(ts) AS a, MAX(ts) AS b FROM messages WHERE thread_id=?").get(groupId) as { a: number | null; b: number | null };
  const transcript = writeTranscript(groupId, name);
  saveToKnowledge(groupId, name);
  return { groupId, name, fetched, added, media, first: span.a, last: span.b, transcript, pages };
}

const fmtTime = (ts: number) => new Date(ts).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false });
const rowsOf = (groupId: string) => db.prepare("SELECT ts,sender_name,text FROM messages WHERE thread_id=? ORDER BY ts, id").all(groupId) as { ts: number; sender_name: string; text: string }[];

/** Bản chép toàn văn (ghi đè mỗi lần lấy lại), đặt trong thư mục chờ để lên Drive. */
function writeTranscript(groupId: string, name: string): string {
  const rows = rowsOf(groupId);
  const dir = path.join(DRIVE_OUT_DIR, "_Lich su nhom", safeName(name));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `Lich su ${safeName(name, 60)}.txt`);
  const out = [`LỊCH SỬ NHÓM ZALO: ${name}`, `Mã nhóm: ${groupId} | Số tin: ${rows.length}${rows.length ? ` | Từ ${fmtTime(rows[0].ts)} đến ${fmtTime(rows[rows.length - 1].ts)}` : ""}`, `Xuất lúc: ${fmtTime(Date.now())}`, ""];
  let day = "";
  for (const r of rows) {
    const d = vnDate(r.ts);
    if (d !== day) { out.push(`\n===== ${d.split("-").reverse().join("/")} =====`); day = d; }
    out.push(`[${new Date(r.ts).toLocaleTimeString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false })}] ${r.sender_name}: ${r.text}`);
  }
  fs.writeFileSync(file, out.join("\n") + "\n");
  return file;
}

/** Đưa lịch sử vào bộ nhớ kiến thức (riêng tư), mỗi tháng một tài liệu; lấy lại thì thay bản cũ. */
function saveToKnowledge(groupId: string, name: string): number {
  const source = `zalo-history:${groupId}`;
  for (const d of listDocs()) if (d.source === source) deleteDoc(d.id);
  const byMonth = new Map<string, string[]>();
  for (const r of rowsOf(groupId)) {
    const month = vnDate(r.ts).slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month)!.push(`[${fmtTime(r.ts)}] ${r.sender_name}: ${r.text}`);
  }
  for (const [month, lines] of byMonth) {
    const [y, mo] = month.split("-");
    addDoc({ title: `Lịch sử nhóm "${name}" tháng ${mo}/${y}`, text: lines.join("\n\n"), source, botVisible: false });
  }
  return byMonth.size;
}
