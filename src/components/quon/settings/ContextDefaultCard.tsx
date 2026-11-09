/**
 * Settings row for the chat composer's Kontext/Context pill (`useMemoryContext`
 * in quonStore). The pill toggles the same value directly - this card exists
 * so the setting (and its explainer) is discoverable outside the composer too
 * ("im chat gibts ne option 'kontext'. Was heißt das?" is the question it
 * answers).
 * A global synced preference (see SYNCED_KEYS in quonStore.ts), applied
 * immediately - not a per-chat default.
 */
import { Sparkles } from "lucide-react";

import { useT } from "@/lib/i18n/i18n";
import { quon, useQuonState } from "@/lib/quonStore";
import { InfoHint } from "../InfoHint";

export function ContextDefaultCard() {
  const { t } = useT();
  const { useMemoryContext } = useQuonState();

  return (
    <section className="rounded-xl border border-quon-border bg-quon-surface p-4">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-quon-indigo/20 text-quon-indigo">
          <Sparkles className="h-4 w-4" />
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold text-quon-text">
              {t("settings.contextDefaultTitle")}
            </span>
            <InfoHint text={t("chat.contextInfoHint")} />
          </div>
          <div className="text-[10px] text-quon-muted">{t("settings.contextDefaultDesc")}</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-1.5">
        {(
          [
            { value: true, labelKey: "settings.mcpEnabled" as const },
            { value: false, labelKey: "settings.mcpDisabled" as const },
          ] as const
        ).map((o) => {
          const active = o.value === useMemoryContext;
          return (
            <button
              key={String(o.value)}
              onClick={() => quon.setUseMemoryContext(o.value)}
              aria-pressed={active}
              className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition ${
                active
                  ? "border-quon-indigo/50 bg-quon-indigo/10 text-quon-indigo"
                  : "border-quon-border bg-quon-surface-2 text-quon-muted hover:text-quon-text"
              }`}
            >
              {t(o.labelKey)}
            </button>
          );
        })}
      </div>
    </section>
  );
}
