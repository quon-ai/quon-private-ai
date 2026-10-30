// @vitest-environment jsdom
/** Detection-preview highlighting core (feedback #55). What must never break:
 *  longest-value-first matching (a contained "Anna" must not shadow
 *  "Anna Müller"), case-insensitivity (matches the backend's always-redact
 *  semantics), regex-metacharacter safety, and DOM idempotence. */
import { describe, expect, it } from "vitest";

import {
  buildHighlightRegex,
  dismissHit,
  withNeverRedacted,
  hasPlaceableText,
  highlightDomText,
  injectManualHit,
  segmentText,
  type DetectionHit,
  type DetectState,
} from "./detectionPreview";

const hits: DetectionHit[] = [
  { value: "Anna Müller", type: "PERSON" },
  { value: "Anna", type: "PERSON" },
  { value: "kontakt@example.com", type: "EMAIL" },
];

describe("segmentText", () => {
  it("marks each hit with its type and keeps everything else", () => {
    const segs = segmentText("Hallo Anna Müller, Mail an kontakt@example.com bitte.", hits);
    expect(segs).toEqual([
      { text: "Hallo ", type: null },
      { text: "Anna Müller", type: "PERSON" },
      { text: ", Mail an ", type: null },
      { text: "kontakt@example.com", type: "EMAIL" },
      { text: " bitte.", type: null },
    ]);
  });

  it("prefers the longest value — 'Anna' never splits 'Anna Müller'", () => {
    const segs = segmentText("Anna Müller und Anna.", hits);
    expect(segs.map((s) => s.text)).toEqual(["Anna Müller", " und ", "Anna", "."]);
  });

  it("matches case-insensitively, preserving the document's own casing", () => {
    const segs = segmentText("ANNA MÜLLER kommt.", hits);
    expect(segs[0]).toEqual({ text: "ANNA MÜLLER", type: "PERSON" });
  });

  it("escapes regex metacharacters in values", () => {
    const amount: DetectionHit[] = [{ value: "(1.250,00 EUR)", type: "FINANCIAL_AMOUNT" }];
    const segs = segmentText("Betrag (1.250,00 EUR) offen", amount);
    expect(segs[1]).toEqual({ text: "(1.250,00 EUR)", type: "FINANCIAL_AMOUNT" });
    // The dot must not act as a wildcard.
    expect(segmentText("Betrag (1x250,00 EUR) offen", amount).every((s) => s.type === null)).toBe(
      true,
    );
  });

  it("returns one untyped segment when there are no hits", () => {
    expect(segmentText("nichts hier", [])).toEqual([{ text: "nichts hier", type: null }]);
    expect(buildHighlightRegex([])).toBeNull();
  });
});

describe("highlightDomText", () => {
  it("wraps hits across nested elements, counts them, and is idempotent", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>Hallo <b>Anna Müller</b>, Mail an kontakt@example.com.</p>";
    const n = highlightDomText(root, hits);
    expect(n).toBe(2);
    const marks = [...root.querySelectorAll("mark[data-quon-hit]")];
    expect(marks.map((m) => m.getAttribute("data-quon-hit"))).toEqual(["PERSON", "EMAIL"]);
    // Text content is unchanged — highlighting must never alter the document.
    expect(root.textContent).toBe("Hallo Anna Müller, Mail an kontakt@example.com.");
    // A second pass finds nothing new (marks are skipped).
    expect(highlightDomText(root, hits)).toBe(0);
    expect(root.querySelectorAll("mark[data-quon-hit]").length).toBe(2);
  });
});

describe("injectManualHit", () => {
  // The document viewer's Text view "Immer schwärzen" action folds a
  // hand-redacted term into whatever the detection preview is currently
  // showing — this is the pure transition behind that, decoupled from React.
  const manual: DetectionHit = { value: "Anna Muster", type: "MANUAL" };

  it("turns marks on with just the one hit when detection is off", () => {
    expect(injectManualHit(null, manual)).toEqual({ status: "done", hits: [manual] });
  });

  it("turns marks on with just the one hit when detection failed", () => {
    expect(injectManualHit({ status: "failed" }, manual)).toEqual({
      status: "done",
      hits: [manual],
    });
  });

  it("replaces a still-running preview rather than folding into a stale list", () => {
    expect(
      injectManualHit({ status: "running", done: 1, total: 3, startedAt: 0, updatedAt: 0 }, manual),
    ).toEqual({
      status: "done",
      hits: [manual],
    });
  });

  it("appends to an existing hit list, longest value first", () => {
    const existing: DetectState = {
      status: "done",
      hits: [{ value: "kontakt@example.com", type: "EMAIL" }], // longer than "Anna Muster"
    };
    const next = injectManualHit(existing, manual);
    expect(next).toEqual({
      status: "done",
      hits: [{ value: "kontakt@example.com", type: "EMAIL" }, manual],
    });
  });

  it("de-dupes by (type, case-insensitive value) instead of adding a second copy", () => {
    const existing: DetectState = { status: "done", hits: [manual] };
    const next = injectManualHit(existing, { value: "ANNA MUSTER", type: "MANUAL" });
    expect(next).toBe(existing); // unchanged — same reference, not just equal
  });

  it("keeps two hits with the same value but different types", () => {
    const existing: DetectState = {
      status: "done",
      hits: [{ value: "Anna Muster", type: "PERSON" }],
    };
    const next = injectManualHit(existing, manual);
    expect(next).toEqual({
      status: "done",
      hits: [{ value: "Anna Muster", type: "PERSON" }, manual],
    });
  });
});

