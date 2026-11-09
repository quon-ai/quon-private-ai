// Stub: this feature is not part of this repository yet; kept code imports this module.
// It exists so the shared screens compile unchanged; every call is an inert no-op.
export type TitleKind = "paperless";
export type TitleResolver = (kind: TitleKind, id: string) => string | undefined;
/** Turn an unknown tool id into readable words - kept, it is pure and used for MCP ids. */
export function humanizeToolName(tool: string): string {
  const bare = tool
    .replace(/^mcp__[^_]+__/, "")
    .replace(/_/g, " ")
    .trim();
  return bare ? bare.charAt(0).toUpperCase() + bare.slice(1) : tool;
}
export function summarizeToolArgs(
  _tool: string,
  _argsJson: string,
  _resolveTitle?: TitleResolver,
): string | null {
  return null;
}
