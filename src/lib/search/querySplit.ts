/**
 * Split a chat message into retrieval *probes*: the whole message plus its
 * individual clauses.
 *
 * Why: the embedder mean-pools a whole sentence into one vector, so a focused
 * fact gets averaged away by conversational filler. Measured against a "I live
 * in Ontario" memory, the full message
 *   "Weißt du wo ich lebe und hast du das bei der Antwort berücksichtigt?"
 * embeds at cosine 0.24 (≈ noise), but its clause "Weißt du wo ich lebe" embeds
 * at 0.355 — clearly relevant. Scoring each candidate by its BEST-matching probe
 * (max-pooling in `topKMulti`) recovers the hit. Filler clauses
 * ("…berücksichtigt?", cos −0.08) and unrelated messages stay low, so this lifts
 * recall without admitting noise.
 */

import { contentTerms } from "./lexical";

/** Cap on probes per message (one batched embed call); keeps cost bounded. */
const MAX_PROBES = 8;

// Clause boundaries: sentence terminators, commas/semicolons, and the common
// German + English coordinating conjunctions (only when whitespace-flanked, so
// "gesund"/"rundum" aren't split).
const CLAUSE_BOUNDARY = /[.!?;\n]+|,|\s+(?:und|oder|aber|sowie|and|or|but|denn)\s+/iu;

/**
 * Return the message itself followed by its meaningful clauses, de-duplicated.
 * The full message is always first, so retrieval never does worse than scoring
 * the whole message alone.
 */
export function splitQuery(query: string): string[] {
  const full = (query ?? "").trim();
  if (!full) return [];

  const probes: string[] = [];
  const seen = new Set<string>();
  const add = (s: string): void => {
    const t = s.trim();
    if (!t) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    probes.push(t);
  };

  add(full);
  for (const seg of full.split(CLAUSE_BOUNDARY)) {
    if (probes.length >= MAX_PROBES) break;
    // Drop pure-stopword fragments ("und du"); keep anything with topical signal.
    if (contentTerms(seg).length >= 1) add(seg);
  }
  return probes;
}
