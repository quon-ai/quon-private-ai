/**
 * Retrieval for chat (RAG): pull the user's most relevant Memory items and
 * Document chunks for a query, fully on-device.
 *
 * Everything here runs in the browser over the already-decrypted stores - the
 * query is embedded locally and ranked locally. The returned `text` is the
 * user's **original** content; the caller scrubs it before it is sent to a cloud
 * LLM (same as a typed message), so the zero-knowledge guarantee holds.
 */

import { allDocChunks, getAllDocuments, getDocumentText } from "./documentStore";
import { combineDocuments } from "./attachAll";
import { EMBED_MODEL, embedBatch } from "./embedding/embedder";
import {
  FACT_MAX_CHARS,
  getAllMemory,
  isActiveMemory,
  touchMemoryUsage,
  upsertMemoryItem,
  type MemoryItem,
} from "./memoryStore";
import { embedMemory } from "./reembed";
import { rrfFuse } from "./search/fusion";
import { rankByLexicalCoverage } from "./search/lexical";
import { splitQuery } from "./search/querySplit";
import { capPreservingRelevance, rerankAndGate, queryTermSet } from "./search/rerank";
import { topKMulti, type Scored } from "./search/vector";

export interface RagSource {
  kind: "memory" | "document";
  title: string;
  snippet: string;
  score: number;
  /** The owning item's id (memory item id / doc id). Lets a future grounding
   *  UI (Phase 3) link a source back to Memory/Documents or dedupe it across
   *  turns. Optional: retrieveContext is currently the only builder of this
   *  shape. */
  itemId?: string;
}

export interface RagResult {
  /** Formatted context block (original text) to inject, or "" if nothing relevant. */
  text: string;
  sources: RagSource[];
  /** How many in-scope PINNED items didn't make it into `sources` this turn -
   *  either because the pinned-crowd-out guard reserved their slot for a
   *  relevance survivor (see rerankAndGate) or the CHAR_BUDGET truncation cut
   *  them. 0 in the common case. Exposed so a future UI can nudge the user
   *  ("you have N pinned facts not shown - consider unpinning some") instead
   *  of pins silently losing a turn. */
  pinnedCrowdedOut: number;
}

const MEMORY_K = 3;
// Fused (vector lexical, via RRF - see ./search/fusion) shortlist size fed
// into the relevance gate (see ./search/rerank). The gate - not a bare cosine
// floor - decides what survives.
const SHORTLIST_K = 15;
const CHAR_BUDGET = 1600; // cap injected context so prompts stay lean
// Pinned documents are the user's EXPLICIT "always use this" choice, so they get
// a far larger slice than relevance-retrieved memory - but still capped so a
// pinned 50-page contract can't blow past the scrubber's max_text_length.
const PINNED_DOC_BUDGET = 12000;
// A memory item whose content hasn't been touched (edited or explicitly
// re-confirmed) in this long gets an honest date suffix when injected into
// context - see the "Stand MM/YYYY" formatting in retrieveContext. ~6 months.
const STALE_AGE_MS = 183 * 24 * 60 * 60 * 1000;

const current = (m: { embedding?: number[]; embModel?: string }) =>
  !!m.embedding && m.embModel === EMBED_MODEL;

/**
 * Retrieval scope: `undefined` = a global chat (only items with no project);
 * a project id = that project only. Strict isolation, no mixing - a project chat
 * never sees global items and a global chat never sees project items.
 */
export type RagScope = string | undefined;

/** Predicate: does an item belong to `scope`? Treats missing and explicit-undefined
 *  projectId as the same (global) bucket. */
export const inScope =
  (scope: RagScope) =>
  (it: { projectId?: string }): boolean =>
    (it.projectId ?? undefined) === (scope ?? undefined);

/** True when there is any (current-model) embedded Memory/Document content in scope.
 *  Superseded/archived memory is excluded - see `isActiveMemory` (P5 lifecycle). */
