/**
 * Registry of in-flight chat generations, keyed by chat-session id.
 *
 * The streaming loop itself stays in ScreenChat, but the abort handle + "is this
 * session generating" live here at module scope so a generation **survives navigation**
 * between chats: when the user opens another chat the component re-renders (the run's
 * closure keeps streaming and persisting to its session), and this registry lets the
 * foreground know whether the chat it's showing is still generating and lets it abort
 * the right one. Per-session controllers mean a second chat can generate while the
 * first finishes, without clobbering each other's abort handle.
 */

export interface ActiveRun {
  controller: AbortController;
  /** id of the streaming assistant message within that session's messages. */
  assistantId: number;
}

const runs = new Map<string, ActiveRun>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function beginRun(sessionId: string, run: ActiveRun): void {
  runs.set(sessionId, run);
  emit();
}

/** Clear a finished/aborted run. No-op if already gone. */
export function endRun(sessionId: string): void {
  if (runs.delete(sessionId)) emit();
}

export function getRun(sessionId: string | null | undefined): ActiveRun | undefined {
  return sessionId ? runs.get(sessionId) : undefined;
}

export function isGenerating(sessionId: string | null | undefined): boolean {
  return !!sessionId && runs.has(sessionId);
}

/** Abort the run for a session, if any. The owning loop's `finally` calls endRun. */
export function abortRun(sessionId: string | null | undefined): void {
  const run = sessionId ? runs.get(sessionId) : undefined;
  run?.controller.abort();
}

/** Subscribe to start/stop of any run (drives the foreground "generating" state). */
export function onRunnerChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Test-only reset. */
export function resetRuns(): void {
  runs.clear();
  emit();
}
