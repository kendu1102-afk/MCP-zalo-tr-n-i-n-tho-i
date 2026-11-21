import Anthropic from "@anthropic-ai/sdk";

export type LlmParams = Anthropic.MessageCreateParamsNonStreaming;
export type LlmResult = Anthropic.Message;
export type LlmFn = (p: LlmParams) => Promise<LlmResult>;

let override: LlmFn | null = null;
let client: Anthropic | null = null;

/** Chỉ dùng khi kiểm thử: thay thế lời gọi API thật. */
export function setLlmForTest(fn: LlmFn | null): void { override = fn; }

export async function callClaude(p: LlmParams): Promise<LlmResult> {
  if (override) return override(p);
  client ??= new Anthropic(); // đọc ANTHROPIC_API_KEY
  return client.messages.create(p);
}

export const textOf = (r: LlmResult): string =>
  r.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").trim();
