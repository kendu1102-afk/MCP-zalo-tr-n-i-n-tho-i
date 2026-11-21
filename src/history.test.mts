// Kiểm thử lấy toàn bộ lịch sử nhóm ghim (máy chủ Zalo giả lập). Chạy: npm test
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "zalo-histtest-"));
process.env.ZALO_MCP_HOME = path.join(HOME, "data");
const { db, setSetting } = await import("./db.js");
const P = await import("./projects.js");
const { importGroupHistory, pinnedGroups } = await import("./history.js");
const { listDocs, search } = await import("./knowledge.js");
const M = await import("./media.js");
const ok = (m: string) => console.log("✔", m);

const cau = P.createProject("SCĐX QL3 Km285", ["QL3 Km285"]);
// 130 tin nhóm 111: từ 25/10 đến 21/11/2026, cứ 30 tin có 1 ảnh; mới nhất trước (như Zalo trả về)
const T0 = Date.parse("2026-10-25T07:00:00+07:00"), STEP = 5 * 3600_000;
const all = Array.from({ length: 130 }, (_, i) => ({
  data: { msgId: String(1000 + i), ts: String(T0 + i * STEP), uidFrom: i % 2 ? "u1" : "u2", dName: "", msgType: i % 30 === 0 ? "chat.photo" : "webchat",
    content: i % 30 === 0 ? { href: "http://127.0.0.1:1/het-han.jpg", title: `ảnh ${i}` } : `Tin số ${i}: đắp đất K95 ${i} m3` },
  isSelf: i === 7,
})).reverse();
let calls = 0;
const api = {
  async getPinConversations() { return { conversations: ["g111", "u999", "g222", "g333", "g444"] }; },
  async getGroupInfo(id: string) { return { gridInfoMap: { [id]: { name: id === "111" ? "2026 - SCĐX QL3 Km285-Km297" : `Nhóm ${id}`, currentMems: [{ id: "u1", dName: "Anh Tuấn" }, { id: "u2", dName: "Chị Lan" }] } } }; },
  async getCloudMessage(groupId: string, lastMsgId?: string, o?: { isOld?: boolean | number }) {
    calls++;
    if (groupId !== "111") return { groupMsgs: [], hasMore: 0, lastMsgId: "", isOld: 0, isFiltered: 0 };
    const start = lastMsgId ? all.findIndex((m) => m.data.msgId === lastMsgId) + 1 : 0;
    const page = all.slice(start, start + 50);
    return { groupMsgs: page as any, hasMore: start + 50 < all.length ? 1 : 0, lastMsgId: page[page.length - 1]?.data.msgId ?? "", isOld: start >= 50 ? 1 : 0, isFiltered: 0, _isOldAsked: o?.isOld };
  },
};

assert.deepEqual(await pinnedGroups(api), ["111", "222", "333"], "3 nhóm ghim đầu, bỏ hội thoại 1-1");
const r = await importGroupHistory(api, "111", { delayMs: 0 });
assert.equal(r.pages, 3); assert.equal(r.fetched, 130); assert.equal(r.added, 130); assert.equal(r.media, 5, "ảnh ở tin 0, 30, 60, 90, 120");
assert.equal(r.name, "2026 - SCĐX QL3 Km285-Km297");
assert.deepEqual(P.projectsOfThread("111").map((p) => p.name), ["SCĐX QL3 Km285"], "tên nhóm khớp bí danh -> tự ghép công trình");
const names = db.prepare("SELECT DISTINCT sender_name FROM messages WHERE thread_id='111' ORDER BY 1").all().map((x: any) => x.sender_name);
assert.deepEqual(names, ["(nick bot)", "Anh Tuấn", "Chị Lan"], "tên người gửi lấy từ danh sách thành viên khi tin cũ thiếu tên");
ok("lấy đủ 130 tin qua 3 trang (lùi dần về quá khứ), tên người gửi đầy đủ, ảnh xếp hàng tải, tự ghép công trình");

const tr = fs.readFileSync(r.transcript, "utf8");
assert.ok(tr.includes("LỊCH SỬ NHÓM ZALO: 2026 - SCĐX QL3 Km285-Km297") && tr.includes("Số tin: 130") && tr.includes("===== 25/10/2026 =====") && tr.includes("Anh Tuấn: Tin số 1: đắp đất K95 1 m3"));
assert.ok(tr.indexOf("Tin số 0:") < tr.indexOf("Tin số 129:"), "bản chép theo thứ tự thời gian (cũ -> mới)");
const docs = listDocs().filter((d) => d.source === "zalo-history:111");
assert.deepEqual(docs.map((d) => d.title).sort(), ['Lịch sử nhóm "2026 - SCĐX QL3 Km285-Km297" tháng 10/2026', 'Lịch sử nhóm "2026 - SCĐX QL3 Km285-Km297" tháng 11/2026']);
assert.ok(docs.every((d) => !d.botVisible), "lịch sử nhóm lưu riêng tư");
assert.ok(search("đắp đất K95 Tin số 120").some((h) => h.title.includes("tháng 11/2026")));
ok("bản chép toàn văn theo ngày + lưu vào bộ nhớ (riêng tư, mỗi tháng một tài liệu), tra cứu được");

const r2 = await importGroupHistory(api, "111", { delayMs: 0 });
assert.equal(r2.added, 0); assert.equal(r2.media, 0);
assert.equal((db.prepare("SELECT COUNT(*) n FROM messages WHERE thread_id='111'").get() as any).n, 130);
assert.equal(listDocs().filter((d) => d.source === "zalo-history:111").length, 2, "lấy lại thì thay, không nhân đôi bộ nhớ");
ok("lấy lại lần 2: không trùng tin, không trùng ảnh, không nhân đôi bộ nhớ");

calls = 0;
const r3 = await importGroupHistory(api, "111", { delayMs: 0, since: Date.parse("2026-11-15T00:00:00+07:00") });
assert.equal(r3.pages, 1, "--tu: dừng khi chạm mốc ngày, không đọc hết lịch sử"); assert.equal(calls, 1);
ok("--tu <ngày>: chỉ đọc tới mốc ngày rồi dừng");

assert.equal((db.prepare("SELECT COUNT(*) n FROM messages WHERE thread_id='111' AND extracted=0 AND direction='in'").get() as { n: number }).n > 0, true, "tin lịch sử chờ bot trích xuất khối lượng");
ok("tin lịch sử của nhóm đã ghép công trình sẽ được bot trích xuất khối lượng");

// lưu thẳng ra thư mục cục bộ (như ổ G: của Google Drive for desktop)
const G = path.join(HOME, "G", "My Drive", "Cong trinh");
assert.ok(M.isLocalTarget(G) && M.isLocalTarget("G:\\My Drive\\Cong trinh") && M.isLocalTarget("G:/My Drive") && !M.isLocalTarget("gdrive:Cong trinh"));
setSetting("drive_remote", G);
const s = await M.syncToDrive();
assert.ok(s !== null);
assert.ok(fs.existsSync(path.join(G, "_Lich su nhom", "2026 - SCĐX QL3 Km285-Km297", "Lich su 2026 - SCĐX QL3 Km285-Km297.txt")));
assert.equal(fs.existsSync(r.transcript), false, "bản tạm đã chuyển đi");
ok("drive_remote là thư mục trên máy (vd G:\\My Drive\\...) -> chép thẳng, không cần rclone");

console.log("\nTẤT CẢ ĐẠT (lịch sử nhóm)");
fs.rmSync(HOME, { recursive: true, force: true });
