/**
 * Settings → Providers & models.
 *
 * Lists every chat provider connection: the built-in OpenRouter plus any
 * user-added OpenAI-compatible providers (BYOK). For each, pick which models
 * appear in the chat dropdown (load the provider's catalog or type ids). Keys are
 * write-only — sent to the gateway, never returned.
 */
import { useState } from "react";
import { Check, Cloud, Eye, EyeOff, Loader2, Plus, RefreshCw, Trash2, X } from "lucide-react";

import { useT } from "@/lib/i18n/i18n";
import { translateApiError } from "@/lib/i18n/apiErrors";
import {
  deleteConnection,
  deleteMyConnection,
  getConnectionCatalog,
  getMyConnectionCatalog,
  upsertConnection,
  upsertMyConnection,
  type CatalogModel,
  type ConnectionInput,
  type ProviderConnection,
  type SettingsStatus,
} from "@/lib/quonApi";

// Brand names (OpenAI, Anthropic, Groq, Mistral) are proper nouns and stay
// untranslated in both languages; only the "Ollama (local)" qualifier is
// localized via settings.presetOllamaLocal.
function getPresets(ollamaLabel: string): Array<{ label: string; base_url: string }> {
  return [
    { label: "OpenAI", base_url: "https://api.openai.com/v1" },
    { label: "Anthropic", base_url: "https://api.anthropic.com/v1" },
    { label: "Groq", base_url: "https://api.groq.com/openai/v1" },
    { label: "Mistral", base_url: "https://api.mistral.ai/v1" },
    { label: ollamaLabel, base_url: "http://localhost:11434/v1" },
  ];
}

