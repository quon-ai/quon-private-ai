/**
 * Sync-engine wiring for the optional features - this build: there are
 * none, so every hook is a no-op. syncEngine.ts is identical in both editions.
 */
import type { CollectionSync } from "./collectionSync";

export function extraEngines(): CollectionSync[] {
  return [];
}
export function startExtras(): void {}
export function stopExtras(): void {}
export function resetExtras(): void {}
