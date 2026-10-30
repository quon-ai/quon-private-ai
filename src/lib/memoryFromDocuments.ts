/**
 * "Learn from documents" — mine the user's OWN documents for the handful of
 * durable personal facts they establish, zero-knowledge.
 *
 * Same pipeline as the chat sweep (`memoryExtract.ts`): build text locally →
 * scrub on-device → extract over placeholders only → re-hydrate locally →
 * dedup against same-scope memory → review queue. Nothing is written to Memory
 * without explicit approval, and the relay only ever sees placeholders.
 *
 * What is DIFFERENT — and it is the whole point of a separate module:
 *
 *   Documents are the noisiest possible memory source. A contract or invoice is
 *   mostly boilerplate, one-off amounts and sender details, and a model asked
 *   for "facts" will happily return a summary of the file. That is worthless as
 *   memory: the document itself is already searchable via RAG. So this sweep is
 *   deliberately STRICTER than the chat one on three levels:
 *
 *   1. a prompt that names the anti-patterns (summaries, one-off amounts,
 *      boilerplate, third parties) and states that [] is the normal answer;
 *   2. a hard post-filter (`filterDocumentCandidates`) that keeps only SHORT,
 *      KEYED facts and caps how many a single document may contribute — the
 *      model cannot flood the queue even if it ignores the prompt;
 *   3. a per-document cursor keyed on `updatedAt`, so a document is analysed
 *      once per version — re-running the sweep costs nothing and re-ingesting
 *      a changed file re-analyses it.
 */

import { getDocumentText, getAllDocuments, type DocItem } from "./documentStore";
import { tr } from "./i18n/i18n";
import {
  dedupAndQueue,
  parseExtractionReply,
  type ExtractedCandidate,
  type SweepOptions,
  type SweepResult,
} from "./memoryExtract";
import { getSweepCursor, setSweepCursor } from "./memorySuggestionStore";
import { applyPlaceholders, chatComplete, scrubText, type ChatTurn } from "./quonApi";
import { inScope } from "./rag";

/** Text budget per document. Personal facts cluster at the top of a document
 *  (letterhead, parties, policy/contract numbers), so the head is what gets
 *  analysed; the rest stays reachable through normal document search. */
export const MAX_DOC_CHARS = 16000;

/** Documents shorter than this carry no extractable fact worth a relay call
 *  (a scan that yielded two lines, an empty note). */
export const MIN_DOC_CHARS = 200;

/** Ceiling on what ONE document may contribute. A document that "produces"
 *  a dozen facts is producing a summary, not memory. */
export const MAX_FACTS_PER_DOC = 5;

/** Longest acceptable fact text. Anything longer is a paragraph — i.e. the
 *  summary this sweep exists to avoid. Matches memoryStore's FACT_MAX_CHARS
 *  intent (short curated facts are the trusted tier in retrieval). */
export const MAX_FACT_CHARS = 300;

export const DOCUMENT_EXTRACTION_SYSTEM_PROMPT = `You extract durable PERSONAL facts about the user from ONE of the user's own documents (a letter, contract, invoice, statement, policy or form), for a personal memory store.

Reply with a JSON array only — no prose, no code fences. Each element:
{"key": "short label naming the fact", "text": "the fact as one standalone sentence", "tags": ["lowercase", "topic", "tags"]}

Extract ONLY what stays true beyond this document and would help in an unrelated future conversation — for example: an employer, a landlord, an insurer and policy number, a bank or customer number, a recurring rate or contribution, a contract term or notice period, a vehicle, a chronic condition, a professional qualification.

Do NOT extract:
- what the document is or says: summaries, quotes, headings, "the letter confirms …". The document itself stays searchable — memory is only for the facts it establishes.
- one-off amounts, dates, deadlines or events tied to this single document (one invoice total, one appointment, one meter reading).
- boilerplate: legal notices, terms and conditions, the sender's own address, bank details or contact lines, page numbers, greetings, signatures.
- facts about other people, unless they define that person's relationship to the user (their landlord, doctor, employer, insurer).

Be strict. Most documents yield ZERO facts, and returning [] is the correct, expected answer — never invent a fact to fill the array. Return at most ${MAX_FACTS_PER_DOC} elements, the most important ones.

"key" is REQUIRED on every element (e.g. "Employer", "Rent", "Health insurer"). Keep "text" under ${MAX_FACT_CHARS} characters and standalone, so it reads without the document.

The document contains placeholder tokens like [PERSON_1] or [IBAN_2]. Copy them into "text" and "key" EXACTLY as written — never invent, renumber or expand a placeholder.`;

export interface DocExcerpt {
  text: string;
  /** True when the document was longer than the budget (head kept). */
  truncated: boolean;
}

