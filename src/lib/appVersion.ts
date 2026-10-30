/**
 * "A new version is available" — the missing half of every deploy.
 *
 * A running instance keeps the JavaScript it loaded. An installed PWA is never
 * reloaded just because the operator deployed, so after a deploy the user goes
 * on using the OLD code — which once cost a bug report for a feature that was
 * already live. Nothing here reloads on its own: an unannounced reload would
 * throw away a half-typed message or an answer still streaming. The user is
 * told, and decides.
 *
 * `CURRENT_BUILD` is stamped in at build time (vite.config's `define`, fed by
 * scripts/write-version.mjs); `/version.json` carries the id of whatever is
 * deployed right now.
 */

export const CURRENT_BUILD: string = import.meta.env.VITE_QUON_BUILD ?? "dev";

/** Unstamped builds (dev server, tests) must never nag about updates. */
export function versionCheckEnabled(): boolean {
  return CURRENT_BUILD !== "dev" && CURRENT_BUILD !== "";
}

/**
 * Decide whether the deployed build differs from ours. Pure, so the rule is
 * testable without a network: an unreadable or empty answer means "don't
 * know", never "outdated" — a hiccup must not put a permanent banner on screen.
 */
export function isOutdated(current: string, deployed: unknown): boolean {
  if (!versionCheckEnabledFor(current)) return false;
  const other = typeof deployed === "string" ? deployed.trim() : "";
  if (!other) return false;
  return other !== current;
}

function versionCheckEnabledFor(current: string): boolean {
  return current !== "dev" && current !== "";
}

/**
 * Fetch the deployed build id. `cache: "no-store"` is the whole point — a
 * cached answer would report our own build forever. Returns null on any
 * failure (offline, proxy hiccup): silence beats a false alarm.
 */
export async function fetchDeployedBuild(signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch("/version.json", { cache: "no-store", signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { build?: unknown };
    return typeof body.build === "string" && body.build ? body.build : null;
  } catch {
    return null;
  }
}

/** True when a NEWER build is deployed than the one running. */
export async function checkForUpdate(signal?: AbortSignal): Promise<boolean> {
  if (!versionCheckEnabled()) return false;
  return isOutdated(CURRENT_BUILD, await fetchDeployedBuild(signal));
}

/**
 * True when an error is "the code I wanted is no longer on the server".
 *
 * A running instance loads chunks by content hash. Deploy, and those hashes are
 * gone — so the next lazy import (the OCR engine, the document extractor) fails
 * with a raw "Failed to fetch dynamically imported module …", which is both
 * unactionable and alarming. Reported from the photo scanner.
 *
 * Matches on the message because that is all the platform gives us: Chrome and
 * Firefox say "Failed to fetch dynamically imported module", Safari
 * "Importing a module script failed", and Vite raises its own
 * `vite:preloadError`.
 */
export function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return /dynamically imported module|importing a module script failed|failed to fetch dynamically/i.test(
    msg,
  );
}
