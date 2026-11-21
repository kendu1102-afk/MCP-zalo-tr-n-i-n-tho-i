import { db, getSetting, getSettingRaw, setSettingRaw } from "./db.js";

type FriendApi = { getAllFriends: (count?: number, page?: number) => Promise<{ userId: string; displayName?: string; zaloName?: string }[]> };
const PAGE = 200;

/** Đồng bộ toàn bộ danh sách bạn bè từ Zalo vào DB. Lỗi giữa chừng thì GIỮ NGUYÊN danh sách cũ. */
export async function syncFriends(api: FriendApi): Promise<number> {
  const all = new Map<string, string>();
  for (let page = 1; page <= 100; page++) {
    const rows = await api.getAllFriends(PAGE, page);
    if (!rows?.length) break;
    let added = 0;
    for (const r of rows) if (!all.has(r.userId)) { all.set(r.userId, r.displayName || r.zaloName || ""); added++; }
    if (rows.length < PAGE || added === 0) break;
  }
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM friends");
    const ins = db.prepare("INSERT INTO friends(uid,name) VALUES(?,?)");
    for (const [uid, name] of all) ins.run(uid, name);
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  setSettingRaw("friends_synced_at", String(Date.now()));
  return all.size;
}

export const friendsCount = () => (db.prepare("SELECT COUNT(*) AS n FROM friends").get() as { n: number }).n;
export const friendsSyncedAt = (): number | null => Number(getSettingRaw("friends_synced_at")) || null;
export const isFriend = (uid: string) => !!db.prepare("SELECT 1 FROM friends WHERE uid=?").get(uid);

/** null = được phép; chuỗi = lý do từ chối. Chưa đồng bộ được danh sách bạn bè => từ chối tất cả (an toàn). */
export function friendGate(uid: string): string | null {
  if (getSetting("friends_only") !== "true") return null;
  if (!friendsSyncedAt()) return "chưa đồng bộ được danh sách bạn bè (từ chối để an toàn)";
  return isFriend(uid) ? null : "không phải bạn bè của nick này";
}
