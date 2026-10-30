// Stub: this feature is not part of this repository yet; kept code imports this module.
// It exists so the shared screens compile unchanged; every call is an inert no-op.
export interface McpTool {
  serverId: string;
  name: string;
  description?: string;
  inputSchema?: unknown;
}
export function resetMcpSession(_serverId: string): void {}
export async function listTools(_server: unknown): Promise<McpTool[]> {
  return [];
}
export async function callTool(_serverId: string, _tool: string, _args: unknown): Promise<string> {
  throw new Error("MCP tools are not part of the core edition.");
}
export function toOpenAiTools(_tools: McpTool[]): unknown[] {
  return [];
}
export function parseToolName(_name: string): { serverId: string; tool: string } | null {
  return null;
}
