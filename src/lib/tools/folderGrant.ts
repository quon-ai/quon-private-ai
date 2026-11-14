// Stub: this feature is not part of this repository; kept code imports this module.
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
