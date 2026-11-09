/**
 * Cross-language parity for the redaction span matcher.
 *
 * The fixture is generated FROM the backend's `scrubber.find_spans`, which is the
 * authority - a hand-redaction is enforced by the backend, so a client that
 * disagrees either promises a redaction that never happens (fail-open) or blocks
 * a send that would have been fine. `tests/test_find_spans_parity.py` asserts the
 * same file from the Python side, so the two can only drift by breaking a test.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { findSpansJs, normalizeRedactValue, occursIn, verifyRedactions } from "./redactSpans";

interface Case {
  name: string;
  text: string;
  value: string;
  spans: number[][];
}

const fixture = JSON.parse(
  readFileSync(new URL("../../tests/fixtures/find-spans-cases.json", import.meta.url), "utf-8"),
) as { cases: Case[] };

describe("findSpansJs matches the backend, case by case", () => {
  it("has a fixture with the boundary cases that actually bite", () => {
    // Guard against the fixture being emptied or trimmed to something toothless.
    expect(fixture.cases.length).toBeGreaterThanOrEqual(12);
    const names = fixture.cases.map((c) => c.name).join(" ");
    expect(names).toContain("umlaut");
    expect(names).toContain("underscore");
    // These are the cases that DISCRIMINATE Unicode word-chars from ASCII \w.
    // Without them the suite passes with the wrong matcher - it did.
    expect(names).toContain("umlaut BEFORE");
    expect(names).toContain("umlaut AFTER");
    expect(names).toContain("value starting with an umlaut");
  });

  for (const c of fixture.cases) {
    it(c.name, () => {
      expect(findSpansJs(c.text, c.value)).toEqual(c.spans.map(([a, b]) => [a, b]));
    });
  }
});

describe("the divergences that would otherwise be silent", () => {
  it("treats an umlaut as a word character, like Python does", () => {
    // JS `\w` is ASCII-only: with it, "Öl" would appear to occur inside "Größe"
    // and the client would promise a redaction the backend never makes.
    expect(findSpansJs("Größe der Kiste", "Öl")).toEqual([]);
    // ...but a real occurrence still matches.
    expect(findSpansJs("Öl ist teuer", "Öl")).toEqual([[0, 2]]);
  });

  it("does not shift offsets on characters whose lowercase is longer", () => {
    // "İ".toLowerCase() is 2 chars in JS - lowercasing both sides to compare
    // would corrupt every later offset.
    const text = `İstanbul und Anna`;
    const [span] = findSpansJs(text, "Anna");
    expect(text.slice(span[0], span[1])).toBe("Anna");
  });

  it("never throws on a value full of regex metacharacters", () => {
    expect(() => findSpansJs("x", "([{*+?^$|\\")).not.toThrow();
  });
});

describe("normalizeRedactValue", () => {
  it("trims and strips one layer of wrapping quotes", () => {
    expect(normalizeRedactValue("  Anna  ")).toBe("Anna");
    expect(normalizeRedactValue('"Anna"')).toBe("Anna");
    expect(normalizeRedactValue("'Anna'")).toBe("Anna");
    expect(normalizeRedactValue("`Anna`")).toBe("Anna");
    expect(normalizeRedactValue('""Anna""')).toBe('"Anna"'); // only one layer
  });

  it("leaves an unmatched quote alone", () => {
    expect(normalizeRedactValue('"Anna')).toBe('"Anna');
  });

  it("reduces whitespace-only input to nothing", () => {
    expect(normalizeRedactValue("   ")).toBe("");
  });
});

describe("occursIn", () => {
  it("is false for a value that only appears inside a longer word", () => {
    // The case that would otherwise let the UI draw a mark that redacts nothing.
    expect(occursIn("Vertragspartnerin", "partner")).toBe(false);
    expect(occursIn("Anna Muster", "Anna")).toBe(true);
  });
});

describe("verifyRedactions: the fail-closed gate", () => {
  it("returns null when every term was honoured", () => {
    expect(verifyRedactions("Hallo [PERSON_1], hier [CUSTOM_1]", ["Anna", "48213"])).toBeNull();
  });

  it("names the term that survived", () => {
    // This is the signal that makes the send abort instead of leaking.
    expect(verifyRedactions("Hallo Anna, hier [CUSTOM_1]", ["Anna", "48213"])).toBe("Anna");
  });

  it("ignores blank terms rather than failing every send", () => {
    expect(verifyRedactions("anything", ["  ", ""])).toBeNull();
  });

  it("does not false-positive on a term that only occurs inside a word", () => {
    // "partner" was asked for, the text has "Vertragspartnerin" - the backend
    // would not have redacted that, so blocking the send would be wrong.
    expect(verifyRedactions("Vertragspartnerin", ["partner"])).toBeNull();
  });

  it("is case-insensitive, like the matcher", () => {
    expect(verifyRedactions("hallo anna", ["Anna"])).toBe("Anna");
  });

  it("does not trip on a term that only occurs inside a placeholder", () => {
    // A placeholder is the PROOF a value was redacted - but it is also text, so a
    // short term could plausibly match inside one and fail a send that was
    // correct. It doesn't, and the reason is the WORD-BOUNDARY rule, not any
    // special handling: "Person" in "[PERSON_1]" is followed by "_" (a word
    // character) and "1" is preceded by one. Asserted here because the mechanism
    // is non-obvious - an earlier version "protected" this by stripping
    // placeholders, and breaking that stripping showed these still passed, i.e.
    // the guard was never doing anything.
    expect(verifyRedactions("Hallo [PERSON_1], Betrag [FINANCIAL_AMOUNT_2]", ["1"])).toBeNull();
    expect(verifyRedactions("Hallo [PERSON_1]", ["Person"])).toBeNull();
    expect(verifyRedactions("Hallo [PERSON_1]", ["PERSON"])).toBeNull();
  });

  it("still catches a real leak sitting next to a placeholder", () => {
    // Stripping placeholders must not blind it to the actual value surviving.
    expect(verifyRedactions("Hallo [PERSON_1] alias Anna Muster", ["Anna Muster"])).toBe(
      "Anna Muster",
    );
  });

  it("is a no-op with an empty term list", () => {
    expect(verifyRedactions("anything at all", [])).toBeNull();
  });
});
