import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  Fingerprint,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
} from "lucide-react";

import {
  login,
  logout,
  registerAccount,
  unlock,
  unlockWithBiometric,
  useAuth,
} from "@/lib/authStore";
import { authApi, type BioKeyMaterial } from "@/lib/api/authApi";
import { ApiError } from "@/lib/api/http";
import { clearOfflineBio, getOfflineBundle, saveOfflineBio } from "@/lib/offlineAccess";
import {
  BIO_TROUBLE_THRESHOLD,
  bioFailureCount,
  clearBioFailures,
  clearBioMarker,
  getBioMarker,
  recordBioFailure,
} from "@/lib/bioEnrollment";
import { translateApiError } from "@/lib/i18n/apiErrors";
import { useT, type I18n } from "@/lib/i18n/i18n";
import { checkPassword } from "@/lib/passwordPolicy";
import { pendingJoinTarget } from "@/lib/pendingJoin";
import { parseJoinFragment } from "@/lib/shareLink";
import { BioCancelledError, platformAuthenticatorAvailable } from "@/lib/webauthnBio";
import { LanguageSelect } from "./LanguageSelect";
import { LegalLinks } from "./LegalPage";
import { Logo } from "./Logo";
import { checkHealth } from "@/lib/quonApi";

type Mode = "login" | "register" | "forgot";

/** Reached `ready` outside of `/join` itself (e.g. the invitee closed the
 *  /join tab and later just logged in from the root page): if a shared-project
 *  invite is still stashed and fresh, resume it instead of landing wherever
 *  this login/unlock would otherwise go. See pendingJoin.ts. A no-op — and
 *  the normal landing proceeds — for the overwhelming majority of logins that
 *  have nothing stashed. */
function resumePendingJoin(navigate: ReturnType<typeof useNavigate>): void {
  const target = pendingJoinTarget();
  if (target) void navigate(target);
}

/** Generate a printable "QUON Recovery Kit" PDF with the 12-word phrase. Labels
 *  are pre-translated by the caller (this function has no hook context). */
async function downloadRecoveryKit(
  mnemonic: string,
  labels: { title: string; generated: string; intro: string; copyLine: string; footer: string },
): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const words = mnemonic.split(" ");
  const W = doc.internal.pageSize.getWidth();
  const M = 48;
  let y = 64;

  doc.setFont("helvetica", "bold").setFontSize(22).setTextColor(20);
  doc.text(labels.title, M, y);
  doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(120);
  y += 18;
  doc.text(labels.generated, M, y);

  y += 28;
  doc.setFontSize(11).setTextColor(30);
  const lines = doc.splitTextToSize(labels.intro, W - M * 2) as string[];
  doc.text(lines, M, y);
  y += lines.length * 14 + 18;

  const rows = 6;
  const rowH = 30;
  const boxH = rows * rowH + 16;
  doc
    .setDrawColor(205)
    .setLineWidth(1)
    .roundedRect(M, y, W - M * 2, boxH, 8, 8);
  const colW = (W - M * 2) / 2;
  doc.setFontSize(13);
  words.forEach((w, i) => {
    const col = i < rows ? 0 : 1;
    const x = M + 16 + col * colW;
    const ty = y + 26 + (i % rows) * rowH;
    doc
      .setFont("helvetica", "normal")
      .setTextColor(150)
      .text(`${i + 1}.`, x, ty);
    doc
      .setFont("helvetica", "bold")
      .setTextColor(20)
      .text(w, x + 26, ty);
  });
  y += boxH + 22;

  // The grid above is for READING. Every cell is its own text run, so a
  // select-all copies "1. word 7. word 2. word …" — numbers interleaved, columns
  // shuffled — and pasting it into a recovery form fails (reported). This one
  // line is the same twelve words in order, in ONE run, so a drag-select copies
  // exactly what the unlock screen expects.
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(120);
  doc.text(labels.copyLine, M, y);
  y += 14;
  doc.setFont("courier", "normal").setFontSize(10.5).setTextColor(20);
  const copyLines = doc.splitTextToSize(words.join(" "), W - M * 2) as string[];
  doc.text(copyLines, M, y);
  y += copyLines.length * 13 + 22;

  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(130);
  doc.text(labels.footer, M, y);

  // Filename stays a fixed, unlocalized slug — it's a file identifier on disk,
  // not UI copy.
  doc.save("QUON-Recovery-Kit.pdf");
}

