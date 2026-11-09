/** Mermaid detection. The sniff is what makes the common case work - a model
 *  emitting `erDiagram` with no ```mermaid fence - so it must be liberal
 *  enough to catch that and conservative enough never to turn ordinary code
 *  or prose into a diagram. */
import { describe, expect, it } from "vitest";

import { looksLikeMermaid } from "./mermaid";

describe("looksLikeMermaid", () => {
  it("accepts an explicit fence regardless of content", () => {
    expect(looksLikeMermaid("anything at all", "mermaid")).toBe(true);
    expect(looksLikeMermaid("anything at all", "MERMAID")).toBe(true);
  });

  it("sniffs an unfenced erDiagram: the actually-reported case", () => {
    const code = `erDiagram
    ACTOR ||--o{ USER_JOURNEY : "performs"
    USER_JOURNEY ||--|{ JOURNEY_STEP : "part_of (ordered)"`;
    expect(looksLikeMermaid(code)).toBe(true);
  });

  it("sniffs the other common diagram types", () => {
    expect(looksLikeMermaid("sequenceDiagram\n  A->>B: hi")).toBe(true);
    expect(looksLikeMermaid("flowchart LR\n  a-->b")).toBe(true);
    expect(looksLikeMermaid("graph TD\n  a-->b")).toBe(true);
    expect(looksLikeMermaid("gantt\n title X")).toBe(true);
    expect(looksLikeMermaid("\n\n  classDiagram\n  A <|-- B")).toBe(true);
  });

  it("requires a direction for graph/flowchart: prose must not become a diagram", () => {
    expect(looksLikeMermaid("graph theory is a field of mathematics")).toBe(false);
    expect(looksLikeMermaid("flowchart of the process below:")).toBe(false);
  });

  it("never mistakes ordinary code or prose for a diagram", () => {
    expect(looksLikeMermaid("const x = 1;\nconsole.log(x);")).toBe(false);
    expect(looksLikeMermaid("SELECT * FROM users;")).toBe(false);
    expect(looksLikeMermaid("# Heading\n\nSome text.")).toBe(false);
    expect(looksLikeMermaid("graphql query { user { id } }")).toBe(false);
    expect(looksLikeMermaid("")).toBe(false);
    expect(looksLikeMermaid("   \n  \n")).toBe(false);
  });

  it("an explicit non-mermaid language wins over a lookalike first line", () => {
    // A python snippet that happens to start with the word "graph".
    expect(looksLikeMermaid("graph TD\nmore", "python")).toBe(false);
  });
});