export function hasRetrievableContext(scope: RagScope): boolean {
  const ok = inScope(scope);
  // allDocChunks already restricts to the current model.
  return (
    getAllMemory().some((m) => current(m) && ok(m) && isActiveMemory(m)) ||
    allDocChunks().some((c) => c.embedding && ok(c))
  );
}

/** True when there is any in-scope **Memory** at all - embedded yet or not. Retrieval
 *  embeds memory on-demand, so the chat gates on presence (this), not on a current
 *  embedding: a freshly-added memory must not be silently ignored because its background
 *  indexing hasn't finished. Documents are not auto-context (added via the chat attach
 *  button instead), so they don't drive the Context toggle. Superseded/archived memory
 *  is excluded - see `isActiveMemory` (P5 lifecycle). */
export function hasScopedContext(scope: RagScope): boolean {
  const ok = inScope(scope);
  return getAllMemory().some((m) => m.text && ok(m) && isActiveMemory(m));
}

/** In-scope PINNED documents that are ready (have text). Pinning is the user's
 *  explicit "always use this" - these bypass relevance retrieval entirely. */
function pinnedDocsInScope(scope: RagScope): { id: string; name: string; text: string }[] {
  const ok = inScope(scope);
  return getAllDocuments()
    .filter((d) => d.pinned && d.status === "ready" && ok(d))
    .map((d) => ({ id: d.id, name: d.filename, text: getDocumentText(d).trim() }))
    .filter((d) => d.text.length > 0);
}

export function hasPinnedDocs(scope: RagScope): boolean {
  return pinnedDocsInScope(scope).length > 0;
}

/** True when a send should attempt context injection: relevance-retrievable
 *  memory OR any pinned document in scope. */
export function hasInjectableContext(scope: RagScope): boolean {
  return hasScopedContext(scope) || hasPinnedDocs(scope);
}

/** Build the pinned-documents context block (fairly budgeted via combineDocuments)
 *  + its sources. Empty when nothing is pinned in scope. Original text - the
 *  caller scrubs it like any other injected context. */
export function pinnedDocContext(scope: RagScope): { text: string; sources: RagSource[] } {
  const pinned = pinnedDocsInScope(scope);
  if (pinned.length === 0) return { text: "", sources: [] };
  const { text } = combineDocuments(
    pinned.map((d) => ({ name: d.name, text: d.text })),
    PINNED_DOC_BUDGET,
  );
  const sources: RagSource[] = pinned.map((d) => ({
    kind: "document",
    title: d.name,
    snippet: d.text.slice(0, 140),
    score: 1, // pinned = always fully trusted
    itemId: d.id,
  }));
  return { text, sources };
}

/** Embed in-scope memory items that have no current-model vector yet, awaited so a
 *  freshly-added or never-indexed memory becomes retrievable on the *first* query
 *  rather than racing the fire-and-forget mount re-embed. Best-effort: a failure
 *  leaves the item for the next attempt. Documents are embedded at ingest, so only
 *  memory needs this self-heal. Superseded/archived items are skipped - no point
 *  spending embedder cycles on memory retrieval will never surface (`isActiveMemory`). */
async function ensureScopedMemoryEmbedded(scope: RagScope): Promise<void> {
  const ok = inScope(scope);
  // Re-embed if stale OR missing chunks (older items predate chunking).
  const pending = getAllMemory().filter(
    (m) =>
      m.text && ok(m) && isActiveMemory(m) && (m.embModel !== EMBED_MODEL || !m.chunks?.length),
  );
  for (const m of pending) {
    try {
      upsertMemoryItem(await embedMemory(m));
    } catch {
      /* embedder unavailable - leave for the next attempt */
    }
  }
}

