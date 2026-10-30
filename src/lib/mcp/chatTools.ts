// Stub: this feature is not part of this repository yet; kept code imports this module.
// It exists so the shared screens compile unchanged; every call is an inert no-op.
import type { Entity, ScrubResult } from "@/lib/quonApi";

export const QUON_TOOL_SERVER_ID = "quon";
export function warmChatTools(): void {}
export async function getChatToolDefs(): Promise<unknown[]> {
  return [];
}
export function refreshFirstPartyToolDefs(_turnDefs: unknown[]): unknown[] {
  return [];
}
export function invalidateChatTools(): void {}
export function isAlwaysAllowed(_serverId: string, _tool: string): boolean {
  return false;
}
export function rememberAlwaysAllow(_serverId: string, _tool: string): void {}
export function clearAlwaysAllow(): void {}
export function mergeScrubbedResult(
  scrub: Pick<ScrubResult, "scrubbed" | "entities">,
  _map: Record<string, string>,
): { text: string; additions: Record<string, string>; entities: Entity[] } {
  return { text: scrub.scrubbed, additions: {}, entities: [] };
}
