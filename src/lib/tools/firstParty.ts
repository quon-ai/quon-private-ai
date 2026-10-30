// Stub: this feature is not part of this repository yet; kept code imports this module.
// It exists so the shared screens compile unchanged; every call is an inert no-op.
import type { RagScope } from "@/lib/rag";

export type ToolTrust = "read" | "write";
export interface QuonToolContext {
  scope: RagScope;
}
export const DOC_READ_CHARS = 100_000;
export function firstPartyToolDefs(): unknown[] {
  return [];
}
export function parseQuonToolName(_name: string): { tool: string; trust: ToolTrust } | null {
  return null;
}
export function isWriteToolName(_name: string): boolean {
  return false;
}
export function toolProvenance(_name: string): "external" | null {
  return null;
}
export function canAlwaysAllow(_name: string): boolean {
  return true;
}
export async function callQuonTool(
  _tool: string,
  _args: Record<string, unknown>,
  _ctx: QuonToolContext,
): Promise<string> {
  throw new Error("Chat tools are not available in this build.");
}