describe("hasPlaceableText", () => {
  // Regression: Original view rendered a clean, unmarked page for a SCAN while
  // Text view showed every hit — because "no text layer" and "no hits found"
  // both came out as an empty rect list. These are different facts and the UI
  // has to be able to tell them apart.
  const item = (str: string) => ({ str });

  it("is false for a page with no text items at all (a scan)", () => {
    expect(hasPlaceableText([])).toBe(false);
  });

  it("is false when the only items are whitespace", () => {
    expect(hasPlaceableText([item(""), item("   "), item("\n")])).toBe(false);
  });

  it("is false for a scan carrying only a stamp or page number", () => {
    // THE case a naive "has any text?" check gets wrong: these pages do have a
    // text layer, so the page would be treated as markable, the body text would
    // still have come from OCR, and the page would render clean again.
    expect(hasPlaceableText([item("Seite 3 von 12")])).toBe(false);
    expect(hasPlaceableText([item("VERTRAULICH")])).toBe(false);
  });

  it("is true for a real text page, even a terse one", () => {
    expect(hasPlaceableText([item("Vertragspartnerin: Anna Muster, Musterstadt, 12345")])).toBe(
      true,
    );
  });

  it("agrees with the threshold extraction used to route the page to OCR", () => {
    // One predicate, one threshold — the viewer must not disagree with the
    // decision that produced the text in the first place.
    const justUnder = [item("a".repeat(29))];
    const justOver = [item("a".repeat(30))];
    expect(hasPlaceableText(justUnder)).toBe(false);
    expect(hasPlaceableText(justOver)).toBe(true);
  });

  it("ignores items whose str is not a string", () => {
    expect(hasPlaceableText([{}, { str: 42 }])).toBe(false);
  });
});

describe("buildHighlightRegex word boundaries", () => {
  // Beta, 2026-08-22: a financial report came back with half its words
  // highlighted. The backend had matched nothing — find_spans is word-bounded
  // and this regex was not, so one two-letter detection repainted the page.
  it("does not match a short value inside longer words", () => {
    const text =
      "Basis & Rechnungsmethodik. Zum Erreichen der Altersgrenze von 65 Jahren " +
      "gelten Reale Kaufkraft inflationsbereinigt (reale Werte). Renditen bereits.";
    const re = buildHighlightRegex([{ value: "Re", type: "PERSON" }]);
    expect(re).not.toBeNull();
    expect([...text.matchAll(re!)]).toHaveLength(0);
  });

  it("still matches the value as a standalone word, case-insensitively", () => {
    const re = buildHighlightRegex([{ value: "Re", type: "PERSON" }]);
    expect([..."Betreff: Re: Vertrag".matchAll(re!)]).toHaveLength(1);
  });

  // JS \b and \w are ASCII-only, so an ASCII boundary would still match inside
  // a word ending in an umlaut. The Unicode class is what makes German work.
  it("treats umlauts as word characters", () => {
    const re = buildHighlightRegex([{ value: "ber", type: "PERSON" }]);
    expect([..."Grüßeber und überber".matchAll(re!)]).toHaveLength(0);
  });

  it("keeps matching values whose edges are punctuation", () => {
    const mail = buildHighlightRegex([{ value: "a.schmidt@web.de", type: "EMAIL" }]);
    expect([..."Kontakt: a.schmidt@web.de.".matchAll(mail!)]).toHaveLength(1);
    const phone = buildHighlightRegex([{ value: "+49 30 123", type: "PHONE" }]);
    expect([..."Tel. +49 30 123 melden".matchAll(phone!)]).toHaveLength(1);
  });

  it("matches full names and multi-word values unchanged", () => {
    const re = buildHighlightRegex([
      { value: "Anna Schmidt", type: "PERSON" },
      { value: "Rehbergplatz 12", type: "ADDRESS" },
    ]);
    const t = "Anna Schmidt, Rehbergplatz 12, 10115 Berlin";
    expect([...t.matchAll(re!)]).toHaveLength(2);
  });
});

describe("dismissing a false positive", () => {
  const done = {
    status: "done" as const,
    hits: [
      { value: "Versicherungsnehmer", type: "PERSON" },
      { value: "Anna Schmidt", type: "PERSON" },
    ],
  };

  it("clears the value from the preview, case-insensitively", () => {
    const next = dismissHit(done, "versicherungsnehmer");
    expect(next).toEqual({ status: "done", hits: [{ value: "Anna Schmidt", type: "PERSON" }] });
  });

  it("leaves other hits alone", () => {
    expect(dismissHit(done, "Anna Schmidt")).toEqual({
      status: "done",
      hits: [{ value: "Versicherungsnehmer", type: "PERSON" }],
    });
  });

  it("passes non-done states through untouched", () => {
    const failed = { status: "failed" as const };
    expect(dismissHit(failed, "x")).toBe(failed);
    expect(dismissHit(null, "x")).toBeNull();
  });

  it("ignores an empty value rather than clearing everything", () => {
    expect(dismissHit(done, "   ")).toBe(done);
  });

  it("adds to the never-redact list without duplicating", () => {
    expect(withNeverRedacted([], "Schutz")).toEqual(["Schutz"]);
    expect(withNeverRedacted(["Schutz"], "schutz")).toEqual(["Schutz"]);
    expect(withNeverRedacted(["Schutz"], " Risikoperson ")).toEqual(["Schutz", "Risikoperson"]);
    expect(withNeverRedacted(["Schutz"], "  ")).toEqual(["Schutz"]);
  });
});
