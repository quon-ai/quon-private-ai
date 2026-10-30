import { useState } from "react";
import { ShieldAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/i18n";
import type { MessageKey } from "@/lib/i18n/catalog";
import type { DurableRedactError, DurableRedactMatch } from "@/lib/manualRedact";

/** Same wording the per-send "Auswahl schwärzen" button already uses for its
 *  three failure modes, plus the two durable-only ones. One map, so the two
 *  surfaces (chat Review panel, document viewer) never drift apart. */
const ERROR_KEYS: Record<DurableRedactError, MessageKey> = {
  empty: "chat.redactHintEmpty",
  placeholder: "chat.redactHintPlaceholder",
  "not-found": "chat.redactHintNotFound",
  "never-redact": "chat.redactHintNeverRedact",
  "inside-word": "chat.redactHintInsideWord",
};

/**
 * "Immer schwärzen" (durable redaction) trigger + inline result line — shared
 * by the chat Review panel's attachment section and the document viewer's Text
 * view, so both surfaces speak with the same voice.
 *
 * Every outcome is named, never silent (the lesson from feedback #58's silent
 * per-send button): success states the exact blast radius — how many places,
 * right now, per `resolveDurableRedaction`'s occurrence count — and failure
 * states why, in the same wording the per-send button already uses.
 *
 * WebKit detail carried over from RedactSelectionButton: onMouseDown
 * preventDefault, because a mousedown on a button collapses the text
 * selection BEFORE click fires in WebKit — the exact selection this button
 * exists to read.
 */
/** What the button promises: "document" saves the term on the DocItem
 *  (every future send), "send" applies it to the one message being composed
 *  (a staged ad-hoc attachment, #72). Label and confirmation follow the scope,
 *  so the button never claims more permanence than the parent delivers. */
export type RedactScope = "document" | "send";

export function AlwaysRedactButton({
  onClick,
  scope = "document",
  className,
}: {
  onClick: () => DurableRedactMatch | null;
  scope?: RedactScope;
  className?: string;
}) {
  const { t, plural } = useT();
  const [result, setResult] = useState<DurableRedactMatch | null>(null);
  return (
    <div>
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setResult(onClick())}
        className={cn(
          "inline-flex items-center gap-1 rounded-md border border-quon-indigo/40 px-2 py-1 text-[10px] text-quon-indigo transition hover:bg-quon-indigo/10",
          className,
        )}
      >
        <ShieldAlert className="h-3 w-3" />{" "}
        {scope === "send" ? t("chat.redactForSendSelection") : t("chat.alwaysRedactSelection")}
      </button>
      {result && "error" in result && (
        <p className="mt-1 text-[10px] leading-snug text-quon-yellow">
          {t(ERROR_KEYS[result.error])}
        </p>
      )}
      {result && "value" in result && (
        <p className="mt-1 text-[10px] leading-snug text-quon-green">
          {plural(
            result.occurrences,
            scope === "send"
              ? { one: "chat.redactForSendConfirmOne", other: "chat.redactForSendConfirmOther" }
              : { one: "chat.alwaysRedactConfirmOne", other: "chat.alwaysRedactConfirmOther" },
            { value: result.value },
          )}
        </p>
      )}
    </div>
  );
}
