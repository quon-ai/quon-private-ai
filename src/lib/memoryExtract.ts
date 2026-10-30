/**
 * Auto-Memory v1 — mine chat sessions for durable facts, zero-knowledge.
 *
 * The manual "Learn from chats" sweep (LearnFromChatsButton) walks the chat
 * sessions in scope (a project, or the global pool) and, per session:
 *
 *   1. builds a compact plaintext transcript of the messages **newer than the
 *      per-session cursor** — entirely client-side, from the local store;
 *   2. scrubs it via /scrub (indexed placeholders, honoring the user's
 *      always/never-redact lists) — the relay only ever sees placeholders;
 *   3. asks the selected chat model (non-streaming relay, `protected: true`)
 *      to extract durable facts as strict JSON, preserving the placeholders;
 *   4. re-hydrates the placeholders LOCALLY with the /scrub entity map — real
 *      values never leave the device;
 *   5. advances the session's cursor — but ONLY on success. A scrub, relay or
 *      parse failure leaves the cursor untouched, so the session is retried on
 *      the next run. Failures never throw into the UI; they are counted and
 *      surfaced softly.
 *
 * Candidates are then deduplicated on-device against the SAME-SCOPE memory
 * (embedding cosine — see the SIM_* thresholds): known facts are dropped,
 * near-matches become "update" suggestions, the rest "create". Everything lands
 * in the review queue (memorySuggestionStore) — nothing is written to Memory
 * without explicit user approval in the Memory screen.
 */

import { EMBED_MODEL, embedBatch } from "./embedding/embedder";
import {
  addMemorySuggestions,
  createSuggestionId,
  getAllMemorySuggestions,
  getSweepCursor,
  setSweepCursor,
  type MemorySuggestion,
} from "./memorySuggestionStore";
import { tr } from "./i18n/i18n";
import {
  createMemoryId,
  getAllMemory,
  isActiveMemory,
  supersedeMemoryItem,
  upsertMemoryItem,
  type MemoryItem,
  type MemoryKind,
} from "./memoryStore";
import { applyPlaceholders, chatComplete, scrubText, type ChatTurn } from "./quonApi";
import { getAllSessions, type StoredChatMessage } from "./quonStore";
import { inScope, type RagScope } from "./rag";
import { synonymsOf } from "./search/synonyms";
import { cosine } from "./search/vector";

// --- dedup thresholds (cosine similarity against same-scope memory) ---------
/** At or above: the fact is already known — dropped (or, when key-compatible,
 *  auto-merged — see `classifyCandidate`'s "merge" mode). */
export const SIM_SKIP = 0.92;
/** At or above (but below SIM_SKIP): suggested as an "update" of the match. */
export const SIM_UPDATE = 0.78;
/**
 * Redundancy band — MEASURED, not guessed (2026-08-10, real German fact pairs
 * through this very embedder; numbers in HANDOFF §1):
 *
 *   0.97  "arbeitet bei Elbwerke"     ~ "ist bei Elbwerke angestellt"   same fact
 *   0.95  "wohnt in Berlin"          ~ "Wohnort ist Berlin"           same fact
 *   0.86  "Mietvertrag bis 31.12.26" ~ "Mietverhältnis endet 31. Dez" SAME FACT
 *   0.85  "Elbwerke als Product Owner"~ "arbeitet bei Elbwerke"         overlapping
 *   0.64  "Termin am Dienstag"       ~ "Termin am Donnerstag"         CONTRADICTION
 *   0.52  "arbeitet bei Elbwerke"     ~ "arbeitet bei Siemens"         CONTRADICTION
 *   0.00  unrelated facts
 *
 * Two lessons the numbers force:
 * 1. SIM_SKIP (0.92) misses genuine restatements — the 0.86 pair is one fact
 *    said twice, and the user reported exactly that ("teilredundant").
 * 2. CONTRADICTIONS SIT *BELOW* REDUNDANCY (0.52–0.64). Similarity can
 *    therefore never detect them, and lowering a merge threshold toward them
 *    would start merging facts that disagree. Contradictions are caught by the
 *    KEY mechanism instead (same key, different text → findMemoryConflicts).
 *
 * So 0.82 is a reporting/consolidation threshold, comfortably above the
 * contradiction band and below real restatements. Nothing is auto-destroyed at
 * this level: within one sweep run the more informative variant wins (both come
 * from the same source text), and for items already stored it only SURFACES the
 * pair in maintenance for a human decision. Silent auto-merge stays at SIM_SKIP.
 */