function errMessage(e: unknown, t: I18n["t"]): string {
  // The scrubber being unreachable or misrouted should read as an infrastructure
  // problem, not a credentials error. A failed fetch throws a TypeError; a wrong
  // / down service answers 404 or 5xx (e.g. another app squatting the API port),
  // which would otherwise surface a bare "Not Found".
  if (e instanceof ApiError) {
    if (e.status === 404) return t("auth.errScrubberUnreachable");
    if (e.status >= 502 && e.status <= 504) return t("auth.errServiceUnavailable");
    return translateApiError(e, t);
  }
  if (e instanceof TypeError) return t("auth.errScrubberDown");
  // The unlock/login decrypt failing (libsodium "wrong secret key for the given
  // ciphertext") just means the password was wrong — say so plainly.
  if (e instanceof Error && /ciphertext|secret key|decrypt/i.test(e.message))
    return t("auth.errWrongPassword");
  return translateApiError(e, t);
}

/** Password input with a Lock icon and a show/hide (eye) toggle. */
function PasswordField(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { t } = useT();
  const [show, setShow] = useState(false);
  return (
    <label className="flex items-center gap-2 rounded-xl border border-quon-border bg-quon-surface px-3 py-2.5 focus-within:border-quon-indigo">
      <Lock className="h-4 w-4 shrink-0 text-quon-muted" />
      <input
        aria-label={(props["aria-label"] as string) ?? (props.placeholder as string)}
        {...props}
        type={show ? "text" : "password"}
        className="flex-1 bg-transparent text-sm text-quon-text placeholder:text-quon-muted focus:outline-none"
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow((v) => !v)}
        className="shrink-0 text-quon-muted hover:text-quon-text"
        aria-label={show ? t("auth.hidePassword") : t("auth.showPassword")}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </label>
  );
}

/** Field with an icon, used across the auth forms. */
function Field({
  icon: Icon,
  ...props
}: { icon: typeof Lock } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex items-center gap-2 rounded-xl border border-quon-border bg-quon-surface px-3 py-2.5 focus-within:border-quon-indigo">
      <Icon className="h-4 w-4 shrink-0 text-quon-muted" />
      <input
        aria-label={(props["aria-label"] as string) ?? (props.placeholder as string)}
        {...props}
        className="flex-1 bg-transparent text-sm text-quon-text placeholder:text-quon-muted focus:outline-none"
      />
    </label>
  );
}

function PrimaryButton({
  loading,
  children,
  ...props
}: { loading?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      disabled={loading || props.disabled}
      className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-quon-indigo px-4 py-3 text-sm font-semibold text-white transition hover:bg-quon-indigo-hover glow-indigo disabled:opacity-50"
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : children}
    </button>
  );
}

