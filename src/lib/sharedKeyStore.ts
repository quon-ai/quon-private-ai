// Stub: this feature is not part of this repository yet; kept code imports this module.
// It exists so the shared screens compile unchanged; every call is an inert no-op.
export function putProjectKey(_projectId: string, _key: Uint8Array): void {}
export function getProjectKey(_projectId: string): Uint8Array | null {
  return null;
}
export function unsealGrant(_projectId: string, _sealedPkB64: string): Uint8Array {
  throw new Error("Shared projects are not available in this build.");
}
export function removeProjectKey(_projectId: string): void {}
export function clearProjectKeys(): void {}
export function resetInMemoryProjectKeys(): void {}
