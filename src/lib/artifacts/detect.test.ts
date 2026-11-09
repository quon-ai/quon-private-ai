import { describe, expect, it } from "vitest";

import { artifactFilename, detectArtifacts, unwrapMarkdownArtifacts } from "./detect";

const bigMd = `# Reisebericht Talbach

## Anreise
Wir fuhren am Morgen los und kamen mittags an. Das Wetter war herrlich und
die Straßen waren frei. Unterwegs hielten wir für einen Kaffee.

## Unterkunft
Das Hotel lag zentral, mit Blick auf die Berge und einem guten Frühstück.`;

const bigHtml = `<!doctype html>
<html><head><title>Rechnung 2027</title></head>
<body><h1>Rechnung</h1><p>Betrag: 1.234 Euro für Beratungsleistungen im Quartal.</p>
<script>alert('x')</script>
<table><tr><td>Position</td><td>Preis</td></tr></table></body></html>`;

describe("detectArtifacts", () => {
  it("detects a substantial fenced markdown block with its H1 title", () => {
    const out = detectArtifacts(`Hier ist dein Dokument:\n\n\`\`\`markdown\n${bigMd}\n\`\`\`\n`);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("markdown");
    expect(out[0].title).toBe("Reisebericht Talbach");
    expect(out[0].content).toContain("## Unterkunft");
  });

  it("detects an html page and its <title>", () => {
    const out = detectArtifacts(`\`\`\`html\n${bigHtml}\n\`\`\``);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("html");
    expect(out[0].title).toBe("Rechnung 2027");
  });

  it("accepts the md/htm aliases", () => {
    expect(detectArtifacts(`\`\`\`md\n${bigMd}\n\`\`\``)[0].type).toBe("markdown");
    expect(detectArtifacts(`\`\`\`htm\n${bigHtml}\n\`\`\``)[0].type).toBe("html");
  });

  it("ignores short snippets and non-doc languages", () => {
    expect(detectArtifacts("```html\n<b>hi</b>\n```")).toEqual([]); // too short
    expect(detectArtifacts("```python\nprint('x' * 300)\n```")).toEqual([]); // not md/html
    expect(detectArtifacts(`\`\`\`html\n${"nur text ".repeat(40)}\n\`\`\``)).toEqual([]); // no tags
  });

  it("returns multiple artifacts in order", () => {
    const out = detectArtifacts(
      `\`\`\`markdown\n${bigMd}\n\`\`\`\n\ntext\n\n\`\`\`html\n${bigHtml}\n\`\`\``,
    );
    expect(out.map((a) => a.type)).toEqual(["markdown", "html"]);
  });

  it("falls back to a first-line / default title", () => {
    const noHeading = "Dies ist ein Fließtext ".repeat(15);
    const a = detectArtifacts(`\`\`\`markdown\n${noHeading}\n\`\`\``)[0];
    expect(a.title.length).toBeGreaterThan(0);
    expect(a.title.length).toBeLessThanOrEqual(80);
  });
});

describe("artifactFilename", () => {
  it("builds a safe filename with the right extension", () => {
    expect(artifactFilename({ type: "markdown", title: "Reise: Talbach?", content: "x" })).toBe(
      "Reise Talbach.md",
    );
    expect(artifactFilename({ type: "html", title: "Rechnung 2027", content: "x" })).toBe(
      "Rechnung 2027.html",
    );
  });
});

