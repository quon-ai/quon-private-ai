/**
 * Detect saveable "artifacts" in an assistant reply - a complete standalone
 * Markdown document or HTML page the model produced, which the user can file
 * into their (zero-knowledge) Documents. Pure + unit-tested; no DOM.
 *
 * Heuristic: a fenced code block tagged ```markdown|md or ```html|htm whose
 * body is substantial (a real document, not a two-line snippet). We stay
 * conservative - a false positive just shows an extra "save" card, never
 * loses or alters the chat text.
 */

export type ArtifactType = "markdown" | "html";

export interface Artifact {
  type: ArtifactType;
  /** Best-effort title (H1 / <title> / first line), for the filename + card. */
  title: string;
  /** The raw document/page content (inside the fence). */
  content: string;
}

/** Minimum fenced-body length to treat as a document (chars, whitespace-trimmed).
 *  Below this it's a snippet, not an artifact. */
export const ARTIFACT_MIN_CHARS = 200;

/**
 * A fenced block, CommonMark-style: the closing run must be AT least as long as
 * the opening one (`\1` + more backticks are allowed after it).
 *
 * The length capture is the whole point. With a fixed ``` opener the pattern is
 * non-greedy and therefore closes at the first inner fence - so a generated
 * document that contains a code block (an ASCII diagram, a snippet) is cut off
 * exactly where that block begins, and everything after it falls out of the
 * artifact and gets rendered as prose: a truncated document and a mangled
 * diagram, one cause, both symptoms.
 *
 * A model wrapping such a document must therefore open with four backticks -
 * which the system prompt now asks for (provider.py). With three on both sides
 * the ambiguity is unresolvable in principle: "closing fence" and "inner
 * opening fence" are the same token.
 */
const FENCE_RE = /(`{3,})(\w+)[ \t]*\r?\n([\s\S]*?)\r?\n?\1`*[ \t]*(?=\r?\n|$)/g;

const LANG_TO_TYPE: Record<string, ArtifactType> = {
  markdown: "markdown",
  md: "markdown",
  html: "html",
  htm: "html",
  xhtml: "html",
};

function htmlTitle(html: string): string | null {
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  if (t && t.trim()) return decodeEntities(t.trim());
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  if (h1) {
    const text = h1.replace(/<[^>]+>/g, "").trim();
    if (text) return decodeEntities(text);
  }
  return null;
}

function markdownTitle(md: string): string | null {
  for (const line of md.split(/\r?\n/)) {
    const h = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line.trim());
    if (h) return h[1].trim();
    if (line.trim()) break; // first non-empty line isn't a heading -> give up on H1
  }
  const first = md.split(/\r?\n/).find((l) => l.trim());
  return first ? first.trim().slice(0, 80) : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Extract all artifacts from an assistant reply, in document order. */
export function detectArtifacts(text: string): Artifact[] {
  if (!text) return [];
  const out: Artifact[] = [];
  for (const m of text.matchAll(FENCE_RE)) {
    const type = LANG_TO_TYPE[m[2].toLowerCase()];
    if (!type) continue;
    const content = m[3].trim();
    if (content.length < ARTIFACT_MIN_CHARS) continue;
    // An HTML block that is clearly just a fragment (no tags at all) isn't a page.
    if (type === "html" && !/<[a-z!][\s\S]*>/i.test(content)) continue;
    const title =
      (type === "html" ? htmlTitle(content) : markdownTitle(content)) ??
      (type === "html" ? "HTML" : "Markdown");
    out.push({ type, title, content });
  }
  return out;
}

/**
 * Show the DOCUMENT, not its source.
 *
 * The system prompt asks the model to wrap a standalone document in a single
 * ```markdown fence so we can offer to save it. Markdown then renders that
 * fence as a CODE BLOCK - technically correct, but it means a reply that is one
 * long document reads as raw markup, and stays that way if the user dismisses
 * the save card. This unwraps exactly those fences before rendering.
 *
 * Conservative on purpose:
 * - only `markdown`/`md` fences, and only ones long enough to qualify as an
 *   artifact (`ARTIFACT_MIN_CHARS`) - a short ```markdown snippet demonstrating
 *   syntax stays a code block, as it should;
 * - `html` and every other language are untouched (their code block is honest,
 *   and the artifact card renders its own sanitized preview);
 * - while a reply is still streaming the closing fence hasn't arrived yet, so a
 *   trailing UNCLOSED opener is unwrapped too - otherwise the document would
 *   render as code for the whole answer and snap at the very end.
 */
export function unwrapMarkdownArtifacts(text: string): string {
  if (!text) return text;
  let out = text.replace(FENCE_RE, (whole, _ticks: string, lang: string, body: string) => {
    if (LANG_TO_TYPE[lang.toLowerCase()] !== "markdown") return whole;
    return body.trim().length >= ARTIFACT_MIN_CHARS ? body : whole;
  });

  // Streaming tail: an opener with no closing fence after it.
  const opener = /(`{3,})(markdown|md)[ \t]*\r?\n/gi;
  let lastOpen: RegExpExecArray | null = null;
  for (let m = opener.exec(out); m; m = opener.exec(out)) lastOpen = m;
  if (lastOpen) {
    const bodyStart = lastOpen.index + lastOpen[0].length;
    const rest = out.slice(bodyStart);
    // "Still open" means no fence at least as long as the opener. A SHORTER
    // inner fence (the document's own code block) does not close it - that was
    // the streaming-side half of the same bug.
    const closer = new RegExp(`^[ \t]*\`{${lastOpen[1].length},}`, "m");
    if (!closer.test(rest) && rest.trim().length >= ARTIFACT_MIN_CHARS) {
      out = out.slice(0, lastOpen.index) + rest;
    }
  }
  return out;
}

/** A filesystem-safe filename for a saved artifact (title + extension). */
export function artifactFilename(a: Artifact): string {
  const ext = a.type === "html" ? "html" : "md";
  const base =
    a.title
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || (a.type === "html" ? "artifact" : "artifact");
  return `${base}.${ext}`;
}
