/**
 * Lazy re-embedding migration.
 *
 * Embedding vectors are only comparable within the same model. When EMBED_MODEL
 * changes (e.g. an upgrade to a multilingual model), existing Memory/Document
 * vectors become stale. This re-embeds those items on-device with the current
 * model and re-syncs them, so semantic search and RAG keep working without the
 * user re-entering anything.
 *
 * Called from the Memory, Documents and Chat screens on mount; idempotent and
 * guarded so it runs at most once at a time and skips already-current items.
 */

import { chunkText } from "./documents/chunker";
import { getAllDocuments, upsertDocument } from "./documentStore";
import { currentPolicy } from "./deviceClass";
import { diagAppend } from "./diagLog";
import { EMBED_MODEL, embedBatch, embedText, isEmbedderReady } from "./embedding/embedder";
import { getAllMemory, upsertMemoryItem, type MemoryChunk, type MemoryItem } from "./memoryStore";

let running = false;
let announcedSkip = false;

/** Chunk + embed a memory's text. A long note as a single vector is too diluted to
 *  match a focused query, so RAG ranks over these chunks; the whole-item `embedding`
 *  is kept for the Memory-screen search. Shared by the mount migration (below) and the
 *  chat self-heal (rag.ts). */
export async function embedMemory(item: MemoryItem): Promise<MemoryItem> {
  const parts = chunkText(item.text);
  const chunks: MemoryChunk[] = parts.length
    ? (await embedBatch(parts.map((p) => p.text))).map((e, i) => ({
        text: parts[i].text,
        embedding: e,
      }))
    : [];
  // One chunk -> reuse it as the whole-item vector; many -> embed the full text once.
  const embedding =
    chunks.length === 1
      ? chunks[0].embedding
      : chunks.length
        ? await embedText(item.text)
        : undefined;
  return { ...item, embedding, chunks, dim: embedding?.length, embModel: EMBED_MODEL };
}

export async function ensureEmbeddingsCurrent(): Promise<void> {
  if (running || typeof window === "undefined") return;
  // On a constrained device this pass is only OPPORTUNISTIC: it may use an
  // embedder that is already up for something the user asked for, but it must
  // never be the thing that loads it - re-embedding every stale document on
  // chat mount, dying, and "retrying on the next mount" is a boot loop on a
  // low-memory iPhone (deviceClass.ts).
  if (!currentPolicy().backgroundReembed && !isEmbedderReady()) {
    if (!announcedSkip) {
      announcedSkip = true;
      diagAppend(`reembed: skipped (policy=${currentPolicy().reason}, embedder not loaded)`);
    }
    return;
  }
  running = true;
  try {
    // --- Memory items ---------------------------------------------------
    // Re-embed if stale OR missing chunks (older items predate chunking). embedMemory
    // keeps updatedAt, so re-embedding doesn't reorder the list; the new ciphertext
    // still syncs (server accepts an equal updated_at).
    for (const m of getAllMemory()) {
      if (!m.text || (m.embModel === EMBED_MODEL && m.chunks?.length)) continue;
      try {
        upsertMemoryItem(await embedMemory(m));
      } catch {
        /* leave stale; retried on the next mount */
      }
    }

    // --- Document chunks ------------------------------------------------
    for (const d of getAllDocuments()) {
      if (d.status !== "ready" || !d.chunks.length || d.embModel === EMBED_MODEL) continue;
      try {
        const embeddings = await embedBatch(d.chunks.map((c) => c.text));
        upsertDocument({
          ...d,
          chunks: d.chunks.map((c, i) => ({ ...c, embedding: embeddings[i] })),
          dim: embeddings[0]?.length,
          embModel: EMBED_MODEL,
        });
      } catch {
        /* leave stale; retried on the next mount */
      }
    }
  } finally {
    running = false;
  }
}
