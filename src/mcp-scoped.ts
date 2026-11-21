/**
 * MCP CHỈ-ĐỌC cho Claude Code khi soạn hồ sơ theo yêu cầu từ Zalo.
 * Phạm vi (công trình, tài liệu riêng tư) do bot đặt qua biến môi trường ZALO_SCOPE; mô hình không thay đổi được.
 * Không có công cụ gửi tin, sửa hay xoá dữ liệu.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { runTool, TOOLS, type AgentCtx } from "./docagent.js";
import { listProjects } from "./projects.js";

const scope = JSON.parse(process.env.ZALO_SCOPE ?? "{}") as { requesterName?: string; isOwner?: boolean; projectIds?: number[]; kbPrivate?: boolean };
const ids = new Set(Array.isArray(scope.projectIds) ? scope.projectIds : []);
const ctx: AgentCtx = {
  requesterName: String(scope.requesterName ?? ""), isOwner: scope.isOwner === true,
  projects: listProjects().filter((p) => ids.has(p.id)), kbPrivate: scope.kbPrivate === true, useMemory: false,
};
const READ_ONLY = TOOLS.filter((t) => !["hoi_lai", "tao_ho_so"].includes(t.name));

const server = new Server({ name: "zalo-scoped", version: "0.1.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: READ_ONLY.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema })),
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (!READ_ONLY.some((t) => t.name === req.params.name)) return { content: [{ type: "text", text: "Công cụ không được phép." }], isError: true };
  const r = await runTool(req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>, ctx, { flush: false });
  return { content: [{ type: "text", text: r.text }], ...(r.error ? { isError: true } : {}) };
});
await server.connect(new StdioServerTransport());
