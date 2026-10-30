// Stub: this feature is not part of this repository yet; kept code imports this module.
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
