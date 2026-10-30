// Core-edition stub: this feature is not part of the core edition (docs/CORE.md).
// It exists so the shared screens compile unchanged; every call is an inert no-op.
export function stashPendingJoin(_fragment: string): void {}
export function clearPendingJoin(): void {}
export function pendingJoinTarget(): null {
  return null;
}
export function takePendingJoin(): string | null {
  return null;
}
