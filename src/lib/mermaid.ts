/**
 * Mermaid diagram detection + lazy rendering.
 *
 * Why lazy, always: mermaid is ~500KB gzipped. Loading it for every chat that
 * merely contains a code block would tax the webview memory that gets the
 * native WebContent process killed under pressure - so the import happens on
 * first actual diagram and never before.
 *
 * Why a content sniff and not just the ``` fence: models very often emit a
 * diagram as a bare indented block with no language tag, and then an
 * `erDiagram` renders as plain text. The sniff is therefore the load-bearing
 * path, not a nicety, and it is deliberately conservative: the first non-empty
 * line must start with a known mermaid diagram keyword, so ordinary prose or
 * code never gets mistaken for a diagram.
 */

/** Diagram types mermaid supports that we're willing to auto-detect. Kept as
 *  an explicit list (not a regex over "any word") so a code block starting
 *  with, say, `graphql` or `classDefinition` is never swallowed. */
const MERMAID_KEYWORDS = [
  "erdiagram",
  "sequencediagram",
  "classdiagram",
  "statediagram",
  "statediagram-v2",
  "flowchart",
  "graph",
  "gantt",
  "pie",
  "journey",
  "mindmap",
  "timeline",
  "quadrantchart",
  "gitgraph",
  "c4context",
  "sankey-beta",
  "xychart-beta",
  "block-beta",
  "requirementdiagram",
] as const;

/**
 * Does this code block look like a mermaid diagram?
 *
 * `language` wins when present (an explicit ```mermaid fence is unambiguous).
 * Otherwise the first non-empty line is matched against the keyword list -
 * `graph`/`flowchart` additionally require a direction token (`graph TD`,
 * `flowchart LR`), because a prose line starting with "graph" is otherwise a
 * plausible false positive.
 */
export function looksLikeMermaid(code: string, language?: string): boolean {
  // An EXPLICIT language is authoritative in both directions: ```mermaid is a
  // diagram, and ```python never is - sniffing a tagged block would let a
  // python snippet starting with "graph TD" render as a diagram.
  if (language) return language.toLowerCase() === "mermaid";
  const first = code
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!first) return false;
  const lower = first.toLowerCase();
  const word = lower.split(/[\s:{(]/)[0];
  if (!MERMAID_KEYWORDS.includes(word as (typeof MERMAID_KEYWORDS)[number])) return false;
  // "graph"/"flowchart" need a direction to count - mermaid requires one
  // anyway, and it separates a real diagram from a sentence.
  if (word === "graph" || word === "flowchart") {
    return /^(graph|flowchart)\s+(tb|td|bt|rl|lr)\b/i.test(lower);
  }
  return true;
}

type MermaidApi = {
  initialize: (cfg: Record<string, unknown>) => void;
  render: (id: string, text: string) => Promise<{ svg: string }>;
};

let mermaidPromise: Promise<MermaidApi> | null = null;

/** Load + configure mermaid once. `securityLevel: "strict"` keeps the diagram
 *  from being a script-injection vector: it sanitises labels and refuses
 *  click-handlers, which matters because diagram source is MODEL output and
 *  may quote untrusted document content. */
function getMermaid(): Promise<MermaidApi> {
  mermaidPromise ??= import("mermaid").then((m) => {
    const api = (m.default ?? m) as unknown as MermaidApi;
    api.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "dark",
      fontFamily: "inherit",
      themeVariables: {
        background: "transparent",
        primaryColor: "#1e1b3a",
        primaryTextColor: "#e6e6f0",
        primaryBorderColor: "#4f46e5",
        lineColor: "#8b8ba7",
        secondaryColor: "#2a2745",
        tertiaryColor: "#232135",
      },
    });
    return api;
  });
  return mermaidPromise;
}

let idCounter = 0;

/** Render diagram source to SVG markup. Rejects on a syntax error so the
 *  caller can fall back to showing the source - a broken diagram must never
 *  swallow the content the model wrote. */
export async function renderMermaid(code: string): Promise<string> {
  const api = await getMermaid();
  const { svg } = await api.render(`quon-mermaid-${++idCounter}`, code);
  return svg;
}