describe("unwrapMarkdownArtifacts", () => {
  const doc = `# Mietvertrag\n\n${"Ein Absatz mit Inhalt. ".repeat(15)}`;

  it("renders a whole-document markdown fence as the document, not as code", () => {
    // The reported bug: the reply is a document, so a code block is what the
    // user sees - and dismissing the save card leaves them with raw markup.
    const out = unwrapMarkdownArtifacts("Hier ist der Entwurf:\n\n```markdown\n" + doc + "\n```");
    expect(out).not.toContain("```");
    expect(out).toContain("# Mietvertrag");
    expect(out.startsWith("Hier ist der Entwurf:")).toBe(true);
  });

  it("leaves a short ```markdown snippet as a code block", () => {
    // Someone demonstrating syntax must still see the syntax.
    const snippet = "```markdown\n# So schreibt man eine Überschrift\n```";
    expect(unwrapMarkdownArtifacts(snippet)).toBe(snippet);
  });

  it("never touches html or other languages", () => {
    const html = "```html\n<html><body>" + "x".repeat(300) + "</body></html>\n```";
    expect(unwrapMarkdownArtifacts(html)).toBe(html);
    const code = "```python\n" + "print('hi')\n".repeat(40) + "```";
    expect(unwrapMarkdownArtifacts(code)).toBe(code);
  });

  it("unwraps a still-open fence so a streaming document doesn't snap at the end", () => {
    // Mid-stream the closing ``` hasn't arrived; without this the whole answer
    // renders as code until the last token.
    const partial = "Einen Moment:\n\n```markdown\n" + doc;
    const out = unwrapMarkdownArtifacts(partial);
    expect(out).not.toContain("```");
    expect(out).toContain("# Mietvertrag");
  });

  it("leaves a just-opened short fence alone (nothing to unwrap yet)", () => {
    const partial = "```markdown\n# Titel";
    expect(unwrapMarkdownArtifacts(partial)).toBe(partial);
  });

  it("keeps surrounding prose and handles several fences", () => {
    const out = unwrapMarkdownArtifacts(
      "Vorher\n\n```markdown\n" +
        doc +
        "\n```\n\nZwischentext\n\n```md\n" +
        doc +
        "\n```\n\nNachher",
    );
    expect(out).toContain("Vorher");
    expect(out).toContain("Zwischentext");
    expect(out).toContain("Nachher");
    expect(out).not.toContain("```");
  });

  it("is a no-op on empty or fence-free text", () => {
    expect(unwrapMarkdownArtifacts("")).toBe("");
    expect(unwrapMarkdownArtifacts("Nur normaler Text.")).toBe("Nur normaler Text.");
  });
});

describe("a document that itself contains fenced blocks", () => {
  // The report: a long generated document was "cut off from 4.1", and the rest
  // rendered as mangled prose instead of a diagram. One cause for both - the
  // fence regex was non-greedy, so a ```markdown document closed at the first
  // inner fence, i.e. exactly where the diagram began.
  const doc = [
    "````markdown",
    "# Reference Architecture",
    "",
    "## 3.8 Anti-Requirements",
    "",
    "- No parallel system of record for requirements.",
    "- No knowledge base without a named, funded owner.",
    "",
    "## 4. Vendor-Agnostic Reference Architecture",
    "",
    "### 4.1 Layered Overview",
    "",
    "```",
    "┌────────────────────────┐",
    "│  CONSUMPTION SURFACES  │",
    "└────────────────────────┘",
    "```",
    "",
    "### 4.2 Everything after the diagram must survive",
    "",
    "Filler so the body clears the artifact minimum. ".repeat(6),
    "````",
  ].join("\n");

  it("keeps the whole document, diagram and all", () => {
    const [a] = detectArtifacts(doc);
    expect(a).toBeDefined();
    expect(a.type).toBe("markdown");
    // The old regex stopped here; these are the assertions that failed.
    expect(a.content).toContain("CONSUMPTION SURFACES");
    expect(a.content).toContain("4.2 Everything after the diagram must survive");
    // And the inner fence is preserved, so it still renders as a code block.
    expect(a.content).toContain("```");
  });

  it("unwraps the outer fence without swallowing the inner one", () => {
    const out = unwrapMarkdownArtifacts(doc);
    expect(out.startsWith("````")).toBe(false); // outer fence gone
    expect(out).toContain("```\n┌"); // inner fence intact -> stays a code block
    expect(out).toContain("4.2 Everything after the diagram must survive");
  });

  it("still treats a plain 3-backtick document as one artifact", () => {
    const simple = ["```markdown", "# Title", "x".repeat(300), "```"].join("\n");
    const [a] = detectArtifacts(simple);
    expect(a?.title).toBe("Title");
  });
});
