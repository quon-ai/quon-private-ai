/**
 * Sanitizer for HTML injected into the document viewer: mammoth's DOCX → HTML
 * output AND the original bytes of uploaded .html documents. mammoth only
 * *generates* markup (it doesn't pass raw XML through), so its output is
 * safe-ish — but uploaded HTML is fully attacker-controlled and the viewer
 * renders with dangerouslySetInnerHTML, so we are deliberate: allowlist known
 * content tags, drop everything else, and keep only the handful of attributes
 * the layout needs. Fail-closed: an unknown element is removed, not unwrapped.
 */

/** Tags mammoth's default style map emits (headings, paragraphs, inline marks,
 *  lists, tables, images, links), plus the passive structural/inline tags real
 *  HTML documents wrap content in (div/span/section/…) — without those,
 *  fail-closed removal would empty most uploaded pages. Nothing here can run
 *  script or trigger a request by itself (attributes are stripped separately).
 *  Anything outside this set is dropped. */
const ALLOWED_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "s",
  "sub",
  "sup",
  "br",
  "hr",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "caption",
  "colgroup",
  "col",
  "a",
  "img",
  "blockquote",
  "pre",
  "code",
  // Structural / inline containers common in uploaded HTML docs:
  "div",
  "span",
  "section",
  "article",
  "main",
  "header",
  "footer",
  "aside",
  "nav",
  "figure",
  "figcaption",
  "dl",
  "dt",
  "dd",
  "small",
  "mark",
  "del",
  "ins",
  "abbr",
  "cite",
  "q",
  "time",
]);

/** Per-tag attribute allowlist (lowercase). Everything else — style, class,
 *  on* handlers — is stripped. */
const ALLOWED_ATTRS: Record<string, readonly string[]> = {
  a: ["href", "id"], // id: mammoth emits <a id> anchors for bookmarks
  img: ["src", "alt"],
  th: ["colspan", "rowspan"],
  td: ["colspan", "rowspan"],
  col: ["span"],
  ol: ["start"],
};

/** URL policy for the two attributes that can trigger a request or navigation.
 *  Images must be the data: URIs mammoth inlines (a remote src would both leak
 *  the viewer's IP and violate the CSP); links may only point at the web or a
 *  bookmark — never javascript:/data:/blob: etc. */
export function isSafeDocxUrl(value: string, attr: "href" | "src"): boolean {
  const v = value.trim().toLowerCase();
  if (attr === "src") return v.startsWith("data:image/");
  return (
    v.startsWith("https://") ||
    v.startsWith("http://") ||
    v.startsWith("mailto:") ||
    v.startsWith("#")
  );
}

/** Sanitize viewer HTML (mammoth output or an uploaded .html original) for
 *  rendering. Browser-only (DOMParser); without one it returns "" and the
 *  viewer falls back to the extracted-text view. */
export function sanitizeDocxHtml(html: string): string {
  if (typeof DOMParser === "undefined") return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  sanitizeChildren(doc.body);
  return doc.body.innerHTML;
}

function sanitizeChildren(parent: Element): void {
  for (const el of [...parent.children]) {
    const tag = el.tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      el.remove();
      continue;
    }
    const allowed = ALLOWED_ATTRS[tag] ?? [];
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (!allowed.includes(name)) {
        el.removeAttribute(attr.name);
        continue;
      }
      if ((name === "href" || name === "src") && !isSafeDocxUrl(attr.value, name)) {
        el.removeAttribute(attr.name);
      }
    }
    // External links leave the app in a new tab, without a referrer.
    if (tag === "a" && el.getAttribute("href")?.startsWith("http")) {
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noreferrer noopener");
    }
    sanitizeChildren(el);
  }
}
