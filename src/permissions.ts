import { db, getJsonList } from "./db.js";

/** Nick được dùng BỘ NHỚ TÀI KHOẢN CLAUDE (~/.claude/CLAUDE.md...) khi trả lời/soạn hồ sơ: chủ, hoặc người bạn đã cho phép rõ. */
export function accountMemoryAllowed(uid: string): boolean {
  if (getJsonList("owner_ids").includes(uid)) return true;
  const r = db.prepare("SELECT account_memory FROM requesters WHERE uid=?").get(uid) as { account_memory: number } | undefined;
  return !!r?.account_memory;
}
