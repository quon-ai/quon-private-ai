/**
 * A small, curated, deterministic DE/EN synonym / morphological-variant map
 * for QUERY-SIDE expansion in retrieval (Phase 4a of the NotebookLM rework —
 * see `.claude/plans/memory-notebooklm-rework.md`).
 *
 * This is NOT a general thesaurus and NOT an LLM call: every cluster below
 * was hand-picked because its members are genuinely interchangeable in
 * everyday German/English usage AND unlikely to collide with an unrelated
 * concept. It runs fully in the browser, synchronously, over a fixed literal
 * table — no relay round-trip, no network, so the raw (un-scrubbed) query
 * never leaves the device and no extra latency is added (ZK-clean, same
 * trust boundary as the rest of ./rag.ts).
 *
 * Query-side only (see `lexicalCoverage` in ./lexical, the sole consumer):
 * the INDEXED text is never expanded, so this can never change what a saved
 * memory "means" — it only widens which query wordings can find it. A
 * synonym hit still has to clear the exact same anchor + relevance gate
 * (ABS_FLOOR / NO_ANCHOR_SIM_FLOOR / STRICT_SIM_FLOOR — see ./rerank) as a
 * literal keyword match; no floor is touched by this file.
 *
 * Subword compounding (Nettoeinkommen ⊃ Einkommen) is already handled by
 * `subwordMatch` in ./lexical and is deliberately NOT duplicated here —
 * these clusters exist only for DIFFERENT roots that mean the same thing
 * (Gehalt vs. Einkommen), which no substring rule can bridge.
 *
 * Deliberately REJECTED clusters (documented so a future editor doesn't
 * re-add them without re-litigating the precision trade-off):
 *   - **Wohnung ↔ Adresse/Wohnort**: a Wohnung is the DWELLING itself
 *     ("meine Wohnung ist chaotisch" = my apartment is messy — nothing to do
 *     with an address). Merging it with Adresse would inject unrelated
 *     apartment notes into an address lookup and vice versa. Adresse ⟷
 *     Anschrift (both genuinely mean "the postal address", interchangeable
 *     on German official forms) stayed; Wohnung did not — see the guard
 *     test in rag.test.ts.
 *   - **A bare "Nummer"/"number" cluster**: far too generic (Hausnummer,
 *     Kontonummer, Kundennummer, Postleitzahl-adjacent stuff, …) — it would
 *     anchor almost any note that happens to contain a number. Only
 *     fully-qualified compounds for ONE specific concept (phone contact:
 *     Rufnummer/Handynummer/Telefonnummer/Kontaktnummer) are listed, and the
 *     bare word "Nummer" itself is never a cluster member.
 *   - **A general "Arbeit"/"Job" cluster**: "Arbeit" alone is extremely
 *     overloaded in German compounds (Hausarbeit, Gartenarbeit,
 *     Vereinsarbeit, …) with no shared concept — left out entirely rather
 *     than trying to hand-pick a safe subset.
 */

const CLUSTERS: readonly (readonly string[])[] = [
  // Income / salary — the motivating case for this phase (a query for
  // "Gehalt" must find a note that only ever says "Einkommen"/"Nettoeinkommen").
  ["einkommen", "gehalt", "verdienst", "lohn", "salär", "income", "salary", "wage", "earnings"],
  // Postal address — deliberately narrow (see the rejected-Wohnung note above).
  ["adresse", "anschrift", "address"],
  // Phone/contact number — different German roots for the same fact, so
  // subword matching (same-root compounding) cannot bridge them.
  ["telefonnummer", "handynummer", "rufnummer", "kontaktnummer", "phone", "mobile"],
];

const SYNONYMS_OF = new Map<string, string[]>();
for (const cluster of CLUSTERS) {
  for (const term of cluster) {
    SYNONYMS_OF.set(
      term,
      cluster.filter((t) => t !== term),
    );
  }
}

/** Curated synonyms/morphological variants of `term` (empty array if `term`
 *  is not in any curated cluster). `term` should already be a lowercased
 *  content term (see `contentTerms`) — this is a plain map lookup, no
 *  normalization is applied here. */
export function synonymsOf(term: string): string[] {
  return SYNONYMS_OF.get(term) ?? [];
}
