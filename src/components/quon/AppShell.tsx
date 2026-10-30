import { explainBoot } from "@/lib/reloadReason";
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { AlertTriangle, Loader2, RefreshCw, Settings as SettingsIcon, WifiOff } from "lucide-react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import { initAuth, useAuth } from "@/lib/authStore";
import { installDiagCapture } from "@/lib/diagLog";
import { applyFontScale } from "@/lib/fontScale";
import { useT } from "@/lib/i18n/i18n";
import { armIfEligible } from "@/lib/onboardingStore";
import { PUSH_BATCH_SIZE } from "@/lib/collectionSync";
import { useQuonState } from "@/lib/quonStore";
import { startSync, stopSync } from "@/lib/syncEngine";
import { logBootSummary } from "@/lib/bootSummary";
import { getSyncStatus, getSyncStatusServer, subscribeSyncStatus } from "@/lib/syncStatus";
import { AppSidebar } from "./AppSidebar";
import { ReleaseNotesModal } from "./ReleaseNotesModal";
import { UpdateBanner } from "./UpdateBanner";
import { ScreenAuth, ScreenUnlock } from "./ScreenAuth";
import { Logo } from "./Logo";
import { StatusIndicator } from "./StatusIndicator";

const PAGE_TITLE_KEYS: Record<
  string,
  | "nav.dashboard"
  | "nav.chat"
  | "nav.memory"
  | "nav.documents"
  | "nav.projects"
  | "nav.connectors"
  | "nav.agents"
  | "nav.admin"
  | "nav.settings"
> = {
  "/dashboard": "nav.dashboard",
  "/connectors": "nav.connectors",
  "/agents": "nav.agents",
  "/admin": "nav.admin",
  "/chat": "nav.chat",
  "/memory": "nav.memory",
  "/documents": "nav.documents",
  "/projects": "nav.projects",
  "/settings": "nav.settings",
};

/** Below this, a push is over before a banner could inform anyone — showing one
 *  would just blink on every ordinary save. */
