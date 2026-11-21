import crypto from "node:crypto";
import { getJsonList, getSetting, setSetting, setSettingRaw } from "./db.js";

const MAX_FAILS = 5;
let fails = 0;

/**
 * Xử lý tin "/ketnoi 123456".
 * - "ignored": không phải lệnh ghép nối
 * - "fail": sai/hết hạn (bot im lặng để kẻ dò mã không biết gì)
 * - "ok": đã thêm uid vào owner_ids, mã bị huỷ
 */
export function tryPairCommand(uid: string, text: string, now = Date.now()): "ignored" | "fail" | "ok" {
  const m = /^\/ketnoi\s+(\d{6})\s*$/i.exec(text.trim());
  if (!m) return "ignored";
  const [code, exp] = getSetting("pair_code").split(":");
  if (!code || !(Number(exp) > now) || code !== m[1]) {
    if (code && ++fails >= MAX_FAILS) { setSettingRaw("pair_code", ""); fails = 0; } // dò mã: huỷ mã hiện hành
    return "fail";
  }
  const owners = getJsonList("owner_ids");
  if (!owners.length) setSetting("bot_enabled", "true"); // chủ đầu tiên ghép nối: bật tự trả lời luôn (/tatbot để tắt)
  if (!owners.includes(uid)) owners.push(uid);
  setSetting("owner_ids", JSON.stringify(owners));
  setSettingRaw("pair_code", "");
  fails = 0;
  return "ok";
}

/** Tạo mã ghép nối mới (6 số) có hiệu lực trong `minutes` phút. */
export function newPairCode(minutes: number): string {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  setSettingRaw("pair_code", `${code}:${Date.now() + minutes * 60_000}`);
  return code;
}
/** Lần đầu (chưa có chủ): tạo mã 24 giờ nếu chưa có mã còn hạn. Trả mã hoặc null. */
export function firstRunPairCode(): string | null {
  if (getJsonList("owner_ids").length) return null;
  const [code, exp] = getSetting("pair_code").split(":");
  if (code && Number(exp) > Date.now()) return code;
  return newPairCode(24 * 60);
}
