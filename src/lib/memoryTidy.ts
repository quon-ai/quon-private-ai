/**
 * "Aufräumen" (tidy) - LLM-assisted memory consolidation. An explicit,
 * user-triggered, cluster-gated relay pass that merges overlapping or
 * contradictory memory items into the minimal set of standalone facts - the
 * Anthropic-Dreams-shaped alternative to silent self-rewriting (Zhang 2026:
 * iterated LLM self-rewrite degrades memory quality 100% -> 54%). Nothing is
 * ever rewritten in place:
 * `runTidy` only ever QUEUES `mode:"merge"` suggestions (same review queue as
 * the chat sweep); `applyMergeSuggestion` is what actually writes, and even
 * then the originals are superseded (reversible), never deleted.
 *
 * Same zero-knowledge pipeline as `memoryExtract.ts`'s sweep: scrub on-device
 * -> relay sees placeholders only -> local re-hydration. `planTidy` itself is
 * PURE and does no network call - it only decides what a run WOULD cost, for
 * the consent dialog.
 */

import { EMBED_MODEL, embedText } from "./embedding/embedder";
import {
  findMemoryConflicts,
  parseExtractionReply,
  SIM_UPDATE,
  type ExtractedCandidate,
} from "./memoryExtract";
import {
  createMemoryId,
  getAllMemory,
  getMemoryItem,
  isActiveMemory,
  supersedeMemoryItem,
  upsertMemoryItem,
  type MemoryItem,
} from "./memoryStore";
import {
  addMemorySuggestions,
  createSuggestionId,
  deleteMemorySuggestion,
  getAllMemorySuggestions,
  type MemorySuggestion,
} from "./memorySuggestionStore";
import { applyPlaceholders, chatComplete, scrubText, type ChatTurn } from "./quonApi";
import { inScope, type RagScope } from "./rag";
import { cosine } from "./search/vector";

export const TIDY_SYSTEM_PROMPT = `You consolidate a user's personal memory store — a set of saved facts/notes that may overlap, repeat, or contradict each other.

Reply with a JSON array only — no prose, no code fences. Each element:
{"kind": "fact" or "note", "key": "short label (required for kind:fact, optional for kind:note)", "text": "the merged, standalone fact", "tags": ["lowercase", "topic", "tags"]}

Rules:
- Merge the given items into the MINIMAL set of standalone facts that preserve all the real information. Do not just concatenate — actually consolidate duplicates and near-duplicates into one entry.
- Where two items contradict (e.g. two different values for the same thing), prefer the one that reads as MORE RECENTLY updated (later in the list) and mention in the merged text that it replaces an earlier, conflicting value — briefly, in the text itself, not as a separate field.
- Never invent information that isn't present in the given items.
- The input contains placeholder tokens like [PERSON_1] or [EMAIL_2]. Copy them into "text" and "key" EXACTLY as written — never invent, renumber or expand a placeholder.
- Return [] if the items genuinely don't merge into anything more concise than they already are.`;

/** A cluster of active memory item ids the tidy pass proposes to consolidate. */
export interface TidyCluster {
  /** Stable id for this cluster (sorted member ids joined) - usable as a React key. */
  id: string;
  itemIds: string[];
  /** Why this cluster was proposed: embedding similarity, or an unresolved
   *  same-key conflict (see `findMemoryConflicts`). */
  reason: "similarity" | "key-conflict";
}

export interface TidyPlan {
  clusters: TidyCluster[];
  /** One relay call per cluster - shown in the consent dialog before any
   *  network call is made. */
  estimatedRelayCalls: number;
}

/**
 * Plan a tidy run - PURE, no network. Two sources of clusters, both restricted
 * to ACTIVE same-scope items:
 *
 *   - similarity clusters: connected components over pairwise cosine >=
 *     SIM_UPDATE (0.78 - the same bar the sweep uses for "this is probably an
 *     update of that"), kept only when a component has >= 3 members (a pair is
 *     already handled by the cheaper exact-dup auto-merge / key-conflict
 *     paths; tidy is for genuinely tangled groups).
 *   - key-conflict clusters: any unresolved `findMemoryConflicts` pair not
 *     already fully covered by a similarity cluster - a conflict is always
 *     worth a tidy pass regardless of size.
 */
