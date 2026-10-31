import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Loader2, ShieldCheck } from "lucide-react";

import { verifyOnce } from "@/lib/verifyOnce";
import { Logo } from "@/components/quon/Logo";
import { translateApiError } from "@/lib/i18n/apiErrors";
import { useT } from "@/lib/i18n/i18n";
import { pendingJoinTarget } from "@/lib/pendingJoin";

export const Route = createFileRoute("/verify")({
  validateSearch: (s: Record<string, unknown>) => ({
    token: typeof s.token === "string" ? s.token : "",
  }),
  component: VerifyPage,
});

const GRADIENT =
  "radial-gradient(ellipse at top, oklch(0.22 0.05 277 / 0.6), transparent 60%), radial-gradient(ellipse at bottom, oklch(0.2 0.04 200 / 0.4), transparent 60%), var(--quon-bg)";

function VerifyPage() {
  const { t } = useT();
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const [state, setState] = useState<"working" | "ok" | "error">("working");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!token) {
        setState("error");
        setMsg(t("auth.missingVerificationToken"));
        return;
      }
      try {
        await verifyOnce(token);
        if (cancelled) return;
        setState("ok");
        // A brand-new invitee who registered from a /join link lands here on a
        // fresh page load (possibly a different tab) with no memory of that
        // URL — resume it now instead of the normal dashboard landing, with
        // the invite fragment restored. The still-`locked` session means
        // AppShell shows the unlock screen next; once unlocked it's already
        // on /join and ScreenJoinShare takes over. See pendingJoin.ts.
        const pendingJoin = pendingJoinTarget();
        setTimeout(() => (pendingJoin ? navigate(pendingJoin) : navigate({ to: "/" })), 1200);
      } catch (e) {
        if (cancelled) return;
        setState("error");
        setMsg(e instanceof Error ? translateApiError(e, t) : t("auth.verificationFailed"));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, navigate]);

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4 py-8"
      style={{ background: GRADIENT }}
    >
      <div className="w-full max-w-md rounded-2xl border border-quon-border bg-quon-bg/80 px-8 py-12 text-center shadow-2xl">
        <Logo size="xl" />
        <div className="mt-8">
          {state === "working" && (
            <div className="flex flex-col items-center gap-3 text-quon-muted">
              <Loader2 className="h-7 w-7 animate-spin text-quon-indigo" />
              <p className="text-sm">{t("auth.verifyingAccount")}</p>
            </div>
          )}
          {state === "ok" && (
            <div className="flex flex-col items-center gap-3">
              <ShieldCheck className="h-9 w-9 text-quon-green" />
              <p className="text-sm text-quon-text">{t("auth.accountVerified")}</p>
            </div>
          )}
          {state === "error" && (
            <div className="flex flex-col items-center gap-3">
              <AlertTriangle className="h-8 w-8 text-red-400" />
              <p className="text-sm text-red-400">{msg}</p>
              <Link to="/" className="mt-2 text-sm font-medium text-quon-indigo hover:underline">
                {t("auth.backToSignIn")}
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
