import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowRight, KeyRound, Loader2, Lock } from "lucide-react";

import { isValidMnemonic } from "@/lib/crypto/quonCrypto";
import { recoverWithPhrase } from "@/lib/authStore";
import { translateApiError } from "@/lib/i18n/apiErrors";
import { useT } from "@/lib/i18n/i18n";
import { checkPassword } from "@/lib/passwordPolicy";
import { Logo } from "@/components/quon/Logo";

export const Route = createFileRoute("/recover")({
  validateSearch: (s: Record<string, unknown>) => ({
    token: typeof s.token === "string" ? s.token : "",
  }),
  component: RecoverPage,
});

const GRADIENT =
  "radial-gradient(ellipse at top, oklch(0.22 0.05 277 / 0.6), transparent 60%), radial-gradient(ellipse at bottom, oklch(0.2 0.04 200 / 0.4), transparent 60%), var(--quon-bg)";

function RecoverPage() {
  const { t } = useT();
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const [phrase, setPhrase] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const m = phrase.trim().toLowerCase().replace(/\s+/g, " ");
    if (!isValidMnemonic(m)) return setError(t("auth.invalidRecoveryPhrase"));
    const pw = checkPassword(password);
    if (!pw.ok) return setError(pw.message!);
    if (password !== confirm) return setError(t("auth.passwordsDoNotMatch"));
    setBusy(true);
    setError("");
    try {
      await recoverWithPhrase(token, m, password);
      setDone(true);
      setTimeout(() => navigate({ to: "/" }), 1500);
    } catch (err) {
      setError(err instanceof Error ? translateApiError(err, t) : t("auth.recoveryFailed"));
      setBusy(false);
    }
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4 py-8"
      style={{ background: GRADIENT }}
    >
      <div className="w-full max-w-md rounded-2xl border border-quon-border bg-quon-bg/80 px-8 py-10 shadow-2xl">
        <div className="mb-6 text-center">
          <Logo size="xl" />
          <p className="mt-3 text-sm text-quon-muted">{t("auth.recoverAccountTitle")}</p>
        </div>

        {!token ? (
          <p className="text-center text-sm text-quon-muted">
            {t("auth.openRecoveryLinkPre")}{" "}
            <Link to="/" className="font-medium text-quon-indigo hover:underline">
              {t("auth.backToSignIn")}
            </Link>
          </p>
        ) : done ? (
          <p className="text-center text-sm text-quon-text">{t("auth.passwordResetDone")}</p>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <p className="text-xs text-quon-muted">{t("auth.recoverIntro")}</p>
            <div className="flex items-start gap-2 rounded-xl border border-quon-border bg-quon-surface px-3 py-2.5 focus-within:border-quon-indigo">
              <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-quon-muted" />
              <textarea
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                placeholder={t("auth.recoveryPhrasePlaceholder")}
                rows={3}
                className="flex-1 resize-none bg-transparent text-sm text-quon-text placeholder:text-quon-muted focus:outline-none"
              />
            </div>
            <label className="flex items-center gap-2 rounded-xl border border-quon-border bg-quon-surface px-3 py-2.5 focus-within:border-quon-indigo">
              <Lock className="h-4 w-4 shrink-0 text-quon-muted" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("auth.newPasswordMin")}
                className="flex-1 bg-transparent text-sm text-quon-text placeholder:text-quon-muted focus:outline-none"
              />
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-quon-border bg-quon-surface px-3 py-2.5 focus-within:border-quon-indigo">
              <Lock className="h-4 w-4 shrink-0 text-quon-muted" />
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={t("auth.confirmNewPassword")}
                className="flex-1 bg-transparent text-sm text-quon-text placeholder:text-quon-muted focus:outline-none"
              />
            </label>
            {error && (
              <div className="flex items-start gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-xs text-red-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            <button
              type="submit"
              disabled={busy}
              className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-quon-indigo px-4 py-3 text-sm font-semibold text-white transition hover:bg-quon-indigo-hover glow-indigo disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  {t("auth.resetPassword")} <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
