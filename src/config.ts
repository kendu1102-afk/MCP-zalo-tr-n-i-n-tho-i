import path from "node:path";
import fs from "node:fs";

/** Thư mục dữ liệu (DB, session Zalo). Mặc định ./data, đổi bằng ZALO_MCP_HOME. */
export const DATA_DIR = path.resolve(process.env.ZALO_MCP_HOME ?? path.join(process.cwd(), "data"));
fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

export const DB_PATH = path.join(DATA_DIR, "zalo.db");
export const SESSION_PATH = path.join(DATA_DIR, "session.json");
export const QR_PATH = path.join(DATA_DIR, "qr.png");

export const BOT_MODEL = process.env.ZALO_BOT_MODEL ?? "claude-sonnet-5-5";

/** Mẫu văn bản của công ty (.docx có thẻ {tên_trường}) và hồ sơ đã xuất. Nằm ngoài git vì là tài liệu nội bộ. */
export const TEMPLATES_DIR = path.join(DATA_DIR, "templates");
export const DOCS_DIR = path.join(DATA_DIR, "docs");
fs.mkdirSync(TEMPLATES_DIR, { recursive: true, mode: 0o700 });
fs.mkdirSync(DOCS_DIR, { recursive: true, mode: 0o700 });

/** Thư mục chờ: ảnh/video/file và nhật ký đã sắp theo "Công trình/Ngày/", được rclone chuyển lên Google Drive rồi xoá. */
export const DRIVE_OUT_DIR = path.join(DATA_DIR, "drive-out");
fs.mkdirSync(DRIVE_OUT_DIR, { recursive: true, mode: 0o700 });

/** Bản sao tạm của ảnh/tệp chờ Claude đọc nội dung (tách khỏi thư mục chờ lên Drive). */
export const READ_DIR = path.join(DATA_DIR, "media-read");
fs.mkdirSync(READ_DIR, { recursive: true, mode: 0o700 });