export const SIM_REDUNDANT = 0.82;

// --- key normalization (P5 sweep key-awareness) -----------------------------

/** Lowercase + trim a memory key for comparison. "" for absent/whitespace-only. */
export function normalizeKey(key: string | undefined): string {
  return (key ?? "").trim().toLowerCase();
}

/** True when two NORMALIZED keys should be treated as naming the SAME fact
 *  slot — either literally equal, or linked via the curated synonym clusters
 *  in `./search/synonyms` (e.g. "adresse"/"anschrift"). Both empty (no key at
 *  all) is NOT a match — there's no slot identity to compare. Synonym lookup
 *  is a plain single-word map lookup (see `synonymsOf`), so this stays
 *  precision-safe — no fuzzy/partial matching. */
export function keysCompatible(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return synonymsOf(a).includes(b) || synonymsOf(b).includes(a);
}

/** Sessions with fewer NEW user-authored characters than this are skipped (no
 *  relay call). Their cursor is not advanced — the text still counts next run.
 *  Calibrated to admit a single fact-bearing sentence (e.g. "Ich nehme 5mg
 *  THC/CBD jede 2. Nacht wegen Schlafproblemen" ≈ 80–110 chars) while still
 *  skipping throwaway one-liners ("ok danke", "und weiter?"). Was 200, which
 *  silently dropped short but valuable health/finance facts (reported). */
export const MIN_NEW_USER_CHARS = 80;

// Transcript budget: keep the relay call lean. Long messages are truncated and,
// if the whole transcript overflows, the OLDEST lines are dropped (the newest
// content is the most likely to hold something new worth remembering).
const MAX_MSG_CHARS = 1500;
const MAX_TRANSCRIPT_CHARS = 24000;

/** A candidate memory as extracted by the model (before dedup/queueing). */
export interface ExtractedCandidate {
  kind: MemoryKind;
  key?: string;
  text: string;
  tags: string[];
}

export const EXTRACTION_SYSTEM_PROMPT = `You extract durable facts about the user from a chat transcript, for a personal memory store.

Reply with a JSON array only — no prose, no code fences. Each element:
{"kind": "fact" or "note", "key": "short label (required for kind:fact, optional for kind:note)", "text": "the memory as one standalone sentence or two", "tags": ["lowercase", "topic", "tags"]}

Rules:
- Exactly one fact per element. Never bundle two facts into one "text" — split them into separate elements instead.
- Only durable information worth remembering in future conversations: stable preferences, recurring facts about the user's life or work, decisions, constraints, ongoing projects.
- "key" is REQUIRED whenever "kind" is "fact" — a short label naming what the fact is about (e.g. "Employer", "Standard rate"). Optional for "note".
- Do NOT extract: task state (todos, in-progress work), dates or appointments, document contents (summaries or quotes of an attached file), or facts about the assistant.
- NO one-off or transient details (a single question, today's errand), NO small talk.
- The transcript contains placeholder tokens like [PERSON_1] or [EMAIL_2]. Copy them into "text" and "key" EXACTLY as written — never invent, renumber or expand a placeholder.
- Write "text" so it stands alone without the transcript (e.g. "Works as a nurse at [ORG_1].").
- Return [] if nothing is worth remembering.`;

export interface TranscriptResult {
  /** "User:"/"Assistant:" lines, double-newline separated; "" when nothing new. */
  text: string;
  /** Highest message id included — the cursor value on success; null = nothing new. */
  lastId: number | null;
  /** New user-authored characters (drives the triviality gate). */
  newUserChars: number;
}

/** Build the compact plaintext transcript of the messages newer than `afterId`
 *  (the persisted cursor). Error bubbles are skipped — they are UI noise, not
 *  conversation. Exported for tests. */
