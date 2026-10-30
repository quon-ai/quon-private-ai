/**
 * Re-rank a vector shortlist with a lexical boost, then gate by relevance.
 *
 * Vector cosine alone is a weak, compressed signal on the multilingual MiniLM
 * model: relevant and loosely-related items overlap in score, so a fixed cosine
 * floor either lets noise through or drops real hits. This adds two precision
 * mechanisms on top of the shortlist the vector search already returned:
 *
 *   1. lexical boost — candidates that share query keywords get bumped up, so a
 *      strong keyword match clears the floor even if its cosine was middling.
 *   2. relative gate — a hit must be both above an absolute floor AND within a
 *      margin of the best hit. When nothing is strongly relevant (the best hit is
 *      weak), everything is dropped — i.e. nothing is injected, instead of the
 *      "least irrelevant" item leaking in.
 *   3. lexical anchor — a candidate that shares NO query keyword at all must show
 *      genuinely high cosine to survive. A production incident injected memory
 *      chunks at blended ~0.40 into an entirely unrelated question with zero
 *      keyword overlap; with cleanly-embedded current-model vectors that pairing
 *      MEASURES ≤0.25 (see the calibration bands below), so a mid-cosine hit
 *      without any keyword anchor is treated as untrustworthy whatever produced
 *      it (stale vectors, model quirks) and dropped.
 *
 * Calibration (measured 2026-07-19 against the real q8 MiniLM pipeline, German
 * user content; the earlier "unrelated same-language lands ~0.35-0.41" theory
 * did NOT reproduce):
 *   - unrelated content, any language pairing:       cosine ≤ ~0.25
 *   - related, same language, with keyword overlap:  cosine ~0.31–0.58
 *   - related, cross-language (no shared tokens):    cosine ~0.37–0.51
 */

import { contentTerms, lexicalCoverage } from "./lexical";

/** Absolute floor on the blended score; below this is treated as noise.
 *  Sits just above the measured unrelated band (≤ ~0.25) so the weakest real
 *  hits — which get a lexical boost on top of cosine — clear it with margin. */
export const ABS_FLOOR = 0.3;
/** Raw-cosine floor for candidates with ZERO lexical overlap with the query.
 *  Deliberately strict — above even the measured related-cross-language band
 *  (~0.37–0.51) — because the observed production false positives sat at ~0.40
 *  with zero overlap. Trade-off (accepted): a cross-language match with no
 *  shared token only surfaces at very high cosine; tags/keys count as anchors,
 *  so tagging bridges the gap when it matters. Precision over recall — wrongly
 *  injected context is visible and erodes trust, a missed memory is invisible. */
export const NO_ANCHOR_SIM_FLOOR = 0.55;
/** Raw-cosine floor for STRICT candidates (long free-form items — see
 *  `strictOf`): they must show a keyword anchor AND at least this cosine.
 *  0.4 clears the measured coincidental-overlap noise (≤ ~0.25) with margin
 *  while keeping genuinely-related lab-report queries (measured ~0.45). */
export const STRICT_SIM_FLOOR = 0.4;
/** A hit must be within this of the top blended score (drops "least-bad" items). */
export const REL_MARGIN = 0.12;
/** Weight of the lexical-coverage boost added to cosine. */
export const LEX_BOOST = 0.2;
/** Max recency bonus (age 0) added to the blended score, when the caller opts in. */
export const RECENCY_BOOST_MAX = 0.05;
/** Age (ms) at or beyond which the recency bonus is zero. */
export const RECENCY_WINDOW_MS = 180 * 24 * 60 * 60 * 1000; // ~180 days

export interface Ranked<T> {
  item: T;
  /** Blended relevance: cosine + LEX_BOOST * keyword-coverage. */
  score: number;
  /** Raw cosine (pre-boost), for diagnostics. */
  base: number;
}

/** Tokenise a query into content terms once, for reuse across candidates. */
export function queryTermSet(query: string): Set<string> {
  return new Set(contentTerms(query));
}

/** Linear recency bonus in [0, RECENCY_BOOST_MAX]: RECENCY_BOOST_MAX at age 0,
 *  scaling down to 0 at RECENCY_WINDOW_MS and beyond. `now` is injectable for tests. */
function recencyBonus(updatedAt: number | undefined, now: number): number {
  if (updatedAt === undefined) return 0;
  const age = Math.max(0, now - updatedAt);
  if (age >= RECENCY_WINDOW_MS) return 0;
  return RECENCY_BOOST_MAX * (1 - age / RECENCY_WINDOW_MS);
}

