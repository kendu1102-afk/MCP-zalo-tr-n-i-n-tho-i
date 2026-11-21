/**
 * Bot Zalo: giữ kết nối với tài khoản (chỉ MỘT listener cho mỗi tài khoản),
 * ghi log tin nhắn, tự trả lời tin nhắn riêng từ kiến thức đã nạp, và gửi tin trong hàng đợi (outbox) do MCP đặt.
 */
import { ThreadType } from "zca-js";
import { db, getJsonList, getSetting, getSettingRaw, getHeartbeat, logMessage, setHeartbeat, setSettingRaw } from "./db.js";
import { answerForOwner, answerFromKnowledge } from "./answer.js";
import { engine, engineReady } from "./llm.js";
import { checkClaudeCode } from "./claudecode.js";
import { extractPending } from "./extract.js";
import { firstRunPairCode, tryPairCommand } from "./pairing.js";
import { attachmentLabel, downloadPending, parseAttachment, queueMedia, syncToDrive } from "./media.js";
import { readPendingMedia } from "./mediaread.js";
import { buildDigest, digestDue } from "./digest.js";
import { vnDate } from "./projects.js";
import { isAdminCommand, runAdminCommand } from "./admin.js";
import { handleOwnerFile } from "./inbox.js";
import { friendGate, syncFriends } from "./friends.js";
import { canRequestDocs, deliverApproved, looksLikeDocRequest, ownerCommand, processQueue, submitRequest, type Transport } from "./docs.js";
import { autoAssignByName, upsertThread } from "./projects.js";
import { loginWithSession } from "./zalo.js";

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (engine() === "claude-code") {
  try { log("Dùng Claude Code (tài khoản Claude đã đăng nhập trên máy này):", await checkClaudeCode()); }
  catch { log('CẢNH BÁO: không chạy được lệnh "claude". Cài Claude Code rồi chạy `claude` một lần để đăng nhập tài khoản Claude của bạn. Hoặc đặt engine=api và ANTHROPIC_API_KEY.'); }
} else if (!process.env.ANTHROPIC_API_KEY) log("CẢNH BÁO: engine=api nhưng chưa có ANTHROPIC_API_KEY.");

// Khi chạy dưới systemd (tự khởi động lại), không được đăng nhập dồn dập: chờ trước khi thoát
const waitThenExit = (minutes: number, code: number): Promise<never> =>
  new Promise(() => { setSettingRaw("bot_problem", `${new Date().toISOString()} ${code === 3 ? "phiên Zalo không dùng được, cần `npm run login` lại" : "bị Zalo Web/PC ở nơi khác ngắt kết nối"}`); setTimeout(() => process.exit(code), minutes * 60_000); });

let api: Awaited<ReturnType<typeof loginWithSession>>;
try {
  api = await loginWithSession();
  setSettingRaw("bot_problem", "");
} catch (e) {
  log("ĐĂNG NHẬP ZALO THẤT BẠI:", e instanceof Error ? e.message : e);
  log("Phiên có thể đã hết hạn: chạy `npm run login` và quét QR lại. Bot chờ 30 phút rồi mới thử lại để tránh bị Zalo khoá.");
  await waitThenExit(30, 3);
  throw e;
}
const myUid = api.getContext().uid;
log("Đã đăng nhập Zalo, uid =", myUid);

// Tin do bot/Claude vừa gửi (để không nhầm là bạn tự nhắn tay khi nhận lại qua selfListen)
const recentSent = new Map<string, number>(); // key = threadId|text -> ts
const takeoverUntil = new Map<string, number>(); // threadId -> ts
const chains = new Map<string, Promise<void>>(); // xử lý tuần tự theo hội thoại

const sentKey = (t: string, text: string) => `${t}|${text}`;
function markSent(threadId: string, text: string) {
  recentSent.set(sentKey(threadId, text), Date.now());
  for (const [k, ts] of recentSent) if (Date.now() - ts > 120_000) recentSent.delete(k);
}
function wasSentByUs(threadId: string, text: string) {
  const ts = recentSent.get(sentKey(threadId, text));
  return ts !== undefined && Date.now() - ts < 120_000;
}

async function sendText(threadId: string, threadType: "user" | "group", text: string, direction: "out_bot" | "out_claude") {
  markSent(threadId, text);
  await api.sendMessage({ msg: text }, threadId, threadType === "user" ? ThreadType.User : ThreadType.Group);
  logMessage({ threadId, threadType, senderId: myUid, direction, text });
}

const isOwner = (uid: string) => getJsonList("owner_ids").includes(uid);

