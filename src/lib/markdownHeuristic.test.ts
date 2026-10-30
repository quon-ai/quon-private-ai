import { describe, expect, it } from "vitest";
import { looksLikeMarkdown } from "./markdownHeuristic";

describe("looksLikeMarkdown", () => {
  it("detects real Markdown syntax", () => {
    expect(looksLikeMarkdown("Das ist **wichtig** für später")).toBe(true);
    expect(looksLikeMarkdown("## Vertragsdetails\nLaufzeit 24 Monate")).toBe(true);
    expect(looksLikeMarkdown("- Angebot A: 12k\n- Angebot B: 11k")).toBe(true);
    expect(looksLikeMarkdown("1. erst prüfen\n2. dann kündigen")).toBe(true);
    expect(looksLikeMarkdown("nutze `docker-compose` (v1!)")).toBe(true);
    expect(looksLikeMarkdown("[Angebot](https://example.com/a.pdf)")).toBe(true);
    expect(looksLikeMarkdown("> Zitat aus dem Vertrag")).toBe(true);
    expect(looksLikeMarkdown("| Anbieter | Preis |\n| A | 12k |")).toBe(true);
  });

  it("leaves plain notes alone (single newlines must survive as line breaks)", () => {
    expect(looksLikeMarkdown("Standard rate: 120 EUR/h")).toBe(false);
    expect(looksLikeMarkdown("Zeile eins\nZeile zwei\nZeile drei")).toBe(false);
    expect(looksLikeMarkdown("Termin am 12.10. um 14 Uhr")).toBe(false); // "12." is not a list
    expect(looksLikeMarkdown("a * b und 2*3")).toBe(false); // lone asterisks
    expect(looksLikeMarkdown("Preis 10-12k")).toBe(false); // hyphen, not a bullet
  });
});
