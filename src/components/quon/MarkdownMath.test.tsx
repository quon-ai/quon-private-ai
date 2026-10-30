import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { hasMath } from "@/lib/markdownText";
import MarkdownMath from "./MarkdownMath";

// The screenshot that started this: "(Elternhaus $\\rightarrow$ Mieterin …)"
// printed with the dollar signs and the backslash in the middle of a sentence.
describe("MarkdownMath", () => {
  it("typesets inline TeX instead of printing it", () => {
    const html = renderToStaticMarkup(
      <MarkdownMath components={{}}>{"Elternhaus $\\rightarrow$ Mieterin"}</MarkdownMath>,
    );
    expect(html).toContain('class="katex"');
    expect(html).not.toContain("$\\rightarrow$");
    // The glyph itself is in the output (KaTeX keeps a MathML/annotation copy).
    expect(html).toContain("→");
  });

  it("does not crash on half-valid TeX", () => {
    const html = renderToStaticMarkup(
      <MarkdownMath components={{}}>{"broken $\\frac{a$ here"}</MarkdownMath>,
    );
    expect(html).toContain("broken");
  });
});

describe("hasMath (the lazy-chunk gate)", () => {
  it("is true for the shapes models actually emit", () => {
    expect(hasMath("A $\\rightarrow$ B")).toBe(true);
    expect(hasMath("Energie: $E = mc^2$")).toBe(true);
    expect(hasMath("Index $a_i$")).toBe(true);
    expect(hasMath("$$\\int_0^1 x\\,dx$$")).toBe(true);
    expect(hasMath("Formel \\(x+1\\) hier")).toBe(true);
  });

  it("is false for prose with dollar amounts — that must not become math mode", () => {
    expect(hasMath("Das kostet $5 und $10 zusammen.")).toBe(false);
    expect(hasMath("Budget: $3.50")).toBe(false);
    expect(hasMath("Kein Dollar hier.")).toBe(false);
  });
});
