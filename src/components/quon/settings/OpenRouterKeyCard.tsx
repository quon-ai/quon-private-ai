import { useState } from "react";
import { Check, Eye, EyeOff, KeyRound } from "lucide-react";

import { useT } from "@/lib/i18n/i18n";
import { translateApiError } from "@/lib/i18n/apiErrors";
import { setOpenRouterKey, type SettingsStatus } from "@/lib/quonApi";

interface Props {
  configured: boolean;
  /** The user has an own key stored — it overrides the included one, so the
   *  card must say so and offer to remove it (#91: a wrong key could never be
   *  taken back from the UI). */
  ownKey?: boolean;
  /** OpenRouter routing region; "eu" = strict in-region routing (region.py). */
  region?: string;
  reachable: boolean | null;
  onApply: (s: SettingsStatus) => void;
}

export function OpenRouterKeyCard({
  configured,
  ownKey = false,
  region = "global",
  reachable,
  onApply,
}: Props) {
  const { t } = useT();
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function removeKey() {
    setRemoving(true);
    setError(null);
    setRemoved(false);
    try {
      const s = await setOpenRouterKey(""); // an empty key clears the override
      onApply(s);
      setRemoved(true);
      setTimeout(() => setRemoved(false), 4000);
    } catch (e) {
      setError(translateApiError(e, t));
    } finally {
      setRemoving(false);
    }
  }

  const statusBadge =
    reachable === false ? (
      <span className="inline-flex items-center gap-1 rounded-full border border-quon-yellow/40 bg-quon-yellow/10 px-2 py-0.5 text-[10px] font-semibold text-quon-yellow">
        {t("settings.scrubberOffline")}
      </span>
    ) : ownKey ? (
      <span className="inline-flex items-center gap-1 rounded-full border border-quon-indigo/40 bg-quon-indigo/10 px-2 py-0.5 text-[10px] font-semibold text-quon-indigo">
        <span className="h-1.5 w-1.5 rounded-full bg-quon-indigo" /> {t("settings.ownKeyInUse")}
      </span>
    ) : configured ? (
      <span className="inline-flex items-center gap-1 rounded-full border border-quon-green/40 bg-quon-green/10 px-2 py-0.5 text-[10px] font-semibold text-quon-green">
        <span className="h-1.5 w-1.5 rounded-full bg-quon-green glow-green" />{" "}
        {t("settings.connected")}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 rounded-full border border-quon-yellow/40 bg-quon-yellow/10 px-2 py-0.5 text-[10px] font-semibold text-quon-yellow">
        {t("settings.notConfigured")}
      </span>
    );

  async function saveKey() {
    if (!apiKey.trim()) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const s = await setOpenRouterKey(apiKey.trim());
      onApply(s);
      setApiKey("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(translateApiError(e, t));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-quon-border bg-quon-surface p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-quon-indigo/20 text-quon-indigo">
            <KeyRound className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-quon-text">
              {t("settings.openRouterTitle")}
            </div>
            <div className="text-[10px] text-quon-muted">{t("settings.openRouterDesc")}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {region === "eu" && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-quon-indigo/40 bg-quon-indigo/10 px-2 py-0.5 text-[10px] font-semibold text-quon-indigo"
              data-testid="eu-routing-badge"
            >
              {t("settings.euRoutingBadge")}
            </span>
          )}
          {statusBadge}
        </div>
      </div>
      {region === "eu" && (
        <p className="mt-2 text-[10px] text-quon-muted">{t("settings.euRoutingHint")}</p>
      )}

      <label className="mt-3 block text-[10px] font-semibold uppercase tracking-wide text-quon-muted">
        {t("settings.openRouterKeyLabel")}
      </label>
      <div className="mt-1 flex items-center gap-2 rounded-lg border border-quon-border bg-quon-surface-2 px-3 py-2 focus-within:border-quon-indigo">
        <input
          type={showKey ? "text" : "password"}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={
            ownKey
              ? t("settings.openRouterKeyPlaceholderConfigured")
              : t("settings.openRouterKeyPlaceholderEmpty")
          }
          className="flex-1 bg-transparent text-xs text-quon-text placeholder:text-quon-muted focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setShowKey((v) => !v)}
          className="text-quon-muted hover:text-quon-text"
          aria-label={showKey ? t("settings.hideKey") : t("settings.showKey")}
        >
          {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      </div>
      {error && <p className="mt-1.5 text-[10px] text-red-400">{error}</p>}
      {removed && <p className="mt-1.5 text-[10px] text-quon-green">{t("settings.keyRemoved")}</p>}
      {ownKey && (
        <button
          type="button"
          onClick={removeKey}
          disabled={removing || reachable === false}
          className="mt-2 mr-2 inline-flex items-center gap-1.5 rounded-lg border border-quon-border px-3 py-2 text-xs font-semibold text-quon-text transition hover:border-red-400/60 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {removing ? t("settings.removingKey") : t("settings.removeKey")}
        </button>
      )}
      <button
        onClick={saveKey}
        disabled={!apiKey.trim() || saving || reachable === false}
        className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-quon-indigo px-3 py-2 text-xs font-semibold text-white transition hover:bg-quon-indigo-hover disabled:cursor-not-allowed disabled:opacity-40"
      >
        {saved ? (
          <>
            <Check className="h-3.5 w-3.5" /> {t("settings.saved")}
          </>
        ) : saving ? (
          t("settings.saving")
        ) : (
          t("settings.saveKey")
        )}
      </button>
      <p className="mt-2 text-[10px] text-quon-muted">{t("settings.openRouterGetKeyHint")}</p>
    </section>
  );
}
