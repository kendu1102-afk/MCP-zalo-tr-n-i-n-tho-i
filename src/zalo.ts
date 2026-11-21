import fs from "node:fs";
import { Zalo, type Credentials } from "zca-js";
import { SESSION_PATH } from "./config.js";

export function saveSession(c: Credentials): void {
  fs.writeFileSync(SESSION_PATH, JSON.stringify(c), { mode: 0o600 });
}
export function loadSession(): Credentials | null {
  try { return JSON.parse(fs.readFileSync(SESSION_PATH, "utf8")) as Credentials; } catch { return null; }
}

export async function loginWithSession() {
  const creds = loadSession();
  if (!creds) throw new Error("Chưa có phiên đăng nhập. Chạy `npm run login` và quét mã QR bằng Zalo trên điện thoại.");
  return new Zalo({ selfListen: true, checkUpdate: false }).login(creds);
}