/**
 * Blend lexical coverage into each shortlist hit, keep only those that pass the
 * absolute + relative gate, and return the top `finalK`, best first.
 *
 * `recencyOf` is optional and OFF by default — only a caller that opts in (RAG's
 * memory retrieval, using the item's `updatedAt`) gets the bonus; a caller that
 * doesn't pass it (e.g. document search) sees byte-identical scores/ordering to
 * before this existed.
 *
 * Ordering matters: the floor/margin gate is computed on cosine + lexical score
 * ONLY, before any recency bonus is added. The floor exists to keep semantically
 * irrelevant junk out; recency is not a relevance signal on its own and must
 * never rescue a sub-floor item into the results. Once an item has qualified,
 * recency is added and can re-order/break ties among the survivors (e.g. a
 * fresher item edges out an equally-relevant stale one), which is the intended
 * effect.
 *
 * The lexical-anchor rule runs FIRST, and `top` is computed over the anchored
 * survivors only — an un-anchored noise hit must not set the relative bar for
 * everyone else. When the query has no content terms at all (e.g. "ok?"), an
 * anchor is impossible and the rule is skipped for normal candidates; strict
 * candidates (see `strictOf`) always require an anchor, so they are never
 * injected for anchor-less queries.
 *
 * `strictOf` marks candidates held to the stricter gate (long free-form notes):
 * they need BOTH a lexical anchor and raw cosine ≥ STRICT_SIM_FLOOR.
 *
 * `pinnedOf` marks candidates that bypass the anchor rule AND the floor
 * entirely — a few short, deliberately curated facts (`MemoryItem.pinned`,
 * short-tier only) that should be considered on every in-scope turn
 * regardless of relevance to THIS query, the way a saved fact behaves in
 * other assistants' memory features. A pinned item's own score never widens
 * or tightens `top`/`floor` for everyone else (computed over the non-pinned
 * survivors only), and pinned survivors are placed ahead of relevance-ranked
 * ones before `finalK` truncates. Passing `undefined` (the default) reduces
 * to the exact previous behaviour.
 *
 * Crowd-out guard (P5 fix): pinned survivors may fill at most `finalK - 1`
 * slots whenever at least one non-pinned (relevance-ranked) survivor exists —
 * a relevance hit must never be fully crowded out just because ≥ finalK items
 * happen to be pinned (the bug at ≥3 pins with the old MEMORY_K=3: pinning a
 * 3rd fact silently blocked ALL topical retrieval forever). When there are NO
 * non-pinned survivors, pinned items fill every slot as before.
 */
export function rerankAndGate<T>(
  hits: Array<{ item: T; score: number }>,
  queryTerms: Set<string>,
  textOf: (item: T) => string,
  finalK: number,
  recencyOf?: (item: T) => number | undefined,
  strictOf?: (item: T) => boolean,
  pinnedOf?: (item: T) => boolean,
): Array<Ranked<T>> {
  if (hits.length === 0) return [];
  const scored = hits.map((h) => {
    const coverage = lexicalCoverage(queryTerms, textOf(h.item));
    return {
      item: h.item,
      base: h.score,
      score: h.score + LEX_BOOST * coverage,
      coverage,
    };
  });
  const anchored: Array<Ranked<T>> = scored
    .filter((s) => {
      if (pinnedOf?.(s.item)) return true; // always a candidate — floor bypassed below too
      if (strictOf?.(s.item)) return s.coverage > 0 && s.base >= STRICT_SIM_FLOOR;
      if (queryTerms.size === 0) return true; // anchor impossible — fall back to the floors below
      return s.coverage > 0 || s.base >= NO_ANCHOR_SIM_FLOOR;
    })
    .map(({ item, base, score }) => ({ item, base, score }));
  if (anchored.length === 0) return [];

  // top/floor are computed over the NON-pinned survivors only: a pinned
  // item's score (arbitrarily low OR high — it bypasses the floor by design)
  // must never move the bar real, non-pinned candidates are held to.
  const nonPinned = pinnedOf ? anchored.filter((s) => !pinnedOf(s.item)) : anchored;
  const top = Math.max(...(nonPinned.length ? nonPinned : anchored).map((s) => s.score));
  const floor = Math.max(ABS_FLOOR, top - REL_MARGIN);
  const qualified = anchored.filter((s) => (pinnedOf?.(s.item) ? true : s.score >= floor));

  const now = Date.now();
  const withRecency = recencyOf
    ? qualified.map((s) => ({ ...s, score: s.score + recencyBonus(recencyOf(s.item), now) }))
    : qualified;
  const sorted = withRecency.sort((a, b) => b.score - a.score);
  if (!pinnedOf) return sorted.slice(0, finalK);
  return capPreservingRelevance(sorted, finalK, pinnedOf);
}

/**
 * Cap a best-first-sorted list at `finalK`, reserving at least one slot for a
 * non-pinned (relevance-ranked) survivor whenever one exists — the crowd-out
 * guard described on `rerankAndGate`. Exported (not just used internally)
 * because a caller that re-truncates AFTER its own post-processing with a
 * SMALLER K than it fed into `rerankAndGate` needs the exact same guard at
 * that later cap — rag.ts calls `rerankAndGate` with a generous `finalK`
 * (its shortlist size) precisely so per-item dedupe can run before the real
 * `MEMORY_K` cap, and re-applies this guard there. See rag.ts's
 * `retrieveContext` for that final cap.
 */
export function capPreservingRelevance<T, H extends { item: T; score: number }>(
  sorted: H[],
  finalK: number,
  pinnedOf: (item: T) => boolean,
): H[] {
  const pinned = sorted.filter((s) => pinnedOf(s.item));
  const rest = sorted.filter((s) => !pinnedOf(s.item));
  if (rest.length === 0) return pinned.slice(0, finalK);
  // Reserve at least one slot for a relevance survivor whenever one exists.
  const maxPinnedSlots = Math.max(0, finalK - 1);
  const pinnedSlice = pinned.slice(0, maxPinnedSlots);
  return [...pinnedSlice, ...rest].slice(0, finalK);
}
