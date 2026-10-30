import { markIntentionalReload } from "@/lib/reloadReason";
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { checkForUpdate, isChunkLoadError, versionCheckEnabled } from "@/lib/appVersion";
import { useT } from "@/lib/i18n/i18n";

/** How often a long-lived instance re-checks. Deploys happen a few times a day,
 *  so this is about eventually noticing, not about reacting fast. */
const POLL_MS = 15 * 60 * 1000;

/**
 * A slim bar offering a reload once a newer build is deployed.
 *
 * The problem it solves: a running instance keeps the JavaScript it loaded, and
 * an installed PWA is never reloaded just because we deployed — so the user
 * keeps testing the old code and reports bugs in features that already shipped.
 *
 * It never reloads on its own. A surprise reload would discard a half-typed
 * message or an answer still streaming; the user picks the moment. The check
 * also runs when the app comes back to the foreground, which is exactly when a
 * phone user returns after a deploy.
 */
export function UpdateBanner() {
  const { t } = useT();
  const [outdated, setOutdated] = useState(false);

  // A failed lazy import is PROOF that this instance outlived its build — the
  // chunk it asked for is gone from the server. Surface the reload offer at
  // once instead of waiting for the next poll; this is the moment the user is
  // actually blocked. Registered even for unstamped builds: the error is
  // self-evident, no version comparison needed.
  useEffect(() => {
    const onPreloadError = () => setOutdated(true);
    const onRejection = (e: PromiseRejectionEvent) => {
      if (isChunkLoadError(e.reason)) setOutdated(true);
    };
    window.addEventListener("vite:preloadError", onPreloadError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("vite:preloadError", onPreloadError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  useEffect(() => {
    if (!versionCheckEnabled()) return; // dev / tests: never nag
    const controller = new AbortController();
    let stopped = false;

    const run = () => {
      void checkForUpdate(controller.signal).then((v) => {
        if (!stopped && v) setOutdated(true); // latch: it can't become current again
      });
    };

    run();
    const timer = setInterval(run, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!outdated) return null;
  return (
    <div className="flex shrink-0 items-center justify-center gap-2 border-b border-quon-indigo/30 bg-quon-indigo/10 px-3 py-1.5 text-[11px] text-quon-text">
      <span className="truncate">{t("common.updateAvailable")}</span>
      <button
        onClick={() => {
          markIntentionalReload("update-banner");
          window.location.reload();
        }}
        className="flex shrink-0 items-center gap-1 rounded-lg bg-quon-indigo px-2 py-1 text-[11px] font-semibold text-white"
      >
        <RefreshCw className="h-3 w-3" /> {t("common.reload")}
      </button>
    </div>
  );
}