function newConnId(): string {
  return `conn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function ProvidersSettings({
  connections,
  reachable,
  onChange,
}: {
  connections: ProviderConnection[];
  reachable: boolean | null;
  onChange: (s: SettingsStatus) => void;
}) {
  const { t } = useT();
  const [adding, setAdding] = useState(false);

  return (
    <section className="rounded-xl border border-quon-border bg-quon-surface p-4">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-quon-indigo/20 text-quon-indigo">
          <Cloud className="h-4 w-4" />
        </div>
        <div>
          <div className="text-sm font-semibold text-quon-text">{t("settings.providersTitle")}</div>
          <div className="text-[10px] text-quon-muted">{t("settings.providersDesc")}</div>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {connections.length === 0 ? (
          <div className="rounded-lg border border-quon-border px-3 py-3 text-[11px] text-quon-muted">
            {reachable === false ? t("settings.scrubberNotReachable") : t("common.loading")}
          </div>
        ) : (
          connections.map((c) => <ConnectionCard key={c.id} conn={c} onChange={onChange} />)
        )}
      </div>

      {adding ? (
        <AddProvider onClose={() => setAdding(false)} onChange={onChange} />
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-quon-border bg-quon-surface-2 px-3 py-2 text-xs font-medium text-quon-muted transition hover:text-quon-text"
        >
          <Plus className="h-3.5 w-3.5" /> {t("settings.addProvider")}
        </button>
      )}
    </section>
  );
}

// --- one connection -------------------------------------------------------
function ConnectionCard({
  conn,
  onChange,
}: {
  conn: ProviderConnection;
  onChange: (s: SettingsStatus) => void;
}) {
  const { t, plural } = useT();
  const [selected, setSelected] = useState<string[]>(conn.models);
  const [catalog, setCatalog] = useState<CatalogModel[] | null>(null);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<"" | "catalog" | "save" | "delete">("");
  const [err, setErr] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(false);

  const dirty = selected.join("\0") !== conn.models.join("\0");

  // Per-user (BYOK) connections use the auth-gated /my-connections endpoints;
  // global ones (OpenRouter + operator customs) use the shared endpoints.
  const isUser = conn.owner === "user";
  const apiUpsert = isUser ? upsertMyConnection : upsertConnection;
  const apiDelete = isUser ? deleteMyConnection : deleteConnection;
  const apiCatalog = isUser ? getMyConnectionCatalog : getConnectionCatalog;

  async function loadCatalog() {
    setBusy("catalog");
    setErr(null);
    try {
      setCatalog(await apiCatalog(conn.id));
    } catch (e) {
      setErr(translateApiError(e, t));
    } finally {
      setBusy("");
    }
  }

  async function save() {
    setBusy("save");
    setErr(null);
    try {
      onChange(await apiUpsert(conn.id, { models: selected }));
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 2000);
    } catch (e) {
      setErr(translateApiError(e, t));
    } finally {
      setBusy("");
    }
  }

  async function remove() {
    setBusy("delete");
    try {
      onChange(await apiDelete(conn.id));
    } catch (e) {
      setErr(translateApiError(e, t));
      setBusy("");
    }
  }

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const shown = (catalog ?? []).filter(
    (m) => !filter || m.id.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div className="rounded-lg border border-quon-border bg-quon-surface-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-quon-text">{conn.label}</span>
          <span className="rounded-sm bg-quon-surface px-1 text-[8px] font-semibold uppercase tracking-wide text-quon-muted">
            {conn.builtin ? t("settings.builtinOpenRouter") : t("settings.openAiCompatible")}
          </span>
          <span
            className={`rounded-sm px-1 text-[8px] font-semibold uppercase tracking-wide ${isUser ? "bg-quon-indigo/15 text-quon-indigo" : "bg-quon-surface text-quon-muted"}`}
          >
            {isUser ? t("settings.ownBadge") : t("settings.sharedBadge")}
          </span>
          <span
            className={`inline-flex items-center gap-1 text-[10px] ${conn.key_configured ? "text-quon-green" : "text-quon-yellow"}`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${conn.key_configured ? "bg-quon-green" : "bg-quon-yellow"}`}
            />
            {conn.key_configured ? t("settings.keySet") : t("settings.noKey")}
          </span>
        </div>
        {!conn.builtin && (
          <button
            onClick={remove}
            disabled={busy === "delete"}
            className="rounded p-1 text-quon-muted hover:text-destructive"
            aria-label={t("settings.deleteProviderAria")}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {!conn.builtin && (
        <div className="mt-0.5 truncate font-mono text-[10px] text-quon-muted">{conn.base_url}</div>
      )}

      <div className="mt-2 flex items-center gap-2">
        <span className="text-[10px] text-quon-muted">
          {plural(selected.length, {
            one: "settings.modelsInChatOne",
            other: "settings.modelsInChatOther",
          })}
        </span>
        <button
          onClick={loadCatalog}
          disabled={!conn.key_configured || busy === "catalog"}
          className="inline-flex items-center gap-1 rounded-md border border-quon-border bg-quon-surface px-2 py-1 text-[10px] text-quon-muted transition hover:text-quon-text disabled:opacity-40"
        >
          {busy === "catalog" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          {t("settings.loadCatalog")}
        </button>
      </div>

      {catalog && (
        <div className="mt-2">
          <div className="mb-1 flex items-center gap-1.5 rounded-md border border-quon-border bg-quon-surface px-2 py-1">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("settings.filterModelsPlaceholder", { count: catalog.length })}
              className="w-full bg-transparent text-[11px] text-quon-text placeholder:text-quon-muted focus:outline-none"
            />
          </div>
          <div className="max-h-40 space-y-0.5 overflow-y-auto">
            {shown.slice(0, 200).map((m) => {
              const on = selected.includes(m.id);
              return (
                <button
                  key={m.id}
                  onClick={() => toggle(m.id)}
                  className={`flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px] ${on ? "text-quon-text" : "text-quon-muted hover:text-quon-text"}`}
                >
                  <span
                    className={`flex h-3 w-3 shrink-0 items-center justify-center rounded-sm border ${on ? "border-quon-indigo bg-quon-indigo text-white" : "border-quon-border"}`}
                  >
                    {on && <Check className="h-2 w-2" />}
                  </span>
                  <span className="truncate font-mono">{m.id}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {err && <p className="mt-1.5 text-[10px] text-red-400">{err}</p>}

      {dirty && (
        <button
          onClick={save}
          disabled={busy === "save"}
          className="mt-2 inline-flex items-center gap-1 rounded-md bg-quon-indigo px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-quon-indigo-hover disabled:opacity-40"
        >
          {savedTick ? <Check className="h-3 w-3" /> : null}
          {savedTick ? t("settings.saved") : t("settings.saveModelSelection")}
        </button>
      )}
    </div>
  );
}

// --- add a custom OpenAI-compatible provider ------------------------------
function AddProvider({
  onClose,
  onChange,
}: {
  onClose: () => void;
  onChange: (s: SettingsStatus) => void;
}) {
  const { t } = useT();
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const presets = getPresets(t("settings.presetOllamaLocal"));

  async function add() {
    if (!label.trim() || !baseUrl.trim() || !key.trim()) {
      setErr(t("settings.addProviderValidationError"));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const input: ConnectionInput = {
        label: label.trim(),
        base_url: baseUrl.trim(),
        api_key: key.trim(),
        models: [],
      };
      onChange(await upsertMyConnection(newConnId(), input));
      onClose();
    } catch (e) {
      setErr(translateApiError(e, t));
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-quon-indigo/40 bg-quon-surface-2 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-quon-text">
          {t("settings.addProviderHeader")}
        </span>
        <button onClick={onClose} className="text-quon-muted hover:text-quon-text">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mb-2 flex flex-wrap gap-1">
        {presets.map((p) => (
          <button
            key={p.label}
            onClick={() => {
              setLabel(p.label);
              setBaseUrl(p.base_url);
            }}
            className="rounded-full border border-quon-border bg-quon-surface px-2 py-0.5 text-[10px] text-quon-muted transition hover:text-quon-text"
          >
            {p.label}
          </button>
        ))}
      </div>
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder={t("settings.labelPlaceholder")}
        className="mb-1.5 w-full rounded-md border border-quon-border bg-quon-surface px-2.5 py-1.5 text-xs text-quon-text placeholder:text-quon-muted focus:border-quon-indigo focus:outline-none"
      />
      <input
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
        placeholder={t("settings.baseUrlPlaceholder")}
        className="mb-1.5 w-full rounded-md border border-quon-border bg-quon-surface px-2.5 py-1.5 font-mono text-[11px] text-quon-text placeholder:text-quon-muted focus:border-quon-indigo focus:outline-none"
      />
      <div className="flex items-center gap-2 rounded-md border border-quon-border bg-quon-surface px-2.5 py-1.5 focus-within:border-quon-indigo">
        <input
          type={showKey ? "text" : "password"}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={t("settings.apiKeyPlaceholder")}
          className="flex-1 bg-transparent text-xs text-quon-text placeholder:text-quon-muted focus:outline-none"
        />
        <button
          onClick={() => setShowKey((v) => !v)}
          className="text-quon-muted hover:text-quon-text"
          aria-label={showKey ? t("settings.hideKey") : t("settings.showKey")}
        >
          {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      </div>
      {err && <p className="mt-1.5 text-[10px] text-red-400">{err}</p>}
      <button
        onClick={add}
        disabled={busy}
        className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-quon-indigo px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-quon-indigo-hover disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        {t("settings.addProviderSubmit")}
      </button>
    </div>
  );
}
