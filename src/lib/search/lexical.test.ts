import { describe, expect, it } from "vitest";

import { contentTerms, lexicalCoverage, rankByLexicalCoverage, subwordMatch } from "./lexical";

describe("contentTerms", () => {
  it("lowercases, drops stopwords and short tokens, keeps umlauts", () => {
    expect(contentTerms("Ab wann ist die Ernährung gut?")).toEqual(["ernährung", "gut"]);
  });

  it("splits on punctuation and digits-adjacent boundaries", () => {
    expect(contentTerms("Omni-Biotic, 2x täglich!")).toEqual(["omni", "biotic", "täglich"]);
  });
});

describe("lexicalCoverage", () => {
  const q = new Set(contentTerms("omnio biotic darm")); // {omnio, biotic, darm}

  it("is the fraction of query terms present in the text", () => {
    expect(lexicalCoverage(q, "biotic für den darm")).toBeCloseTo(2 / 3);
    expect(lexicalCoverage(q, "omnio biotic darm sanierung")).toBe(1);
  });

  it("is 0 with no overlap or an empty query", () => {
    expect(lexicalCoverage(q, "gehalt sparkasse konto")).toBe(0);
    expect(lexicalCoverage(new Set(), "anything at all")).toBe(0);
  });
});

describe("subwordMatch (German compound anchoring)", () => {
  it("matches an exact pair regardless of length", () => {
    expect(subwordMatch("ab", "ab")).toBe(true);
  });

  it("matches when a long-enough term is a substring of a compound (both directions)", () => {
    // The production bug: a query for "Einkommen" must anchor a note that
    // only ever says "Nettoeinkommen" (a German compound noun).
    expect(subwordMatch("einkommen", "nettoeinkommen")).toBe(true);
    expect(subwordMatch("nettoeinkommen", "einkommen")).toBe(true);
  });

  it("does NOT match below SUBWORD_MIN_LEN even if one is a substring of the other", () => {
    // Guards the false-anchor class the STOPWORDS comment in this file warns
    // about: short coincidental overlaps ("ein"/"rat") must not anchor.
    expect(subwordMatch("ein", "einkommen")).toBe(false);
    expect(subwordMatch("rat", "vorratslager")).toBe(false);
  });

  it("does NOT match two unrelated words that both clear the length floor", () => {
    expect(subwordMatch("einkommen", "talbach")).toBe(false);
    expect(subwordMatch("ferritin", "gesundheitsinformationen")).toBe(false);
  });
});

describe("lexicalCoverage (subword anchoring integrated)", () => {
  it("counts a German-compound subword match as coverage", () => {
    const q = new Set(contentTerms("prüfe wie mein Einkommen ist"));
    expect(
      lexicalCoverage(q, "Nettoeinkommen (beide berufstätig): Timo 120k, Nadine 80k"),
    ).toBeGreaterThan(0);
  });

  it("stopword-filtered casual query words still never anchor (regression guard)", () => {
    // "kann"/"machen"/"sonst"/"alles" are stripped by STOPWORDS before they
    // ever reach subwordMatch — confirms the subword rule didn't reopen the
    // casual-query false-anchor class those stopwords exist to close.
    const q = new Set(contentTerms("was kann man sonst alles machen"));
    expect(q.size).toBe(0); // every word in that sentence is a stopword
    expect(lexicalCoverage(q, "Ein langer Reisebericht über machen und alles Mögliche.")).toBe(0);
  });
});

describe("lexicalCoverage (curated synonym expansion — query side only)", () => {
  it("a query synonym ('Gehalt') matches text that only ever says a different-root word ('Einkommen')", () => {
    const q = new Set(contentTerms("wie hoch ist unser Gehalt"));
    expect(lexicalCoverage(q, "Mein Einkommen ist stabil.")).toBeGreaterThan(0);
  });

  it("a synonym hit does not inflate coverage past a literal match (denominator stays queryTerms.size)", () => {
    // "gehalt" has 8 curated cluster-mates, but it can still only satisfy ITS
    // OWN slot — coverage must be exactly 1/1, identical to a literal match.
    const q = new Set(contentTerms("Gehalt"));
    expect(lexicalCoverage(q, "Mein Einkommen ist stabil.")).toBe(1);
  });

  it("expansion is QUERY-SIDE ONLY: 'Gehalt' appearing in the text doesn't matter to an unrelated query", () => {
    const q = new Set(contentTerms("was kann man in talbach machen"));
    expect(lexicalCoverage(q, "Mein Gehalt und Sparkonto bei der Sparkasse")).toBe(0);
  });

  it("guard: the deliberately-rejected Wohnung↔Adresse pairing is not connected", () => {
    const q = new Set(contentTerms("wie lautet meine Adresse"));
    expect(lexicalCoverage(q, "Unsere Wohnung ist ziemlich chaotisch.")).toBe(0);
  });

  it("guard: the deliberately-rejected bare-'Nummer' pairing is not connected", () => {
    const q = new Set(contentTerms("wie ist deine Rufnummer"));
    expect(lexicalCoverage(q, "Hausnummer 42 in der Bahnhofstraße.")).toBe(0);
  });
});

describe("rankByLexicalCoverage", () => {
  it("ranks candidates best-first and drops zero-coverage ones", () => {
    const q = new Set(contentTerms("omnio biotic darm"));
    const items = ["biotic darm probiotikum", "irrelevant text", "omnio biotic darm sanierung"];
    const ranked = rankByLexicalCoverage(items, q, (s) => s);
    expect(ranked.map((r) => r.item)).toEqual([
      "omnio biotic darm sanierung",
      "biotic darm probiotikum",
    ]);
  });

  it("returns [] for an empty query", () => {
    expect(rankByLexicalCoverage(["a", "b"], new Set(), (s) => s)).toEqual([]);
  });
});
