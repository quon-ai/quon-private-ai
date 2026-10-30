/**
 * Markdown renderer for assistant chat answers.
 *
 * Models reply in Markdown (`**bold**`, `## headings`, lists, code, tables …);
 * this renders it with compact, chat-friendly styling instead of showing the
 * raw syntax. Safe by default — react-markdown does not render raw HTML.
 *
 * Code fences get one extra pass: a mermaid diagram (explicitly fenced, OR
 * sniffed from an untagged block — models routinely omit the tag, which is how
 * an `erDiagram` ended up displayed as plain text, reported 2026-08-10) renders
 * as a diagram instead. mermaid itself is imported lazily, only when a diagram
 * is really shown; see lib/mermaid.ts.
 */

import { Children, cloneElement, isValidElement, lazy, Suspense, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { hasMath, proxiedImageSrc, splitOnHtmlBreaks } from "@/lib/markdownText";
import { extractTable } from "@/lib/markdownTable";
import { looksLikeMermaid } from "@/lib/mermaid";
import { MermaidBlock } from "./MermaidBlock";

// KaTeX only ever loads for an answer that actually contains TeX — see
// MarkdownMath.tsx and `hasMath`.
const MarkdownMath = lazy(() => import("./MarkdownMath"));

/**
 * Turn literal `<br>` text into real line breaks, recursively.
 *
 * Raw HTML stays unparsed (react-markdown's safe default — model output must
 * never become live markup); this only ever CREATES `<br />` elements from text
 * it split itself, so no other tag can result. Recursion matters because the
 * tag usually sits next to inline formatting, e.g. `**Label**<br>Fließtext`,
 * where the text run is a child of `<strong>`'s sibling rather than of the cell.
 */
function withLineBreaks(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === "string") {
      const parts = splitOnHtmlBreaks(child);
      if (parts.length === 1) return child;
      return parts.map((part, i) => (
        <span key={i}>
          {i > 0 && <br />}
          {part}
        </span>
      ));
    }
    if (isValidElement<{ children?: ReactNode }>(child) && child.props.children) {
      return cloneElement(child, { children: withLineBreaks(child.props.children) });
    }
    return child;
  });
}

/**
 * A model's comparison table is unreadable on a phone as a table: three columns
 * of prose in ~390 px means either a sideways scroll (reported) or columns
 * squeezed to two words. So the same content gets two layouts.
 *
 * Wide (≥ sm): the ordinary table.
 * Narrow: one card per ROW — first cell as the card's title, the rest as
 * labelled values. That matches how models build these tables (first column =
 * the attribute, remaining columns = the things compared), so a card reads
 * "Optischer Eindruck / SNT: … / Labfresh: …".
 *
 * A CSS breakpoint rather than a matchMedia hook, so it is SSR-safe and cannot
 * flash the wrong layout. Both trees exist in the DOM; the tables are small,
 * and identical proxied image URLs are served from cache the second time.
 */
function ResponsiveTable({ children }: { children?: ReactNode }) {
  const extracted = extractTable(children);
  const table = (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  );
  // Unrecognised shape → the plain table is the honest fallback.
  if (!extracted) return <div className="mb-2 last:mb-0">{table}</div>;

  const { headers, rows } = extracted;
  return (
    <div className="mb-2 last:mb-0">
      <div className="hidden sm:block">{table}</div>
      <div className="space-y-2 sm:hidden">
        {rows.map((cells, r) => (
          <div key={r} className="rounded-lg border border-quon-border bg-quon-surface-2 p-2">
            <div className="mb-1.5 text-xs font-semibold text-quon-text">
              {withLineBreaks(cells[0])}
            </div>
            <div className="space-y-1.5">
              {cells.slice(1).map((cell, c) => (
                <div key={c}>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-quon-muted">
                    {withLineBreaks(headers[c + 1])}
                  </div>
                  <div className="text-xs">{withLineBreaks(cell)}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className="mt-2 mb-1 text-base font-semibold first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-2 mb-1 text-[15px] font-semibold first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => <h3 className="mt-2 mb-1 text-sm font-semibold first:mt-0">{children}</h3>,
  p: ({ children }) => <p className="mb-2 last:mb-0">{withLineBreaks(children)}</p>,
  ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-0.5 last:mb-0">{children}</ul>,
  ol: ({ children }) => (
    <ol className="mb-2 ml-4 list-decimal space-y-0.5 last:mb-0">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-snug">{withLineBreaks(children)}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="underline">
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="rounded bg-quon-surface-2 px-1 py-0.5 text-[0.85em]">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="mb-2 overflow-x-auto rounded-lg bg-quon-surface-2 p-2 text-[0.85em] last:mb-0">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-quon-border pl-2 text-quon-muted last:mb-0">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-2 border-quon-border" />,
  table: ({ children }) => <ResponsiveTable>{children}</ResponsiveTable>,
  th: ({ children }) => (
    <th className="border border-quon-border px-2 py-1 text-left font-semibold">
      {withLineBreaks(children)}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-quon-border px-2 py-1">{withLineBreaks(children)}</td>
  ),
  // Images from a model answer are re-served by QUON (see proxiedImageSrc):
  // the app's CSP blocks remote hosts outright, and loading them directly would
  // tell each host who is reading about it. Anything unproxyable renders as
  // nothing rather than a broken-image icon.
  img: ({ src, alt }) => {
    const proxied = proxiedImageSrc(typeof src === "string" ? src : undefined);
    if (!proxied) return null;
    return (
      <img
        src={proxied}
        alt={typeof alt === "string" ? alt : ""}
        loading="lazy"
        className="my-1 max-h-64 max-w-full rounded-lg border border-quon-border object-contain"
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />
    );
  },
};

/** Pull the raw source + language out of the <code> child react-markdown puts
 *  inside a <pre>, so a fenced block can be inspected before rendering. */
function readCodeChild(children: ReactNode): { code: string; language?: string } | null {
  const only = Children.toArray(children)[0];
  if (!isValidElement<{ className?: string; children?: ReactNode }>(only)) return null;
  const raw = only.props.children;
  const code = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.join("") : null;
  if (code === null) return null;
  const match = /language-([\w-]+)/.exec(only.props.className ?? "");
  return { code: code.replace(/\n$/, ""), language: match?.[1] };
}

export function Markdown({
  children,
  streaming = false,
}: {
  children: string;
  /** True while the answer is still arriving: a half-written diagram can't
   *  parse, so mermaid rendering waits for the end (MermaidBlock). */
  streaming?: boolean;
}) {
  const withMermaid: Components = {
    ...components,
    pre: ({ children: preChildren }) => {
      const block = readCodeChild(preChildren);
      if (block && looksLikeMermaid(block.code, block.language)) {
        return <MermaidBlock code={block.code} streaming={streaming} />;
      }
      return (
        <pre className="mb-2 overflow-x-auto rounded-lg bg-quon-surface-2 p-2 text-[0.85em] last:mb-0">
          {preChildren}
        </pre>
      );
    },
  };
  const plain = (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={withMermaid}>
      {children}
    </ReactMarkdown>
  );
  return (
    <div className="[overflow-wrap:anywhere] break-words">
      {hasMath(children) ? (
        // The plain render is the fallback, so while the chunk loads the text is
        // already on screen (raw `$…$` for a moment), never a blank bubble.
        <Suspense fallback={plain}>
          <MarkdownMath components={withMermaid}>{children}</MarkdownMath>
        </Suspense>
      ) : (
        plain
      )}
    </div>
  );
}
