/**
 * Default reasoning-effort for new chats. Reads/writes the same quonStore value the
 * chat composer's per-chat picker overrides, so this is the fallback when no override
 * is set. Sent to OpenRouter's unified `reasoning.effort`; non-reasoning models ignore
 * it. "Off" omits the param entirely (provider default).
 */
import { Brain } from "lucide-react";

import { useT } from "@/lib/i18n/i18n";
import type { MessageKey } from "@/lib/i18n/catalog";
import { quon, useQuonState, type ReasoningEffort } from "@/lib/quonStore";
import { InfoHint } from "../InfoHint";

const OPTIONS: { value: ReasoningEffort; labelKey: MessageKey; hintKey: MessageKey }[] = [
  { value: "off", labelKey: "settings.reasoningOff", hintKey: "settings.reasoningOffHint" },
  { value: "low", labelKey: "settings.reasoningLow", hintKey: "settings.reasoningLowHint" },
  {
    value: "medium",
    labelKey: "settings.reasoningMedium",
    hintKey: "settings.reasoningMediumHint",
  },
  { value: "high", labelKey: "settings.reasoningHigh", hintKey: "settings.reasoningHighHint" },
];

export function ReasoningDefaultCard() {
  const { t } = useT();
  const { reasoningEffort } = useQuonState();
  const current = OPTIONS.find((o) => o.value === reasoningEffort) ?? OPTIONS[0];

  return (
    <section className="rounded-xl border border-quon-border bg-quon-surface p-4">
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-quon-indigo/20 text-quon-indigo">
          <Brain className="h-4 w-4" />
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold text-quon-text">
              {t("settings.reasoningEffortTitle")}
            </span>
            <InfoHint text={t("chat.reasoningInfoHint")} />
          </div>
          <div className="text-[10px] text-quon-muted">{t("settings.reasoningEffortDesc")}</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-1.5">
        {OPTIONS.map((o) => {
          const active = o.value === reasoningEffort;
          return (
            <button
              key={o.value}
              onClick={() => quon.setReasoningEffort(o.value)}
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

      <div className="mt-2 text-[10px] leading-snug text-quon-muted md:text-xs">
        {t(current.hintKey)}
      </div>
    </section>
  );
}