export function buildTranscript(messages: StoredChatMessage[], afterId?: number): TranscriptResult {
  let lastId: number | null = null;
  let newUserChars = 0;
  const lines: string[] = [];
  for (const m of messages) {
    if (afterId !== undefined && m.id <= afterId) continue;
    lastId = lastId === null ? m.id : Math.max(lastId, m.id);
    const text = m.text.trim();
    if (m.isError || !text) continue;
    if (m.role === "user") newUserChars += text.length;
    lines.push(`${m.role === "user" ? "User" : "Assistant"}: ${text.slice(0, MAX_MSG_CHARS)}`);
  }
  let text = lines.join("\n\n");
  if (text.length > MAX_TRANSCRIPT_CHARS) {
    // Keep the newest lines: cut from the front at a message boundary.
    text = text.slice(text.length - MAX_TRANSCRIPT_CHARS);
    const boundary = text.indexOf("\n\n");
    if (boundary >= 0) text = text.slice(boundary + 2);
  }
  return { text, lastId, newUserChars };
}

/**
 * Parse the model's reply into candidates. Fail-safe: returns null when the
 * reply is not a JSON array (the caller then aborts that session's sweep WITHOUT
 * advancing its cursor). Tolerates code fences / surrounding prose; entries
 * without a usable `text` are dropped rather than failing the whole reply.
 *
 * The prompt requires `key` for kind:"fact", but a sloppy model reply may omit
 * it anyway — rather than hard-rejecting that entry (losing a real memory), it
 * is downgraded to kind:"note" (key is optional for notes), so it still reaches
 * the review queue as a usable suggestion.
 */
export function parseExtractionReply(raw: string): ExtractedCandidate[] | null {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const out: ExtractedCandidate[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    const text = typeof rec.text === "string" ? rec.text.trim() : "";
    if (!text) continue;
    const key =
      typeof rec.key === "string" && rec.key.trim() ? rec.key.trim().slice(0, 80) : undefined;
    const tags = Array.isArray(rec.tags)
      ? rec.tags
          .filter((t): t is string => typeof t === "string")
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 6)
      : [];
    // A fact without a key is downgraded to a note rather than dropped — a
    // sloppy model reply should still yield a usable (if unlabeled) suggestion.
    const kind: MemoryKind = rec.kind === "note" ? "note" : key ? "fact" : "note";
    out.push({ kind, key, text, tags });
  }
  return out;
}

export type DedupDecision =
  | { mode: "create" }
  | { mode: "update"; targetId: string }
  | { mode: "skip" }
  /** Exact-dup + key-compatible: the caller auto-executes (create the
   *  candidate, supersede `targetId`) WITHOUT the review queue — see
   *  `dedupAndQueue`'s "merge" branch. */
  | { mode: "merge"; targetId: string };

/**
 * Classify a candidate against existing ACTIVE same-scope memory (already
 * filtered to the candidate's scope + the current embedding model + active
 * status by the caller — see `isActiveMemory`).
 *
 * Key-aware path (P5, the highest-leverage lifecycle fix — see
 * memory-lifecycle-p5.md §"Sweep key-awareness"): when the candidate carries
 * a `key` that normalizes/synonym-matches an existing item's key, that item
 * is almost certainly the SAME fact slot, so it is forced into "update" (or
 * "merge", if the text is ALSO near-identical) REGARDLESS of cosine. This is
 * what catches the contradiction a pure vector comparison misses — e.g.
 * "Adresse: Hamburg" (existing) vs. a freshly extracted "Adresse: Berlin"
 * (candidate) can sit at LOW cosine (different city names) yet must never
 * both be injected as memory.
 *
 * Falls back to the original cosine-only classification when the candidate
 * has no key, or no existing item shares it: best cosine ≥ SIM_SKIP → skip
 * (known duplicate, no key info to merge against); ≥ SIM_UPDATE → update of
 * the best match; else (or nothing comparable) → create.
 */
