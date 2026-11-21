/**
 * Lệnh quản trị qua Zalo cho CHỦ tài khoản (đã /ketnoi): quản lý bot ngay trên điện thoại, không cần máy tính.
 * Mỗi lệnh trả về chuỗi trả lời. Danh sách đánh số (nhóm, bạn bè) được nhớ theo người hỏi để dùng số ở lệnh sau.
 */
import { db, getJsonList, getSetting, setSetting, type SettingKey } from "./db.js";
import * as D from "./docs.js";
import { friendsCount } from "./friends.js";
import { addDoc, listDocs, setDocVisibility } from "./knowledge.js";
import { driveStatus, isLocalTarget } from "./media.js";
import * as P from "./projects.js";
import { buildDigest } from "./digest.js";
import { listTemplates } from "./templates.js";

const lastGroups = new Map<string, string[]>();   // chủ -> thread_id theo số thứ tự
const lastFriends = new Map<string, string[]>();  // chủ -> uid theo số thứ tự

export const HELP = [
  "📖 LỆNH QUẢN TRỊ (chỉ bạn dùng được)",
  "/trangthai : tình trạng bot, Drive, số liệu",
  "/batbot  /tatbot : bật/tắt tự trả lời",
  "/congtrinh : danh sách công trình",
  "/congtrinh them Tên công trình | bí danh 1, bí danh 2",
  "/nhom : các nhóm Zalo (đánh số)",
  "/ghep <số nhóm> <tên công trình>",
  "/boghep <số nhóm>",
  "/banbe <từ khoá tên> : tìm trong danh sách bạn bè (đánh số)",
  "/capquyen <số bạn bè> <công trình 1, công trình 2 | *> [bonho] [riengtu]",
  "   bonho = được dùng bộ nhớ tài khoản Claude; riengtu = được dùng tài liệu riêng tư",
  "/quyen : người được yêu cầu hồ sơ   /thuhoi <số bạn bè hoặc uid>",
  "/mau : các mẫu hồ sơ đã nạp",
  "/ghinho <nội dung> : lưu một ghi chú vào bộ nhớ (riêng tư)",
  "/tailieu : tài liệu đã nạp   /congkhai <mã>  /riengtu <mã>",
  "/tonghop [YYYY-MM-DD] : bản tổng hợp ngày",
  "/drive <remote:thư mục> : đặt thư mục Google Drive",
  "/dat <khoá> <giá trị> : đổi cài đặt (vd /dat daily_digest_time 17:30)",
  "",
  "Gửi FILE cho bot: .docx có thẻ {ten_truong} → nạp thành MẪU hồ sơ; PDF/Word/Excel/txt khác → nạp vào bộ nhớ (riêng tư).",
  "Duyệt hồ sơ: \"duyệt 12\" / \"hủy 12 lý do\".",
].join("\n");

const ADMIN_SETTINGS: SettingKey[] = ["bot_enabled", "friends_only", "reply_scope", "disclose_bot", "fallback_reply", "max_replies_per_hour", "human_takeover_minutes",
  "doc_delivery", "doc_max_per_day", "drive_remote", "media_scope", "media_kinds", "media_read", "drive_text_logs", "daily_digest_time", "cc_model", "persona"];

export function isAdminCommand(text: string): boolean {
  return /^\/(huongdan|help|trangthai|batbot|tatbot|congtrinh|nhom|ghep|boghep|banbe|capquyen|quyen|thuhoi|mau|ghinho|tailieu|congkhai|riengtu|tonghop|drive|dat)\b/i.test(text.trim());
}

