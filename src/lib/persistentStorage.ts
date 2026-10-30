import { currentPolicy } from "./deviceClass";
import { diagAppend } from "./diagLog";

let asked = false;

/**
 * Ask the browser to treat this origin's storage as persistent, i.e. exempt
 * from quota eviction. Chrome grants it silently to installed PWAs and
 * engaged sites and denies it silently otherwise — there is no prompt and no
 * cost in asking. Without it a 4 GB Android under storage pressure evicts the
 * IndexedDB cache (and the 100+ MB model cache that makes this origin a prime
 * candidate) while the sync cursors in localStorage survive (feedback #88).
 *
 * Logged only on a constrained device and only when denied: on a healthy
 * device the diagnostics stay empty on purpose ("empty diag = healthy").
 */
export async function requestPersistentStorage(): Promise<void> {
  if (asked || typeof navigator === "undefined" || !navigator.storage?.persist) return;
  asked = true;
  try {
    if (await navigator.storage.persisted?.()) return;
    const granted = await navigator.storage.persist();
    if (!granted && currentPolicy().reason !== "normal") {
      diagAppend("storage: persistent storage denied — the browser may evict the local cache");
    }
  } catch {
    /* not every browser implements it; nothing to do */
  }
}
