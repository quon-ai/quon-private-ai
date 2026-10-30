import { useSyncExternalStore } from "react";
import { FileText, Loader2, Sparkles } from "lucide-react";

import { CHAT_MODELS, getModels } from "@/lib/quonApi";
import { getSweepState, startSweep, subscribeSweep, type SweepKind } from "@/lib/memorySweepRunner";
import { pendingSweepCount } from "@/lib/memoryExtract";
import { pendingDocumentSweepCount } from "@/lib/memoryFromDocuments";
import { useMemorySuggestions } from "@/lib/memorySuggestionStore";
import { inScope } from "@/lib/rag";
import { useQuonState } from "@/lib/quonStore";
import { useT } from "@/lib/i18n/i18n";
import type { MessageKey } from "@/lib/i18n/catalog";

/**
 * The manual Auto-Memory triggers (v1: the button IS the opt-in; nothing runs in
 * the background). Each mines one source in scope — a project's chats/documents,
 * or, without `projectId`, the global pool — for durable facts and fills the
 * review queue shown in the Memory screen; nothing is saved to Memory without
 * explicit approval there.
 *
 * The sweeps run at module level (memorySweepRunner) so their progress survives
 * navigating away and back, and a re-entered screen shows the live status or the
 * final result — the buttons just reflect and trigger them.
 *
 * Zero-knowledge: source text is scrubbed on-device before the relay sees it and
 * placeholders are re-hydrated locally (src/lib/memoryExtract.ts,
 * src/lib/memoryFromDocuments.ts).
 *
 * ⚠️ The result must stay REACHABLE. A sweep fills a review queue that lives on
 * another screen (in a project: Content → memory), and reported 2026-08-04 the
 * only thing to click afterwards was this button again — which re-ran the
 * sweep, found nothing left to analyse, and replaced "29 suggestions to
 * review" with "Nothing new to learn". The suggestions were never lost, but
 * the one affordance present destroyed the evidence that they existed. Hence
 * `onShowReview` + the waiting-count chip below, and the guard in run().
 */
function LearnButton({
  projectId,
  kind,
  label,
  Icon,
  countPending,
  onShowReview,
}: {
  projectId?: string;
  kind: SweepKind;
  label: MessageKey;
  Icon: typeof Sparkles;
  countPending: (scope?: string) => number;
  /** Reveal the review queue (project: switch to the Content tab; global: it
   *  is on the same screen). Without it the sweep result is a dead end. */
  onShowReview?: () => void;
}) {
  const { t } = useT();
  const { activeModelId, alwaysRedact, neverRedact } = useQuonState();
  const { running, status } = useSyncExternalStore(subscribeSweep, () =>
    getSweepState(projectId, kind),
  );
  // Ambient discovery signal: how much in-scope material has never been mined.
  // Recomputed on each render — useQuonState re-renders on store changes,
  // subscribeSweep on a completed run (cursors advanced → count drops).
  const pending = running ? 0 : countPending(projectId);
  // What a previous sweep already found and nobody has reviewed yet. Strictly
  // scoped, so this is exactly what THIS button's sweep produced.
  const ok = inScope(projectId);
  const awaiting = useMemorySuggestions().filter(
    (s) => ok(s) && (kind === "chats" ? !!s.sourceSessionId : !!s.sourceDocId),
  ).length;

  async function run() {
    if (running) return;
    // Nothing left to mine, but results are waiting: the user pressing this
    // wants their suggestions, not a second pointless sweep that would report
    // "nothing new" over the top of the real result. Take them there instead.
    if (pending === 0 && awaiting > 0 && onShowReview) {
      onShowReview();
      return;
    }
    // Same model resolution as the chat composer: the backend /models list
    // (falling back to the bundled catalog) maps the selected id to its provider
    // slug + connection. Resolved here (async) then handed to the module runner.
    const models = await getModels().catch(() => CHAT_MODELS);
    const selected = models.find((m) => m.id === activeModelId);
    startSweep({
      kind,
      scope: projectId,
      model: selected?.model || activeModelId,
      connectionId: selected?.connection_id,
      alwaysRedact,
      neverRedact,
    });
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <button
        onClick={() => void run()}
        disabled={running}
        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-quon-border px-2.5 py-1.5 text-[11px] font-semibold text-quon-text hover:border-quon-indigo/50 disabled:opacity-50"
      >
        {running ? (
          <Loader2 className="h-3 w-3 animate-spin text-quon-indigo" />
        ) : (
          <Icon className="h-3 w-3 text-quon-indigo" />
        )}
        {t(label)}
        {pending > 0 && (
          <span className="ml-0.5 rounded-full bg-quon-indigo px-1.5 py-0.5 text-[9px] font-bold leading-none text-white">
            {t("memory.learnNewBadge", { count: pending })}
          </span>
        )}
      </button>
      {awaiting > 0 && onShowReview && (
        <button
          onClick={onShowReview}
          className="shrink-0 rounded-full border border-quon-indigo/50 bg-quon-indigo/10 px-2 py-1 text-[10px] font-semibold text-quon-indigo hover:bg-quon-indigo/20"
        >
          {t("memory.reviewWaiting", { count: awaiting })}
        </button>
      )}
      {status && <span className="min-w-0 truncate text-[10px] text-quon-muted">{status}</span>}
    </div>
  );
}

export function LearnFromChatsButton({
  projectId,
  onShowReview,
}: {
  projectId?: string;
  onShowReview?: () => void;
}) {
  return (
    <LearnButton
      projectId={projectId}
      kind="chats"
      label="memory.learnFromChats"
      Icon={Sparkles}
      countPending={pendingSweepCount}
      onShowReview={onShowReview}
    />
  );
}

export function LearnFromDocumentsButton({
  projectId,
  onShowReview,
}: {
  projectId?: string;
  onShowReview?: () => void;
}) {
  return (
    <LearnButton
      projectId={projectId}
      kind="documents"
      label="memory.learnFromDocuments"
      Icon={FileText}
      countPending={pendingDocumentSweepCount}
      onShowReview={onShowReview}
    />
  );
}
