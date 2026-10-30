/**
 * Attribution for page reloads — turning "die Seite wird kurz schwarz" into
 * data (reported 2026-08-07 for the native app, possibly also the iPhone PWA).
 *
 * Every INTENTIONAL reload in the codebase calls markIntentionalReload(reason)
 * first; at boot, explainBoot() checks the navigation type and writes one
 * diagnostic line. The interesting case is a RELOAD navigation with NO marker:
 * nothing in our code did it, which on WKWebView (the native shell, iOS
 * Safari/PWA) almost always means the OS killed the webview's content process
 * — typically memory pressure — and the view relaunched. That mapping is the
 * hypothesis this instrumentation exists to confirm or kill; the lines land in
 * the diag log the user can attach to feedback (getDiagReport).
 *
 * sessionStorage on purpose: survives exactly one reload of THIS tab, never
 * syncs, no secrets (a short reason string).
 */

import { diagAppend, previousSessionWasUnclean } from "./diagLog";

const KEY = "quon_reload_reason_v1";

/** Call immediately BEFORE an intentional location.reload(). */
export function markIntentionalReload(reason: string): void {
  try {
    sessionStorage.setItem(KEY, reason);
  } catch {
    /* private mode — the reload will read as unexplained, which is noisy but safe */
  }
}

/** Boot-time: attribute how we got here. Quiet for a plain first navigation. */
export function explainBoot(): void {
  let marker: string | null = null;
  try {
    marker = sessionStorage.getItem(KEY);
    if (marker) sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  let navType = "unknown";
  try {
    const nav = performance.getEntriesByType("navigation")[0] as
      PerformanceNavigationTiming | undefined;
    if (nav) navType = nav.type;
  } catch {
    /* ignore */
  }
  if (marker) {
    diagAppend(`boot: reload (intentional: ${marker})`);
  } else if (navType === "reload") {
    // No code path of ours did this. On WKWebView this is the signature of a
    // content-process termination — the black-flash report.
    diagAppend("boot: UNEXPLAINED reload — likely the OS restarted the webview");
  } else if (previousSessionWasUnclean()) {
    // The boot type is only diagnostic TOGETHER with the crash marker: issue
    // #37's silent kill relaunched as a plain "navigate", so the type is what
    // distinguishes it from an ordinary start. On a healthy device this stays
    // silent ON PURPOSE — logging every boot would mean the diagnostics buffer
    // is never empty, and the feedback dialog could never say "no technical
    // log recorded" (caught by feedback.spec.ts after exactly that mistake).
    diagAppend(`boot after unclean shutdown: type=${navType}`);
  }
}
