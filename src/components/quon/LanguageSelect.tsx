/**
 * DE/EN language switch. A two-option segmented control (only two languages).
 * Always switches the live UI + device preference; when `syncAccount` is set
 * (the user is signed in), it also persists to the account so the choice
 * follows them to other devices. Used in the registration form (device-only)
 * and in Account settings (account-synced).
 */
import { useState } from "react";

import { authApi } from "@/lib/api/authApi";
import { useT } from "@/lib/i18n/i18n";
import type { Lang } from "@/lib/langPref";

export function LanguageSelect({
  syncAccount = false,
  className = "",
}: {
  syncAccount?: boolean;
  className?: string;
}) {
  const { lang, setLang, t } = useT();
  const [busy, setBusy] = useState(false);

  async function choose(next: Lang) {
    if (next === lang || busy) return;
    setLang(next); // live + device pref, immediately
    if (syncAccount) {
      setBusy(true);
      try {
        await authApi.setUiLanguage(next);
      } catch {
        /* best-effort: the device already switched; the account sync can retry later */
      } finally {
        setBusy(false);
      }
    }
  }

  const opts: Array<{ value: Lang; label: string }> = [
    { value: "de", label: t("common.german") },
    { value: "en", label: t("common.english") },
  ];

  return (
    <div
      role="group"
      aria-label={t("common.language")}
      className={`inline-flex rounded-lg border border-quon-border bg-quon-surface-2 p-0.5 ${className}`}
    >
      {opts.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => void choose(o.value)}
          aria-pressed={lang === o.value}
          className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
            lang === o.value ? "bg-quon-indigo text-white" : "text-quon-muted hover:text-quon-text"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
