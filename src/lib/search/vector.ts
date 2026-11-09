/** Tiny client-side vector search: cosine similarity + top-k ranking.
 *
 * Operates over the decrypted items the Memory/Document stores already hold in
 * memory, so search is fully local (zero-knowledge). Embeddings from the
 * embedder are L2-normalized, so cosine reduces to a dot product - but the full
 * formula is used here so it stays correct for any vectors. */

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface Scored<T> {
  item: T;
  score: number;
}

/** Rank *items* by cosine similarity to *query*, returning the top *k*.
 *  Items whose embedding is missing or a different length are skipped. */
export function topK<T>(
  query: number[],
  items: T[],
  embeddingOf: (item: T) => number[] | undefined | null,
  k = 5,
): Array<Scored<T>> {
  return topKMulti([query], items, embeddingOf, k);
}

/**
 * Like {@link topK}, but scores each item by its BEST match across several query
 * vectors (max-pooling), then returns the top *k*. Used so a multi-clause chat
 * message matches on its single most relevant clause instead of a diluted
 * whole-message average (see `./querySplit`). Embeddings missing or of a
 * different length than *every* query are skipped.
 */
export function topKMulti<T>(
  queries: number[][],
  items: T[],
  embeddingOf: (item: T) => number[] | undefined | null,
  k = 5,
): Array<Scored<T>> {
  const scored: Array<Scored<T>> = [];
  for (const item of items) {
    const emb = embeddingOf(item);
    if (!emb) continue;
    let best = -Infinity;
    for (const q of queries) {
      if (q.length !== emb.length) continue;
      const s = cosine(q, emb);
      if (s > best) best = s;
    }
    if (best > -Infinity) scored.push({ item, score: best });
  }
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, k);
}
