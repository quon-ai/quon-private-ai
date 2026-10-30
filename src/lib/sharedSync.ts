// Stub: this feature is not part of this repository yet; kept code imports this module.
// It exists so the shared screens compile unchanged; every call is an inert no-op.
import type { ShareRole } from "./api/sharesApi";

const EMPTY: ReadonlyMap<string, ShareRole> = new Map();
export function isSharedProject(_projectId: string | undefined): boolean {
  return false;
}
export function sharedRole(_projectId: string | undefined): ShareRole | null {
  return null;
}
export function subscribeShared(_cb: () => void): () => void {
  return () => {};
}
export function getSharedSnapshot(): ReadonlyMap<string, ShareRole> {
  return EMPTY;
}
export async function refreshSharedSync(): Promise<void> {}
export function startSharedSync(): void {}
export function stopSharedSync(): void {}
