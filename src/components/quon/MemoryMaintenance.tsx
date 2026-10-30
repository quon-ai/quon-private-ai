/**
 * Memory maintenance UI (P5) — the single quiet entry point for the lifecycle
 * layer, per the ux-designer concept: the default Memory view stays exactly as
 * calm as before; everything here renders NOTHING unless it has something to
 * say. One conditional "Pflege" row expands inline (accordion — deliberately no
 * dialog, matching the house click-to-expand precedent) into up to three
 * sections in risk order: conflicts → attic ("still current?") → AI tidy-up.
 * Every action is reversible (supersede/archive, never delete except the
 * explicit attic delete) and the LLM tidy shows an honest cost line BEFORE
 * anything is sent.
 */
import { useMemo, useState } from "react";
import { Archive, ChevronDown, Loader2, Wand2 } from "lucide-react";

import { useT } from "@/lib/i18n/i18n";
import {
  ATTIC_AGE_MS,
  autoMergeExactDuplicates,
  findAtticItems,
  findMemoryConflicts,
  nearDuplicatesForReview,
  type KeyConflictPair,
  type NearDupPair,
} from "@/lib/memoryExtract";
import {
  archiveMemoryItem,
  confirmMemoryItem,
  deleteMemoryItem,
  getMemoryItem,
  isActiveMemory,
  reviveMemoryItem,
  supersedeMemoryItem,
  useMemory,
  type MemoryItem,
} from "@/lib/memoryStore";
import { planTidy, runTidy, type TidyPlan } from "@/lib/memoryTidy";
import { CHAT_MODELS, getModels } from "@/lib/quonApi";
import { useQuonState } from "@/lib/quonStore";

const ATTIC_VISIBLE = 5;

/** Coarse, honest cost estimate for the consent line: small completions on the
 *  mistral-small class run well under a cent each — never claim "free". */
function tidyCostLabel(calls: number): string {
  return calls <= 5 ? "0,01 $" : "0,05 $";
}

function fmtMonthYear(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

// --- the single entry point ---------------------------------------------------

export function MemoryHealthRow({ projectId }: { projectId?: string }) {
  const { t, plural } = useT();
  const items = useMemory();
  const [open, setOpen] = useState(false);
  // Recomputed when the store changes (useMemory re-renders us); both scans are
  // pure over cached vectors — cheap at this product's item counts.
  const { conflicts, nearDuplicates } = useMemo(() => {
    const found = findMemoryConflicts(projectId);
    // A pair that is already a key conflict is NOT also listed as a duplicate —
    // one pair, one question, asked in the more specific place (see
    // nearDuplicatesForReview).
    return { conflicts: found.keyConflicts, nearDuplicates: nearDuplicatesForReview(found) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, projectId]);
  const attic = useMemo(
    () => findAtticItems(projectId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, projectId],
  );
  const plan = useMemo(
    () => planTidy(projectId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, projectId],
  );

  // Quiet by default: nothing to decide, confirm or tidy → no row at all.
  if (
    conflicts.length === 0 &&
    nearDuplicates.length === 0 &&
    attic.length === 0 &&
    plan.clusters.length === 0
  )
    return null;

  const parts = [
    conflicts.length > 0 &&
      plural(conflicts.length, {
        one: "memory.maintRowConflicts.one",
        other: "memory.maintRowConflicts.other",
      }),
    attic.length > 0 &&
      plural(attic.length, {
        one: "memory.maintRowAttic.one",
        other: "memory.maintRowAttic.other",
      }),
    nearDuplicates.length > 0 &&
      plural(nearDuplicates.length, {
        one: "memory.maintRowDupes.one",
        other: "memory.maintRowDupes.other",
      }),
    conflicts.length === 0 &&
      nearDuplicates.length === 0 &&
      attic.length === 0 &&
      plan.clusters.length > 0 &&
      t("memory.maintRowTidy"),
  ].filter(Boolean) as string[];

  return (
    <div className="mt-3 rounded-xl border border-quon-yellow/30 bg-quon-yellow/5">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <Wand2 className="h-4 w-4 shrink-0 text-quon-yellow" />
        <span className="min-w-0 flex-1 truncate text-xs text-quon-text">{parts.join(" · ")}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-quon-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="space-y-3 border-t border-quon-border px-3 py-3">
          {conflicts.length > 0 && <ConflictSection conflicts={conflicts} />}
          {nearDuplicates.length > 0 && <DuplicateSection pairs={nearDuplicates} />}
          {attic.length > 0 && <AtticSection items={attic} />}
          {plan.clusters.length > 0 && <TidySection projectId={projectId} plan={plan} />}
        </div>
      )}
    </div>
  );
}