export function planTidy(scope: RagScope): TidyPlan {
  const ok = inScope(scope);
  const active = getAllMemory().filter((m) => ok(m) && isActiveMemory(m));
  const embedded = active.filter((m) => m.embModel === EMBED_MODEL && m.embedding);

  const adjacency = new Map<string, Set<string>>();
  for (const m of embedded) adjacency.set(m.id, new Set());
  for (let i = 0; i < embedded.length; i++) {
    for (let j = i + 1; j < embedded.length; j++) {
      const a = embedded[i];
      const b = embedded[j];
      if (cosine(a.embedding as number[], b.embedding as number[]) >= SIM_UPDATE) {
        adjacency.get(a.id)?.add(b.id);
        adjacency.get(b.id)?.add(a.id);
      }
    }
  }
  const visited = new Set<string>();
  const simClusters: string[][] = [];
  for (const m of embedded) {
    if (visited.has(m.id)) continue;
    const stack = [m.id];
    const component: string[] = [];
    visited.add(m.id);
    while (stack.length) {
      const cur = stack.pop() as string;
      component.push(cur);
      for (const nb of adjacency.get(cur) ?? []) {
        if (!visited.has(nb)) {
          visited.add(nb);
          stack.push(nb);
        }
      }
    }
    if (component.length >= 3) simClusters.push(component.sort());
  }

  const { keyConflicts } = findMemoryConflicts(scope);
  const simSets = simClusters.map((c) => new Set(c));
  const conflictClusters: string[][] = [];
  for (const { a, b } of keyConflicts) {
    const pair = [a.id, b.id].sort();
    const alreadyCovered = simSets.some((s) => pair.every((id) => s.has(id)));
    if (!alreadyCovered) conflictClusters.push(pair);
  }

  const clusters: TidyCluster[] = [
    ...simClusters.map((itemIds) => ({
      id: itemIds.join("+"),
      itemIds,
      reason: "similarity" as const,
    })),
    ...conflictClusters.map((itemIds) => ({
      id: itemIds.join("+"),
      itemIds,
      reason: "key-conflict" as const,
    })),
  ];

  return { clusters, estimatedRelayCalls: clusters.length };
}

export interface TidyRunOptions {
  /** undefined = global memory; a project id = that project's memory. */
  scope: RagScope;
  model: string;
  connectionId?: string;
  alwaysRedact?: string[];
  neverRedact?: string[];
  /** The clusters to actually process - normally `planTidy(scope).clusters`,
   *  filtered down to whatever the user consented to in the dialog. */
  clusters: TidyCluster[];
  /** `(done, total)` after each cluster, success or failure. */
  onProgress?: (done: number, total: number) => void;
}

export interface TidyRunResult {
  /** "merge" suggestions queued for review. */
  suggested: number;
  /** Clusters that failed (scrub/relay/parse) - untouched, safe to retry on
   *  the next tidy run (nothing was written for a failed cluster). */
  failed: number;
}

/**
 * Execute a consented tidy plan: per cluster, scrub the concatenated member
 * texts, ask the model to consolidate them (`TIDY_SYSTEM_PROMPT`), re-hydrate
 * locally, and queue the result(s) as `mode:"merge"` suggestions targeting the
 * cluster's member ids. Fail-soft per cluster (like the chat sweep) - one
 * cluster's scrub/relay/parse failure doesn't abort the rest.
 *
 * A cluster whose members got merged also SUPERSEDES any pending queue
 * suggestion that already targets one of them (a stale "update"/"merge"
 * suggestion against an item this pass just replaced would otherwise dangle).
 */
