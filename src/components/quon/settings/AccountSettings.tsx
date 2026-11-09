/**
 * Account tab: change email, change password, recovery hint, delete account.
 *
 * Zero-knowledge is preserved throughout:
 *   - change-password re-wraps the UNCHANGED Master Key client-side (see
 *     authStore.changePassword) - the server never sees the password or the key.
 *   - password strength is checked client-side (passwordPolicy) because the
 *     server only ever receives the derived authToken.
 *   - both password change and account deletion require the current password,
 *     never just the session cookie.
 */
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Fingerprint,
  KeyRound,
  Languages,
  LifeBuoy,
  Mail,
  Trash2,
  Type,
} from "lucide-react";

import { LanguageSelect } from "@/components/quon/LanguageSelect";
import { Notice } from "@/components/quon/Notice";
import { useT } from "@/lib/i18n/i18n";
import { translateApiError } from "@/lib/i18n/apiErrors";
import type { MessageKey } from "@/lib/i18n/catalog";
import { sharesApi } from "@/lib/api/sharesApi";
import {
  changePassword,
  deleteAccount,
  disableBiometric,
  enrollBiometric,
  requestEmailChange,
  rotateRecoveryPhrase,
  useAuth,
} from "@/lib/authStore";
import { getBioMarker } from "@/lib/bioEnrollment";
import { FONT_SCALE_OPTIONS, type FontScale } from "@/lib/fontScale";
import { checkPassword } from "@/lib/passwordPolicy";
import { quon, useQuonState } from "@/lib/quonStore";
import {
  BioCancelledError,
  BioPrfUnavailableError,
  platformAuthenticatorAvailable,
} from "@/lib/webauthnBio";

const CARD = "rounded-xl border border-quon-border bg-quon-surface p-4";
const CHIP =
  "flex h-7 w-7 items-center justify-center rounded-lg bg-quon-indigo/20 text-quon-indigo";
const LABEL = "block text-[10px] font-semibold uppercase tracking-wide text-quon-muted";
const FIELD =
  "mt-1 w-full rounded-lg border border-quon-border bg-quon-surface-2 px-3 py-2 text-xs text-quon-text placeholder:text-quon-muted focus:border-quon-indigo focus:outline-none";
const BTN =
  "mt-3 inline-flex items-center gap-1.5 rounded-lg bg-quon-indigo px-3 py-2 text-xs font-semibold text-white transition hover:bg-quon-indigo-hover disabled:cursor-not-allowed disabled:opacity-40";
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function AccountSettings() {
  const { t } = useT();
  return (
    <div className="space-y-5">
      <LanguageCard />
      <FontSizeCard />
      <ChangeEmailCard />
      <ChangePasswordCard />
      <BiometricUnlockCard />
      <RecoveryHintCard />
      <DeleteAccountCard />
    </div>
  );
}

function LanguageCard() {
  const { t } = useT();
  return (
    <section className={CARD}>
      <div className="flex items-center gap-2">
        <div className={CHIP}>
          <Languages className="h-4 w-4" />
        </div>
        <div>
          <div className="text-sm font-semibold text-quon-text">{t("settings.languageTitle")}</div>
          <div className="text-[10px] text-quon-muted">{t("settings.languageHint")}</div>
        </div>
      </div>
      <div className="mt-3">
        <LanguageSelect syncAccount />
      </div>
    </section>
  );
}

// "die schriften sind teilweise recht klein. Vll kann man eine Einstellung
// einbauen um die schriftgröße generell zu ändern?" - the request this answers.
// Three discrete steps, applied as a root font-size percentage - see
// lib/fontScale.ts for why that scales Tailwind's rem-based type everywhere.
// Device-local (quonStore.ts's `fontScale` field), not synced.
const FONT_SIZE_LABEL_KEYS: Record<FontScale, MessageKey> = {
  standard: "settings.fontSizeStandard",
  larger: "settings.fontSizeLarger",
  large: "settings.fontSizeLarge",
};

