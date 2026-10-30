/**
 * Lightweight lexical (keyword) scoring to complement vector similarity.
 *
 * The on-device bi-encoder produces a compressed, noisy cosine distribution, so
 * vector score alone is a weak relevance signal. A cheap keyword-overlap signal
 * sharpens it: candidates that actually share salient terms with the query get a
 * boost, zero-overlap candidates do not. Computed only over the vector shortlist
 * (a handful of items), so it stays O(1) regardless of corpus size.
 */

import { synonymsOf } from "./synonyms";

// Common German + English function words that carry no topical signal. Kept
// small and high-frequency on purpose — this is a precision aid, not a full IR
// stopword list.
const STOPWORDS = new Set([
  // German
  "der",
  "die",
  "das",
  "den",
  "dem",
  "des",
  "ein",
  "eine",
  "einen",
  "einem",
  "einer",
  "und",
  "oder",
  "aber",
  "nicht",
  "kein",
  "keine",
  "mit",
  "ohne",
  "für",
  "von",
  "vom",
  "bei",
  "aus",
  "auf",
  "über",
  "unter",
  "vor",
  "nach",
  "zur",
  "zum",
  "ist",
  "sind",
  "war",
  "ich",
  "du",
  "wir",
  "ihr",
  "sie",
  "man",
  "mir",
  "mich",
  "dir",
  "dich",
  "was",
  "wer",
  "wie",
  "wann",
  "wo",
  "warum",
  "wieso",
  "welche",
  "welcher",
  "ab",
  "schon",
  "noch",
  "auch",
  "nur",
  "sehr",
  "mein",
  "meine",
  "dein",
  "sein",
  "hat",
  "habe",
  "haben",
  // High-frequency German verbs/fillers. These must not count as lexical
  // ANCHORS (see rerank.ts): a casual query like "was kann man sonst alles
  // machen" would otherwise "anchor" on kann/machen/sonst/alles appearing in
  // any long German text, defeating the no-anchor gate.
  "kann",
  "kannst",
  "können",
  "könnte",
  "muss",
  "soll",
  "sollte",
  "will",
  "wollen",
  "möchte",
  "machen",
  "macht",
  "gemacht",
  "gibt",
  "geht",
  "mal",
  "sonst",
  "alles",
  "etwas",
  "mehr",
  "viel",
  "viele",
  "immer",
  "wieder",
  "bitte",
  "jetzt",
  "dann",
  "denn",
  "doch",
  "hier",
  "dort",
  "sagt",
  "sagen",
  // English
  "can",
  "get",
  "got",
  "make",
  "made",
  "want",
  "need",
  "just",
  "some",
  "any",
  "all",
  "else",
  "also",
  "still",
  "now",
  "here",
  "there",
  "say",
  "says",
  "said",
  "the",
  "and",
  "or",
  "but",
  "not",
  "with",
  "without",
  "for",
  "from",
  "this",
  "that",
  "what",
  "who",
  "how",
  "when",
  "where",
  "why",
  "which",
  "are",
  "was",
  "were",
  "have",
  "has",
  "you",
  "your",
  "can",
  "could",
  "would",
  "about",
  "into",
  "than",
  "then",
]);

/** Lowercase, split on non-letter/digit, drop short tokens and stopwords. */
export function contentTerms(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/** Minimum length (chars) BOTH sides of a pair must have before a substring
 *  relationship counts as a shared subword anchor (see `subwordMatch`).
 *  German compounds carry their base noun verbatim — "Nettoeinkommen"
 *  contains "Einkommen" — which is what lets a query for "Einkommen" anchor a
 *  note that only ever says "Nettoeinkommen" (`contentTerms` tokenises on
 *  non-letters only, so it never splits the compound; the production miss
 *  this fixes: see rag.test.ts's income regression). Deliberately >= 5:
 *  STOPWORDS already strips short function words before either side reaches
 *  here, and this extra floor keeps a coincidental short overlap
 *  ("ein"/"rat") from anchoring two unrelated words — exactly the
 *  false-anchor class the STOPWORDS comment above warns about for casual
 *  queries ("kann"/"machen"/... are filtered before this runs at all). */
export const SUBWORD_MIN_LEN = 5;

/** True when `a` and `b` (already-lowercased content terms) count as the same
 *  topic for anchoring purposes: an exact match, or — for tokens long enough
 *  to carry real meaning (both >= SUBWORD_MIN_LEN) — one is a substring of
 *  the other. */
export function subwordMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < SUBWORD_MIN_LEN || b.length < SUBWORD_MIN_LEN) return false;
  return a.includes(b) || b.includes(a);
}

/**
 * Fraction of the query's content terms that appear in `text` (0..1), counting
 * a subword/compound match (see `subwordMatch`) OR a curated synonym/
 * morphological-variant match (see `./synonyms`) as a hit too. Synonym
 * expansion is QUERY-SIDE ONLY and deliberately does not change the
 * denominator: each original query term still contributes at most one hit,
 * whether satisfied by the literal word, a subword match, or one of its
 * curated synonyms — so a term with many curated synonyms can't inflate
 * `coverage` past what a single literal keyword match would score (the
 * LEX_BOOST/floor calibration in ./rerank stays valid unchanged). Pass the
 * pre-tokenised query terms so it isn't recomputed per candidate.
 */
export function lexicalCoverage(queryTerms: Set<string>, text: string): number {
  if (queryTerms.size === 0) return 0;
  const terms = contentTerms(text);
  const exact = new Set(terms);
  const matches = (t: string): boolean => exact.has(t) || terms.some((x) => subwordMatch(t, x));
  let hit = 0;
  for (const q of queryTerms) {
    if (matches(q) || synonymsOf(q).some(matches)) hit++;
  }
  return hit / queryTerms.size;
}

/**
 * Rank ALL candidates by lexical coverage against the query, best first,
 * dropping zero-coverage items. Unlike `lexicalCoverage` (a per-candidate
 * score used to re-rank an already-chosen shortlist), this ranks the WHOLE
 * pool — it is the lexical channel fed into RRF fusion (see `./fusion` +
 * `../rag.ts`), so a candidate the vector stage would never shortlist can
 * still enter retrieval on the strength of a keyword/subword match alone.
 */
export function rankByLexicalCoverage<T>(
  items: T[],
  queryTerms: Set<string>,
  textOf: (item: T) => string,
): Array<{ item: T; score: number }> {
  if (queryTerms.size === 0) return [];
  return items
    .map((item) => ({ item, score: lexicalCoverage(queryTerms, textOf(item)) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
}
