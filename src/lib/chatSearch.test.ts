import { describe, expect, it } from "vitest";

import { searchChatSessions, segmentByHighlights, tokenizeQuery } from "./chatSearch";
import type { ChatSession, StoredChatMessage } from "./quonStore";

let nextMsgId = 1;
const msg = (
  role: "user" | "assistant",
  text: string,
  extra?: Partial<StoredChatMessage>,
): StoredChatMessage => ({ id: nextMsgId++, role, text, ...extra });

const session = (
  id: string,
  title: string,
  messages: StoredChatMessage[],
  extra?: Partial<ChatSession>,
): ChatSession => ({
  id,
  title,
  createdAt: 0,
  updatedAt: 0,
  messages,
  ...extra,
});

describe("tokenizeQuery", () => {
  it("lowercases, splits on whitespace and dedupes", () => {
    expect(tokenizeQuery("  Invoice  MÜLLER invoice ")).toEqual(["invoice", "müller"]);
  });

  it("returns nothing for a blank query", () => {
    expect(tokenizeQuery("   ")).toEqual([]);
  });
});

describe("searchChatSessions: matching", () => {
  it("matches case-insensitive substrings in message text", () => {
    const hits = searchChatSessions(
      [session("a", "Trip", [msg("user", "Flug nach Lissabon buchen")])],
      "lissabon",
    );
    expect(hits.map((h) => h.sessionId)).toEqual(["a"]);
    expect(hits[0].snippets[0].role).toBe("user");
  });

  it("matches the session title even when no message matches", () => {
    const hits = searchChatSessions(
      [session("a", "Lisbon itinerary", [msg("user", "unrelated")])],
      "lisbon",
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].titleMatch).toBe(true);
    expect(hits[0].snippets).toEqual([]);
  });

  it("searches assistant text too", () => {
    const hits = searchChatSessions(
      [session("a", "Chat", [msg("assistant", "The capital is Lisbon.")])],
      "capital",
    );
    expect(hits[0].snippets[0].role).toBe("assistant");
  });

  it("returns nothing for an empty query or no matches", () => {
    const s = [session("a", "Chat", [msg("user", "hello")])];
    expect(searchChatSessions(s, "")).toEqual([]);
    expect(searchChatSessions(s, "zzz")).toEqual([]);
  });
});

describe("searchChatSessions: AND tokens (per message)", () => {
  it("requires all tokens within a single message", () => {
    const split = session("split", "Chat", [
      msg("user", "invoice due"),
      msg("user", "Müller called"),
    ]);
    const together = session("both", "Chat", [msg("user", "Invoice for Müller is due")]);
    const hits = searchChatSessions([split, together], "invoice müller");
    expect(hits.map((h) => h.sessionId)).toEqual(["both"]);
  });

  it("still hits when all tokens are in the title", () => {
    const hits = searchChatSessions(
      [session("a", "Müller invoice", [msg("user", "unrelated")])],
      "invoice müller",
    );
    expect(hits.map((h) => h.sessionId)).toEqual(["a"]);
  });
});

describe("searchChatSessions: ranking", () => {
  it("puts title matches first, then sorts by recency", () => {
    const hits = searchChatSessions(
      [
        session("body-new", "Chat", [msg("user", "about tokyo")], { updatedAt: 300 }),
        session("title-old", "Tokyo trip", [], { updatedAt: 100 }),
        session("title-new", "Tokyo food", [], { updatedAt: 200 }),
        session("body-old", "Chat", [msg("user", "tokyo again")], { updatedAt: 50 }),
      ],
      "tokyo",
    );
    expect(hits.map((h) => h.sessionId)).toEqual([
      "title-new",
      "title-old",
      "body-new",
      "body-old",
    ]);
  });
});

describe("searchChatSessions: snippets", () => {
  it("extracts a window around the match with aligned highlight ranges", () => {
    const long = `${"x".repeat(100)} the secret keyword sits here ${"y".repeat(100)}`;
    const [hit] = searchChatSessions([session("a", "Chat", [msg("user", long)])], "keyword");
    const [snip] = hit.snippets;
    expect(snip.snippet.startsWith("…")).toBe(true);
    expect(snip.snippet.endsWith("…")).toBe(true);
    const [range] = snip.highlights;
    expect(snip.snippet.slice(range.start, range.end)).toBe("keyword");
  });

  it("keeps the full text (no ellipses) when the message is short", () => {
    const [hit] = searchChatSessions([session("a", "Chat", [msg("user", "find me")])], "find");
    expect(hit.snippets[0].snippet).toBe("find me");
    expect(hit.snippets[0].highlights).toEqual([{ start: 0, end: 4 }]);
  });

  it("highlights every token and merges overlapping ranges", () => {
    const [hit] = searchChatSessions(
      [session("a", "Chat", [msg("user", "alpha beta alphabet")])],
      "alpha alphabet",
    );
    const { snippet, highlights } = hit.snippets[0];
    expect(highlights.map((r) => snippet.slice(r.start, r.end))).toEqual(["alpha", "alphabet"]);
  });

  it("caps the snippets per session at three", () => {
    const messages = Array.from({ length: 5 }, () => msg("user", "hit here"));
    const [hit] = searchChatSessions([session("a", "Chat", messages)], "hit");
    expect(hit.snippets).toHaveLength(3);
  });

  it("highlights the matching part of the title", () => {
    const [hit] = searchChatSessions([session("a", "Tokyo trip", [])], "tokyo");
    const [range] = hit.titleHighlights;
    expect(hit.title.slice(range.start, range.end)).toBe("Tokyo");
  });
});

describe("searchChatSessions: error bubbles", () => {
  it("skips error messages entirely", () => {
    const hits = searchChatSessions(
      [session("a", "Chat", [msg("assistant", "Scrubber unreachable", { isError: true })])],
      "unreachable",
    );
    expect(hits).toEqual([]);
  });

  it("still matches the session via its non-error messages", () => {
    const [hit] = searchChatSessions(
      [
        session("a", "Chat", [
          msg("assistant", "network failed", { isError: true }),
          msg("user", "why did the network fail?"),
        ]),
      ],
      "network",
    );
    expect(hit.snippets).toHaveLength(1);
    expect(hit.snippets[0].role).toBe("user");
  });
});

describe("segmentByHighlights", () => {
  it("splits text into plain and highlighted segments", () => {
    expect(segmentByHighlights("say hello twice", [{ start: 4, end: 9 }])).toEqual([
      { text: "say ", hit: false },
      { text: "hello", hit: true },
      { text: " twice", hit: false },
    ]);
  });

  it("returns one plain segment when there are no highlights", () => {
    expect(segmentByHighlights("plain", [])).toEqual([{ text: "plain", hit: false }]);
  });
});