function FontSizeCard() {
  const { t } = useT();
  const { fontScale } = useQuonState();

  return (
    <section className={CARD}>
      <div className="flex items-center gap-2">
        <div className={CHIP}>
          <Type className="h-4 w-4" />
        </div>
        <div>
          <div className="text-sm font-semibold text-quon-text">{t("settings.fontSizeTitle")}</div>
          <div className="text-[10px] text-quon-muted">{t("settings.fontSizeHint")}</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1.5">
        {FONT_SCALE_OPTIONS.map((scale) => {
          const active = scale === fontScale;
          return (
            <button
              key={scale}
              onClick={() => quon.setFontScale(scale)}
              aria-pressed={active}
              className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition ${
                active
                  ? "border-quon-indigo/50 bg-quon-indigo/10 text-quon-indigo"
                  : "border-quon-border bg-quon-surface-2 text-quon-muted hover:text-quon-text"
              }`}
            >
              {t(FONT_SIZE_LABEL_KEYS[scale])}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ChangeEmailCard() {
  const { t } = useT();
  const { user } = useAuth();
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = EMAIL_RE.test(newEmail.trim()) && newEmail.trim().toLowerCase() !== user?.email;

  async function submit() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await requestEmailChange(newEmail);
      setDone(true);
      setNewEmail("");
    } catch (e) {
      setError(translateApiError(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={CARD}>
      <div className="flex items-center gap-2">
        <div className={CHIP}>
          <Mail className="h-4 w-4" />
        </div>
        <div>
          <div className="text-sm font-semibold text-quon-text">{t("settings.emailTitle")}</div>
          <div className="text-[10px] text-quon-muted">
            {t("settings.emailDescCurrently", { email: user?.email ?? "—" })}
          </div>
        </div>
      </div>

      <label className="mt-3 block">
        <span className={LABEL}>{t("settings.fieldNewEmail")}</span>
        <input
          type="email"
          autoComplete="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          placeholder={t("settings.emailPlaceholder")}
          className={FIELD}
        />
      </label>
      {error && <p className="mt-1.5 text-[10px] text-red-400">{error}</p>}
      {done && (
        <p className="mt-1.5 text-[10px] text-quon-green">{t("settings.emailChangeSuccess")}</p>
      )}
      <button onClick={submit} disabled={!valid || busy} className={BTN}>
        {busy ? t("settings.sending") : t("settings.sendConfirmation")}
      </button>
    </section>
  );
}

function ChangePasswordCard() {
  const { t } = useT();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const policy = next ? checkPassword(next) : { ok: false };
  const matches = next.length > 0 && next === confirm;
  const canSubmit = current.length > 0 && policy.ok && matches && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await changePassword(current, next);
      setDone(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (e) {
      setError(translateApiError(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={CARD}>
      <div className="flex items-center gap-2">
        <div className={CHIP}>
          <KeyRound className="h-4 w-4" />
        </div>
        <div>
          <div className="text-sm font-semibold text-quon-text">{t("settings.passwordTitle")}</div>
          <div className="text-[10px] text-quon-muted">{t("settings.passwordDesc")}</div>
        </div>
      </div>

      <label className="mt-3 block">
        <span className={LABEL}>{t("settings.fieldCurrentPassword")}</span>
        <input
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          className={FIELD}
        />
      </label>
      <label className="mt-2 block">
        <span className={LABEL}>{t("settings.fieldNewPassword")}</span>
        <input
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          className={FIELD}
        />
      </label>
      <label className="mt-2 block">
        <span className={LABEL}>{t("settings.fieldConfirmNewPassword")}</span>
        <input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={FIELD}
        />
      </label>

      {next.length > 0 && !policy.ok && (
        <p className="mt-1.5 text-[10px] text-quon-yellow">{policy.message}</p>
      )}
      {confirm.length > 0 && !matches && (
        <p className="mt-1.5 text-[10px] text-quon-yellow">{t("settings.passwordsDontMatch")}</p>
      )}
      {error && <p className="mt-1.5 text-[10px] text-red-400">{error}</p>}
      {done && (
        <p className="mt-1.5 flex items-center gap-1 text-[10px] text-quon-green">
          <Check className="h-3 w-3" /> {t("settings.passwordChanged")}
        </p>
      )}
      <button onClick={submit} disabled={!canSubmit} className={BTN}>
        {busy ? t("settings.changing") : t("settings.changePassword")}
      </button>
    </section>
  );
}

/** Biometric unlock for this device (WebAuthn PRF - Face ID / Touch ID /
 *  fingerprint). Renders nothing when the device has no user-verifying platform
 *  authenticator; enrollment can still fail honest at create-time when the
 *  authenticator lacks the PRF extension (only testable then - e.g. iOS < 18). */
function BiometricUnlockCard() {
  const { t } = useT();
  const { user } = useAuth();
  const [available, setAvailable] = useState(false);
  const [enrolled, setEnrolled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    platformAuthenticatorAvailable().then((ok) => {
      if (!cancelled) setAvailable(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (user) setEnrolled(getBioMarker(user.id) != null);
  }, [user]);

  if (!available) return null;

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      await enrollBiometric();
      setEnrolled(true);
    } catch (e) {
      if (e instanceof BioCancelledError) {
        /* user dismissed the prompt - reset silently */
      } else if (e instanceof BioPrfUnavailableError) {
        setError(t("settings.bioPrfUnavailable"));
      } else {
        setError(translateApiError(e, t));
      }
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      await disableBiometric();
      setEnrolled(false);
    } catch (e) {
      setError(translateApiError(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={CARD}>
      <div className="flex items-center gap-2">
        <div className={CHIP}>
          <Fingerprint className="h-4 w-4" />
        </div>
        <div>
          <div className="text-sm font-semibold text-quon-text">{t("settings.biometricTitle")}</div>
        </div>
      </div>
      {enrolled ? (
        <>
          <p className="mt-2 text-[10px] leading-snug text-quon-muted md:text-xs">
            {t("settings.biometricEnrolledDesc")}
          </p>
          <button className={BTN} onClick={disable} disabled={busy}>
            <Fingerprint className="h-3.5 w-3.5" />{" "}
            {busy ? t("settings.turningOff") : t("settings.turnOff")}
          </button>
          <p className="mt-2 text-[10px] leading-snug text-quon-muted">
            {t("settings.biometricRemoveHint")}
          </p>
        </>
      ) : (
        <>
          <p className="mt-2 text-[10px] leading-snug text-quon-muted md:text-xs">
            {t("settings.biometricNotEnrolledDesc")}
          </p>
          <button className={BTN} onClick={enable} disabled={busy}>
            <Fingerprint className="h-3.5 w-3.5" />{" "}
            {busy ? t("settings.settingUp") : t("settings.enableOnThisDevice")}
          </button>
        </>
      )}
      {error && (
        <div className="mt-2">
          <Notice variant="warning">{error}</Notice>
        </div>
      )}
    </section>
  );
}

/** Recovery phrase: the OLD phrase is deliberately un-reshowable (never stored
 *  - that is the zero-knowledge point), so "I lost it" is served by ROTATION:
 *  generate a new phrase while unlocked; the old one stops working instantly.
 *  Password-gated (a hijacked session alone must not rotate recovery). */
function RecoveryHintCard() {
  const { t } = useT();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  async function rotate() {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    try {
      setMnemonic(await rotateRecoveryPhrase(password));
      setPassword("");
    } catch (e) {
      setError(translateApiError(e, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={CARD}>
      <div className="flex items-center gap-2">
        <div className={CHIP}>
          <LifeBuoy className="h-4 w-4" />
        </div>
        <div>
          <div className="text-sm font-semibold text-quon-text">{t("settings.recoveryTitle")}</div>
        </div>
      </div>
      <p className="mt-2 text-[10px] leading-snug text-quon-muted md:text-xs">
        {t("settings.recoveryDesc")}
      </p>

      {mnemonic === null ? (
        <>
          <p className="mt-2 text-[10px] leading-snug text-quon-muted md:text-xs">
            {t("settings.recoveryRotateHint")}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("settings.fieldCurrentPassword")}
              className="min-w-0 flex-1 rounded-lg border border-quon-border bg-quon-bg px-3 py-2 text-sm text-quon-text placeholder:text-quon-muted focus:border-quon-indigo focus:outline-none"
            />
            <button
              onClick={() => void rotate()}
              disabled={!password || busy}
              className="rounded-lg bg-quon-indigo px-3 py-2 text-sm font-semibold text-white hover:bg-quon-indigo-hover disabled:opacity-40"
            >
              {busy ? t("settings.recoveryRotating") : t("settings.recoveryRotate")}
            </button>
          </div>
          {error && <p className="mt-2 text-[11px] text-destructive">{error}</p>}
        </>
      ) : (
        <div className="mt-3">
          <Notice variant="warning">{t("settings.recoveryNewPhraseNote")}</Notice>
          <div className="mt-2 grid grid-cols-3 gap-2 rounded-xl border border-quon-border bg-quon-bg p-3">
            {mnemonic.split(" ").map((w, i) => (
              <div key={i} className="text-xs text-quon-text">
                <span className="mr-1 text-[10px] text-quon-muted">{i + 1}</span>
                {w}
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(mnemonic);
                setCopied(true);
              }}
              className="rounded-lg border border-quon-border px-3 py-1.5 text-xs text-quon-text hover:border-quon-indigo/50"
            >
              {copied ? t("settings.recoveryCopied") : t("settings.recoveryCopy")}
            </button>
          </div>
          <label className="mt-2 flex items-start gap-2 text-xs text-quon-text">
            <input
              type="checkbox"
              checked={saved}
              onChange={(e) => setSaved(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-quon-indigo"
            />
            {t("settings.recoverySavedConfirm")}
          </label>
          <button
            onClick={() => {
              // One-time display, like at registration: once confirmed, the
              // words leave the DOM and exist only on the user's paper.
              setMnemonic(null);
              setSaved(false);
              setCopied(false);
            }}
            disabled={!saved}
            className="mt-2 rounded-lg bg-quon-indigo px-3 py-1.5 text-sm font-semibold text-white hover:bg-quon-indigo-hover disabled:opacity-40"
          >
            {t("settings.recoveryDone")}
          </button>
        </div>
      )}
    </section>
  );
}

function DeleteAccountCard() {
  const { t, plural } = useT();
  const [password, setPassword] = useState("");
  const [confirmWord, setConfirmWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // `users` -> `project_shares` cascades on delete (migration 0007): deleting the
  // account instantly drops every project this user owns and shares, for every
  // member, with no way back (v1 has no key rotation / ownership transfer). Warn
  // up front rather than let the owner find out after the fact. Best-effort -
  // a failed fetch just leaves the warning off; it never blocks deletion itself.
  const [ownedShareCount, setOwnedShareCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    sharesApi
      .list()
      .then((shares) => {
        if (!cancelled) setOwnedShareCount(shares.filter((s) => s.owner).length);
      })
      .catch(() => {
        /* transient - the warning simply stays hidden */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const canSubmit = password.length > 0 && confirmWord.trim().toUpperCase() === "DELETE" && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await deleteAccount(password);
      // On success the auth status flips to `anonymous` and the app shows the
      // sign-in screen automatically - no navigation needed here.
    } catch (e) {
      setError(translateApiError(e, t));
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-red-500/30 bg-red-500/[0.03] p-4">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-500/15 text-red-400">
          <Trash2 className="h-4 w-4" />
        </div>
        <div>
          <div className="text-sm font-semibold text-quon-text">
            {t("settings.deleteAccountTitle")}
          </div>
          <div className="text-[10px] text-quon-muted">{t("settings.deleteAccountDesc")}</div>
        </div>
      </div>

      {ownedShareCount > 0 && (
        <div className="mt-3">
          <Notice variant="warning">
            {plural(ownedShareCount, {
              one: "settings.deleteAccountShareWarningOne",
              other: "settings.deleteAccountShareWarningOther",
            })}
          </Notice>
        </div>
      )}

      <label className="mt-3 block">
        <span className={LABEL}>{t("settings.passwordTitle")}</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={FIELD}
        />
      </label>
      <label className="mt-2 block">
        <span className={LABEL}>
          {t("settings.deleteConfirmPrefix")} <span className="text-red-400">DELETE</span>{" "}
          {t("settings.deleteConfirmSuffix")}
        </span>
        <input
          type="text"
          value={confirmWord}
          onChange={(e) => setConfirmWord(e.target.value)}
          placeholder="DELETE"
          className={FIELD}
        />
      </label>
      {error && <p className="mt-1.5 text-[10px] text-red-400">{error}</p>}
      <button
        onClick={submit}
        disabled={!canSubmit}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-red-500/90 px-3 py-2 text-xs font-semibold text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <AlertTriangle className="h-3.5 w-3.5" />{" "}
        {busy ? t("settings.deleting") : t("settings.deleteMyAccount")}
      </button>
    </section>
  );
}
