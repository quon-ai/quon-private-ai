import { useState } from "react";

import {
  ArrowUp,
  ChevronDown,
  Lock,
  Paperclip,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Unlock,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/i18n";
import { entityStyle } from "@/lib/quonEntityStyles";
import { enrichmentSkipReason } from "@/lib/quonApi";
import type { DurableRedactMatch, ManualRedactError } from "@/lib/manualRedact";
import { AlwaysRedactButton } from "./AlwaysRedactButton";

/** What `ReviewPanel` needs about a staged attachment (already scrubbed). */
export interface ReviewAttachment {
  name: string;
  /** the already-scrubbed document text (placeholders) — shown for manual redaction */
  base: string;
  /** per-hit review items detected in the document (toggleable) */
  items: ReviewItem[];
  truncated?: boolean;
  /** Library doc ids; absent for ad-hoc uploads → no durable redaction. */
  docIds?: string[];
}

export interface ReviewItem {
  placeholder: string;
  value: string;
  type: string;
  confidence?: number;
  /** true = keep redacted (placeholder); false = send the real value */
  active: boolean;
  /** true = added manually by the user (select-to-redact) */
  isManual?: boolean;
}

const PLACEHOLDER_RE = /\[[A-Z]+_\d+\]/g;

/**
 * The exact text that will be sent: detected placeholders are kept unless the
 * user un-redacted them; manual selections are replaced by their placeholder.
 */
export function buildSentText(base: string, items: ReviewItem[]): string {
  let text = base;
  for (const it of items) {
    if (it.isManual) {
      if (it.active) text = text.split(it.value).join(it.placeholder);
    } else if (!it.active) {
      text = text.split(it.placeholder).join(it.value);
    }
  }
  return text;
}

/** One reviewable hit: label + value, and a toggle between "Redacted" / "Sending real". */
function ItemRow({
  item,
  onToggle,
}: {
  item: ReviewItem;
  onToggle: (placeholder: string) => void;
}) {
  const { t } = useT();
  const style = entityStyle(item.type);
  return (
    // The whole ROW toggles — the operator's phrasing review ("klicke in eine
    // Zeile") doubled as a UX review: a 44px row is a target, a 10px-text
    // button is a hunt. The button stays as the visible state + focus stop;
    // stopPropagation keeps one tap = one toggle.
    <li
      className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-1 py-0.5 transition hover:bg-quon-surface-2"
      onClick={() => onToggle(item.placeholder)}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", style.dot)} />
        <span className={cn("rounded border px-1 text-[10px] font-medium uppercase", style.chip)}>
          {item.isManual ? t("chat.manualLabel") : style.label}
        </span>
        <span className="truncate text-[13px] text-quon-text" title={item.value}>
          {item.value}
        </span>
      </div>
      {/* Beta feedback 2026-08-23: "geschwärzt" read as a STATUS, not a
          BUTTON — even the operator had to hunt for the tap target. A toggle
          the user cannot find protects nothing, so the affordance is spelled
          out: switch styling, a title, and a visible flip hint. */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggle(item.placeholder);
        }}
        title={item.active ? t("chat.reviewTapToRelease") : t("chat.reviewTapToRedact")}
        aria-pressed={item.active}
        className={cn(
          "group inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium transition",
          item.active
            ? "border-quon-border bg-quon-surface-2 text-quon-muted hover:border-quon-indigo hover:text-quon-text"
            : "border-red-500/40 bg-red-500/10 text-red-400",
        )}
      >
        {item.active ? (
          <>
            <Lock className="h-2.5 w-2.5" /> {t("chat.redactedLabel")}
            <span className="hidden text-quon-indigo group-hover:inline">
              · {t("chat.reviewTapToRelease")}
            </span>
          </>
        ) : (
          <>
            <Unlock className="h-2.5 w-2.5" /> {t("chat.sendingRealLabel")}
          </>
        )}
      </button>
    </li>
  );
}

