/** "Auswahl schwärzen" matching — every branch here was a SILENT no-op before
 *  (feedback #58: "der Button scheint nicht zu funktionieren"). The regression
 *  this locks in: failures have names, and cross-line selections match. */
import { describe, expect, it } from "vitest";

import { findManualSelection, resolveDurableRedaction } from "./manualRedact";

const SENT = "Bitte überweise an Anna Müller,\nIBAN folgt separat. Danke!";

describe("findManualSelection", () => {
  it("matches an exact substring", () => {
    expect(findManualSelection("Anna Müller", SENT)).toEqual({ value: "Anna Müller" });
  });

  it("names an empty selection instead of doing nothing", () => {
    expect(findManualSelection("", SENT)).toEqual({ error: "empty" });
    expect(findManualSelection("   ", SENT)).toEqual({ error: "empty" });
    expect(findManualSelection(undefined, SENT)).toEqual({ error: "empty" });
  });

  it("refuses a selection touching a placeholder — that text is already redacted", () => {
    expect(findManualSelection("[PERSON_1]", SENT)).toEqual({ error: "placeholder" });
    expect(findManualSelection("an [PERSON_1] und", SENT)).toEqual({ error: "placeholder" });
  });

  it("names a selection that is not in the outgoing text (wrong panel)", () => {
    expect(findManualSelection("völlig anderer Text", SENT)).toEqual({ error: "not-found" });
  });

  /** The real-world miss: a selection crossing a rendered line break copies
   *  "\n" (or loses it) — includes() fails, the button silently no-oped. The
   *  match must return the TEXT's own substring so split/join replacement works. */
  it("matches across whitespace differences and returns the text's own spelling", () => {
    const crossLine = findManualSelection("Anna Müller, IBAN folgt", SENT);
    expect(crossLine).toEqual({ value: "Anna Müller,\nIBAN folgt" });
    const collapsed = findManualSelection("Müller,\n\n  IBAN", SENT);
    expect(collapsed).toEqual({ value: "Müller,\nIBAN" });
  });

  it("escapes regex metacharacters in the selection", () => {
    const text = "Der Betrag (1.250,00 EUR) ist offen.";
    expect(findManualSelection("(1.250,00 EUR)", text)).toEqual({ value: "(1.250,00 EUR)" });
  });
});

describe("resolveDurableRedaction — the gate to the enforced always-redact list", () => {
  // Stricter than the per-send path on purpose: a durable term is enforced by
  // the BACKEND's word-boundary matcher against every future send, so the value
  // must be something that matcher will hit, and the user must confirm the real
  // occurrence count — never a mark that redacts nothing.
  const doc = "Anna Muster wohnt hier. Anna Muster zahlt. Die Vertragspartnerin auch.";

  it("resolves a selection with its occurrence count", () => {
    expect(resolveDurableRedaction("Anna Muster", doc, [])).toEqual({
      value: "Anna Muster",
      occurrences: 2,
    });
  });

  it("refuses a value that only occurs inside longer words", () => {
    // "partner" is a substring of the doc, so the per-send path would accept it —
    // but the backend requires word boundaries and would redact NOTHING. A
    // visible-but-ineffective redaction is the one forbidden outcome.
    expect(resolveDurableRedaction("partner", doc, [])).toEqual({ error: "inside-word" });
  });

  it("refuses a value on the never-redact allow-list, by name", () => {
    // Both lists at once is a contradiction; before the backend exempted CUSTOM
    // it even meant the allow-list silently won. Refuse and let the UI offer to
    // remove the allow-list entry.
    expect(resolveDurableRedaction("Anna Muster", doc, ["anna muster"])).toEqual({
      error: "never-redact",
    });
  });

  it("keeps the per-send named errors", () => {
    expect(resolveDurableRedaction("", doc, [])).toEqual({ error: "empty" });
    expect(resolveDurableRedaction("[PERSON_1]", doc, [])).toEqual({ error: "placeholder" });
    expect(resolveDurableRedaction("nicht drin", doc, [])).toEqual({ error: "not-found" });
  });

  it("resolves across a rendered line break like the per-send path", () => {
    const wrapped = "Anna\nMuster wohnt hier.";
    expect(resolveDurableRedaction("Anna Muster", wrapped, [])).toEqual({
      value: "Anna\nMuster",
      occurrences: 1,
    });
  });
});