interface MemChunkRef {
  /** Owning item's id - used to dedupe the shortlist so one long item can't fill
   *  every context slot with several of its own chunks. */
  itemId: string;
  /** Full length of the owning item's text (not just this chunk) - drives the
   *  strict-gate tier: long free-form content is held to a higher relevance bar. */
  itemTextLen: number;
  key?: string;
  kind: MemoryItem["kind"];
  text: string;
  /** Item tags, carried through for the lexical re-rank only (see rerankAndGate's
   *  `textOf` in retrieveContext) - not embedded. Tags are extracted but were
   *  previously ignored at retrieval time; folding them into the *embedded* text
   *  would require re-embedding every existing item (embedMemory in reembed.ts
   *  embeds raw chunk text, so vectors and this text must stay in sync). Lexical
   *  boosting works with today's vectors as-is, so that's where tags go. */
  tags: string[];
  embedding: number[];
  /** Item's last-updated timestamp, carried through for the optional recency
   *  bonus in rerankAndGate (see retrieveContext). */
  updatedAt: number;
  /** Item's last-confirmed timestamp ("still current?" - see
   *  `MemoryItem.lastConfirmedAt`), carried through for the staleness
   *  date-suffix in retrieveContext. */
  lastConfirmedAt?: number;
  /** Effective pinned flag for retrieval: true only when the owning item is
   *  marked `MemoryItem.pinned` AND at/under the fact-length ceiling - a
   *  pinned long note still gets the strict tier (pinning a whole pasted
   *  document must not force-inject it). Fed to rerankAndGate's `pinnedOf`. */
  pinned: boolean;
}

/** Flatten in-scope, current-model memory into rankable chunks - a long note as one
 *  vector is too diluted to match a focused query. Items predating chunking fall back
 *  to their whole-item embedding. Superseded/archived items are excluded (P5
 *  lifecycle - see `isActiveMemory`): retrieval must never surface a fact the user
 *  (or an auto-merge) has replaced. Exported for testing. */
export function memoryChunksInScope(scope: RagScope): MemChunkRef[] {
  const ok = inScope(scope);
  const out: MemChunkRef[] = [];
  for (const m of getAllMemory()) {
    if (!ok(m) || m.embModel !== EMBED_MODEL || !isActiveMemory(m)) continue;
    const pinned = m.pinned === true && m.text.length <= FACT_MAX_CHARS;
    if (m.chunks?.length) {
      for (const c of m.chunks) {
        if (c.embedding)
          out.push({
            itemId: m.id,
            itemTextLen: m.text.length,
            key: m.key,
            kind: m.kind,
            text: c.text,
            tags: m.tags,
            embedding: c.embedding,
            updatedAt: m.updatedAt,
            lastConfirmedAt: m.lastConfirmedAt,
            pinned,
          });
      }
    } else if (m.embedding) {
      out.push({
        itemId: m.id,
        itemTextLen: m.text.length,
        key: m.key,
        kind: m.kind,
        text: m.text,
        tags: m.tags,
        embedding: m.embedding,
        updatedAt: m.updatedAt,
        lastConfirmedAt: m.lastConfirmedAt,
        pinned,
      });
    }
  }
  return out;
}

/** Keep only the best-scoring chunk per memory item. The input arrives sorted
 *  best-first (from rerankAndGate), so the first chunk seen per item wins.
 *  Without this, one long item can occupy every MEMORY_K slot with its own
 *  chunks (the observed failure: 3 injected snippets, all from a single pasted
 *  document). Runs on the GATED list - see retrieveContext. Exported for testing. */
export function dedupeByItem<T extends { itemId: string }>(
  hits: Array<{ item: T; score: number }>,
): Array<{ item: T; score: number }> {
  const seen = new Set<string>();
  return hits.filter((h) => {
    if (seen.has(h.item.itemId)) return false;
    seen.add(h.item.itemId);
    return true;
  });
}