/** Xử lý lệnh quản trị của chủ. owner = uid của chủ (để nhớ danh sách đánh số). */
export function runAdminCommand(owner: string, text: string): string {
  const t = text.trim();
  const [cmdRaw, ...rest] = t.split(/\s+/);
  const cmd = cmdRaw.toLowerCase().slice(1);
  const arg = t.slice(cmdRaw.length).trim();
  try {
    switch (cmd) {
      case "huongdan": case "help": return HELP;
      case "trangthai": {
        const s = driveStatus();
        const c = s.counts as Record<string, number>;
        return [
          `🤖 Tự trả lời: ${getSetting("bot_enabled") === "true" ? "BẬT" : "TẮT"} | chỉ bạn bè: ${getSetting("friends_only") === "true" ? "có" : "không"} (${friendsCount()} bạn)`,
          `🏗 Công trình: ${P.listProjects().length} | nhóm đã ghép: ${(db.prepare("SELECT COUNT(DISTINCT thread_id) n FROM thread_project").get() as { n: number }).n}/${P.listGroups().length}`,
          `👥 Người được yêu cầu hồ sơ: ${D.listRequesters().length} | mẫu hồ sơ: ${listTemplates().length} | hồ sơ chờ duyệt: ${D.listJobs("awaiting_approval").length}`,
          `☁️ Drive: ${s.remote || "CHƯA ĐẶT"} | đã lên ${c.uploaded ?? 0}, chờ ${(c.pending ?? 0) + (c.downloaded ?? 0)}, lỗi ${c.failed ?? 0}${s.lastResult && s.lastResult !== "ok" ? `\n   ⚠ lỗi gần nhất: ${s.lastResult.slice(0, 150)}` : ""}`,
          `📚 Tài liệu trong bộ nhớ: ${listDocs().length}`,
        ].join("\n");
      }
      case "batbot": setSetting("bot_enabled", "true"); return "✅ Đã BẬT tự trả lời.";
      case "tatbot": setSetting("bot_enabled", "false"); return "⏸ Đã TẮT tự trả lời. (Bot vẫn ghi nhận báo cáo, tải ảnh và gửi tổng hợp ngày.)";
      case "congtrinh": {
        if (/^them\b/i.test(arg)) {
          const [name, aliases = ""] = arg.replace(/^them\s*/i, "").split("|").map((x) => x.trim());
          if (!name) return "Cú pháp: /congtrinh them Tên công trình | bí danh 1, bí danh 2";
          const p = P.createProject(name, aliases.split(",").map((a) => a.trim()).filter(Boolean));
          const auto = P.listGroups().filter((g) => !g.projects.length && g.name && P.autoAssignByName(g.threadId, g.name)?.id === p.id);
          return `✅ Đã tạo công trình "${p.name}"${p.aliases.length ? ` (bí danh: ${p.aliases.join(", ")})` : ""}.${auto.length ? `\nTự ghép ${auto.length} nhóm có tên khớp: ${auto.map((g) => g.name).join("; ")}` : "\nGõ /nhom để ghép nhóm Zalo."}`;
        }
        const ps = P.listProjects();
        return ps.length ? ps.map((p) => `• ${p.name}${p.aliases.length ? ` (${p.aliases.join(", ")})` : ""} | báo cáo gần nhất: ${P.lastReportDate(p.id) ?? "chưa có"}`).join("\n") : "Chưa có công trình. Tạo: /congtrinh them Tên | bí danh";
      }
      case "nhom": {
        const gs = P.listGroups().sort((a, b) => Number(a.projects.length > 0) - Number(b.projects.length > 0));
        lastGroups.set(owner, gs.map((g) => g.threadId));
        if (!gs.length) return "Bot chưa thấy nhóm nào. Thêm nick bot vào nhóm hiện trường và chờ có tin nhắn.";
        return gs.map((g, i) => `${i + 1}. ${g.name || g.threadId} → ${g.projects.length ? g.projects.join(", ") : "CHƯA GHÉP"}`).join("\n") + "\n\nGhép: /ghep <số> <tên công trình>";
      }
      case "ghep": case "boghep": {
        const idx = Number(rest[0]);
        const tid = lastGroups.get(owner)?.[idx - 1];
        if (!tid) return "Gõ /nhom trước để lấy số thứ tự nhóm.";
        if (cmd === "boghep") return `Đã bỏ ghép ${P.unassignThread(tid)} công trình khỏi nhóm.`;
        const p = P.resolveProject(rest.slice(1).join(" "));
        if (!p) return `Không tìm thấy công trình "${rest.slice(1).join(" ")}". Gõ /congtrinh để xem.`;
        P.assignThread(tid, p.id);
        return `✅ Đã ghép nhóm số ${idx} → "${p.name}". Tin báo cáo và ảnh của nhóm sẽ được tổng hợp vào công trình này.`;
      }
      case "banbe": {
        const fs = (arg ? D.findFriends(arg) : (db.prepare("SELECT uid,name FROM friends ORDER BY name LIMIT 30").all() as { uid: string; name: string }[])).slice(0, 30);
        lastFriends.set(owner, fs.map((f) => f.uid));
        if (!fs.length) return arg ? `Không có bạn bè nào khớp "${arg}".` : "Danh sách bạn bè trống (bot đang đồng bộ, thử lại sau ít phút).";
        const reqs = new Set(D.listRequesters().map((r) => r.uid));
        return fs.map((f, i) => `${i + 1}. ${f.name}${reqs.has(f.uid) ? " ✅ (đã có quyền)" : ""}`).join("\n") + "\n\nCấp quyền: /capquyen <số> <công trình, ... | *> [bonho] [riengtu]";
      }
      case "capquyen": {
        const uid = lastFriends.get(owner)?.[Number(rest[0]) - 1] ?? rest[0];
        if (!uid) return "Gõ /banbe <tên> trước để lấy số thứ tự.";
        let spec = rest.slice(1).join(" ");
        const mem = /\bbonho\b/i.test(spec), priv = /\briengtu\b/i.test(spec);
        spec = spec.replace(/\b(bonho|riengtu)\b/gi, "").trim();
        if (!spec) return "Cần nêu công trình, ví dụ: /capquyen 2 Cầu ABC, QL.xx  (hoặc * cho tất cả)";
        const projects = spec === "*" ? ["*"] : spec.split(",").map((x) => x.trim()).filter(Boolean);
        const r = D.addRequester(uid, projects, priv, mem);
        return `✅ ${r.name || uid} được nhờ bot làm hồ sơ cho: ${r.projects.join(", ")}${r.accountMemory ? " | dùng bộ nhớ tài khoản" : ""}${r.kbPrivate ? " | dùng tài liệu riêng tư" : ""}.\nChế độ gửi: ${getSetting("doc_delivery") === "auto" ? "TỰ ĐỘNG" : "bạn duyệt trước"}.`;
      }
      case "quyen": {
        const rs = D.listRequesters();
        lastFriends.set(owner, rs.map((r) => r.uid));
        return rs.length ? rs.map((r, i) => `${i + 1}. ${r.name || r.uid}: ${r.projects.join(", ")}${r.accountMemory ? " | bộ nhớ" : ""}${r.kbPrivate ? " | riêng tư" : ""}`).join("\n") + "\n\nThu hồi: /thuhoi <số>" : "Chưa cấp quyền cho ai. Dùng /banbe rồi /capquyen.";
      }
      case "thuhoi": {
        const uid = lastFriends.get(owner)?.[Number(rest[0]) - 1] ?? rest[0];
        return uid && D.removeRequester(uid) ? "✅ Đã thu hồi quyền." : "Không tìm thấy. Gõ /quyen để xem danh sách đánh số.";
      }
      case "mau": {
        const ts = listTemplates();
        return ts.length ? ts.map((x) => `• ${x.id}: ${x.name}${x.kind ? ` (${x.kind})` : ""} | ${x.schema.scalars.length} trường${Object.keys(x.schema.loops).length ? `, bảng: ${Object.keys(x.schema.loops).join(", ")}` : ""}`).join("\n") : "Chưa có mẫu. Gửi file .docx mẫu (đã đặt thẻ {ten_truong}) cho bot để nạp.";
      }
      case "ghinho": {
        if (!arg) return "Cú pháp: /ghinho <nội dung cần nhớ>";
        const r = addDoc({ title: `Ghi nhớ ${P.vnDate(Date.now())}: ${arg.slice(0, 50)}`, text: arg, source: "Zalo /ghinho", botVisible: false });
        return `✅ Đã lưu vào bộ nhớ (mã ${r.docId}, riêng tư). Muốn bot dùng để trả lời bạn bè: /congkhai ${r.docId}`;
      }
      case "tailieu": {
        const ds = listDocs().slice(0, 30);
        return ds.length ? ds.map((d) => `${d.id}. ${d.title} ${d.botVisible ? "🌐 công khai" : "🔒 riêng tư"}`).join("\n") : "Bộ nhớ đang trống.";
      }
      case "congkhai": case "riengtu": {
        const id = Number(rest[0]);
        return setDocVisibility(id, cmd === "congkhai") ? `✅ Tài liệu ${id}: ${cmd === "congkhai" ? "bot ĐƯỢC dùng để trả lời bạn bè" : "chỉ bạn dùng"}.` : `Không có tài liệu ${id}.`;
      }
      case "tonghop": return buildDigest(/^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : undefined);
      case "drive": {
        if (!arg) return `Thư mục Drive hiện tại: ${getSetting("drive_remote") || "CHƯA ĐẶT"}\nĐặt: /drive gdrive:Cong trinh/Anh hien truong`;
        if (!/^[A-Za-z0-9_\-]{2,}:/.test(arg) && !isLocalTarget(arg)) return "Phải có dạng <tên remote rclone>:<thư mục> (vd gdrive:Cong trinh/Anh hien truong), hoặc thư mục trên máy (vd G:\\My Drive\\Cong trinh)";
        setSetting("drive_remote", arg);
        return `✅ Ảnh, nhật ký và sao lưu sẽ lưu vào ${arg}. Gõ /trangthai sau 10 phút để kiểm tra.`;
      }
      case "dat": {
        const key = rest[0] as SettingKey;
        if (!ADMIN_SETTINGS.includes(key)) return `Khoá không hợp lệ. Có thể đổi: ${ADMIN_SETTINGS.join(", ")}`;
        const value = t.split(/\s+/).slice(2).join(" ");
        setSetting(key, value);
        return `✅ ${key} = ${value || "(trống)"}`;
      }
    }
  } catch (e) {
    return `⚠ ${e instanceof Error ? e.message : String(e)}`;
  }
  return HELP;
}

export const ownerCount = () => getJsonList("owner_ids").length;
