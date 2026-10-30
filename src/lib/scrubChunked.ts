/**
 * Chunked, parallel scrubbing for LARGE inputs (the "attach all documents" /
 * compare-several-contracts case). A single /scrub over a 50k blob makes the
 * backend fan out ~5 sequential-ish cloud-LLM chunks in ONE HTTP request; behind
 * Cloudflare's ~100s edge timeout on a non-streamed response that request tips
 * over and the whole send fails closed ("nothing sent"). Splitting the text into
 * pieces that each cost ~1 cloud chunk and scrubbing them as PARALLEL, short
 * /scrub requests keeps every request well under the edge limit and makes the
 * wall-time the slowest piece instead of the sum.
 *
 * The pieces are merged back into ONE self-consistent scrub result with a
 * VALUE-AWARE placeholder namespace: the same person/IBAN/amount appearing in
 * several documents collapses to the SAME placeholder, so the model sees a
 * coherent set of entities across the documents (essential for "compare these
 * five offers"). Fail-closed: if any piece can't be scrubbed, the whole thing
 * throws, exactly like the single-call path — the caller never sends partial or
 * unscrubbed text.
 */

import { scrubText, type Entity, type ScrubOptions, type ScrubResult } from "@/lib/quonApi";

/** Per-piece target size. Kept below the backend's cloud chunk (12000) so each
 *  piece is a single LLM round-trip — fast, and never near the edge timeout. */
export const SCRUB_PIECE_CHARS = 8000;
/** Above this total we split; at or below it a single /scrub is fine. */
export const SCRUB_SPLIT_THRESHOLD = 12000;
/** Max concurrent /scrub requests. Measured on the live stack (2026-08-08,
 *  25×8k pieces = a 200k attachment, numbers in HANDOFF §1): BEFORE the
 *  backend attached OpenRouter throughput-routing to the PII calls, raising
 *  this made things WORSE (one underlying provider queued per key: 3→78s,
 *  6→116s). WITH routing, 6 is the knee: 3→82s, 6→54s, 10→105s (collapses
 *  again). Don't change this without re-measuring both legs. */
export const SCRUB_CONCURRENCY = 6;
/** Told when a piece failed and is about to be retried. `attempt` is the number
 *  of the attempt ABOUT to run (2 = first retry), so it reads as "2 of 3". */
export type ScrubRetryReporter = (info: {
  attempt: number;
  attempts: number;
  error: unknown;
}) => void;

/** Per-piece retry attempts. Splitting a big attachment into N pieces means N
 *  chances for a TRANSIENT failure (a mobile-network blip, an OpenRouter
 *  rate-limit on the user's sub-key, an edge hiccup) — and fail-closed means one
 *  failed piece aborts the whole send. Retrying each piece a few times with
 *  backoff turns those transient failures into success instead of a dead send.
 *  (The backend already degrades LLM→NER internally and returns 200, so a piece
 *  only rejects on a real network/timeout/5xx — exactly what retry recovers.) */
const SCRUB_PIECE_ATTEMPTS = 3;

async function scrubPieceWithRetry(
  text: string,
  options: ScrubOptions | undefined,
  attempts: number,
  onRetry?: ScrubRetryReporter,
): Promise<ScrubResult> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await scrubText(text, options);
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) {
        // ⚠️ Report it. A piece that times out and retries used to be completely
        // silent: with a 180s per-request timeout and 3 attempts, ONE bad piece
        // stalls a send for ~9 minutes showing nothing but a ticking clock. A
        // user reported exactly that as "hangs with no error" — and they were
        // right to, because nothing distinguished it from a dead UI.
        onRetry?.({ attempt: i + 2, attempts, error: e });
        // Backoff: 400ms, 800ms, … — long enough to clear a rate-limit window /
        // a brief network stall without making the whole send feel stuck.
        await new Promise((res) => setTimeout(res, 400 * 2 ** i));
      }
    }
  }
  throw lastErr;
}

/**
 * Greedily pack `text` into pieces of at most `maxChars`, preferring paragraph
 * (blank-line) then line boundaries so entities aren't split across a cut. The
 * pieces concatenate back to EXACTLY the original text (boundaries are kept with
 * the preceding piece), so re-joining the scrubbed pieces reproduces the full
 * scrubbed text. A single atom longer than `maxChars` is hard-sliced. Exported
 * for testing.
 */
