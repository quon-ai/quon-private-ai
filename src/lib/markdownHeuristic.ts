/** Decide whether a user-authored text should be rendered as Markdown.
 *
 *  Memory items are free text: some are pasted model answers or Obsidian notes
 *  (real Markdown), most are one-liners or plain notes where Markdown semantics
 *  would *hurt* - a single newline separates lines the user typed, but Markdown
 *  joins them into one paragraph. So plain text keeps whitespace-pre-wrap and
 *  only texts with actual Markdown syntax go through the renderer.
 */
export function looksLikeMarkdown(text: string): boolean {
  return (
    /(\*\*|__)[^\s]/.test(text) || // bold
    /^#{1,4}\s/m.test(text) || // headings
    /^\s*[-*+]\s+\S/m.test(text) || // bullet list
    /^\s*\d+\.\s+\S/m.test(text) || // ordered list
    /`[^`]+`/.test(text) || // inline code
    /\[.+\]\(.+\)/.test(text) || // link
    /^>\s/m.test(text) || // blockquote
    /^\|.+\|/m.test(text) // table row
  );
}
