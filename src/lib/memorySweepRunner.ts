/**
 * Module-level runner for the "Learn from chats" sweep.
 *
 * The sweep is fire-and-forget and can take a while (one relay call per chat).
 * Keeping its progress in a component's local state loses it the moment the
 * user navigates away and back (unmount -> state reset), and lets them start a
 * second concurrent sweep. So the run state lives here, keyed by scope, and the
 * button subscribes via useSyncExternalStore - the status survives navigation
 * and a re-entered screen shows the live progress or the final result.
 *
 * Mirrors the chatRunner pattern (module state + listener set).
 */

import { tr } from "./i18n/i18n";
import { runMemorySweep, type SweepOptions } from "./memoryExtract";
import { runDocumentMemorySweep } from "./memoryFromDocuments";
import type { RagScope } from "./rag";

/** Which source a sweep mines. Chats and documents run independently (own
 *  state, own progress) so one can be running while the other reports. */
export type SweepKind = "chats" | "documents";

export interface SweepRunState {
  running: boolean;
  /** Progress label while running, or the final summary after it finishes. */
  status: string | null;
}

const IDLE: SweepRunState = Object.freeze({ running: false, status: null });

// Snapshot objects are replaced on change and kept stable otherwise, so
// useSyncExternalStore sees a new reference only when a scope actually updates.
const states = new Map<string, SweepRunState>();
const listeners = new Set<() => void>();

const keyOf = (scope: RagScope, kind: SweepKind): string => `${kind}:${scope ?? "__global__"}`;

function emit(): void {
  for (const l of listeners) l();
}

function set(key: string, next: SweepRunState): void {
  states.set(key, next);
  emit();
}

export function subscribeSweep(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Stable snapshot for a scope + source (IDLE reference when nothing ran). */
export function getSweepState(scope: RagScope, kind: SweepKind = "chats"): SweepRunState {
  return states.get(keyOf(scope, kind)) ?? IDLE;
}

/** Human summary of a finished sweep (moved here so it persists in the state).
 *  Localized via `tr` (module-level, no hook) - see i18n.tsx. */
function summarize(res: { analyzed: number; failed: number; suggestions: number }): string {
  const parts: string[] = [];
  if (res.suggestions > 0) {
    parts.push(
      res.suggestions === 1
        ? tr("memory.sweep.suggestions.one", { count: res.suggestions })
        : tr("memory.sweep.suggestions.other", { count: res.suggestions }),
    );
  } else if (res.analyzed > 0) {
    parts.push(tr("memory.sweep.nothingNew"));
  } else if (res.failed === 0) {
    parts.push(tr("memory.sweep.noContent"));
  }
  if (res.failed > 0) {
    parts.push(
      res.failed === 1
        ? tr("memory.sweep.failed.one", { count: res.failed })
        : tr("memory.sweep.failed.other", { count: res.failed }),
    );
  }
  return parts.join(" — ");
}

/** Start a sweep for `opts.scope` unless one is already running there for the
 *  same source. The onProgress in `opts` is ignored - progress is routed to the
 *  module state. */
export function startSweep(opts: SweepOptions & { kind?: SweepKind }): void {
  const kind: SweepKind = opts.kind ?? "chats";
  const key = keyOf(opts.scope, kind);
  if (states.get(key)?.running) return; // one sweep per scope + source at a time
  set(key, { running: true, status: tr("memory.sweep.looking") });
  void (async () => {
    const run = kind === "documents" ? runDocumentMemorySweep : runMemorySweep;
    try {
      const res = await run({
        ...opts,
        onProgress: (label) => set(key, { running: true, status: label }),
      });
      set(key, { running: false, status: summarize(res) });
    } catch {
      // The sweeps swallow per-item errors; this catches the unexpected.
      set(key, { running: false, status: tr("memory.sweep.error") });
    }
  })();
}

/** Whether a sweep is currently running for a scope + source. */
export function isSweeping(scope: RagScope, kind: SweepKind = "chats"): boolean {
  return !!states.get(keyOf(scope, kind))?.running;
}