const PLACEHOLDER = "[tệp/ảnh/nội dung đặc biệt]";
const transport: Transport = {
  sendText: (uid, text) => sendText(uid, "user", text, "out_bot"),
  async sendFile(uid, filePath, caption) {
    markSent(uid, caption);
    markSent(uid, PLACEHOLDER); // bản sao tin file nhận lại qua selfListen không bị tính là bạn nhắn tay
    await api.sendMessage({ msg: caption, attachments: [filePath] }, uid, ThreadType.User);
    logMessage({ threadId: uid, threadType: "user", senderId: myUid, direction: "out_bot", text: `${caption}\n[kèm file ${filePath.split(/[\\/]/).pop()}]` });
  },
};

function canBotReply(threadId: string, owner = false): string | null {
  if (getSetting("bot_enabled") !== "true") return "bot đang tắt";
  if (getJsonList("blocklist").includes(threadId)) return "nằm trong blocklist";
  if (!owner) { const g = friendGate(threadId); if (g) return g; } // chủ đã ghép nối thì luôn được
  if (!owner && getSetting("reply_scope") === "allowlist" && !getJsonList("allowlist").includes(threadId)) return "không thuộc allowlist";
  if ((takeoverUntil.get(threadId) ?? 0) > Date.now()) return "bạn đang tự trả lời (tạm dừng)";
  const max = owner ? 60 : Number(getSetting("max_replies_per_hour"));
  const n = (db.prepare("SELECT COUNT(*) AS n FROM messages WHERE thread_id=? AND direction='out_bot' AND ts>?").get(threadId, Date.now() - 3_600_000) as { n: number }).n;
  if (n >= max) return `vượt giới hạn ${max} tin/giờ`;
  return null;
}

// ---- ghép nối tài khoản chủ: nhắn "/ketnoi 123456" từ nick chính của bạn ----
async function tryPair(threadId: string, uid: string, text: string): Promise<boolean> {
  const r = tryPairCommand(uid, text);
  if (r === "ignored") return false;
  if (r === "ok") {
    log(`đã ghép nối tài khoản chủ: ${uid}`);
    await sendText(threadId, "user", "✅ Đã kết nối. Từ giờ bạn có thể hỏi mình về tiến độ, khối lượng các công trình, ví dụ: \"khối lượng công trình X đến đâu rồi?\"\nTự trả lời đang BẬT (/tatbot để tắt). Gõ /huongdan để xem các lệnh quản lý bot ngay trên Zalo.", "out_bot");
  } else {
    log(`ghép nối thất bại từ ${uid}`);
  }
  return true;
}

// ---- hồ sơ: lệnh duyệt của chủ, và yêu cầu làm hồ sơ từ người được cấp quyền ----
let docWorker = false;
async function runDocWorker() {
  if (docWorker || !engineReady()) return;
  docWorker = true;
  try { await processQueue(transport); await deliverApproved(transport); }
  catch (e) { log("lỗi hàng đợi hồ sơ:", e); }
  finally { docWorker = false; }
}
async function handleDocFlow(uid: string, name: string, text: string): Promise<boolean> {
  const owner = isOwner(uid);
  if (owner && isAdminCommand(text)) { await sendText(uid, "user", runAdminCommand(uid, text), "out_bot"); return true; }
  if (owner && await ownerCommand(text, transport, (t) => sendText(uid, "user", t, "out_bot"))) return true;
  if (!canRequestDocs(uid) || !looksLikeDocRequest(text)) return false;
  const why = canBotReply(uid, owner);
  if (why) { log(`bỏ qua yêu cầu hồ sơ [${uid}] vì ${why}`); return true; }
  const job = await submitRequest(uid, name, text, transport);
  if (job) { log(`nhận yêu cầu hồ sơ #${job.id} từ ${name}`); void runDocWorker(); }
  return true;
}
setInterval(() => void runDocWorker(), 5000); // cũng gửi các hồ sơ được duyệt từ Claude Code (doc_approve)

async function handleIncomingDm(threadId: string, name: string, text: string) {
  const owner = isOwner(threadId); // với DM, threadId chính là uid người gửi
  const why = canBotReply(threadId, owner);
  if (why) return log(`bỏ qua tự trả lời [${threadId}] vì ${why}`);
  await sleep(2000 + Math.random() * 3000); // trễ tự nhiên, giảm nguy cơ bị Zalo đánh dấu
  if (canBotReply(threadId, owner)) return; // trạng thái có thể đổi trong lúc chờ (ví dụ bạn vừa nhắn tay)
  let reply: string | null;
  try {
    reply = owner ? await answerForOwner(threadId, text) : await answerFromKnowledge(threadId, text);
  } catch (e) {
    return log("Lỗi khi gọi Claude:", e instanceof Error ? e.message : e);
  }
  if (reply === null) {
    db.prepare("INSERT INTO unanswered(ts,thread_id,sender_name,question) VALUES(?,?,?,?)").run(Date.now(), threadId, name, text);
    log(`không có căn cứ trong kiến thức -> ghi vào 'unanswered' [${threadId}]`);
    const fb = getSetting("fallback_reply");
    if (fb) await sendText(threadId, "user", fb, "out_bot");
    return;
  }
  const prefix = getSetting("disclose_bot") === "true" ? getSetting("disclose_prefix") : "";
  await sendText(threadId, "user", prefix + reply, "out_bot");
  log(`đã trả lời [${threadId}]`);
}

