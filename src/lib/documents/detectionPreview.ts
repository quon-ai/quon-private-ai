/**
 * Detection preview for the document viewer (feedback #55).
 *
 * "Ich habe nicht das ganze Dok im Kopf und kann [nicht] sagen, ob er alles
 * erwischt hat" — a LIST of detections cannot prove completeness; only the
 * document itself can, with every hit marked IN PLACE. This module runs the
 * exact same filter the send path uses (scrubLarge → the user's policy:
 * always/never lists, disabled types) and hands back the detected VALUES, plus
 * the DOM/text machinery to paint them into any rendered view.
 *
 * Honesty note: the preview sends the document text through the same scrub
 * request a send would — nothing new leaves the device that sending would not
 * also send, and nothing is stored. The point is to SEE the result before
 * trusting it.
 */

import { getQuonState } from "@/lib/quonStore";
import { scrubLarge } from "@/lib/scrubChunked";

import { joinPdfItems, pageNeedsOcr } from "./pageText";

export interface DetectionHit {
  value: string;
  type: string;
}

/** The document viewer's detection-preview state machine (DocumentViewer.tsx's
 *  `detect`). Exported so the pure transition below is unit-testable and the
 *  component stays a thin wrapper over it. */
export type DetectState =
  | null
  | {
      status: "running";
      done: number;
      total: number;
      /** performance.now() when the scan started / when `done` last changed.
       *  Both are needed by scrubProgressEta: the raw (done,total) ticks once
       *  per 8000-char piece, which at ~2.0s per 1000 chars is ~16s apart, so a
       *  bar driven by it alone sits frozen and reads as hung. */
      startedAt: number;
      updatedAt: number;
    }
  | { status: "done"; hits: DetectionHit[] }
  | { status: "failed" };

/** Run the user's current filter policy over the full text. Returns unique
 *  (value, type) hits, longest value first — the order matters for
 *  highlighting, so "Anna Müller-Lüdenscheidt" wins over a contained "Anna". */
export async function runDetectionPreview(
  text: string,
  onProgress?: (done: number, total: number) => void,
): Promise<DetectionHit[]> {
  const { alwaysRedact, neverRedact, disabledEntityTypes } = getQuonState();
  const result = await scrubLarge(
    text,
    {
      placeholder_style: "indexed",
      always_redact: alwaysRedact,
      never_redact: neverRedact,
      disabled_types: disabledEntityTypes,
    },
    onProgress,
  );
  const seen = new Map<string, DetectionHit>();
  for (const e of result.entities) {
    const key = `${e.type}\0${e.value.toLowerCase()}`;
    if (!seen.has(key) && e.value.trim().length > 0) {
      seen.set(key, { value: e.value, type: e.type });
    }
  }
  return [...seen.values()].sort((a, b) => b.value.length - a.value.length);
}

/**
 * Fold a hand-redacted term (from the Text view's "Immer schwärzen" action)
 * into the detection-preview state, so it paints in place immediately — a list
 * cannot prove it, only the document itself can (feedback #55's whole point,
 * now true for manual redactions too).
 *
 * `null`/`failed` (detection off or errored) and `running` (a scan mid-flight;
 * folding into a stale hit list would be overwritten when it lands, so start
 * fresh instead) both become a fresh `done` state carrying just this hit —
 * "turn the marks on with just that hit". An existing `done` state appends,
 * de-duplicated by (type, case-insensitive value) since the same term selected
 * twice must not double up, and keeps the longest-value-first order
 * `runDetectionPreview` establishes (so a short hit never shadows one that
 * contains it).
 */
