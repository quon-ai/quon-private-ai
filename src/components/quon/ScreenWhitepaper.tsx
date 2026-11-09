/**
 * The published detection whitepaper (/docs/detection-whitepaper): the
 * decision-paper view of how the privacy filter's architecture was chosen and
 * evidenced. The page renders docs/detection-whitepaper.md verbatim - the
 * markdown file is the single source, bundled at build time, so the website
 * and the repository cannot drift apart.
 *
 * English-only by design (the document is English); the plain-language
 * bilingual companion for end users is /docs/detection. Standalone shell like
 * the other public pages - not inside AppShell.
 */
import { Link } from "@tanstack/react-router";

import whitepaperRaw from "../../../docs/detection-whitepaper.md?raw";
import { translate } from "@/lib/i18n/i18n";

import { LegalLinks } from "./LegalPage";
import { Markdown } from "./Markdown";

// react-markdown renders raw HTML as literal text (no rehype-raw on purpose),
// so the file's leading source-note comment must not reach the renderer.
const whitepaper = whitepaperRaw.replace(/^<!--[\s\S]*?-->\s*/, "");

const GRADIENT =
  "radial-gradient(ellipse at top, oklch(0.22 0.05 277 / 0.6), transparent 60%), radial-gradient(ellipse at bottom, oklch(0.2 0.04 200 / 0.4), transparent 60%), var(--quon-bg)";

/** Document typography on top of the chat-sized Markdown renderer: a reading
 *  column, larger headings with real section spacing, and roomier tables.
 *  Wrapper-level arbitrary variants outrank the renderer's own spacing
 *  classes (compound selector), so the renderer stays untouched for chat. */
const DOC_TYPE =
  "[&_h1]:text-2xl [&_h1]:sm:text-[28px] [&_h1]:leading-tight " +
  "[&_h2]:text-xl [&_h2]:mt-9 [&_h2]:mb-2.5 " +
  "[&_h3]:text-base [&_h3]:mt-7 [&_h3]:mb-2 " +
  "[&_h4]:text-[15px] [&_h4]:mt-5 [&_h4]:mb-2 [&_h4]:font-semibold " +
  "[&_p]:mb-3.5 [&_p]:leading-relaxed [&_li]:leading-relaxed [&_ul]:mb-3.5 [&_ol]:mb-3.5 " +
  "[&_blockquote]:my-4 [&_blockquote]:border-quon-indigo [&_blockquote]:py-1 [&_blockquote]:pl-3 " +
  "[&_table]:my-2 [&_th]:px-2.5 [&_th]:py-1.5 [&_td]:px-2.5 [&_td]:py-1.5";

export function ScreenWhitepaper() {
  return (
    <div className="min-h-screen px-4 py-10" style={{ background: GRADIENT }} lang="en">
      <div className="mx-auto w-full max-w-3xl rounded-2xl border border-quon-border bg-quon-bg/80 px-6 py-8 shadow-2xl sm:px-10">
        <div className="flex items-start justify-between gap-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-quon-indigo">
            QUON · Docs
          </p>
          <Link
            to="/docs/detection"
            className="text-xs font-semibold text-quon-muted underline-offset-2 hover:text-quon-text hover:underline"
          >
            {translate("en", "evaluation.backToOverview")}
          </Link>
        </div>

        <article className={`mt-6 text-sm text-quon-text ${DOC_TYPE}`}>
          <Markdown>{whitepaper}</Markdown>
        </article>

        <LegalLinks className="mt-10" lang="en" />
      </div>
    </div>
  );
}
