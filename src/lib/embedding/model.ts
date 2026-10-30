/**
 * Embedding model identity, shared by the main-thread proxy (`embedder.ts`) and
 * the Web Worker (`embedder.worker.ts`) so the two can never drift.
 *
 * The model is **multilingual** (`paraphrase-multilingual-MiniLM-L12-v2`,
 * 384-dim) so a German query matches English notes and vice-versa. Changing
 * EMBED_MODEL invalidates existing vectors (different vector space); items carry
 * the model id they were embedded with and are re-embedded lazily by
 * `ensureEmbeddingsCurrent` (src/lib/reembed.ts).
 */
export const EMBED_MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
export const EMBED_DIM = 384;
