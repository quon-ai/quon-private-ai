// Core-edition stub: this feature is not part of the core edition (docs/CORE.md).
// It exists so the shared screens compile unchanged; every call is an inert no-op.
export interface FolderGrant {
  path: string;
  name: string;
  grantedAt: number;
}
export function setFolderGrant(_g: FolderGrant | null): void {}
export function getFolderGrant(): FolderGrant | null {
  return null;
}
export function clearFolderGrant(): void {}