const SYNC_BANNER_MIN_ITEMS = 10;

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useT();
  const { status, user, offline } = useAuth();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const pageTitleKey = PAGE_TITLE_KEYS[pathname];
  const pageTitle = pageTitleKey ? t(pageTitleKey) : "QUON";
  const wasReady = useRef(false);

  // Apply the device's text-size preference to the document root — on boot
  // (defaults to "standard" until the encrypted local cache opens post-unlock,
  // see quonStore.ts's `fontScale` docstring) and again on every change from
  // Settings, so it takes effect immediately without a reload.
  const { fontScale } = useQuonState();
  useEffect(() => {
    applyFontScale(fontScale);
  }, [fontScale]);

  // Resolve the session once on boot.
  useEffect(() => {
    void initAuth();
    // Crash-surviving diagnostics: capture window errors/rejections + the
    // "previous session never shut down cleanly" marker (diagLog.ts). Installed
    // here so it also covers the locked/unlock screens this shell wraps.
    installDiagCapture();
    // Attribute reload boots (the "black flash" report) — see reloadReason.ts.
    explainBoot();
  }, []);

  // Start/stop the sync engine with the unlocked state; bounce "/" → dashboard.
  useEffect(() => {
    if (status === "ready" && user) {
      // Per-account local-data isolation. If the data cached in this browser
      // belongs to a different (or unknown, e.g. first load after this fix)
      // account, purge it + the sync cursors BEFORE pulling this account's — so a
      // new/other account in a shared browser never inherits the previous
      // account's cached chats / memory / documents. Same account → no wipe
      // (incremental sync resumes from the cursors).
      const ACTIVE_USER_KEY = "quon_active_user";
      let prevUser: string | null = null;
      try {
        prevUser = localStorage.getItem(ACTIVE_USER_KEY);
      } catch {
        /* ignore */
      }
      if (prevUser !== user.id) stopSync();
      try {
        localStorage.setItem(ACTIVE_USER_KEY, user.id);
      } catch {
        /* ignore */
      }
      startSync();
      // One diagnostic line with the numbers a crash report needs (counts and
      // megabytes only — bootSummary.ts). Fire-and-forget after hydration.
      void logBootSummary();
      // MUST run after stopSync() above: stopSync (a different/unknown previous
      // account, incl. every brand-new account's very first ready transition)
      // calls resetState(), which would otherwise wipe the onboarding step this
      // sets right back to its "already seen" defaults.
      armIfEligible();
      wasReady.current = true;
      if (pathname === "/") navigate({ to: "/dashboard" });
    } else if (wasReady.current && status === "anonymous") {
      stopSync();
      wasReady.current = false;
    }
  }, [status, user?.id, pathname, navigate]);

  // Offline mode: the shell renders from the encrypted local caches; the
  // reconnect watcher (authStore) upgrades in place when the network returns.
  // One quiet, persistent line — not a scary error: nothing is wrong, and the
  // send path is already fail-closed while the scrubber is unreachable.
  const offlineBanner = offline ? (
    <div className="flex items-center justify-center gap-2 border-b border-quon-yellow/30 bg-quon-yellow/10 px-3 py-1.5 text-[11px] font-medium text-quon-yellow">
      <WifiOff className="h-3.5 w-3.5 shrink-0" />
      {t("nav.offlineBanner")}
    </div>
  ) : null;

  // Sync used to be entirely invisible — a push that failed looked exactly like
  // a push that wasn't needed, which is how an oversized chat could wedge a
  // whole collection unnoticed. Two states earn a line here.
  const sync = useSyncExternalStore(subscribeSyncStatus, getSyncStatus, getSyncStatusServer);
  const syncBanner = sync.blocked.length ? (
    // Durable: this will not resolve on its own, so it stays until acted on.
    <div className="flex items-center justify-center gap-2 border-b border-quon-yellow/30 bg-quon-yellow/10 px-3 py-1.5 text-[11px] font-medium text-quon-yellow">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      {sync.blocked.length === 1
        ? t("nav.syncBlockedOne")
        : t("nav.syncBlockedMany", { count: sync.blocked.length })}
    </div>
  ) : sync.busy && sync.total > SYNC_BANNER_MIN_ITEMS ? (
    // Transient: only for a push big enough to be felt. A routine save is one
    // or two blobs and finishes inside the debounce — banner-ing that would
    // blink on every edit.
    <div className="flex items-center justify-center gap-2 border-b border-quon-border bg-quon-surface px-3 py-1.5 text-[11px] font-medium text-quon-muted">
      <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" />
      {/* ⚠️ Show a fraction ONLY when it can actually advance. Progress is
          observable at batch granularity, so a push that fits in one batch sat
          at "(0/29)" for its whole duration — reported as meaningless, rightly:
          it named neither what was syncing nor how far along it was. Below one
          batch we say what is happening and how much there is, and let the
          spinner carry "still working". */}
      {sync.total > PUSH_BATCH_SIZE
        ? t("nav.syncBusyProgress", { done: sync.done, total: sync.total })
        : t("nav.syncBusy", { count: sync.total })}
    </div>
  ) : null;

  if (status === "loading") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-quon-bg">
        <Logo size="md" />
        <Loader2
          className="h-5 w-5 animate-spin text-quon-muted"
          aria-label={t("common.loading")}
        />
      </div>
    );
  }

  if (status === "unreachable") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-quon-bg px-6 text-center">
        <Logo size="md" />
        <WifiOff className="h-8 w-8 text-quon-muted" />
        <div className="max-w-sm space-y-1">
          <p className="text-sm font-medium text-quon-text">{t("nav.cantReachTitle")}</p>
          <p className="text-sm text-quon-muted">{t("nav.cantReachBody")}</p>
        </div>
        <button
          onClick={() => void initAuth()}
          className="rounded-xl bg-quon-indigo px-4 py-2 text-sm font-semibold text-white transition hover:bg-quon-indigo-hover glow-indigo"
        >
          {t("common.tryAgain")}
        </button>
      </div>
    );
  }

  if (status === "anonymous" || status === "locked") {
    return (
      <div
        className="flex min-h-screen items-center justify-center px-4 py-8"
        style={{
          background:
            "radial-gradient(ellipse at top, oklch(0.22 0.05 277 / 0.6), transparent 60%), radial-gradient(ellipse at bottom, oklch(0.2 0.04 200 / 0.4), transparent 60%), var(--quon-bg)",
        }}
      >
        <div className="w-full max-w-md rounded-2xl border border-quon-border bg-quon-bg/80 shadow-2xl">
          {status === "locked" ? <ScreenUnlock /> : <ScreenAuth />}
        </div>
      </div>
    );
  }

  if (isMobile) {
    const showSettingsIcon = pathname !== "/settings";
    return (
      <SidebarProvider defaultOpen={false}>
        {/* On mobile the sidebar renders as a slide-in sheet (menu button top-left). */}
        <ReleaseNotesModal />
        <AppSidebar />
        <div className="flex h-dvh w-full flex-col bg-quon-bg">
          <UpdateBanner />
          {offlineBanner}
          {syncBanner}
          <header
            className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-quon-border bg-quon-bg/95 px-3 py-3 backdrop-blur"
            style={{ paddingTop: "max(env(safe-area-inset-top), 0.75rem)" }}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <SidebarTrigger
                className="h-11 w-11 shrink-0 rounded-xl border border-quon-border bg-quon-surface text-quon-text shadow-sm hover:bg-quon-surface-2 hover:text-quon-text [&_svg]:h-5 [&_svg]:w-5"
                aria-label={t("nav.openMenu")}
              />
              <Logo size="md" />
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <StatusIndicator compact />
              {showSettingsIcon && (
                <Link
                  to="/settings"
                  className="rounded-xl border border-quon-border bg-quon-surface p-2.5 text-quon-muted transition hover:bg-quon-surface-2 hover:text-quon-text"
                  aria-label={t("nav.settings")}
                >
                  <SettingsIcon className="h-5 w-5" />
                </Link>
              )}
            </div>
          </header>
          <main
            className="flex min-h-0 flex-1 flex-col"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            {children}
          </main>
        </div>
      </SidebarProvider>
    );
  }

  // Desktop layout
  return (
    <SidebarProvider>
      <ReleaseNotesModal />
      <div className="flex h-dvh w-full bg-quon-bg">
        <AppSidebar />
        <div className="flex min-h-0 flex-1 flex-col">
          <UpdateBanner />
          {offlineBanner}
          {syncBanner}
          <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-3 border-b border-quon-border bg-quon-bg/95 px-3 backdrop-blur">
            <SidebarTrigger />
            <span className="text-sm font-semibold text-quon-text">{pageTitle}</span>
            <div className="ml-auto">
              <StatusIndicator />
            </div>
          </header>
          <main className="flex min-h-0 flex-1 flex-col">
            {/* min-h-0 is load-bearing: without it this column can't shrink below its
                content, the chat overflows the viewport and the composer scrolls away
                instead of staying pinned at the bottom. */}
            <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">{children}</div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
