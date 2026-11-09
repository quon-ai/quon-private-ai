/**
 * The Markdown renderer with math (remark-math + KaTeX). Split from Markdown.tsx
 * on purpose: KaTeX is ~300 KB plus fonts, and most answers contain no TeX, so
 * this module is `lazy()`-loaded only for a message `hasMath()` says needs it.
 * The KaTeX stylesheet is bundled by Vite and served from our own origin, and
 * its inline `style=` attributes are covered by the existing `style-src
 * 'unsafe-inline'` - no CSP change.
 *
 * `throwOnError: false` + `strict: "ignore"`: a model's half-valid TeX renders
 * as best it can (in red, KaTeX's own convention) instead of crashing the
 * bubble; a chat answer is not a paper.
 */
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";

export default function MarkdownMath({
  children,
  components,
}: {
  children: string;
  components: Components;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: "ignore", output: "html" }]]}
      components={components}
    >
      {children}
    </ReactMarkdown>
  );
}