export async function runTidy(opts: TidyRunOptions): Promise<TidyRunResult> {
  let suggested = 0;
  let failed = 0;
  const now = Date.now();

  for (let i = 0; i < opts.clusters.length; i++) {
    const cluster = opts.clusters[i];
    try {
      const members = cluster.itemIds
        .map((id) => getMemoryItem(id))
        .filter((m): m is MemoryItem => !!m && isActiveMemory(m));
      if (members.length < 2) continue; // nothing left to merge (edited/removed since planning)

      const combined = members.map((m) => `- ${m.key ? `${m.key}: ` : ""}${m.text}`).join("\n");
      const scrub = await scrubText(combined, {
        placeholder_style: "indexed",
        always_redact: opts.alwaysRedact,
        never_redact: opts.neverRedact,
      });
      const turns: ChatTurn[] = [
        { role: "system", content: TIDY_SYSTEM_PROMPT },
        { role: "user", content: scrub.scrubbed },
      ];
      const reply = await chatComplete(turns, opts.model, true, opts.connectionId);
      const parsed: ExtractedCandidate[] | null = parseExtractionReply(reply.answer);
      if (parsed === null || parsed.length === 0) {
        failed++;
        continue;
      }

      const map = Object.fromEntries(scrub.entities.map((e) => [e.placeholder, e.value]));
      const memberIds = members.map((m) => m.id);
      const newSuggestions: MemorySuggestion[] = parsed.map((c) => ({
        id: createSuggestionId(),
        kind: c.kind,
        key: c.key ? applyPlaceholders(c.key, map) : undefined,
        text: applyPlaceholders(c.text, map),
        tags: c.tags,
        projectId: opts.scope,
        mode: "merge",
        targetIds: memberIds,
        createdAt: now,
      }));
      addMemorySuggestions(newSuggestions);
      suggested += newSuggestions.length;

      // Drop stale pending suggestions targeting an item this cluster merges.
      const memberIdSet = new Set(memberIds);
      const stale = getAllMemorySuggestions().filter(
        (s) =>
          !newSuggestions.some((n) => n.id === s.id) &&
          ((s.targetId && memberIdSet.has(s.targetId)) ||
            (s.targetIds && s.targetIds.some((id) => memberIdSet.has(id)))),
      );
      for (const s of stale) deleteMemorySuggestion(s.id);
    } catch {
      failed++; // fail-soft per cluster, like the chat sweep
    } finally {
      opts.onProgress?.(i + 1, opts.clusters.length);
    }
  }

  return { suggested, failed };
}

/**
 * Accept a "merge" suggestion: create one new active memory item holding the
 * merged text, then supersede every `targetIds` member against it
 * (reversible - see `supersedeMemoryItem`). Nothing is deleted. Throws if `s`
 * is not a merge suggestion (a caller bug, not a runtime condition to handle
 * softly).
 */
export async function applyMergeSuggestion(s: MemorySuggestion): Promise<MemoryItem> {
  if (s.mode !== "merge" || !s.targetIds?.length) {
    throw new Error("applyMergeSuggestion: suggestion is not a merge");
  }
  let embedding: number[] | undefined;
  try {
    embedding = await embedText(s.text);
  } catch {
    embedding = undefined; // stored anyway; re-embedded lazily like any other item
  }
  const now = Date.now();
  const firstTarget = s.targetIds.map((id) => getMemoryItem(id)).find((m): m is MemoryItem => !!m);
  const merged: MemoryItem = {
    id: createMemoryId(),
    kind: s.kind,
    key: s.key,
    text: s.text,
    tags: s.tags,
    embedding,
    dim: embedding?.length,
    embModel: embedding ? EMBED_MODEL : undefined,
    projectId: s.projectId,
    source: firstTarget?.source, // best-effort provenance carry-through
    createdAt: now,
    updatedAt: now,
  };
  upsertMemoryItem(merged);
  for (const targetId of s.targetIds) {
    if (getMemoryItem(targetId)) supersedeMemoryItem(targetId, merged.id);
  }
  deleteMemorySuggestion(s.id);
  return merged;
}
