/**
 * Chạy Claude Code ở chế độ không tương tác (`claude -p`) bằng TÀI KHOẢN CLAUDE đang đăng nhập trên máy này.
 * An toàn: tắt toàn bộ công cụ có sẵn (Bash, đọc/sửa file, web...) bằng --tools "", chỉ nạp MCP do bot chỉ định
 * (--strict-mcp-config), không lưu phiên, chạy trong thư mục trống riêng.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR } from "./config.js";
import { getSetting } from "./db.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORK = path.join(DATA_DIR, "cc-work");
fs.mkdirSync(WORK, { recursive: true, mode: 0o700 });
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? "claude";
const MAX_PARALLEL = 2;

let running = 0;
const waiters: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((r) => waiters.push(r));
  running++;
  try { return await fn(); } finally { running--; waiters.shift()?.(); }
}

export type CcRun = {
  prompt: string;
  systemPrompt: string;
  jsonSchema: object;
  /** true = nạp bộ nhớ người dùng của Claude Code (~/.claude/CLAUDE.md, cài đặt cấp user). Chỉ bật cho nick được phép. */
  useMemory: boolean;
  /** MCP chỉ-đọc theo phạm vi (cho agent soạn hồ sơ). Phạm vi do bot đặt qua biến môi trường, mô hình không đổi được. */
  scope?: Record<string, unknown>;
  /** Ảnh gửi kèm trong NỘI DUNG tin nhắn (không cần bật công cụ đọc file). */
  images?: { mediaType: string; base64: string }[];
};

export async function runClaudeCode(o: CcRun): Promise<unknown> {
  return slot(() => runOnce(o));
}

async function runOnce(o: CcRun): Promise<unknown> {
  const tmp = fs.mkdtempSync(path.join(WORK, "run-"));
  try {
    const sysFile = path.join(tmp, "system.txt");
    fs.writeFileSync(sysFile, o.systemPrompt);
    const withImages = !!o.images?.length;
    const args = [
      "-p", "--no-session-persistence",
      ...(withImages ? ["--input-format", "stream-json", "--output-format", "stream-json", "--verbose"] : ["--output-format", "json"]),
      "--tools", "",
      "--system-prompt-file", sysFile,
      "--json-schema", JSON.stringify(o.jsonSchema),
      "--setting-sources", o.useMemory ? "user" : "",
      "--strict-mcp-config",
    ];
    const model = getSetting("cc_model");
    if (model) args.push("--model", model);
    if (o.scope) {
      const mcpFile = path.join(tmp, "mcp.json");
      fs.writeFileSync(mcpFile, JSON.stringify({
        mcpServers: {
          zalo: {
            command: process.execPath,
            args: [path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), path.join(ROOT, "src", "mcp-scoped.ts")],
            env: { ZALO_MCP_HOME: DATA_DIR, ZALO_SCOPE: JSON.stringify(o.scope) },
          },
        },
      }));
      args.push("--mcp-config", mcpFile, "--allowedTools", "mcp__zalo");
    }
    // Bỏ ANTHROPIC_API_KEY để Claude Code dùng tài khoản đã đăng nhập (không tính phí API)
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    const timeoutMs = Number(getSetting("cc_timeout_sec")) * 1000;

    const out = await new Promise<string>((resolve, reject) => {
      const child = spawn(CLAUDE_BIN, args, { cwd: tmp, env, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`Claude Code quá thời gian ${timeoutMs / 1000}s`)); }, timeoutMs);
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", (e) => { clearTimeout(timer); reject(new Error(`Không chạy được "${CLAUDE_BIN}": ${e.message}. Cài Claude Code và đăng nhập bằng lệnh: claude`)); });
      child.on("close", (code) => { clearTimeout(timer); code === 0 || stdout ? resolve(stdout) : reject(new Error(`Claude Code thoát mã ${code}: ${stderr.slice(-500)}`)); });
      child.stdin.end(withImages
        ? JSON.stringify({ type: "user", message: { role: "user", content: [
            ...o.images!.map((im) => ({ type: "image", source: { type: "base64", media_type: im.mediaType, data: im.base64 } })),
            { type: "text", text: o.prompt },
          ] } }) + "\n"
        : o.prompt);
    });
    let j: { is_error?: boolean; subtype?: string; result?: string; structured_output?: unknown };
    try {
      // stream-json: mỗi dòng một sự kiện, dòng "result" chứa kết quả cuối
      j = withImages ? JSON.parse(out.trim().split("\n").reverse().find((l) => l.includes('"type":"result"')) ?? "{}") : JSON.parse(out);
    } catch { throw new Error(`Kết quả Claude Code không đọc được: ${out.slice(0, 300)}`); }
    if (j.is_error || j.structured_output === undefined) throw new Error(`Claude Code lỗi (${j.subtype ?? "?"}): ${String(j.result ?? "").slice(0, 300)}`);
    return j.structured_output;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Kiểm tra CLI có sẵn (gọi lúc bot khởi động). */
export async function checkClaudeCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const c = spawn(CLAUDE_BIN, ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    let s = "";
    c.stdout.on("data", (d) => (s += d));
    c.on("error", (e) => reject(e));
    c.on("close", (code) => (code === 0 ? resolve(s.trim()) : reject(new Error(`mã ${code}`))));
  });
}
