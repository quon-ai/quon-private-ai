/**
 * Full-text search over chat sessions (the sidebar "Search chats" box).
 *
 * Purely lexical and fully client-side: it runs over the already-decrypted
 * in-memory session list from quonStore, so nothing ever leaves the device
 * (zero-knowledge). Deliberately NOT embedding-based — semantic retrieval
 * exists for Memory/Documents (rag.ts); someone searching their chat history
 * wants exact recall of a message they remember, not semantic neighbours.
 *
 * Matching semantics: the query is split into whitespace tokens; each token
 * matches as a case-insensitive substring. ALL tokens must appear in the
 * session title, or together within a SINGLE message ("per-message AND" —
 * precision over recall: "invoice müller" finds the turn about Müller's
 * invoice, not a session that mentions the two words in unrelated turns).
 * Error bubbles are skipped — their text is UI copy, not conversation.
 *
 * Ranking: title matches first, then most-recently-updated.
 */

import type { ChatSession } from "./quonStore";

export interface HighlightRange {
  /** Inclusive start / exclusive end, character offsets into the string. */
  start: number;
  end: number;
}

export interface ChatSearchSnippet {
  messageId: number;
  role: "user" | "assistant";
  /** Short excerpt around the first match ("…" marks truncation). */
  snippet: string;
  /** Match positions within `snippet`, sorted and non-overlapping. */
  highlights: HighlightRange[];
}

export interface ChatSearchHit {
  sessionId: string;
  title: string;
  projectId?: string;
  updatedAt: number;
  /** True when every query token appears in the title (ranks first). */
  titleMatch: boolean;
  /** Match positions within `title` (empty when the title doesn't match). */
  titleHighlights: HighlightRange[];
  /** Up to MAX_SNIPPETS_PER_SESSION matching messages, in conversation order. */
  snippets: ChatSearchSnippet[];
}

/** Context kept before the first match in a snippet, and the total cap. */
const SNIPPET_LEAD = 32;
const SNIPPET_LENGTH = 130;
const MAX_SNIPPETS_PER_SESSION = 3;

/** Split a query into unique, lowercased whitespace tokens. */
export function tokenizeQuery(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))];
}

/**
 * Lowercase without shifting character offsets. `toLowerCase` can grow a
 * string for a handful of code points (e.g. "İ" → "i̇"), which would misalign
 * highlight ranges against the original text — leave those characters as-is.
 */
function lowerAligned(s: string): string {
  const lower = s.toLowerCase();
  if (lower.length === s.length) return lower;
  let out = "";
  for (const ch of s) {
    const lc = ch.toLowerCase();
    out += lc.length === ch.length ? lc : ch;
  }
  return out;
}

/** Every occurrence of every token in `lowerText`, merged and sorted. */
function findRanges(lowerText: string, tokens: string[]): HighlightRange[] {
  const raw: HighlightRange[] = [];
  for (const token of tokens) {
    let from = 0;
    for (;;) {
      const at = lowerText.indexOf(token, from);
      if (at === -1) break;
      raw.push({ start: at, end: at + token.length });
      from = at + 1;
    }
  }
  raw.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: HighlightRange[] = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged;
}

const containsAll = (lowerText: string, tokens: string[]) =>
  tokens.every((t) => lowerText.includes(t));

/** Cut a window around the first match and re-base the ranges onto it. */
function makeSnippet(
  text: string,
  ranges: HighlightRange[],
): { snippet: string; highlights: HighlightRange[] } {
  const winStart = Math.max(0, ranges[0].start - SNIPPET_LEAD);
  const winEnd = Math.min(text.length, winStart + SNIPPET_LENGTH);
  const prefix = winStart > 0 ? "…" : "";
  const suffix = winEnd < text.length ? "…" : "";
  const highlights: HighlightRange[] = [];
  for (const r of ranges) {
    if (r.start >= winEnd) break;
    if (r.end <= winStart) continue;
    highlights.push({
      start: Math.max(r.start, winStart) - winStart + prefix.length,
      end: Math.min(r.end, winEnd) - winStart + prefix.length,
    });
  }
  return { snippet: prefix + text.slice(winStart, winEnd) + suffix, highlights };
}

/**
 * Search `sessions` for `query`. Pure and synchronous — the whole history
 * (30 sessions max, already in memory) is scanned per call; memoize on
 * (sessions, query) at the call site.
 */
export function searchChatSessions(sessions: ChatSession[], query: string): ChatSearchHit[] {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return [];
  const hits: ChatSearchHit[] = [];
  for (const session of sessions) {
    const lowerTitle = lowerAligned(session.title);
    const titleMatch = containsAll(lowerTitle, tokens);
    const snippets: ChatSearchSnippet[] = [];
    for (const msg of session.messages) {
      if (snippets.length >= MAX_SNIPPETS_PER_SESSION) break;
      if (msg.isError) continue;
      const lowerText = lowerAligned(msg.text);
      if (!containsAll(lowerText, tokens)) continue;
      const { snippet, highlights } = makeSnippet(msg.text, findRanges(lowerText, tokens));
      snippets.push({ messageId: msg.id, role: msg.role, snippet, highlights });
    }
    if (!titleMatch && snippets.length === 0) continue;
    hits.push({
      sessionId: session.id,
      title: session.title,
      projectId: session.projectId,
      updatedAt: session.updatedAt,
      titleMatch,
      titleHighlights: titleMatch ? findRanges(lowerTitle, tokens) : [],
      snippets,
    });
  }
  return hits.sort((a, b) => {
    const titleDiff = (b.titleMatch ? 1 : 0) - (a.titleMatch ? 1 : 0);
    return titleDiff !== 0 ? titleDiff : b.updatedAt - a.updatedAt;
  });
}

/** Split `text` into plain/highlighted segments for rendering (`<mark>`-style). */
export function segmentByHighlights(
  text: string,
  highlights: HighlightRange[],
): Array<{ text: string; hit: boolean }> {
  const out: Array<{ text: string; hit: boolean }> = [];
  let last = 0;
  for (const { start, end } of highlights) {
    if (start > last) out.push({ text: text.slice(last, start), hit: false });
    out.push({ text: text.slice(start, end), hit: true });
    last = end;
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false });
  return out;
}