export function classifyCandidate(
  embedding: number[],
  candidateKey: string | undefined,
  existing: Array<Pick<MemoryItem, "id" | "embedding" | "key">>,
): DedupDecision {
  const normKey = normalizeKey(candidateKey);
  if (normKey) {
    let bestKeyMatchId: string | null = null;
    let bestKeyMatchCos: number | null = null;
    for (const item of existing) {
      if (!keysCompatible(normKey, normalizeKey(item.key))) continue;
      const cos =
        item.embedding && item.embedding.length === embedding.length
          ? cosine(embedding, item.embedding)
          : null;
      // Prefer the key-matching item with the HIGHEST comparable cosine (most
      // likely the same content, not just an unrelated item that happens to
      // share a label); an item we can't compare only wins if nothing
      // comparable has been seen yet.
      if (
        bestKeyMatchId === null ||
        (cos !== null && (bestKeyMatchCos === null || cos > bestKeyMatchCos))
      ) {
        bestKeyMatchId = item.id;
        bestKeyMatchCos = cos;
      }
    }
    if (bestKeyMatchId !== null) {
      if (bestKeyMatchCos !== null && bestKeyMatchCos >= SIM_SKIP) {
        return { mode: "merge", targetId: bestKeyMatchId };
      }
      return { mode: "update", targetId: bestKeyMatchId };
    }
  }

  let bestId: string | null = null;
  let best = -Infinity;
  for (const item of existing) {
    if (!item.embedding || item.embedding.length !== embedding.length) continue;
    const s = cosine(embedding, item.embedding);
    if (s > best) {
      best = s;
      bestId = item.id;
    }
  }
  if (bestId === null) return { mode: "create" };
  if (best >= SIM_SKIP) return { mode: "skip" };
  if (best >= SIM_UPDATE) return { mode: "update", targetId: bestId };
  return { mode: "create" };
}

// --- sweep orchestrator ------------------------------------------------------

export interface SweepOptions {
  /** undefined = global chats (no projectId); a project id = that project only. */
  scope: RagScope;
  /** Provider model slug + connection — resolved by the caller the same way the
   *  chat composer resolves its selected model. */
  model: string;
  connectionId?: string;
  /** Same on-device redaction lists the chat sends with every /scrub. */
  alwaysRedact?: string[];
  neverRedact?: string[];
  onProgress?: (label: string) => void;
}

export interface SweepResult {
  /** Sessions successfully analyzed (cursor advanced). */
  analyzed: number;
  /** Sessions whose scrub/relay/parse failed (cursor NOT advanced — retried). */
  failed: number;
  /** Suggestions added to the review queue after dedup. */
  suggestions: number;
  /** Candidates auto-merged directly into Memory WITHOUT the review queue
   *  (exact-dup + key-compatible — see `classifyCandidate`'s "merge" mode).
   *  Reversible: the older item is superseded, never deleted. */
  autoMerged: number;
}

/** How many in-scope chat sessions have enough NEW user text (past their sweep
 *  cursor) to be worth a "Learn from chats" run — computed purely locally from
 *  the store, NO relay/scrub. Mirrors the exact pending predicate runMemorySweep
 *  uses, so the count and what a run would actually process can't diverge. Drives
 *  the ambient "N new" discovery badge (learning itself stays one explicit tap —
 *  auto-relaying chat content in the background would be a surprise cost on the
 *  user's own AI budget and a privacy default we don't take). */
export function pendingSweepCount(scope: RagScope): number {
  const ok = inScope(scope);
  let n = 0;
  for (const s of getAllSessions()) {
    if (!ok(s)) continue;
    const transcript = buildTranscript(s.messages, getSweepCursor(s.id));
    if (transcript.lastId !== null && transcript.newUserChars >= MIN_NEW_USER_CHARS) n++;
  }
  return n;
}

/** Run the sweep over every in-scope session with new content. Never throws for
 *  per-session problems — failures are counted in the result instead. */
