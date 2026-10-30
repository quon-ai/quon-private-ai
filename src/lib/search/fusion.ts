/**
 * Reciprocal Rank Fusion (RRF): merge several rankings of the same candidate
 * pool into one combined order, so a candidate that ranks well in ANY signal
 * surfaces — not only the single strongest one.
 *
 * Why this exists: before this, the lexical signal in `../rag.ts` retrieval
 * was only a RE-SCORER over the vector-search shortlist (`rerankAndGate`
 * boosts/gates whatever `topKMulti` already returned) — an item the vector
 * stage ranked outside its cutoff could never be reached, however strong its
 * keyword/subword match. RRF promotes the lexical ranking to a parallel
 * CANDIDATE SOURCE: fuse the vector ranking and the full lexical ranking
 * (`./lexical`'s `rankByLexicalCoverage`), and an item high in either one
 * enters the shortlist.
 *
 * Fusion only decides shortlist membership/order. It does NOT replace the
 * relevance decision: callers must re-attach each fused candidate's real raw
 * score (e.g. cosine) before the actual floor/anchor gate runs downstream —
 * RRF scores are tiny (~1/60) and not comparable to the calibrated absolute
 * floors in `./rerank`.
 */

/** Standard IR default: dampens the gap between rank 1 and rank 2 so a
 *  mid-ranked hit in one signal isn't drowned out by a top hit in another. */
export const RRF_K = 60;

/**
 * Fuse `rankings` (each already sorted best-first) into one combined order.
 * `identity` maps an item to a stable key so the same underlying candidate is
 * recognised across rankings even though the ranking arrays hold separate
 * (but equal) item values. Returns identity keys, best first, deduplicated.
 */
export function rrfFuse<T>(
  rankings: Array<Array<{ item: T }>>,
  identity: (item: T) => string,
  k: number = RRF_K,
): string[] {
  const scores = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((entry, idx) => {
      const key = identity(entry.item);
      scores.set(key, (scores.get(key) ?? 0) + 1 / (k + idx + 1));
    });
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);
}