export function splitForScrub(text: string, maxChars: number = SCRUB_PIECE_CHARS): string[] {
  if (text.length <= maxChars) return text.length ? [text] : [];
  // Split into atoms that still concatenate to the original: keep each separator
  // attached to the atom before it.
  const atoms: string[] = [];
  const re = /[^\n]*(?:\n+|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0] === "") break; // zero-width match at end
    atoms.push(m[0]);
    if (re.lastIndex >= text.length) break;
  }

  const pieces: string[] = [];
  let cur = "";
  const flush = () => {
    if (cur) pieces.push(cur);
    cur = "";
  };
  for (let atom of atoms) {
    while (atom.length > maxChars) {
      // An oversized single line: emit what we have, then hard-slice the atom.
      flush();
      pieces.push(atom.slice(0, maxChars));
      atom = atom.slice(maxChars);
    }
    if (cur.length + atom.length > maxChars) flush();
    cur += atom;
  }
  flush();
  return pieces;
}

/** Run `tasks` with a bounded number in flight, preserving result order. Any
 *  rejection propagates (fail-closed) after in-flight tasks settle. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

const placeholderRe = /\[([A-ZÄÖÜ_]+)_(\d+)\]/g;

/**
 * Fold several independently-scrubbed pieces into one result with a shared,
 * value-aware placeholder namespace. Within each piece, every local placeholder
 * `[TYPE_n]` is rewritten to a GLOBAL `[TYPE_k]`, where the same (type, value)
 * always maps to the same global placeholder across pieces. Returns the joined
 * scrubbed text + the de-duplicated entity list. Exported for testing.
 */
export function mergeScrubPieces(pieces: Array<Pick<ScrubResult, "scrubbed" | "entities">>): {
  scrubbed: string;
  entities: Entity[];
} {
  const valueToGlobal = new Map<string, string>(); // "TYPE\0value" -> "[TYPE_k]"
  const nextByType = new Map<string, number>();
  const entities: Entity[] = [];

  const globalFor = (type: string, value: string, confidence: number): string => {
    const key = `${type}\0${value}`;
    const seen = valueToGlobal.get(key);
    if (seen) return seen;
    const n = (nextByType.get(type) ?? 0) + 1;
    nextByType.set(type, n);
    const placeholder = `[${type}_${n}]`;
    valueToGlobal.set(key, placeholder);
    entities.push({ type, value, placeholder, confidence });
    return placeholder;
  };

  const outTexts = pieces.map((piece) => {
    // Local placeholder -> value, from this piece's entity list.
    const localToValue = new Map<string, { type: string; value: string; confidence: number }>();
    for (const e of piece.entities) {
      localToValue.set(e.placeholder, { type: e.type, value: e.value, confidence: e.confidence });
    }
    // Rewrite every placeholder occurrence in the piece's scrubbed text.
    return piece.scrubbed.replace(placeholderRe, (match, type: string) => {
      const info = localToValue.get(match);
      // A placeholder with no matching entity (shouldn't happen) is left as-is,
      // but never leaks a value — it's already a placeholder.
      if (!info) return match;
      return globalFor(info.type ?? type, info.value, info.confidence);
    });
  });

  return { scrubbed: outTexts.join(""), entities };
}

/**
 * Scrub a possibly-large text. Small inputs go through a single /scrub; large
 * ones are split and scrubbed in bounded-parallel, then merged value-aware.
 * Fail-closed: any piece failing rejects the whole call. Metadata is summarized
 * (fallback_mode = OR of pieces, so a degraded piece still surfaces honestly).
 */
export async function scrubLarge(
  text: string,
  options?: ScrubOptions,
  /** Called after each finished piece with (done, total). Feedback #57 was
   *  blunt about why this exists: the document INDEXING had a progress bar
   *  while "der verdammte Kern dieses Service" — the scrub — sat behind a
   *  static label for up to a minute on a 200k attachment. total is 1 for the
   *  single-call path so callers need no size-based special case. */
  onProgress?: (done: number, total: number) => void,
  /** Surfaces a stalled piece to the UI — see scrubPieceWithRetry. */
  onRetry?: ScrubRetryReporter,
): Promise<Pick<ScrubResult, "scrubbed" | "entities"> & { fallbackMode: boolean }> {
  if (text.length <= SCRUB_SPLIT_THRESHOLD) {
    const r = await scrubPieceWithRetry(text, options, SCRUB_PIECE_ATTEMPTS, onRetry);
    onProgress?.(1, 1);
    return { scrubbed: r.scrubbed, entities: r.entities, fallbackMode: r.metadata.fallback_mode };
  }
  const pieces = splitForScrub(text, SCRUB_PIECE_CHARS);
  let done = 0;
  const results = await mapLimit(pieces, SCRUB_CONCURRENCY, async (piece) => {
    const r = await scrubPieceWithRetry(piece, options, SCRUB_PIECE_ATTEMPTS, onRetry);
    onProgress?.(++done, pieces.length);
    return r;
  });
  const merged = mergeScrubPieces(results);
  const fallbackMode = results.some((r) => r.metadata.fallback_mode);
  return { ...merged, fallbackMode };
}