// --- conflicts: pick the current version --------------------------------------

function ConflictSection({ conflicts }: { conflicts: KeyConflictPair[] }) {
  const { t } = useT();
  return (
    <section>
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-quon-text">
        {t("memory.conflictTitle")}
      </h3>
      <p className="mt-0.5 text-[10px] text-quon-muted">{t("memory.conflictHint")}</p>
      <div className="mt-2 space-y-2">
        {conflicts.map((pair) => (
          <div
            key={`${pair.a.id}:${pair.b.id}`}
            className="rounded-lg border border-quon-border bg-quon-surface-2 p-2.5"
          >
            {pair.a.key && (
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-quon-muted">
                {pair.a.key}
              </div>
            )}
            <div className="grid grid-cols-1 gap-1.5">
              {[pair.a, pair.b].map((item) => (
                <button
                  key={item.id}
                  onClick={() =>
                    supersedeMemoryItem(item.id === pair.a.id ? pair.b.id : pair.a.id, item.id)
                  }
                  aria-label={t("memory.conflictPickAria")}
                  className="flex items-start gap-2 rounded-lg border border-quon-border p-2 text-left hover:border-quon-indigo/50"
                >
                  <span className="min-w-0 flex-1 text-xs text-quon-text">{item.text}</span>
                  <span className="shrink-0 text-[10px] tabular-nums text-quon-muted">
                    {fmtMonthYear(item.updatedAt)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// --- near-duplicates: the same fact, said twice --------------------------------
// Reported 2026-08-08 ("teilredundant"). These are pairs above SIM_REDUNDANT but
// below the auto-merge bar — measurement showed genuine restatements live here
// (a 0.86 pair is one fact in two wordings), so they are SURFACED for a human
// decision and never silently merged. Same interaction as a key conflict: tap
// the version to keep; the other is superseded, never deleted.

function DuplicateSection({ pairs }: { pairs: NearDupPair[] }) {
  const { t } = useT();
  return (
    <section>
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-quon-text">
        {t("memory.dupeTitle")}
      </h3>
      <p className="mt-0.5 text-[10px] text-quon-muted">{t("memory.dupeHint")}</p>
      <div className="mt-2 space-y-2">
        {pairs.slice(0, 10).map((pair) => (
          <div
            key={`${pair.a.id}:${pair.b.id}`}
            className="rounded-lg border border-quon-border bg-quon-surface-2 p-2.5"
          >
            <div className="grid grid-cols-1 gap-1.5">
              {[pair.a, pair.b].map((item) => (
                <button
                  key={item.id}
                  onClick={() =>
                    supersedeMemoryItem(item.id === pair.a.id ? pair.b.id : pair.a.id, item.id)
                  }
                  aria-label={t("memory.conflictPickAria")}
                  className="flex items-start gap-2 rounded-lg border border-quon-border p-2 text-left hover:border-quon-indigo/50"
                >
                  <span className="min-w-0 flex-1 text-xs text-quon-text">{item.text}</span>
                  <span className="shrink-0 text-[10px] tabular-nums text-quon-muted">
                    {fmtMonthYear(item.updatedAt)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// --- attic: "still current?" ---------------------------------------------------

function AtticSection({ items }: { items: MemoryItem[] }) {
  const { t, plural } = useT();
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? items : items.slice(0, ATTIC_VISIBLE);
  const hidden = items.length - visible.length;
  return (
    <section>
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-quon-text">
        {t("memory.atticTitle")}
      </h3>
      <p className="mt-0.5 text-[10px] text-quon-muted">{t("memory.atticHint")}</p>
      <div className="mt-2 space-y-2">
        {visible.map((m) => (
          <div key={m.id} className="rounded-lg border border-quon-border bg-quon-surface-2 p-2.5">
            {m.key && <div className="mb-0.5 text-xs font-semibold text-quon-text">{m.key}</div>}
            <p className="break-words text-xs text-quon-text">{m.text}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-quon-muted">
                {t("memory.atticSince", {
                  date: fmtMonthYear(
                    Math.max(m.updatedAt, m.lastConfirmedAt ?? 0, m.lastUsedAt ?? 0) ||
                      Date.now() - ATTIC_AGE_MS,
                  ),
                })}
              </span>
              <span className="ml-auto flex shrink-0 items-center gap-1">
                <button
                  onClick={() => confirmMemoryItem(m.id)}
                  className="rounded-lg bg-quon-indigo px-2 py-1 text-[10px] font-semibold text-white hover:bg-quon-indigo-hover"
                >
                  {t("memory.atticConfirm")}
                </button>
                <button
                  onClick={() => archiveMemoryItem(m.id)}
                  className="rounded-lg border border-quon-border px-2 py-1 text-[10px] text-quon-muted hover:text-quon-text"
                >
                  {t("memory.atticArchive")}
                </button>
                <button
                  onClick={() => deleteMemoryItem(m.id)}
                  className="rounded-lg border border-quon-border px-2 py-1 text-[10px] text-quon-muted hover:text-destructive"
                >
                  {t("memory.atticDelete")}
                </button>
              </span>
            </div>
          </div>
        ))}
        {hidden > 0 && (
          <button
            onClick={() => setShowAll(true)}
            className="text-[10px] font-medium text-quon-indigo hover:underline"
          >
            {plural(hidden, { one: "memory.atticMore.one", other: "memory.atticMore.other" })}
          </button>
        )}
      </div>
    </section>
  );
}

// --- AI tidy-up: consent inline → progress → honest result ---------------------

type TidyPhase =
  | { step: "idle" }
  | { step: "consent" }
  | { step: "running"; done: number; total: number }
  | { step: "done"; autoMerged: number; suggested: number; failed: number };

function TidySection({ projectId, plan }: { projectId?: string; plan: TidyPlan }) {
  const { t, plural } = useT();
  const { activeModelId, alwaysRedact, neverRedact } = useQuonState();
  const [phase, setPhase] = useState<TidyPhase>({ step: "idle" });

  async function go() {
    // 1) Free, deterministic pass first: exact duplicates auto-merge (reversible
    //    — the older item is archived, never deleted; always REPORTED below).
    const autoMerged = autoMergeExactDuplicates(projectId);
    // 2) Re-plan (the auto-merge may have dissolved clusters), then relay.
    const fresh = planTidy(projectId);
    if (fresh.clusters.length === 0) {
      setPhase({ step: "done", autoMerged, suggested: 0, failed: 0 });
      return;
    }
    setPhase({ step: "running", done: 0, total: fresh.clusters.length });
    try {
      const models = await getModels().catch(() => CHAT_MODELS);
      const selected = models.find((m) => m.id === activeModelId);
      const res = await runTidy({
        scope: projectId,
        model: selected?.model || activeModelId,
        connectionId: selected?.connection_id,
        alwaysRedact,
        neverRedact,
        clusters: fresh.clusters,
        onProgress: (done, total) => setPhase({ step: "running", done, total }),
      });
      setPhase({ step: "done", autoMerged, suggested: res.suggested, failed: res.failed });
    } catch {
      // runTidy is fail-soft per cluster; this catches the unexpected.
      setPhase({ step: "done", autoMerged, suggested: 0, failed: fresh.clusters.length });
    }
  }

  return (
    <section>
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-quon-text">
        {t("memory.tidyTitle")}
      </h3>
      <p className="mt-0.5 text-[10px] text-quon-muted">{t("memory.tidyBlurb")}</p>
      <div className="mt-2">
        {phase.step === "idle" && (
          <button
            onClick={() => setPhase({ step: "consent" })}
            className="flex items-center gap-1.5 rounded-lg border border-quon-border px-2.5 py-1.5 text-[11px] font-semibold text-quon-text hover:border-quon-indigo/50"
          >
            <Wand2 className="h-3 w-3 text-quon-indigo" /> {t("memory.tidyStart")}
          </button>
        )}
        {phase.step === "consent" && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] text-quon-muted">
              {t("memory.tidyCostLine", {
                count: plan.estimatedRelayCalls,
                amount: tidyCostLabel(plan.estimatedRelayCalls),
              })}
            </span>
            <button
              onClick={() => void go()}
              className="rounded-lg bg-quon-indigo px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-quon-indigo-hover"
            >
              {t("memory.tidyConfirm")}
            </button>
            <button
              onClick={() => setPhase({ step: "idle" })}
              className="rounded-lg border border-quon-border px-2.5 py-1 text-[10px] text-quon-muted hover:text-quon-text"
            >
              {t("common.cancel")}
            </button>
          </div>
        )}
        {phase.step === "running" && (
          <div className="flex items-center gap-1.5 text-[10px] text-quon-muted">
            <Loader2 className="h-3 w-3 animate-spin text-quon-indigo" />
            {t("memory.tidyRunning", { done: phase.done, total: phase.total })}
          </div>
        )}
        {phase.step === "done" && (
          <div className="space-y-0.5 text-[10px] text-quon-muted">
            {phase.autoMerged > 0 && (
              <p>
                {plural(phase.autoMerged, {
                  one: "memory.tidyAutoMerged.one",
                  other: "memory.tidyAutoMerged.other",
                })}
              </p>
            )}
            <p>
              {phase.failed > 0 && phase.suggested === 0
                ? t("memory.tidyFailed")
                : phase.suggested > 0
                  ? plural(phase.suggested, {
                      one: "memory.tidyDoneSuggestions.one",
                      other: "memory.tidyDoneSuggestions.other",
                    })
                  : t("memory.tidyDoneNothing")}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

// --- pin-crowding nudge ---------------------------------------------------------

export function PinCrowdingHint({ projectId }: { projectId?: string }) {
  const { t } = useT();
  const items = useMemory();
  const pinned = items.filter(
    (m) => (projectId ? m.projectId === projectId : true) && isActiveMemory(m) && m.pinned,
  ).length;
  if (pinned < 2) return null;
  return (
    <p className="mt-2 text-[10px] text-quon-muted">{t("memory.pinNudge", { count: pinned })}</p>
  );
}

// --- archived drawer -------------------------------------------------------------

export function ArchivedMemoriesSection({ projectId }: { projectId?: string }) {
  const { t, plural } = useT();
  const items = useMemory();
  const [open, setOpen] = useState(false);
  const archived = items.filter(
    (m) => (projectId ? m.projectId === projectId : true) && !isActiveMemory(m),
  );
  if (archived.length === 0) return null;
  return (
    <div className="pt-1">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-[10px] text-quon-muted hover:text-quon-text"
      >
        <Archive className="h-3 w-3" />
        {plural(archived.length, {
          one: "memory.archiveLink.one",
          other: "memory.archiveLink.other",
        })}
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {archived.map((m) => {
            const winner = m.supersededBy ? getMemoryItem(m.supersededBy) : undefined;
            return (
              <div
                key={m.id}
                className="rounded-lg border border-dashed border-quon-border p-2.5 opacity-80"
              >
                {m.key && (
                  <div className="mb-0.5 text-xs font-semibold text-quon-text">{m.key}</div>
                )}
                <p className="break-words text-xs text-quon-muted">{m.text}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  {winner && (
                    <span className="min-w-0 truncate text-[10px] text-quon-muted">
                      {t("memory.archiveSupersededBy", { text: winner.text.slice(0, 60) })}
                    </span>
                  )}
                  <button
                    onClick={() => reviveMemoryItem(m.id)}
                    className="ml-auto shrink-0 rounded-lg border border-quon-border px-2 py-1 text-[10px] text-quon-muted hover:text-quon-text"
                  >
                    {t("memory.archiveRevive")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