// Tên nhóm: lấy một lần cho mỗi nhóm; nếu tên chứa đúng một công trình đã khai báo thì tự ghép
const groupNameTried = new Set<string>();
async function ensureGroupName(threadId: string) {
  upsertThread(threadId, "group");
  if (groupNameTried.has(threadId)) return;
  groupNameTried.add(threadId);
  try {
    const info = await api.getGroupInfo(threadId);
    const name = info.gridInfoMap?.[threadId]?.name ?? "";
    if (name) {
      upsertThread(threadId, "group", name);
      const p = autoAssignByName(threadId, name);
      log(`nhóm "${name}" (${threadId})${p ? ` -> tự ghép công trình "${p.name}"` : " (chưa ghép công trình)"}`);
    }
  } catch (e) {
    groupNameTried.delete(threadId); // thử lại lần sau
    log("không lấy được tên nhóm:", e instanceof Error ? e.message : e);
  }
}

api.listener.on("message", (m) => {
  const text = typeof m.data.content === "string" ? m.data.content : null;
  const type = m.type === ThreadType.User ? "user" : "group";
  const att = text === null ? parseAttachment(m.data.msgType, m.data.content) : null;
  // tin của chính bot/Claude gửi file được nhận lại dạng PLACEHOLDER (xem transport.sendFile)
  const shown = text ?? (att && !m.isSelf ? attachmentLabel(att) : PLACEHOLDER);

  if (m.isSelf) {
    if (wasSentByUs(m.threadId, shown)) return; // bản sao của tin chính bot/Claude vừa gửi
    logMessage({ ts: Number(m.data.ts) || undefined, threadId: m.threadId, threadType: type, senderId: myUid, direction: "out_manual", text: shown });
    if (type === "user") {
      const mins = Number(getSetting("human_takeover_minutes"));
      takeoverUntil.set(m.threadId, Date.now() + mins * 60_000);
    }
    return;
  }

  const name = m.data.dName || m.data.uidFrom;
  if (type === "group") void ensureGroupName(m.threadId); else upsertThread(m.threadId, "user", name);
  if (!logMessage({ ts: Number(m.data.ts) || undefined, threadId: m.threadId, threadType: type, senderId: m.data.uidFrom, senderName: name, direction: "in", text: shown, msgId: m.data.msgId ? String(m.data.msgId) : undefined })) return; // tin trùng
  if (type === "group" && att && queueMedia({ msgId: String(m.data.msgId), threadId: m.threadId, ts: Number(m.data.ts) || Date.now(), sender: name, msgType: m.data.msgType, content: m.data.content })) void runDownloads();
  // Chủ gửi tệp cho bot: nạp mẫu hồ sơ hoặc tài liệu vào bộ nhớ
  if (type === "user" && att?.kind === "file" && isOwner(m.threadId)) {
    const prevF = chains.get(m.threadId) ?? Promise.resolve();
    chains.set(m.threadId, prevF.then(async () => {
      const reply = await handleOwnerFile({ url: att.url, name: att.caption || `tep.${att.ext}` });
      await sendText(m.threadId, "user", reply, "out_bot");
    }).catch((e) => log("lỗi nạp tệp:", e)));
    return;
  }
  if (type !== "user" || text === null || !text.trim()) return; // bot chỉ trả lời tin nhắn riêng dạng chữ

  const prev = chains.get(m.threadId) ?? Promise.resolve();
  chains.set(m.threadId, prev.then(async () => {
    if (await tryPair(m.threadId, m.threadId, text)) return;
    if (await handleDocFlow(m.threadId, name, text)) return;
    await handleIncomingDm(m.threadId, name, text);
  }).catch((e) => log("lỗi xử lý:", e)));
});

api.listener.on("connected", () => log("Listener đã kết nối."));
api.listener.on("error", (e) => log("Listener lỗi:", e));
api.listener.on("closed", (code, reason) => {
  log("Listener đóng:", code, reason);
  if (code === 3000 || code === 3003) {
    log("Nick bot đang được mở ở Zalo Web/PC nơi khác nên bị ngắt. Đừng mở nick bot trên Zalo Web/PC (điện thoại thì được). Thử lại sau 10 phút.");
    void waitThenExit(10, 2);
  }
});
api.listener.start({ retryOnClose: true });