function ErrorLine({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-2 text-xs text-red-400">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

// --- Recovery kit ---------------------------------------------------------
function RecoveryKit({ mnemonic, onDone }: { mnemonic: string; onDone: () => void }) {
  const { t } = useT();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const words = mnemonic.split(" ");

  return (
    <div className="flex flex-col gap-4">
      <div className="text-center">
        <ShieldCheck className="mx-auto h-8 w-8 text-quon-green" />
        <h2 className="mt-2 text-lg font-semibold text-quon-text">
          {t("auth.recoveryPhraseTitle")}
        </h2>
        <p className="mt-1 text-xs text-quon-muted">
          {t("auth.recoveryIntroPre")}
          <strong className="text-quon-text">{t("auth.recoveryIntroBold")}</strong>
          {t("auth.recoveryIntroPost")}
        </p>
        <p className="mt-1.5 text-[11px] text-quon-muted">{t("auth.recoveryActivatesNote")}</p>
      </div>

      <div className="grid grid-cols-3 gap-2 rounded-xl border border-quon-border bg-quon-surface p-3">
        {words.map((w, i) => (
          <div key={i} className="flex items-baseline gap-1.5 text-sm">
            <span className="w-4 text-right text-[10px] text-quon-muted">{i + 1}</span>
            <span className="font-medium text-quon-text">{w}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(mnemonic);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-quon-border bg-quon-surface px-3 py-2 text-xs text-quon-muted transition hover:text-quon-text"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5 text-quon-green" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {copied ? t("auth.copied") : t("auth.copyPhrase")}
        </button>
        <button
          onClick={() =>
            void downloadRecoveryKit(mnemonic, {
              title: t("auth.recoveryKitPdfTitle"),
              generated: t("auth.recoveryKitPdfGenerated", { date: new Date().toLocaleString() }),
              intro: t("auth.recoveryKitPdfIntro"),
              copyLine: t("auth.recoveryKitPdfCopyLine"),
              // The instance's own host, not a baked-in domain: a self-hosted
              // deployment must not hand its users a sheet naming someone
              // else's site.
              footer: t("auth.recoveryKitPdfFooter", {
                host: typeof window !== "undefined" ? window.location.host : "QUON",
              }),
            })
          }
          className="flex items-center justify-center gap-1.5 rounded-lg border border-quon-border bg-quon-surface px-3 py-2 text-xs text-quon-muted transition hover:text-quon-text"
        >
          <Download className="h-3.5 w-3.5" /> {t("auth.downloadKitPdf")}
        </button>
      </div>

      {/* Not muted, unlike the surrounding help text: this is the one sentence
          on the screen that must actually be read. Plain foreground rather
          than an alarm colour — red reads as "something went wrong", and
          nothing has. */}
      <label className="flex items-start gap-2 text-xs leading-relaxed text-quon-text">
        <input
          type="checkbox"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
          className="mt-0.5 shrink-0 accent-quon-indigo"
        />
        {t("auth.savedPhraseCheckbox")}
      </label>

      <PrimaryButton disabled={!saved} onClick={onDone}>
        {t("common.continue")} <ArrowRight className="h-4 w-4" />
      </PrimaryButton>
    </div>
  );
}

// --- Unlock (locked session) ----------------------------------------------
export function ScreenUnlock() {
  const { t } = useT();
  const { user, offline } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Biometric unlock (WebAuthn PRF): offered when this device enrolled a
  // credential for THIS user and has a platform authenticator. The wrap
  // material is PREFETCHED so credentials.get() runs inside the click's
  // transient activation (Safari requirement) — awaiting a fetch in the click
  // handler could consume it. A GET 404 means "revoked elsewhere": clear the
  // marker and don't offer the button. Other fetch errors keep the button
  // (transient network blip — retried on click).
  const bioMarker = user ? getBioMarker(user.id) : null;
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioKm, setBioKm] = useState<BioKeyMaterial | null>(null);
  const [bioRevoked, setBioRevoked] = useState(false);
  // Lost-passkey suspicion (see bioEnrollment.ts): at the threshold we stop
  // auto-firing the prompt — on Android a get() for a deleted credential pops
  // the OS's own "kein Passkey vorhanden" sheet on EVERY visit — and show a
  // hint pointing at the password + re-create path instead.
  const [bioTrouble, setBioTrouble] = useState(() =>
    user ? bioFailureCount(user.id) >= BIO_TROUBLE_THRESHOLD : false,
  );
  // Auto-trigger the biometric prompt once the material is ready, so an enrolled
  // user doesn't have to tap the button first. Only fires once per mount
  // (autoTried) so a cancel doesn't loop. On browsers that require a user
  // gesture for credentials.get() (Safari/iOS), the gestureless attempt is
  // rejected as NotAllowedError — indistinguishable from a real cancel, so the
  // AUTO path stays SILENT (no error text) and just leaves the button for a
  // manual, gesture-backed tap. Android Chrome allows the gestureless call, so
  // there the prompt appears on its own.
  const autoTriedRef = useRef(false);
  useEffect(() => {
    if (!bioMarker) return;
    let cancelled = false;
    void platformAuthenticatorAvailable().then((ok) => {
      if (!cancelled) setBioAvailable(ok);
    });
    void authApi
      .bioGet(bioMarker.credentialId)
      .then((km) => {
        if (cancelled) return;
        setBioKm(km);
        // Refresh the offline front door — with this cached, the biometric
        // unlock works with no server in reach (the PRF ceremony is local).
        if (user) saveOfflineBio(user.id, bioMarker.credentialId, km);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          if (user) {
            clearBioMarker(user.id);
            clearOfflineBio(user.id);
          }
          setBioRevoked(true);
          return;
        }
        // Server unreachable: fall back to the cached bio material, if it
        // belongs to this same credential.
        const cached = user ? getOfflineBundle(user.id)?.bio : null;
        if (cached && cached.credential_id === bioMarker.credentialId) setBioKm(cached);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bioMarker?.credentialId, user?.id]);

  async function submitBiometric(auto = false) {
    if (!bioMarker) return;
    setBusy(true);
    setError("");
    try {
      // Re-fetch only if the prefetch failed (transient) — the common path has
      // the material ready so the biometric prompt fires within the gesture.
      const km = bioKm ?? (await authApi.bioGet(bioMarker.credentialId));
      await unlockWithBiometric(bioMarker.credentialId, km);
      if (user) clearBioFailures(user.id);
      resumePendingJoin(navigate);
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.status === 404) {
        if (user) {
          clearBioMarker(user.id);
          clearBioFailures(user.id); // nothing left to repair — honest reset
        }
        setBioRevoked(true);
        if (!auto) setError(t("auth.bioTurnedOff"));
        return;
      }
      // Cancel and "credential gone" are the same NotAllowedError by spec, so
      // every non-404 failure feeds the lost-passkey streak; a success resets
      // it, so genuine one-off cancels never accumulate.
      if (user) {
        const streak = recordBioFailure(user.id);
        if (streak >= BIO_TROUBLE_THRESHOLD) setBioTrouble(true);
      }
      if (err instanceof BioCancelledError) return; // user dismissed — quiet reset
      // A silent auto-attempt that the browser blocked for want of a gesture
      // must NOT show a scary error — the manual button is right there.
      if (!auto) setError(t("auth.bioDidntWork"));
    }
  }

  const showBio = bioMarker != null && bioAvailable && !bioRevoked;

  // Fire the prompt automatically once the material has loaded (see autoTriedRef).
  useEffect(() => {
    if (!showBio || bioKm == null || autoTriedRef.current || bioTrouble) return;
    autoTriedRef.current = true;
    void submitBiometric(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBio, bioKm]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await unlock(password);
      resumePendingJoin(navigate);
    } catch (err) {
      setError(errMessage(err, t));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-center px-8 py-10">
      <Logo size="xl" />
      <p className="mt-3 mb-6 text-center text-sm text-quon-muted">
        {user?.email
          ? t("auth.unlockWelcomeBackEmail", { email: user.email })
          : t("auth.unlockWelcomeBack")}
      </p>
      {offline && (
        <p className="mb-4 -mt-3 max-w-sm text-center text-[11px] leading-snug text-quon-yellow">
          {t("auth.offlineUnlockNote")}
        </p>
      )}
      {showBio && (
        <div className="mb-3 flex w-full max-w-sm flex-col gap-3">
          <PrimaryButton type="button" loading={busy} onClick={() => void submitBiometric()}>
            <Fingerprint className="h-4 w-4" /> {t("auth.unlockWithBiometric")}
          </PrimaryButton>
          {bioTrouble && (
            <p className="text-center text-[11px] leading-snug text-quon-muted">
              {t("auth.bioTroubleHint")}
            </p>
          )}
          <div className="flex items-center gap-3 text-[10px] uppercase tracking-wide text-quon-muted">
            <div className="h-px flex-1 bg-quon-border" /> {t("auth.or")}
            <div className="h-px flex-1 bg-quon-border" />
          </div>
        </div>
      )}
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-3">
        <PasswordField
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t("auth.password")}
        />
        {error && <ErrorLine text={error} />}
        <PrimaryButton loading={busy} type="submit">
          {t("auth.unlock")} <ArrowRight className="h-4 w-4" />
        </PrimaryButton>
      </form>
      <button
        onClick={() => void logout()}
        className="mt-4 text-xs text-quon-muted hover:text-quon-text"
      >
        {t("auth.signInDifferentUser")}
      </button>
    </div>
  );
}

// --- Main auth screen (anonymous) -----------------------------------------
export function ScreenAuth() {
  const { t } = useT();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  // Only a closed instance (SIGNUP_INVITE_CODE set) has a code to ask for; an
  // open one must not show a required field nobody can fill. /health says which.
  const [inviteRequired, setInviteRequired] = useState(false);
  useEffect(() => {
    let cancelled = false;
    checkHealth()
      .then((h) => {
        if (!cancelled) setInviteRequired(Boolean(h.signup_invite_required));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [step, setStep] = useState<"form" | "kit" | "sent">("form");

  // Rendering on /join with a still-valid invite fragment in the URL — used to
  // tell a registering invitee what happens next (they leave for email verify,
  // then come back here automatically). Read directly off the URL rather than
  // the pendingJoin stash so this reflects what's ACTUALLY in the address bar
  // right now, not a side effect of it.
  const isJoinInvite =
    typeof window !== "undefined" &&
    window.location.pathname === "/join" &&
    !!parseJoinFragment(window.location.hash);

  function reset(next: Mode) {
    setMode(next);
    setError("");
    setStep("form");
    setMnemonic(null);
    setPassword("");
    setConfirm("");
    setInviteCode("");
    setAcceptedTerms(false);
  }

  async function doLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(email.trim().toLowerCase(), password);
      resumePendingJoin(navigate);
    } catch (err) {
      setError(errMessage(err, t));
      setBusy(false);
    }
  }

  async function doRegister(e: React.FormEvent) {
    e.preventDefault();
    const pw = checkPassword(password);
    if (!pw.ok) return setError(pw.message!);
    if (password !== confirm) return setError(t("auth.passwordsDoNotMatch"));
    if (!acceptedTerms) return setError(t("auth.acceptTermsRequired"));
    setBusy(true);
    setError("");
    try {
      const phrase = await registerAccount(email.trim().toLowerCase(), password, inviteCode);
      setMnemonic(phrase);
      setStep("kit");
    } catch (err) {
      setError(errMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  async function doForgot(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await authApi.requestReset(email.trim().toLowerCase());
      setStep("sent");
    } catch (err) {
      setError(errMessage(err, t));
    } finally {
      setBusy(false);
    }
  }

  // Register: recovery-kit step
  if (mode === "register" && step === "kit" && mnemonic) {
    return (
      <div className="px-7 py-9">
        <RecoveryKit mnemonic={mnemonic} onDone={() => setStep("sent")} />
      </div>
    );
  }

  // "Check your email" confirmations
  if (step === "sent") {
    const forReset = mode === "forgot";
    return (
      <div className="flex flex-col items-center px-8 py-12 text-center">
        <Mail className="h-9 w-9 text-quon-indigo" />
        <h2 className="mt-3 text-lg font-semibold text-quon-text">{t("auth.checkYourEmail")}</h2>
        {forReset ? (
          <p className="mt-2 max-w-xs text-sm text-quon-muted">{t("auth.resetSentMessage")}</p>
        ) : (
          <>
            {/* Registration fake-succeeds for an already-taken email (enumeration
                defense, see auth.py) — this copy must read identically whichever
                branch actually fired, so it covers both without hinting which one
                happened. Otherwise an existing user is left waiting forever for an
                email that will never arrive, holding a now-dead recovery phrase. */}
            <p className="mt-2 max-w-xs text-sm text-quon-muted">
              {t("auth.sentVerificationPre")}
              <strong>{email}</strong>
              {t("auth.sentVerificationPost")}
            </p>
            <p className="mt-2 max-w-xs text-xs text-quon-muted">
              {t("auth.sentAlreadyPre")}
              <button
                type="button"
                onClick={() => reset("login")}
                className="font-medium text-quon-indigo hover:underline"
              >
                {t("auth.signInLower")}
              </button>
              {t("auth.sentAlreadyMid")}
              <button
                type="button"
                onClick={() => reset("forgot")}
                className="font-medium text-quon-indigo hover:underline"
              >
                {t("auth.forgotPasswordLink")}
              </button>
              {t("auth.sentAlreadyPost")}
            </p>
          </>
        )}
        <button
          onClick={() => reset("login")}
          className="mt-6 text-sm font-medium text-quon-indigo hover:underline"
        >
          {t("auth.backToSignIn")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center px-8 py-10">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="mb-6 text-center"
      >
        <Logo size="xl" />
        <p className="mt-3 text-sm text-quon-muted">{t("auth.tagline")}</p>
      </motion.div>

      {mode === "login" && (
        <form onSubmit={doLogin} className="flex w-full max-w-sm flex-col gap-3">
          <Field
            icon={Mail}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("auth.email")}
            required
          />
          <PasswordField
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("auth.password")}
            required
          />
          {error && <ErrorLine text={error} />}
          <PrimaryButton loading={busy} type="submit">
            {t("auth.signIn")} <ArrowRight className="h-4 w-4" />
          </PrimaryButton>
          <div className="mt-1 flex items-center justify-between text-xs text-quon-muted">
            <button type="button" onClick={() => reset("forgot")} className="hover:text-quon-text">
              {t("auth.forgotPasswordQuestion")}
            </button>
            <span>
              {t("auth.newToQuon")}
              <button
                type="button"
                onClick={() => reset("register")}
                className="font-semibold text-quon-indigo underline-offset-2 hover:underline"
              >
                {t("auth.createAnAccount")}
              </button>
            </span>
          </div>
        </form>
      )}

      {mode === "register" && (
        <form onSubmit={doRegister} className="flex w-full max-w-sm flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-quon-muted">{t("common.language")}</span>
            <LanguageSelect />
          </div>
          {inviteRequired && (
            <Field
              icon={KeyRound}
              type="text"
              autoComplete="off"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder={t("auth.inviteCode")}
              required
            />
          )}
          <Field
            icon={Mail}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("auth.email")}
            required
          />
          <PasswordField
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("auth.passwordMin")}
            required
          />
          <PasswordField
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={t("auth.confirmPassword")}
            required
          />
          <label className="flex items-start gap-2 text-xs leading-snug text-quon-muted">
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
              className="mt-0.5 accent-quon-indigo"
              aria-label={t("auth.acceptTermsAriaLabel")}
            />
            <span>
              {t("auth.termsPre")}
              <Link
                to="/terms"
                target="_blank"
                className="font-medium text-quon-indigo underline-offset-2 hover:underline"
              >
                {t("common.legalTerms")}
              </Link>
              {t("auth.termsPost")}
            </span>
          </label>
          {error && <ErrorLine text={error} />}
          <PrimaryButton loading={busy} type="submit" disabled={!acceptedTerms}>
            {t("auth.createAccount")} <ArrowRight className="h-4 w-4" />
          </PrimaryButton>
          <p className="text-center text-[11px] leading-snug text-quon-muted">
            {t("auth.zeroKnowledgeNotice")}
          </p>
          {isJoinInvite && (
            <p className="text-center text-[11px] leading-snug text-quon-muted">
              {t("auth.joinInviteNotice")}
            </p>
          )}
          <button
            type="button"
            onClick={() => reset("login")}
            className="text-center text-xs font-medium text-quon-indigo hover:underline"
          >
            {t("auth.alreadyHaveAccount")}
          </button>
        </form>
      )}

      {mode === "forgot" && (
        <form onSubmit={doForgot} className="flex w-full max-w-sm flex-col gap-3">
          <p className="text-center text-xs text-quon-muted">{t("auth.forgotIntro")}</p>
          <Field
            icon={Mail}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("auth.email")}
            required
          />
          {error && <ErrorLine text={error} />}
          <PrimaryButton loading={busy} type="submit">
            {t("auth.sendRecoveryLink")} <ArrowRight className="h-4 w-4" />
          </PrimaryButton>
          <button
            type="button"
            onClick={() => reset("login")}
            className="text-center text-xs font-medium text-quon-indigo hover:underline"
          >
            {t("auth.backToSignIn")}
          </button>
        </form>
      )}

      <LegalLinks className="mt-8" />
    </div>
  );
}
