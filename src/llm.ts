import Anthropic from "@anthropic-ai/sdk";
import { getSetting } from "./db.js";
import { runClaudeCode } from "./claudecode.js";

export type LlmParams = Anthropic.MessageCreateParamsNonStreaming;
export type LlmResult = Anthropic.Message;
export type LlmOpts = { useMemory?: boolean };
export type LlmFn = (p: LlmParams, o?: LlmOpts) => Promise<LlmResult>;

let override: LlmFn | null = null;
let client: Anthropic | null = null;

/** Chỉ dùng khi kiểm thử: thay thế lời gọi thật. */
export function setLlmForTest(fn: LlmFn | null): void { override = fn; }

export const usingTestLlm = () => override !== null;
export const engine = (): "claude-code" | "api" => (getSetting("engine") === "api" ? "api" : "claude-code");
export const engineReady = () => override !== null || engine() === "claude-code" || !!process.env.ANTHROPIC_API_KEY;

const blockText = (c: string | Anthropic.ContentBlockParam[]) =>
  typeof c === "string" ? c : c.map((b) => (b.type === "text" ? b.text : "")).join("");

/**
 * Gọi Claude. Với engine claude-code: một lượt hội thoại (không công cụ) -> text; hoặc ép một công cụ -> JSON theo schema của công cụ đó.
 * Vòng lặp nhiều công cụ (agent soạn hồ sơ) dùng runClaudeCode trực tiếp.
 */
export async function callClaude(p: LlmParams, o: LlmOpts = {}): Promise<LlmResult> {
  if (override) return override(p, o);
  if (engine() === "api") {
    client ??= new Anthropic();
    return client.messages.create(p);
  }
  const system = typeof p.system === "string" ? p.system : (p.system ?? []).map((b) => b.text).join("\n");
  const msgs = p.messages.map((m) => ({ role: m.role, text: blockText(m.content) }));
  const prompt = msgs.length === 1 ? msgs[0].text
    : "LỊCH SỬ HỘI THOẠI:\n" + msgs.slice(0, -1).map((m) => `[${m.role === "user" ? "Người nhắn" : "Trợ lý"}]: ${m.text}`).join("\n") + `\n\nTIN NHẮN CẦN TRẢ LỜI:\n${msgs[msgs.length - 1].text}`;
  const forced = p.tool_choice?.type === "tool" ? p.tool_choice.name : null;
  if (forced) {
    const tool = (p.tools ?? []).find((t) => "name" in t && t.name === forced) as Anthropic.Tool | undefined;
    if (!tool) throw new Error(`Không có công cụ ${forced}`);
    const input = await runClaudeCode({ prompt, systemPrompt: system, jsonSchema: tool.input_schema, useMemory: !!o.useMemory });
    return { content: [{ type: "tool_use", id: "cc", name: forced, input }] } as unknown as LlmResult;
  }
  if (p.tools?.length) throw new Error("Vòng lặp nhiều công cụ phải dùng runClaudeCode trực tiếp.");
  const out = (await runClaudeCode({ prompt, systemPrompt: system, jsonSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] }, useMemory: !!o.useMemory })) as { text?: string };
  return { content: [{ type: "text", text: String(out?.text ?? "") }] } as unknown as LlmResult;
}

export const textOf = (r: LlmResult): string =>
  r.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").trim();
