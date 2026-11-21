import path from "node:path";
import fs from "node:fs";

/** Thư mục dữ liệu (DB, session Zalo). Mặc định ./data, đổi bằng ZALO_MCP_HOME. */
export const DATA_DIR = path.resolve(process.env.ZALO_MCP_HOME ?? path.join(process.cwd(), "data"));
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

export const DB_PATH = path.join(DATA_DIR, "zalo.db");
export const SESSION_PATH = path.join(DATA_DIR, "session.json");
export const QR_PATH = path.join(DATA_DIR, "qr.png");

export const BOT_MODEL = process.env.ZALO_BOT_MODEL ?? "claude-sonnet-5-5";