export function injectManualHit(state: DetectState, hit: DetectionHit): DetectState {
  if (state?.status !== "done") return { status: "done", hits: [hit] };
  const exists = state.hits.some(
    (h) => h.type === hit.type && h.value.toLowerCase() === hit.value.toLowerCase(),
  );
  if (exists) return state;
  const hits = [...state.hits, hit].sort((a, b) => b.value.length - a.value.length);
  return { status: "done", hits };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A "word" character for boundary purposes — UNICODE, not ASCII.
 *
 *  JavaScript's `\b` and `\w` are ASCII-only, so `\bMüller\b` still matches
 *  inside "Grüße-Müller" and every German name with an umlaut is mishandled.
 *  The backend's find_spans uses Python's `re.UNICODE` `\w`; this is the
 *  equivalent, and it needs the `u` flag on the compiled regex. */
const WORD_CHAR = "[\\p{L}\\p{N}_]";

/** One alternative, boundary-guarded exactly the way the BACKEND guards it.
 *
 *  Boundaries apply only where the value itself begins/ends with a word
 *  character, so "+49 30 123" and "a@b.de" still match at their punctuation
 *  edges while a short value cannot match inside a longer word. Without this a
 *  single two-letter detection repaints half the document: measured on a real
 *  financial report, the value "Re" produced NINE highlights — Rechnungs-
 *  methodik, Erreichen, Altersgrenze, Jahren, Reale, bereinigt … — where the
 *  backend produced zero. The redaction was right; only the PREVIEW was wrong,
 *  which is worse than it sounds, because the preview is the entire reason the
 *  user trusts the redaction. */
function boundedAlternative(value: string): string {
  const startsWord = new RegExp(`^${WORD_CHAR}`, "u").test(value);
  const endsWord = new RegExp(`${WORD_CHAR}$`, "u").test(value);
  return (
    (startsWord ? `(?<!${WORD_CHAR})` : "") +
    escapeRegExp(value) +
    (endsWord ? `(?!${WORD_CHAR})` : "")
  );
}

/** One regex over all hit values (alternation, longest-first so contained
 *  values never shadow their container), case-insensitive — matching the
 *  backend's own case-insensitive always-redact semantics. */
/** Drop a dismissed value from whatever the preview is currently showing.
 *
 *  The mirror of injectManualHit. Value-keyed and case-insensitive, exactly
 *  like the detection it undoes: one false positive is redacted in every place
 *  it occurs, so one dismissal must clear every place it occurs. States other
 *  than "done" have nothing to fold into and pass through unchanged. */
export function dismissHit(state: DetectState, value: string): DetectState {
  if (state?.status !== "done") return state;
  const drop = value.trim().toLowerCase();
  if (!drop) return state;
  return { status: "done", hits: state.hits.filter((h) => h.value.trim().toLowerCase() !== drop) };
}

/** Add a value to the device's never-redact list, without duplicates.
 *  Pure so the dedupe rule is testable and cannot drift from the UI. */
export function withNeverRedacted(list: string[], value: string): string[] {
  const v = value.trim();
  if (!v) return list;
  const seen = new Set(list.map((x) => x.trim().toLowerCase()));
  return seen.has(v.toLowerCase()) ? list : [...list, v];
}

export function buildHighlightRegex(hits: DetectionHit[]): RegExp | null {
  const parts = hits
    .map((h) => h.value)
    .filter((v) => v.length > 0)
    .map(boundedAlternative);
  if (!parts.length) return null;
  try {
    return new RegExp(`(${parts.join("|")})`, "giu");
  } catch {
    // A value that will not compile under `u` must not blank the whole preview
    // — fall back to the unguarded form, which over-highlights but still shows
    // the user every real hit. Same fail-open shape as the backend's find_spans.
    try {
      return new RegExp(`(${hits.map((h) => escapeRegExp(h.value)).join("|")})`, "gi");
    } catch {
      return null;
    }
  }
}

/** Type lookup for a matched string (case-insensitive). */
export function typeOfMatch(hits: DetectionHit[], matched: string): string {
  const low = matched.toLowerCase();
  return hits.find((h) => h.value.toLowerCase() === low)?.type ?? "PII";
}

/**
 * Split plain text into alternating keep/highlight segments — the pure core
 * the React text view renders from, and the unit under test.
 */
export function segmentText(
  text: string,
  hits: DetectionHit[],
): Array<{ text: string; type: string | null }> {
  const re = buildHighlightRegex(hits);
  if (!re) return [{ text, type: null }];
  const out: Array<{ text: string; type: string | null }> = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: text.slice(last, i), type: null });
    out.push({ text: m[0], type: typeOfMatch(hits, m[0]) });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), type: null });
  return out;
}

/**
 * Wrap every hit inside an already-rendered DOM subtree in a highlight <mark>.
 * Used for the DOCX/HTML/Markdown original views: they render sanitized HTML,
 * so highlighting must happen on TEXT NODES after render — string-level
 * replacement on the HTML would risk matching inside attributes or tags.
 * Idempotent per call site (callers re-render from source before re-applying).
 */
export function highlightDomText(root: HTMLElement, hits: DetectionHit[]): number {
  const re = buildHighlightRegex(hits);
  if (!re) return 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      // Never descend into our own marks (idempotence) — or scripts/styles,
      // which the sanitizer forbids anyway (belt and braces).
      node.parentElement?.closest("mark[data-quon-hit], script, style")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  const textNodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) textNodes.push(n as Text);

  let count = 0;
  for (const node of textNodes) {
    const value = node.nodeValue ?? "";
    const segments = segmentText(value, hits);
    if (segments.length === 1 && segments[0].type === null) continue;
    const frag = document.createDocumentFragment();
    for (const seg of segments) {
      if (seg.type === null) {
        frag.appendChild(document.createTextNode(seg.text));
      } else {
        const mark = document.createElement("mark");
        mark.setAttribute("data-quon-hit", seg.type);
        mark.textContent = seg.text;
        count++;
        frag.appendChild(mark);
      }
    }
    node.parentNode?.replaceChild(frag, node);
  }
  return count;
}

/**
 * Can detection marks be placed on this page at all?
 *
 * A PDF page whose text layer is too thin is a SCAN: its text exists only
 * because OCR produced it, and OCR positions are discarded during extraction, so
 * there is nowhere to put a rect. Distinguishing this from "the filter found
 * nothing here" is the whole point — conflating them made a scanned document
 * render a clean, unmarked page in Original view while Text view showed every
 * hit, with nothing telling the user why.
 *
 * ⚠️ Uses the SAME threshold that decided the text came from OCR in the first
 * place (`pageNeedsOcr`). A naive "does any text item exist?" test is wrong: a
 * scan carrying a header stamp or a page number would pass it, and the page would
 * again render clean with no explanation.
 */
export function hasPlaceableText(items: Array<{ str?: unknown }>): boolean {
  return !pageNeedsOcr(joinPdfItems(items));
}