/** The exact text that will be sent, with placeholder tokens highlighted. */
function HighlightedSent({ text, className }: { text: string; className?: string }) {
  const parts = text.split(PLACEHOLDER_RE);
  const tokens = text.match(PLACEHOLDER_RE) ?? [];
  return (
    <div
      className={cn(
        "max-h-32 select-text overflow-y-auto whitespace-pre-line rounded-md p-2.5 text-sm leading-relaxed text-quon-text",
        className,
      )}
    >
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < tokens.length && (
            <span className="rounded-sm bg-quon-indigo/20 px-0.5 font-mono text-quon-indigo">
              {tokens[i]}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

/** Small "select text → Redact selection" button (used by the message + doc/context).
 *
 *  Two hard-won details:
 *  - onMouseDown preventDefault: in WebKit a mousedown on a button collapses
 *    the text selection BEFORE click fires — the exact selection this button
 *    exists to read. Chrome keeps it (buttons are user-select:none), which is
 *    why the bug never showed in Chromium runs.
 *  - failures SPEAK: the callback returns a named reason and it is shown right
 *    under the button. The silent version read as "the button doesn't work"
 *    (feedback #58). */
function RedactSelectionButton({
  onClick,
  className,
}: {
  onClick: () => ManualRedactError | null;
  className?: string;
}) {
  const { t } = useT();
  const [hint, setHint] = useState<ManualRedactError | null>(null);
  return (
    <div>
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setHint(onClick())}
        className={cn(
          "inline-flex items-center gap-1 rounded-md border border-quon-border px-2 py-1 text-[10px] text-quon-muted transition hover:text-quon-text",
          className,
        )}
      >
        <ShieldAlert className="h-3 w-3" /> {t("chat.redactSelection")}
      </button>
      {hint && (
        <p className="mt-1 text-[10px] leading-snug text-quon-yellow">
          {t(
            hint === "empty"
              ? "chat.redactHintEmpty"
              : hint === "placeholder"
                ? "chat.redactHintPlaceholder"
                : "chat.redactHintNotFound",
          )}
        </p>
      )}
    </div>
  );
}

/**
 * Collapsible scrubbed full-text of a context source (document / RAG) with a
 * "Redact selection" affordance, so the user can manually black out anything the
 * detector missed — the same power the typed-message preview already has.
 *
 * `onRedactAlways` is optional and, today, only wired for the attachment: a
 * second action next to the per-send one that ALSO remembers the term on the
 * enforced always-redact list, for every future send. Omitting it (the
 * Memory/Documents context section) keeps that surface exactly as before.
 */
function ManualRedactSection({
  label,
  text,
  onRedactSelection,
  onRedactAlways,
}: {
  label: string;
  text: string;
  onRedactSelection: () => ManualRedactError | null;
  onRedactAlways?: () => DurableRedactMatch | null;
}) {
  const { t } = useT();
  return (
    <details className="group mt-2">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-[10px] font-medium text-quon-muted transition hover:text-quon-text [&::-webkit-details-marker]:hidden">
        <ChevronDown className="h-3 w-3 transition group-open:rotate-180" />
        {label}
      </summary>
      <div className="mt-1.5 text-[10px] uppercase tracking-wide text-quon-muted">
        {t("chat.selectMissedTextInstruction")}
      </div>
      <HighlightedSent
        text={text}
        className="mt-1 border border-quon-border bg-quon-surface text-[13px]"
      />
      <div className="mt-2 flex flex-wrap items-start gap-2">
        <RedactSelectionButton onClick={onRedactSelection} className="bg-quon-surface" />
        {onRedactAlways && (
          <AlwaysRedactButton onClick={onRedactAlways} className="bg-quon-surface" />
        )}
      </div>
    </details>
  );
}

export function ReviewPanel({
  modelLabel,
  base,
  items,
  attachment,
  contextItems,
  contextBase,
  contextSourceCount,
  fallbackMode,
  skipReason,
  lowCaseSignal,
  onToggle,
  onToggleAttachment,
  onToggleContext,
  onRedactSelection,
  onRedactAttachmentSelection,
  onRedactAttachmentAlways,
  onOpenOriginal,
  onRedactContextSelection,
  onEdit,
  onSend,
}: {
  modelLabel: string;
  base: string;
  items: ReviewItem[];
  attachment?: ReviewAttachment;
  /** hits detected in the retrieved Memory/Documents context (undefined = none injected) */
  contextItems?: ReviewItem[];
  /** the already-scrubbed context text (placeholders) — shown for manual redaction */
  contextBase?: string;
  contextSourceCount?: number;
  fallbackMode?: boolean;
  skipReason?: string | null;
  lowCaseSignal?: boolean;
  onToggle: (placeholder: string) => void;
  onToggleAttachment: (placeholder: string) => void;
  onToggleContext: (placeholder: string) => void;
  onRedactSelection: () => ManualRedactError | null;
  onRedactAttachmentSelection: () => ManualRedactError | null;
  /** Durable ("Immer schwärzen") counterpart for the attachment section only. */
  onRedactAttachmentAlways: () => DurableRedactMatch | null;
  /** Opens the attached library document in the real viewer (rendered PDF,
   *  selection on the page). Absent for ad-hoc/combined attachments. */
  onOpenOriginal?: () => void;
  onRedactContextSelection: () => ManualRedactError | null;
  onEdit: () => void;
  onSend: () => void;
}) {
  const { t, plural } = useT();
  const sent = buildSentText(base, items);
  // Count everything still redacted across the message AND the document / context,
  // so the header reflects exactly what will leave the device.
  const activeCount =
    items.filter((i) => i.active).length +
    (attachment?.items.filter((i) => i.active).length ?? 0) +
    (contextItems?.filter((i) => i.active).length ?? 0);
  const countRedactedKeys = {
    one: "chat.reviewCountRedactedOne",
    other: "chat.reviewCountRedactedOther",
  } as const;

  return (
    <div className="rounded-xl border border-quon-indigo/40 bg-quon-surface">
      <div className="flex items-center justify-between border-b border-quon-border px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-quon-text">
          <Lock className="h-3.5 w-3.5 text-quon-indigo" />{" "}
          {t("chat.reviewHeader", { model: modelLabel })}
        </div>
        <span className="text-[10px] text-quon-muted">
          {plural(activeCount, countRedactedKeys)}
        </span>
      </div>

      <div className="px-3 py-2">
        {fallbackMode && (
          <div className="mb-2 rounded-md border border-quon-yellow/30 bg-quon-yellow/10 px-2 py-1 text-[10px] text-quon-yellow">
            {t("chat.fallbackNoticeBase")}
            {enrichmentSkipReason(skipReason) ? ` — ${enrichmentSkipReason(skipReason)}` : ""}
            {t("chat.fallbackNoticeReviewSuffix")}
            {lowCaseSignal && t("chat.fallbackNoticeLowCase")}
          </div>
        )}

        <div className="mb-1 text-[11px] uppercase tracking-wide text-quon-muted">
          {t("chat.sentToProviderInstruction")}
        </div>
        <HighlightedSent text={sent} className="bg-quon-surface-2" />

        <RedactSelectionButton onClick={onRedactSelection} className="mt-2 bg-quon-surface-2" />

        {items.length > 0 && (
          <p className="mt-2 text-[10px] text-quon-muted">{t("chat.reviewListHint")}</p>
        )}
        {items.length > 0 && (
          <ul className="mt-1 space-y-1">
            {items.map((it) => (
              <ItemRow key={it.placeholder} item={it} onToggle={onToggle} />
            ))}
          </ul>
        )}

        {attachment && (
          <div className="mt-3 rounded-md border border-quon-border bg-quon-surface-2 p-2">
            <div className="flex items-center gap-1.5 text-[11px] text-quon-text">
              <Paperclip className="h-3 w-3 shrink-0 text-quon-indigo" />
              <span className="truncate font-medium" title={attachment.name}>
                {attachment.name}
              </span>
              {attachment.truncated && (
                <span
                  className="text-quon-yellow"
                  title={t("chat.attachmentTruncatedTooltip", { n: "50,000" })}
                >
                  {t("chat.truncatedBadge")}
                </span>
              )}
              {onOpenOriginal && (
                <button
                  onClick={onOpenOriginal}
                  className="ml-2 shrink-0 rounded-md border border-quon-border px-1.5 py-0.5 text-[10px] font-medium text-quon-muted transition hover:text-quon-text"
                >
                  {t("chat.openOriginalToRedact")}
                </button>
              )}
              <span className="ml-auto shrink-0 text-[10px] text-quon-muted">
                {plural(attachment.items.filter((i) => i.active).length, countRedactedKeys)}
              </span>
            </div>
            {attachment.items.length > 0 ? (
              <ul className="mt-1.5 space-y-1">
                {attachment.items.map((it) => (
                  <ItemRow key={it.placeholder} item={it} onToggle={onToggleAttachment} />
                ))}
              </ul>
            ) : (
              <div className="mt-1 flex items-center gap-1 text-[10px] text-quon-muted">
                <ShieldCheck className="h-3 w-3 text-quon-green" /> {t("chat.noPersonalDataInDoc")}
              </div>
            )}
            <ManualRedactSection
              label={t("chat.showDocContentLabel")}
              text={buildSentText(attachment.base, attachment.items)}
              onRedactSelection={onRedactAttachmentSelection}
              // Durable terms live ON a library document; an ad-hoc upload has
              // nowhere to save to, so the action is absent, not broken.
              onRedactAlways={attachment.docIds?.length ? onRedactAttachmentAlways : undefined}
            />
          </div>
        )}

        {contextItems && (
          <div className="mt-3 rounded-md border border-quon-border bg-quon-surface-2 p-2">
            <div className="flex items-center gap-1.5 text-[11px] text-quon-text">
              <Sparkles className="h-3 w-3 shrink-0 text-quon-indigo" />
              <span className="font-medium">{t("chat.memoryDocumentsContext")}</span>
              {contextSourceCount ? (
                <span className="text-quon-muted">
                  {plural(contextSourceCount, {
                    one: "chat.fromSourcesOne",
                    other: "chat.fromSourcesOther",
                  })}
                </span>
              ) : null}
              <span className="ml-auto shrink-0 text-[10px] text-quon-muted">
                {plural(contextItems.filter((i) => i.active).length, countRedactedKeys)}
              </span>
            </div>
            {contextItems.length > 0 ? (
              <ul className="mt-1.5 space-y-1">
                {contextItems.map((it) => (
                  <ItemRow key={it.placeholder} item={it} onToggle={onToggleContext} />
                ))}
              </ul>
            ) : (
              <div className="mt-1 flex items-center gap-1 text-[10px] text-quon-muted">
                <ShieldCheck className="h-3 w-3 text-quon-green" />{" "}
                {t("chat.noPersonalDataInContext")}
              </div>
            )}
            {contextBase != null && (
              <ManualRedactSection
                label={t("chat.showContextContentLabel")}
                text={buildSentText(contextBase, contextItems)}
                onRedactSelection={onRedactContextSelection}
              />
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-quon-border px-3 py-2">
        <button
          onClick={onEdit}
          className="flex-1 rounded-lg border border-quon-border bg-quon-surface px-3 py-2 text-xs font-medium text-quon-muted transition hover:text-quon-text"
        >
          {t("chat.editMessage")}
        </button>
        <button
          onClick={onSend}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-quon-indigo px-3 py-2 text-xs font-semibold text-white transition hover:bg-quon-indigo-hover"
        >
          {t("chat.sendTo", { model: modelLabel })} <ArrowUp className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
