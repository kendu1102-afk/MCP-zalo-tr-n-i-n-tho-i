/**
 * Bot Zalo: giữ kết nối với tài khoản (chỉ MỘT listener cho mỗi tài khoản),
 * ghi log tin nhắn, tự trả lời tin nhắn riêng từ kiến thức đã nạp, và gửi tin trong hàng đợi (outbox) do MCP đặt.
 */
import { ThreadType } from "zca-js";
import { db, getJsonList, getSetting, getSettingRaw, getHeartbeat, logMessage, setHeartbeat, setSettingRaw } from "./db.js";
import { answerForOwner, answerFromKnowledge } from "./answer.js";
import { extractPending } from "./extract.js";
import { tryPairCommand } from "./pairing.js";
import { autoAssignByName, upsertThread } from "./projects.js";
import { loginWithSession } from "./zalo.js";

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (!process.env.ANTHROPIC_API_KEY) log("CẢNH BÁO: chưa có ANTHROPIC_API_KEY, bot sẽ không tự trả lời được.");

const api = await loginWithSession();
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

function canBotReply(threadId: string, owner = false): string | null {
  if (getSetting("bot_enabled") !== "true") return "bot đang tắt";
  if (getJsonList("blocklist").includes(threadId)) return "nằm trong blocklist";
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
    await sendText(threadId, "user", "✅ Đã kết nối. Từ giờ bạn có thể hỏi mình về tiến độ, khối lượng các công trình, ví dụ: \"khối lượng công trình X đến đâu rồi?\"", "out_bot");
  } else {
    log(`ghép nối thất bại từ ${uid}`);
  }
  return true;
}

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
  const shown = text ?? "[tệp/ảnh/nội dung đặc biệt]";

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
  logMessage({ ts: Number(m.data.ts) || undefined, threadId: m.threadId, threadType: type, senderId: m.data.uidFrom, senderName: name, direction: "in", text: shown });
  if (type !== "user" || text === null || !text.trim()) return; // bot chỉ trả lời tin nhắn riêng dạng chữ

  const prev = chains.get(m.threadId) ?? Promise.resolve();
  chains.set(m.threadId, prev.then(async () => {
    if (await tryPair(m.threadId, m.threadId, text)) return;
    await handleIncomingDm(m.threadId, name, text);
  }).catch((e) => log("lỗi xử lý:", e)));
});

api.listener.on("connected", () => log("Listener đã kết nối."));
api.listener.on("error", (e) => log("Listener lỗi:", e));
api.listener.on("closed", (code, reason) => {
  log("Listener đóng:", code, reason);
  if (code === 3000 || code === 3003) {
    log("Zalo đang được mở ở nơi khác (Zalo Web/PC) nên đã ngắt listener. Thoát để bạn chủ động chạy lại.");
    process.exit(2);
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
// Trích xuất báo cáo từ các nhóm hiện trường (mỗi 60 giây; hoặc ngay khi Claude Code yêu cầu extract_now)
let extracting = false;
async function runExtraction(force: boolean) {
  if (extracting) return;
  extracting = true;
  try {
    if (!process.env.ANTHROPIC_API_KEY) return;
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
setHeartbeat();
log("Bot sẵn sàng. bot_enabled =", getSetting("bot_enabled"), "(heartbeat trước đó:", getHeartbeat(), ")");
