// Core-edition stub: this feature is not part of the core edition (docs/CORE.md).
// It exists so the shared screens compile unchanged; every call is an inert no-op.
export interface BriefingItem {
  kind: string;
  title: string;
  at: number;
}
export interface Briefing {
  date: string;
  items: BriefingItem[];
}
export function computeRecentChanges(_sinceMs: number): BriefingItem[] {
  return [];
}
export function subscribeBriefing(_cb: () => void): () => void {
  return () => {};
}
export function getBriefing(): Briefing | null {
  return null;
}
export function getBriefingServer(): Briefing | null {
  return null;
}
export function runDailyBriefing(_now: number = Date.now()): void {}
export async function refreshCalendar(_now: number = Date.now()): Promise<void> {}
export function dismissBriefing(): void {}
export function _resetBriefingSession(): void {}