// Hàng đợi tin nhắn do Claude Code (MCP) đặt
setInterval(async () => {
  setHeartbeat();
  const rows = db.prepare("SELECT id,thread_id,thread_type,text FROM outbox WHERE status='pending' ORDER BY id LIMIT 5").all() as
    { id: number; thread_id: string; thread_type: "user" | "group"; text: string }[];
  for (const r of rows) {
    try {
      await sendText(r.thread_id, r.thread_type, r.text, "out_claude");
      db.prepare("UPDATE outbox SET status='sent' WHERE id=?").run(r.id);
      log(`đã gửi outbox #${r.id}`);
    } catch (e) {
      db.prepare("UPDATE outbox SET status='failed', error=? WHERE id=?").run(String(e), r.id);
      log(`gửi outbox #${r.id} thất bại:`, e);
    }
    await sleep(1500);
  }
}, 3000);
// Danh sách bạn bè: đồng bộ lúc khởi động, mỗi 10 phút, và ngay khi có thay đổi (kết bạn/huỷ kết bạn/chặn)
let syncing = false;
async function refreshFriends(why: string) {
  if (syncing) return;
  syncing = true;
  try { log(`đã đồng bộ ${await syncFriends(api)} bạn bè (${why})`); }
  catch (e) { log("không đồng bộ được danh sách bạn bè:", e instanceof Error ? e.message : e); }
  finally { syncing = false; }
}
void refreshFriends("khởi động");
setInterval(() => void refreshFriends("định kỳ"), 10 * 60_000);
let friendEventTimer: NodeJS.Timeout | undefined;
api.listener.on("friend_event", () => { clearTimeout(friendEventTimer); friendEventTimer = setTimeout(() => void refreshFriends("có thay đổi bạn bè"), 3000); });

// Trích xuất báo cáo từ các nhóm hiện trường (mỗi 60 giây; hoặc ngay khi Claude Code yêu cầu extract_now)
let extracting = false;
async function runExtraction(force: boolean) {
  if (extracting) return;
  extracting = true;
  try {
    if (!engineReady()) return;
    await extractPending({ force });
  } catch (e) {
    log("lỗi trích xuất:", e);
  } finally {
    extracting = false;
  }
}
setInterval(() => void runExtraction(false), 60_000);
setInterval(() => {
  if (getSettingRaw("extract_request") === "1") {
    setSettingRaw("extract_request", "0");
    void runExtraction(true);
  }
}, 3000);
// Ảnh/video/tệp hiện trường: tải ngay, chuyển lên Google Drive mỗi 10 phút (hoặc khi Claude Code yêu cầu drive_sync_now)
let downloading = false;
async function runDownloads() {
  if (downloading) return;
  downloading = true;
  try { while ((await downloadPending(10)) > 0) { /* tải tiếp */ } }
  catch (e) { log("lỗi tải tệp:", e); }
  finally { downloading = false; }
}
setInterval(() => void runDownloads(), 10_000);

// Claude đọc nội dung ảnh/tệp (bảng khối lượng chụp, Excel, PDF...) -> đưa vào trích xuất
let reading = false;
async function runReads() {
  if (reading || !engineReady() || getSetting("media_read") === "off") return;
  reading = true;
  try { for (let i = 0; i < 5 && (await readPendingMedia()) > 0; i++) { /* đọc tiếp */ } }
  catch (e) { log("lỗi đọc ảnh/tệp:", e); }
  finally { reading = false; }
}
setInterval(() => void runReads(), 20_000);

// Bản tổng hợp cuối ngày gửi chủ tài khoản
let digesting = false;
setInterval(async () => {
  if (digesting || !digestDue(getSetting("daily_digest_time"), getSettingRaw("digest_last_date"))) return;
  const owners = getJsonList("owner_ids");
  if (!owners.length) return;
  digesting = true;
  try {
    await runReads();
    if (engineReady()) await extractPending({ force: true }).catch(() => {});
    const textDigest = buildDigest();
    for (const o of owners) await sendText(o, "user", textDigest, "out_bot");
    setSettingRaw("digest_last_date", vnDate(Date.now()));
    log("đã gửi bản tổng hợp ngày cho chủ tài khoản");
  } catch (e) { log("lỗi gửi bản tổng hợp:", e); }
  finally { digesting = false; }
}, 60_000);
setInterval(() => void syncToDrive(), 10 * 60_000);
setInterval(() => {
  if (getSettingRaw("drive_sync_request") === "1") { setSettingRaw("drive_sync_request", "0"); void runDownloads().then(() => syncToDrive()); }
}, 3000);

{
  const code = firstRunPairCode();
  if (code) log(`CHƯA CÓ TÀI KHOẢN CHỦ. Từ Zalo chính của bạn nhắn cho nick bot:  /ketnoi ${code}  (mã hiệu lực 24 giờ)`);
}
setHeartbeat();
log("Bot sẵn sàng. bot_enabled =", getSetting("bot_enabled"), "(heartbeat trước đó:", getHeartbeat(), ")");