/** The text handed to the extractor for one document: the head, up to the
 *  budget, cut at a paragraph boundary so a fact isn't sliced mid-sentence. */
export function buildDocumentExcerpt(full: string): DocExcerpt {
  const text = full.trim();
  if (text.length <= MAX_DOC_CHARS) return { text, truncated: false };
  let head = text.slice(0, MAX_DOC_CHARS);
  const boundary = head.lastIndexOf("\n\n");
  // Only honour a boundary in the last quarter — an early one would throw away
  // most of the budget.
  if (boundary > MAX_DOC_CHARS * 0.75) head = head.slice(0, boundary);
  return { text: head.trimEnd(), truncated: true };
}

/**
 * The hard quality gate, applied to whatever the model returned. Independent
 * of the prompt on purpose: the prompt is a request, this is the guarantee.
 *
 *   - keyed facts only — an unkeyed entry is the "note"/summary shape, and a
 *     document has no business producing free-form notes;
 *   - short only — over MAX_FACT_CHARS is a paragraph, not a fact;
 *   - deduplicated by normalized key WITHIN the document, so one file can't
 *     contribute three variants of the same slot;
 *   - capped at MAX_FACTS_PER_DOC.
 */
export function filterDocumentCandidates(candidates: ExtractedCandidate[]): ExtractedCandidate[] {
  const out: ExtractedCandidate[] = [];
  const seenKeys = new Set<string>();
  for (const c of candidates) {
    const key = c.key?.trim();
    const text = c.text.trim();
    if (!key || !text) continue;
    if (text.length > MAX_FACT_CHARS) continue;
    const norm = key.toLowerCase();
    if (seenKeys.has(norm)) continue;
    seenKeys.add(norm);
    out.push({ kind: "fact", key, text, tags: c.tags });
    if (out.length >= MAX_FACTS_PER_DOC) break;
  }
  return out;
}

/** Documents in scope that are ready, long enough, and not yet analysed at
 *  their current version. Pure and local — no relay, no scrub. */
export function pendingDocuments(scope: SweepOptions["scope"]): DocItem[] {
  const ok = inScope(scope);
  return getAllDocuments().filter((d) => {
    if (!ok(d) || d.status !== "ready") return false;
    // The cursor holds the `updatedAt` that was analysed; a re-ingested (or
    // re-OCRed) document bumps it and becomes pending again.
    if (getSweepCursor(d.id) === d.updatedAt) return false;
    return getDocumentText(d).trim().length >= MIN_DOC_CHARS;
  });
}

/** Count for the ambient badge — mirrors exactly what a run would process. */
export function pendingDocumentSweepCount(scope: SweepOptions["scope"]): number {
  return pendingDocuments(scope).length;
}

/**
 * Run the sweep over every in-scope document that hasn't been analysed at its
 * current version. Never throws for per-document problems — a scrub/relay/parse
 * failure is counted and leaves that document's cursor untouched, so it is
 * retried on the next run.
 */
export async function runDocumentMemorySweep(opts: SweepOptions): Promise<SweepResult> {
  const pending = pendingDocuments(opts.scope);
  if (pending.length === 0) return { analyzed: 0, failed: 0, suggestions: 0, autoMerged: 0 };

  const candidates: Array<{ candidate: ExtractedCandidate; docId: string }> = [];
  let analyzed = 0;
  let failed = 0;
  for (let i = 0; i < pending.length; i++) {
    const doc = pending[i];
    opts.onProgress?.(tr("memory.sweep.analyzingDocs", { n: i + 1, total: pending.length }));
    try {
      const { text } = buildDocumentExcerpt(getDocumentText(doc));
      // 1) On-device redaction BEFORE anything reaches the provider.
      const scrub = await scrubText(text, {
        placeholder_style: "indexed",
        always_redact: opts.alwaysRedact,
        never_redact: opts.neverRedact,
      });
      // 2) Extraction over the SCRUBBED text only.
      const turns: ChatTurn[] = [
        { role: "system", content: DOCUMENT_EXTRACTION_SYSTEM_PROMPT },
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
      for (const c of filterDocumentCandidates(parsed)) {
        candidates.push({
          candidate: {
            ...c,
            text: applyPlaceholders(c.text, map),
            key: c.key ? applyPlaceholders(c.key, map) : undefined,
          },
          docId: doc.id,
        });
      }
      // Analysed at THIS version — a later edit/re-ingest bumps updatedAt and
      // makes the document pending again.
      setSweepCursor(doc.id, doc.updatedAt);
      analyzed++;
    } catch {
      failed++; // scrub or relay failure — fail soft, cursor untouched
    }
  }

  const { suggestions, autoMerged } = await dedupAndQueue(candidates, opts.scope, opts.onProgress);
  return { analyzed, failed, suggestions, autoMerged };
}
