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
  if (!owners.includes(uid)) owners.push(uid);
  setSetting("owner_ids", JSON.stringify(owners));
  setSettingRaw("pair_code", "");
  fails = 0;
  return "ok";
}