export async function runMemorySweep(opts: SweepOptions): Promise<SweepResult> {
  const ok = inScope(opts.scope);
  const pending: Array<{ sessionId: string; text: string; lastId: number }> = [];
  for (const s of getAllSessions()) {
    if (!ok(s)) continue;
    const transcript = buildTranscript(s.messages, getSweepCursor(s.id));
    // Nothing new, or too little new user text to be worth a relay call. The
    // cursor stays put either way, so skipped text still counts next time.
    if (transcript.lastId === null || transcript.newUserChars < MIN_NEW_USER_CHARS) continue;
    pending.push({ sessionId: s.id, text: transcript.text, lastId: transcript.lastId });
  }
  if (pending.length === 0) return { analyzed: 0, failed: 0, suggestions: 0, autoMerged: 0 };

  const candidates: Array<{ candidate: ExtractedCandidate; sessionId: string }> = [];
  let analyzed = 0;
  let failed = 0;
  for (let i = 0; i < pending.length; i++) {
    const { sessionId, text, lastId } = pending[i];
    opts.onProgress?.(tr("memory.sweep.analyzing", { n: i + 1, total: pending.length }));
    try {
      // 1) Scrub on-device rules apply BEFORE anything reaches the provider.
      const scrub = await scrubText(text, {
        placeholder_style: "indexed",
        always_redact: opts.alwaysRedact,
        never_redact: opts.neverRedact,
      });
      // 2) Extraction over the SCRUBBED transcript only.
      const turns: ChatTurn[] = [
        { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
        { role: "user", content: scrub.scrubbed },
      ];
      const reply = await chatComplete(turns, opts.model, true, opts.connectionId);
      const parsed = parseExtractionReply(reply.answer);
      if (parsed === null) {
        failed++; // malformed reply — cursor untouched, retried next run
        continue;
      }
      // 3) Re-hydrate locally: placeholder → original value, device-only.
      const map = Object.fromEntries(scrub.entities.map((e) => [e.placeholder, e.value]));
      for (const c of parsed) {
        candidates.push({
          candidate: {
            ...c,
            text: applyPlaceholders(c.text, map),
            key: c.key ? applyPlaceholders(c.key, map) : undefined,
          },
          sessionId,
        });
      }
      setSweepCursor(sessionId, lastId);
      analyzed++;
    } catch {
      failed++; // scrub or relay failure — fail soft, cursor untouched
    }
  }

  const { suggestions, autoMerged } = await dedupAndQueue(candidates, opts.scope, opts.onProgress);
  return { analyzed, failed, suggestions, autoMerged };
}

export interface ExtractFromTextOptions {
  /** undefined = global memory; a project id = that project's memory. */
  scope: RagScope;
  model: string;
  connectionId?: string;
  alwaysRedact?: string[];
  neverRedact?: string[];
}

/**
 * Distill durable facts from arbitrary pasted text (the Memory screen's
 * large-paste triage) — the same zero-knowledge pipeline as the chat sweep:
 * scrub on-device → extraction over placeholders only → local re-hydration →
 * dedup against same-scope memory → review queue. Returns how many suggestions
 * were queued. Throws on scrub/relay/parse failure (the dialog surfaces it and
 * the user can retry or save the text as-is instead).
 */
export async function extractFromText(text: string, opts: ExtractFromTextOptions): Promise<number> {
  const scrub = await scrubText(text, {
    placeholder_style: "indexed",
    always_redact: opts.alwaysRedact,
    never_redact: opts.neverRedact,
  });
  const turns: ChatTurn[] = [
    { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
    { role: "user", content: scrub.scrubbed },
  ];
  const reply = await chatComplete(turns, opts.model, true, opts.connectionId);
  const parsed = parseExtractionReply(reply.answer);
  if (parsed === null) throw new Error("Could not parse the extraction reply");
  const map = Object.fromEntries(scrub.entities.map((e) => [e.placeholder, e.value]));
  const candidates = parsed.map((c) => ({
    candidate: {
      ...c,
      text: applyPlaceholders(c.text, map),
      key: c.key ? applyPlaceholders(c.key, map) : undefined,
    },
  }));
  const { suggestions } = await dedupAndQueue(candidates, opts.scope);
  return suggestions;
}

export interface DedupAndQueueResult {
  /** Suggestions added to the review queue. */
  suggestions: number;
  /** Candidates auto-executed (create + supersede) WITHOUT the review queue —
   *  see `classifyCandidate`'s "merge" mode. */
  autoMerged: number;
}

/** Dedup candidates against same-scope ACTIVE memory (+ the pending queue and
 *  each other) and add the survivors to the review queue — EXCEPT an exact-dup
 *  + key-compatible candidate (`classifyCandidate`'s "merge" mode), which is
 *  auto-executed directly (see `autoMergeCandidate`) and never touches the
 *  queue. `sessionId` is absent for candidates distilled from pasted text. */
export async function dedupAndQueue(
  candidates: Array<{ candidate: ExtractedCandidate; sessionId?: string; docId?: string }>,
  scope: RagScope,
  onProgress?: (label: string) => void,
): Promise<DedupAndQueueResult> {
  if (candidates.length === 0) return { suggestions: 0, autoMerged: 0 };
  onProgress?.(tr("memory.sweep.checking"));
  const ok = inScope(scope);
  // STRICT scope isolation: a project candidate is only ever compared with that
  // project's memory, a global candidate only with global memory. ACTIVE only
  // (P5): a superseded/archived item must never be matched against, whether as
  // a "known duplicate" or a key-conflict update target.
  const existing = getAllMemory().filter(
    (m) => ok(m) && isActiveMemory(m) && m.embModel === EMBED_MODEL && m.embedding,
  );
  // Exact-text guard against the pending queue, so re-running the sweep over new
  // sessions doesn't stack the same suggestion twice.
  const seenTexts = new Set(
    getAllMemorySuggestions()
      .filter(ok)
      .map((s) => s.text.trim().toLowerCase()),
  );

  let vectors: number[][] = [];
  try {
    vectors = await embedBatch(candidates.map((c) => c.candidate.text));
  } catch {
    // Embedder unavailable: still queue (exact-dup-filtered) as "create" — the
    // review step is the safety net, and dropping the sweep's output is worse.
  }

  const accepted: MemorySuggestion[] = [];
  const acceptedVecs: number[][] = [];
  let autoMerged = 0;
  const now = Date.now();
  for (let i = 0; i < candidates.length; i++) {
    const { candidate, sessionId, docId } = candidates[i];
    const norm = candidate.text.trim().toLowerCase();
    if (seenTexts.has(norm)) continue;
    seenTexts.add(norm);
    let mode: MemorySuggestion["mode"] = "create";
    let targetId: string | undefined;
    const vec = vectors[i];
    if (vec) {
      const decision = classifyCandidate(vec, candidate.key, existing);
      if (decision.mode === "skip") continue; // already known

      if (decision.mode === "merge") {
        // Exact-dup + key-compatible: auto-execute, bypassing the review
        // queue entirely. The candidate (freshly extracted "now") is
        // definitionally the newer side — keep it, supersede the matched
        // existing item (reversible via reviveMemoryItem, never deleted).
        autoMergeCandidate(candidate, decision.targetId, scope, sessionId, docId, vec);
        autoMerged++;
        continue;
      }

      // Near-duplicates the model produced within THIS run. Both sides come
      // from the same source text in the same pass, so consolidating is safe
      // without asking: keep the MORE INFORMATIVE (longer) variant, so
      // "arbeitet bei Elbwerke als Product Owner" survives against the bare
      // "arbeitet bei Elbwerke" (measured 0.85 — below the old 0.92 gate, which
      // is why both used to be queued).
      const dupIdx = acceptedVecs.findIndex((av) => cosine(vec, av) >= SIM_REDUNDANT);
      if (dupIdx !== -1) {
        if (candidate.text.trim().length > accepted[dupIdx].text.trim().length) {
          accepted[dupIdx] = {
            ...accepted[dupIdx],
            text: candidate.text,
            key: candidate.key ?? accepted[dupIdx].key,
            tags: candidate.tags ?? accepted[dupIdx].tags,
          };
          acceptedVecs[dupIdx] = vec;
        }
        continue;
      }
      mode = decision.mode;
      if (decision.mode === "update") targetId = decision.targetId;
    }
    accepted.push({
      id: createSuggestionId(),
      kind: candidate.kind,
      key: candidate.key,
      text: candidate.text,
      tags: candidate.tags,
      // "update": carry the CURRENT target text so the review UI can render a
      // before/after conflict diff without a second lookup (the target may
      // itself change or get superseded before the suggestion is reviewed).
      previousText: mode === "update" ? existing.find((e) => e.id === targetId)?.text : undefined,
      projectId: scope,
      sourceSessionId: sessionId,
      sourceDocId: docId,
      mode,
      targetId,
      createdAt: now,
    });
    if (vec) acceptedVecs.push(vec);
  }
  addMemorySuggestions(accepted);
  return { suggestions: accepted.length, autoMerged };
}

/** Auto-execute an exact-dup + key-compatible match: create the candidate as
 *  a new active memory item, then supersede the matched existing item. Uses
 *  the embedding already computed for the candidate (no extra embed call). */
function autoMergeCandidate(
  candidate: ExtractedCandidate,
  existingId: string,
  scope: RagScope,
  sessionId: string | undefined,
  docId: string | undefined,
  embedding: number[],
): void {
  const now = Date.now();
  const newItem: MemoryItem = {
    id: createMemoryId(),
    kind: candidate.kind,
    key: candidate.key,
    text: candidate.text,
    tags: candidate.tags,
    embedding,
    dim: embedding.length,
    embModel: EMBED_MODEL,
    projectId: scope,
    source: docId ? "document" : sessionId ? "chat" : "manual",
    sourceSessionId: sessionId,
    sourceDocId: docId,
    createdAt: now,
    updatedAt: now,
  };
  upsertMemoryItem(newItem);
  supersedeMemoryItem(existingId, newItem.id);
}

// --- conflicts, near-duplicates, the "attic" (P5) ---------------------------

/** An active same-scope pair sharing a normalized/synonym-linked key but with
 *  DIFFERENT text — an unresolved contradiction (e.g. "Adresse: Hamburg" vs.
 *  "Adresse: Berlin"), surfaced for a future "Konflikte" UI. */
export interface KeyConflictPair {
  a: MemoryItem;
  b: MemoryItem;
}

/** An active same-scope pair whose embeddings are near-identical (cosine ≥
 *  SIM_SKIP), surfaced for a future merge-suggestion UI. */
export interface NearDupPair {
  a: MemoryItem;
  b: MemoryItem;
  cosineScore: number;
}

export interface MemoryConflicts {
  keyConflicts: KeyConflictPair[];
  nearDuplicates: NearDupPair[];
}

/**
 * Find unresolved conflicts among ACTIVE same-scope memory — PURE, no
 * network, no mutation (see `autoMergeExactDuplicates` for the executing
 * counterpart). Two independent signals:
 *
 *   - `keyConflicts`: grouped by normalized/synonym-linked key (O(N) grouping
 *     + only within-group pairs compared — cheap even with many items), then
 *     any two group members with different text are a conflict.
 *   - `nearDuplicates`: a pairwise cosine pass over ALL active, currently-
 *     embedded items (no new embedding calls — just dot products over
 *     already-cached vectors, cheap even at O(N²) for the current item
 *     counts this product runs at).
 */
/** Order-independent id for a pair of memories, so a pair found in one order
 *  matches the same pair found in the other. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function findMemoryConflicts(scope: RagScope): MemoryConflicts {
  const ok = inScope(scope);
  const active = getAllMemory().filter((m) => ok(m) && isActiveMemory(m));

  const groups = new Map<string, MemoryItem[]>();
  for (const item of active) {
    const norm = normalizeKey(item.key);
    if (!norm) continue;
    let bucketKey = norm;
    for (const existingKey of groups.keys()) {
      if (keysCompatible(existingKey, norm)) {
        bucketKey = existingKey;
        break;
      }
    }
    const bucket = groups.get(bucketKey);
    if (bucket) bucket.push(item);
    else groups.set(bucketKey, [item]);
  }
  const keyConflicts: KeyConflictPair[] = [];
  for (const bucket of groups.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        if (bucket[i].text.trim() !== bucket[j].text.trim()) {
          keyConflicts.push({ a: bucket[i], b: bucket[j] });
        }
      }
    }
  }

  const embedded = active.filter((m) => m.embModel === EMBED_MODEL && m.embedding);
  const nearDuplicates: NearDupPair[] = [];
  for (let i = 0; i < embedded.length; i++) {
    for (let j = i + 1; j < embedded.length; j++) {
      const a = embedded[i];
      const b = embedded[j];
      const score = cosine(a.embedding as number[], b.embedding as number[]);
      // Report from SIM_REDUNDANT so genuine restatements below 0.92 become
      // visible in maintenance (measured: a 0.86 pair is one fact said twice).
      // autoMergeExactDuplicates deliberately re-checks SIM_SKIP before it
      // supersedes anything — surfacing is not the same as auto-destroying.
      if (score >= SIM_REDUNDANT) nearDuplicates.push({ a, b, cosineScore: score });
    }
  }

  return { keyConflicts, nearDuplicates };
}

/**
 * The near-duplicate pairs worth SHOWING a human — `nearDuplicates` minus every
 * pair that is already a key conflict.
 *
 * Both signals fire on the same pair all the time: two facts under one key
 * usually also read alike ("Wohnort: Hamburg, Elbchaussee 1" vs "Wohnort:
 * Berlin, Kastanienallee 5" measured at 0.87). Listed twice, the maintenance
 * screen asks the same question in two places with the same buttons — and the
 * key conflict is the better question of the two, because a shared key is
 * evidence these are one slot, where similarity is only evidence they sound
 * alike.
 *
 * Deliberately NOT applied inside findMemoryConflicts: `autoMergeExactDuplicates`
 * consumes the raw `nearDuplicates` and merges exactly the same-key-different-
 * text pairs this filter removes — filtering at the source would silently turn
 * auto-merge off.
 */
export function nearDuplicatesForReview(conflicts: MemoryConflicts): NearDupPair[] {
  const conflicted = new Set(conflicts.keyConflicts.map((p) => pairKey(p.a.id, p.b.id)));
  return conflicts.nearDuplicates.filter((p) => !conflicted.has(pairKey(p.a.id, p.b.id)));
}

/**
 * Maintenance-scan auto-merge: for pairs `findMemoryConflicts` flags as near-
 * duplicates (cosine ≥ SIM_SKIP) AND normalized-key-compatible, keep the
 * NEWER (by `updatedAt`) item and supersede the older — deterministic,
 * reversible, no review queue (mirrors the sweep-time "merge" mode in
 * `classifyCandidate`, but for two items that ALREADY both exist). Items
 * without a key (or without a comparable key) are left alone — no key info
 * means no confirmed "same slot", so no auto-action. Returns how many pairs
 * were merged. Safe to call repeatedly; a pair already resolved by an earlier
 * merge in the same pass (one side no longer active) is skipped.
 */
export function autoMergeExactDuplicates(scope: RagScope): number {
  const { nearDuplicates } = findMemoryConflicts(scope);
  let merged = 0;
  const superseded = new Set<string>();
  for (const pair of nearDuplicates) {
    if (superseded.has(pair.a.id) || superseded.has(pair.b.id)) continue;
    // findMemoryConflicts now reports the wider redundancy band for REVIEW;
    // silently superseding an item still requires the strong signal.
    if (pair.cosineScore < SIM_SKIP) continue;
    const keyA = normalizeKey(pair.a.key);
    const keyB = normalizeKey(pair.b.key);
    if (!keysCompatible(keyA, keyB)) continue;
    const [winner, loser] =
      pair.a.updatedAt >= pair.b.updatedAt ? [pair.a, pair.b] : [pair.b, pair.a];
    supersedeMemoryItem(loser.id, winner.id);
    superseded.add(loser.id);
    merged++;
  }
  return merged;
}

/** Age (ms) beyond which an untouched active item is offered in the future
 *  "attic" review ("Noch aktuell?"). ~12 months (user-decided threshold, see
 *  memory-lifecycle-p5.md). */
export const ATTIC_AGE_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Active, non-pinned, same-scope items that haven't been touched — edited,
 * explicitly re-confirmed, OR actually retrieved into a chat's context — in
 * over `ATTIC_AGE_MS`. Pure read; NEVER auto-archives or auto-deletes (the
 * P5 plan is explicit: decay is a policy choice the user makes, one item at
 * a time, in the future "attic" review UI).
 */
export function findAtticItems(scope: RagScope, now: number = Date.now()): MemoryItem[] {
  const ok = inScope(scope);
  return getAllMemory().filter((m) => {
    if (!ok(m) || !isActiveMemory(m) || m.pinned) return false;
    const lastTouched = Math.max(m.updatedAt, m.lastConfirmedAt ?? 0, m.lastUsedAt ?? 0);
    return now - lastTouched > ATTIC_AGE_MS;
  });
}
