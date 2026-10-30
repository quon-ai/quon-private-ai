/**
 * Pure text helpers for rendering assistant Markdown. Kept out of the component
 * so they can be unit-tested without a DOM.
 */

import { QUON_API_URL } from "./quonApi";

/** `<br>`, `<br/>`, `<br />` — case-insensitive. */
const BR_RE = /<br\s*\/?>/gi;

/**
 * Split a text run on literal `<br>` tags.
 *
 * Models write `<br>` inside GFM table cells all the time, because a real
 * newline would end the row — there is no Markdown alternative there. Since
 * react-markdown does not render raw HTML (deliberately: model output must
 * never become live markup), those tags showed up verbatim in the answer.
 *
 * Returning the plain segments lets the renderer join them with real `<br />`
 * ELEMENTS it creates itself. No HTML is ever parsed, so this cannot become an
 * injection path — the only tag that can result is a line break.
 */
export function splitOnHtmlBreaks(text: string): string[] {
  return text.split(BR_RE);
}

/**
 * Rewrite an image URL from a model's answer so the browser fetches it from
 * QUON instead of the origin.
 *
 * Two reasons. Privacy: loading `![…](https://shop.example/x.jpg)` directly
 * tells that host the user's IP and that this person is reading about them —
 * the same leak the sources strip avoids. Function: the app's CSP is
 * `img-src 'self' data: blob:`, so a remote URL is BLOCKED and the user just
 * sees a broken-image icon (reported).
 *
 * Returns null for anything that isn't a proxyable image reference, so the
 * caller can render nothing rather than a broken picture.
 */
export function proxiedImageSrc(src: string | undefined): string | null {
  const raw = (src ?? "").trim();
  if (!raw) return null;
  // Inline data URIs are already local and allowed by the CSP.
  if (/^data:image\//i.test(raw)) return raw;
  if (!/^https?:\/\//i.test(raw)) return null;
  return `${QUON_API_URL}/link-image?url=${encodeURIComponent(raw)}`;
}

/**
 * Does this answer carry TeX the renderer should typeset? Models write
 * `$\rightarrow$`, `$x^2$`, `\( … \)`, `$$ … $$` — and the plain renderer used
 * to print all of it verbatim ("$\rightarrow$" in the middle of a sentence,
 * reported 2026-09-01). The check is deliberately stricter than remark-math's
 * own single-dollar rule: an inline pair only counts when its body looks like
 * TeX (a backslash command, `^`, `_`, `{`), so "$5 and $10" in prose does not
 * flip a whole message into math mode. Gates the LAZY KaTeX chunk — a message
 * with no math never pays for it.
 */
export function hasMath(text: string): boolean {
  if (!text.includes("$") && !text.includes("\\(") && !text.includes("\\[")) return false;
  if (/\$\$[\s\S]+?\$\$/.test(text) || /\\\(|\\\[/.test(text)) return true;
  return /\$(?!\s)[^$\n]*[\\^_{][^$\n]*(?<!\s)\$/.test(text);
}
