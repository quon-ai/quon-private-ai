/**
 * One diagnostic line per boot with the NUMBERS a crash report needs — but
 * only on a session where a crash report is a live possibility.
 *
 * The iPhone reports (#68, #76) carried a perfect timeline of deaths and not a
 * single figure about what the device was carrying: how many documents and
 * chunks sit in memory after hydration, how much storage the cache holds,
 * which policy the session runs under, whether an originals upload is
 * pending. Every one of those is decisive for a memory kill, and none of them
 * is personal data — counts and megabytes only, never a name or a text.
 *
 * Gated on `currentPolicy().reason !== "normal"` (constrained device or safe
 * mode): the feedback dialog treats an EMPTY diag log as "nothing to report"
 * and hides the attach option (`tests/e2e/feedback.spec.ts` — a healthy
 * account must see "No technical log recorded"). Logging on every boot,
 * including every ordinary desktop/Android session, would have made that
 * buffer non-empty for everyone and turned a genuine signal into noise —
 * found by that very test after the first version of this function ran
 * unconditionally.
 */

import { currentPolicy } from "./deviceClass";
import { diagAppend } from "./diagLog";
import { getAllDocuments, whenDocumentsLoaded } from "./documentStore";
import { originalKind } from "./documents/originalStore";
import { getAllMemory } from "./memoryStore";

let done = false;

export async function logBootSummary(): Promise<void> {
  if (done || typeof window === "undefined") return;
  done = true;
  if (currentPolicy().reason === "normal") return;
  try {
    await whenDocumentsLoaded();
    const docs = getAllDocuments();
    const chunks = docs.reduce((n, d) => n + d.chunks.length, 0);
    const pendingOriginals = docs.filter((d) => {
      if (d.status !== "ready" || d.original) return false;
      const kind = originalKind(d.mime, d.filename);
      return !!kind && kind !== "md";
    }).length;
    let storage = "n/a";
    try {
      const est = await navigator.storage?.estimate?.();
      if (est?.usage != null) storage = `${Math.round(est.usage / 1048576)}MB`;
    } catch {
      /* not every WebKit reports it */
    }
    const p = currentPolicy();
    diagAppend(
      `boot summary: docs=${docs.length} chunks=${chunks} memoryItems=${getAllMemory().length} ` +
        `pendingOriginals=${pendingOriginals} storage=${storage} policy=${p.reason}`,
    );
  } catch {
    /* diagnostics must never affect the app */
  }
}