export async function retrieveContext(query: string, scope: RagScope): Promise<RagResult> {
  // Self-heal first: embed any in-scope memory that isn't current yet, so it is
  // actually considered below instead of filtered out by `current`.
  await ensureScopedMemoryEmbedded(scope);
  // Memory only: documents are no longer pulled as automatic context - the user adds a
  // specific document explicitly via the chat attach button instead.
  const memChunks = memoryChunksInScope(scope);
  if (!memChunks.length) return { text: "", sources: [], pinnedCrowdedOut: 0 };

  // Probe with the whole message AND each clause, so a focused fact isn't
  // averaged out of relevance by surrounding chit-chat (see ./querySplit).
  let qvs: number[][];
  try {
    qvs = await embedBatch(splitQuery(query));
  } catch {
    return { text: "", sources: [], pinnedCrowdedOut: 0 }; // embedder unavailable - skip retrieval
  }
  if (!qvs.length) return { text: "", sources: [], pinnedCrowdedOut: 0 };

  // Tags feed the lexical boost only (not the embedded text - see MemChunkRef),
  // so a query matching only a tag (e.g. "work" for an item tagged ["work"])
  // still surfaces the item without touching stored vectors.
  const textOf = (c: MemChunkRef): string => `${c.key ?? ""} ${c.text} ${c.tags.join(" ")}`;
  const chunkKey = (c: MemChunkRef): string => `${c.itemId}::${c.text}`;
  const qTerms = queryTermSet(query);

  // Hybrid candidate sourcing (not vector-only): rank the whole in-scope pool
  // by cosine and, separately, by lexical/subword coverage (see
  // ./search/lexical's rankByLexicalCoverage - this is where the German
  // compound anchor, e.g. "Einkommen" "Nettoeinkommen", gets a chance to
  // matter), then fuse the two rankings via RRF (./search/fusion). Before this,
  // the lexical signal only re-scored whatever topKMulti's cosine cutoff had
  // already shortlisted, so a strong keyword/subword match on an item the
  // vector stage ranked outside SHORTLIST_K could never be reached at all -
  // exactly the production miss (see rag.test.ts's income regression).
  // Fusion only decides shortlist membership/order; each candidate's real raw
  // cosine (from the full vector ranking) is what actually reaches the gate
  // below, never an RRF score.
  const vectorRanked = topKMulti(qvs, memChunks, (c) => c.embedding, memChunks.length);
  const lexicalRanked = rankByLexicalCoverage(memChunks, qTerms, textOf);
  const fusedKeys = rrfFuse([vectorRanked, lexicalRanked], chunkKey).slice(0, SHORTLIST_K);
  const byKey = new Map(vectorRanked.map((s) => [chunkKey(s.item), s] as const));
  // Pinned short facts are always a candidate for the gate, whether or not
  // fusion's top-K cutoff kept them - they're deliberately few and short (see
  // MemoryItem.pinned), so unioning them in never blows the shortlist budget.
  const pinnedKeys = memChunks.filter((c) => c.pinned).map(chunkKey);
  const shortlist = [...new Set([...fusedKeys, ...pinnedKeys])]
    .map((k) => byKey.get(k))
    .filter((s): s is Scored<MemChunkRef> => !!s);

  // Relevance gate -> per-item dedupe -> top MEMORY_K. The gate drops
  // weakly-relevant items and, when nothing is strongly relevant, injects
  // nothing. Order matters: the dedupe runs after the gate - deduping first
  // would pick each item's best chunk by raw cosine, which can throw away the
  // chunk that carries the keyword anchor and then lose the whole item at the
  // gate (verified live: "was sagt mein befund zu ferritin" - the
  // anchor-bearing chunk was the item's second-best by cosine).
  const gated = rerankAndGate(
    shortlist,
    qTerms,
    textOf,
    SHORTLIST_K, // keep all qualified chunks; dedupe + MEMORY_K cap below
    // Opt in to the recency bonus: among equally-relevant memories, prefer the
    // one updated more recently. Document search does not pass this and stays
    // byte-identical (see rerankAndGate's doc comment).
    (c) => c.updatedAt,
    // Long free-form content gets the STRICT gate (keyword anchor + higher
    // cosine): it chunks into many vectors, each an independent chance at a
    // spurious hit, so mid-cosine alone must never inject it. Short items (the
    // fact tier, whatever their kind field says) keep the normal gate.
    (c) => c.itemTextLen > FACT_MAX_CHARS,
    // Pinned short facts bypass the floor entirely (see MemChunkRef.pinned).
    (c) => c.pinned,
  );
  const deduped = dedupeByItem(gated);
  // The real final selection cap: rerankAndGate above was called with the
  // generous SHORTLIST_K (so per-item dedupe has the full qualified pool to
  // pick from), so the pinned crowd-out guard must be re-applied here, at the
  // actual MEMORY_K cap - see capPreservingRelevance's doc comment.
  const memHits = capPreservingRelevance(deduped, MEMORY_K, (c: MemChunkRef) => c.pinned);

  // How many in-scope pinned items didn't make the cut (crowd-out guard above,
  // or simply not among the top MEMORY_K) - see RagResult.pinnedCrowdedOut.
  const pinnedInScope = new Set(memChunks.filter((c) => c.pinned).map((c) => c.itemId));
  const pinnedIncluded = new Set(memHits.filter((h) => h.item.pinned).map((h) => h.item.itemId));
  const pinnedCrowdedOut = [...pinnedInScope].filter((id) => !pinnedIncluded.has(id)).length;

  const sources: RagSource[] = [];
  const memLines: string[] = [];
  for (const r of memHits) {
    const c = r.item;
    // Staleness honesty: a fact untouched (no edit AND no explicit
    // re-confirmation) for a long while gets a "Stand MM/YYYY" date suffix so
    // the model can hedge instead of presenting old data as current truth -
    // see STALE_AGE_MS and MemoryItem.lastConfirmedAt.
    const lastTouched = Math.max(c.updatedAt, c.lastConfirmedAt ?? 0);
    const isStale = lastTouched > 0 && Date.now() - lastTouched > STALE_AGE_MS;
    const dateSuffix = isStale ? ` (${formatStandDate(lastTouched)})` : "";
    const label = c.key ? `${c.key}${dateSuffix}: ` : dateSuffix ? `${dateSuffix.trim()} ` : "";
    memLines.push(`- ${label}${c.text}`);
    sources.push({
      kind: "memory",
      title: c.key || (c.kind === "fact" ? "Fact" : "Note"),
      snippet: c.text,
      score: r.score,
      itemId: c.itemId,
    });
  }

  // CHAR_BUDGET truncation, honestly: cut at LINE boundaries (never mid-line)
  // and drop the matching `sources[]` entries for anything that didn't
  // survive, so the "Context used" grounding chip never lists a
  // truncated-away snippet as if it had actually been sent.
  const header = "Saved memory:\n";
  let used = header.length;
  let keepCount = 0;
  for (const line of memLines) {
    const add = (keepCount > 0 ? 1 : 0) + line.length; // +1 for the joining "\n"
    if (used + add > CHAR_BUDGET) break;
    used += add;
    keepCount++;
  }
  const text = keepCount > 0 ? `${header}${memLines.slice(0, keepCount).join("\n")}`.trim() : "";
  const keptSources = sources.slice(0, keepCount);

  // Usage tracking (P5): only items whose line actually survived truncation
  // and made it into `text` count as "used" - see MemoryItem.lastUsedAt.
  for (const s of keptSources) {
    if (s.itemId) touchMemoryUsage(s.itemId);
  }

  return { text, sources: keptSources, pinnedCrowdedOut };
}

/** "Stand MM/YYYY" (German for "as of") - the staleness date suffix format
 *  used when injecting an old memory item into context. */
function formatStandDate(ts: number): string {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `Stand ${mm}/${d.getFullYear()}`;
}
