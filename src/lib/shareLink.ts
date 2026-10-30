// Core-edition stub: this feature is not part of the core edition (docs/CORE.md).
// It exists so the shared screens compile unchanged; every call is an inert no-op.
export interface JoinPayload {
  projectId: string;
  code: string;
  key: string;
}
export function buildJoinFragment(_p: JoinPayload): string {
  return "";
}
export function parseJoinFragment(_fragment: string): JoinPayload | null {
  return null;
}
