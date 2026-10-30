import { useState } from "react";
import { Eye, EyeOff, ShieldAlert, ShieldOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/i18n";
import { entityStyle } from "@/lib/quonEntityStyles";
import { enrichmentSkipReason, type Entity } from "@/lib/quonApi";
import { Notice } from "./Notice";

interface RedactionDetailProps {
  entities: Entity[];
  showOriginal: boolean;
  onToggleShowOriginal: () => void;
  fallbackMode?: boolean;
  /** why the AI enrichment was skipped (e.g. "timeout", "budget") */
  skipReason?: string | null;
  /** true when the input had no case signal — NER names were deferred to the LLM */
  lowCaseSignal?: boolean;
  className?: string;
  /**
   * Present only on a message that had ≥1 redaction and is not itself already an
   * unfiltered resend. One-shot escape hatch for a false-positive redaction (e.g.
   * German "Wann einnehmen?" mis-flagged as a PERSON): resends the ORIGINAL text
   * of this one message as a new turn, skipping detection entirely for that send.
   * Deliberately not a permanent allow-list — see unfilteredResend.ts.
   */
  onResendWithoutFilter?: () => void;
  /** True while a generation is already running for this chat. */
  resendDisabled?: boolean;
  /** Release one value for FUTURE sends (adds to the device's never-redact
   *  list). Omit to hide the per-row action. */
  onNeverRedact?: (value: string) => void;
}

/**
 * The redaction DETAIL for one message: the per-entity list (value ↔ placeholder),
 * the fallback-mode notice, and the original/anonymized view toggle. The trigger
 * that opens it now lives on the message bubble itself (see UserBubble) — this is
 * only the expanded body, so the composer chrome stays compact. Privacy invariant:
 * the bubble always states the redaction count without a click; this reveals what
 * exactly was replaced when the user asks for it.
 */
export function RedactionDetail({
  entities,
  showOriginal,
  onToggleShowOriginal,
  fallbackMode = false,
  skipReason,
  lowCaseSignal = false,
  className,
  onResendWithoutFilter,
  resendDisabled = false,
  onNeverRedact,
}: RedactionDetailProps) {
  const { t } = useT();
  // Two-step consent: the first click only arms the confirm state — nothing is
  // sent until the second, explicit click. Resets whenever this message's own
  // redaction set changes identity (a different bubble reusing the component).
  const [armed, setArmed] = useState(false);
  // Values released via the per-row action — swap the row's action into a
  // confirmation so the tap visibly DID something, without a toast layer.
  const [released, setReleased] = useState<Set<string>>(() => new Set());
  return (
    <div
      className={cn(
        "rounded-xl border border-quon-border bg-quon-surface px-3 py-2 text-quon-text",
        className,
      )}
    >
      {entities.length > 0 && (
        <div className="mb-2 flex justify-end">
          <button
            onClick={onToggleShowOriginal}
            className="inline-flex items-center gap-1 rounded-md border border-quon-border bg-quon-surface-2 px-1.5 py-0.5 text-[10px] text-quon-muted transition hover:text-quon-text"
          >
            {showOriginal ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            {showOriginal ? t("chat.showAnonymized") : t("chat.showOriginal")}
          </button>
        </div>
      )}

      {fallbackMode && (
        <Notice variant="warning" icon={<ShieldAlert className="h-3 w-3" />} className="mb-2">
          {t("chat.fallbackNoticeBase")}
          {enrichmentSkipReason(skipReason) ? ` — ${enrichmentSkipReason(skipReason)}` : ""}
          {t("chat.fallbackNoticeDetailSuffix")}
          {lowCaseSignal && t("chat.fallbackNoticeLowCase")}
        </Notice>
      )}

      {entities.length === 0 ? (
        <p className="py-1 text-xs text-quon-muted">{t("chat.nothingPersonalDetected")}</p>
      ) : (
        <ul className="space-y-1.5">
          {entities.map((entity, i) => {
            const style = entityStyle(entity.type);
            return (
              <li key={`${entity.type}-${entity.value}-${i}`} className="flex items-start gap-2">
                <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", style.dot)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "rounded border px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide",
                        style.chip,
                      )}
                    >
                      {style.label}
                    </span>
                    {/* Confidence % intentionally hidden: detector scores are
                        fixed per source (NER 0.85, LLM 0.9, regex 1.0) and
                        don't reflect real per-item certainty, so the number
                        was misleading to users. */}
                  </div>
                  <div className="mt-0.5 truncate text-[13px]">
                    {showOriginal ? (
                      <span className="text-quon-text" title={entity.value}>
                        {entity.value}
                      </span>
                    ) : (
                      <span className="font-mono text-quon-muted">{entity.placeholder}</span>
                    )}
                  </div>
                </div>
                {/* Beta feedback 2026-08-23: in Filter mode there was NO way to
                    say "this was wrong" — the one-tap release existed only in
                    the document viewer and Review. This panel opens from the
                    "N redacted" line in EVERY mode, so the per-value release
                    lives here. Honest about its scope: this message is already
                    sent; the release applies from the next send on. */}
                {onNeverRedact &&
                  (released.has(entity.value.toLowerCase()) ? (
                    <span className="shrink-0 text-[10px] text-quon-green">
                      {t("chat.neverRedactDone")}
                    </span>
                  ) : (
                    <button
                      onClick={() => {
                        onNeverRedact(entity.value);
                        setReleased((prev) => new Set(prev).add(entity.value.toLowerCase()));
                      }}
                      title={t("chat.neverRedactHint")}
                      className="shrink-0 rounded-md border border-quon-border bg-quon-surface-2 px-1.5 py-0.5 text-[10px] text-quon-muted transition hover:border-quon-indigo hover:text-quon-text"
                    >
                      {t("chat.neverRedactAction")}
                    </button>
                  ))}
              </li>
            );
          })}
        </ul>
      )}

      {onResendWithoutFilter && (
        <div className="mt-2 border-t border-quon-border pt-2">
          {!armed ? (
            <button
              onClick={() => setArmed(true)}
              disabled={resendDisabled}
              className="flex items-center gap-1.5 text-left text-[11px] font-medium text-quon-muted transition hover:text-quon-text disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ShieldOff className="h-3 w-3 shrink-0" />
              {t("chat.resendWithoutFilter")}
            </button>
          ) : (
            <div className="flex flex-col gap-2 rounded-lg border border-quon-border bg-quon-surface-2 p-2">
              <p className="text-[10px] leading-snug text-quon-muted">
                {t("chat.resendWithoutFilterExplain")}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setArmed(false);
                    onResendWithoutFilter();
                  }}
                  disabled={resendDisabled}
                  className="rounded-lg bg-quon-indigo px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-quon-indigo-hover disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t("chat.sendUnprotected")}
                </button>
                <button
                  onClick={() => setArmed(false)}
                  className="rounded-lg border border-quon-border px-2.5 py-1 text-[11px] text-quon-text transition hover:border-quon-indigo/50"
                >
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
