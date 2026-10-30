/**
 * The persistence projection.
 *
 * The property that matters is NOT "which fields were dropped" — it is that a
 * projected conversation produces the byte-identical provider request. These
 * tests assert that directly (via `toRelayHistory` and by rebuilding the
 * leading system turns the way ScreenChat does), so a future change to the
 * rules fails here rather than silently altering what gets sent.
 */
import { describe, expect, it } from "vitest";

import { rehydrationEntities, toStoredMessages } from "./chatPersist";
import { toRelayHistory } from "./relayHistory";
import type { StoredChatMessage } from "./quonStore";

const ent = (n: number) => ({
  type: "PERSON",
  value: `Real Name ${n}`,
  placeholder: `[PERSON_${n}]`,
  confidence: 0.9,
});

/** A conversation with heavy context on every user turn. */
function convo(): StoredChatMessage[] {
  const out: StoredChatMessage[] = [];
  for (let i = 0; i < 3; i++) {
    out.push({
      id: i * 2 + 1,
      role: "user",
      text: `Frage ${i} über Real Name ${i}`,
      scrubbed: `Frage ${i} über [PERSON_${i}]`,
      entities: [ent(i)],
      rag: {
        context: "R".repeat(5000),
        sources: [{ kind: "document", title: "Doc", snippet: "S".repeat(1000), score: 0.8 }],
        entities: [ent(100 + i)],
      },
      instruction: { text: "I".repeat(2000), entities: [ent(200 + i)] },
      attachment: {
        name: "10 Dokumente",
        text: "A".repeat(200_000),
        entities: [ent(300 + i)],
        combined: true,
      },
    });
    out.push({
      id: i * 2 + 2,
      role: "assistant",
      text: `Antwort über Real Name ${i}`,
      rawText: `Antwort über [PERSON_${i}]`,
      reasoning: "thinking…",
    });
  }
  return out;
}

describe("size", () => {
  it("collapses the O(turns × context) growth", () => {
    const before = JSON.stringify(convo()).length;
    const after = JSON.stringify(toStoredMessages(convo())).length;
    // 3 attachment copies → 1. The growth class, not a constant factor.
    expect(after).toBeLessThan(before / 2.5);
  });
});

describe("send equivalence", () => {
  it("produces an identical relay history", () => {
    const original = convo();
    expect(toRelayHistory(toStoredMessages(original))).toEqual(toRelayHistory(original));
  });

  it("keeps the last user turn's heavy context byte-identical", () => {
    // ScreenChat builds the provider request from the LAST user turn only:
    //   [...convo].reverse().find(m => m.role === "user")
    const original = convo();
    const projected = toStoredMessages(original);
    const lastOf = (ms: StoredChatMessage[]) => [...ms].reverse().find((m) => m.role === "user")!;

    expect(lastOf(projected).rag!.context).toBe(lastOf(original).rag!.context);
    expect(lastOf(projected).attachment!.text).toBe(lastOf(original).attachment!.text);
    expect(lastOf(projected).instruction!.text).toBe(lastOf(original).instruction!.text);
  });

  it("empties — never deletes — the heavy fields on earlier turns", () => {
    // Every read site is a truthiness check (`if (lastUser?.rag?.context)`), so
    // "" behaves as absent while keeping the declared shape intact.
    const projected = toStoredMessages(convo());
    const earlier = projected.filter((m) => m.role === "user").slice(0, -1);
    expect(earlier.length).toBeGreaterThan(0);
    for (const m of earlier) {
      expect(m.rag!.context).toBe("");
      expect(m.attachment!.text).toBe("");
      expect(m.instruction!.text).toBe("");
      expect(m.attachment!.name).toBe("10 Dokumente"); // the bubble still renders
    }
  });
});

describe("placeholder continuity", () => {
  it("keeps every entity list on every turn", () => {
    // rebuildRefs walks all four of these to restore placeholder numbering; drop
    // one and a follow-up turn reuses a number, corrupting re-hydration.
    for (const m of toStoredMessages(convo())) {
      if (m.role !== "user") continue;
      expect(m.entities).toHaveLength(1);
      expect(m.rag!.entities).toHaveLength(1);
      expect(m.instruction!.entities).toHaveLength(1);
      expect(m.attachment!.entities).toHaveLength(1);
    }
  });
});

describe("scrubbed / rawText de-duplication", () => {
  it("drops them only when identical to text", () => {
    const [p] = toStoredMessages([
      { id: 1, role: "user", text: "no pii here", scrubbed: "no pii here" },
    ]);
    expect(p.scrubbed).toBeUndefined();
    expect(toRelayHistory([p])[0].content).toBe("no pii here"); // via `scrubbed ?? text`
  });

  it("NEVER drops a differing rawText — that would re-send re-hydrated PII", () => {
    // The safety property. `text` is re-hydrated (real values); `rawText` is what
    // may leave the device. If rawText were dropped while differing, the fallback
    // `rawText ?? text` would send the user's real data to the provider.
    const [p] = toStoredMessages([
      { id: 2, role: "assistant", text: "Hallo Real Name", rawText: "Hallo [PERSON_1]" },
    ]);
    expect(p.rawText).toBe("Hallo [PERSON_1]");
    expect(toRelayHistory([p])[0].content).toBe("Hallo [PERSON_1]");
    expect(toRelayHistory([p])[0].content).not.toContain("Real Name");
  });

  it("keeps a differing scrubbed on a user turn", () => {
    const [p] = toStoredMessages([
      { id: 1, role: "user", text: "Ich bin Real Name", scrubbed: "Ich bin [PERSON_1]" },
    ]);
    expect(p.scrubbed).toBe("Ich bin [PERSON_1]");
    expect(toRelayHistory([p])[0].content).not.toContain("Real Name");
  });
});

describe("shape", () => {
  it("truncates source snippets but keeps title and score", () => {
    const [p] = toStoredMessages([
      {
        id: 1,
        role: "user",
        text: "q",
        rag: {
          context: "c",
          sources: [{ kind: "document", title: "Doc", snippet: "x".repeat(5000), score: 0.7 }],
        },
      },
    ]);
    expect(p.rag!.sources[0].snippet.length).toBe(200);
    expect(p.rag!.sources[0].title).toBe("Doc");
    expect(p.rag!.sources[0].score).toBe(0.7);
  });

  it("keeps reasoning — deliberately persisted so the panel survives a reload", () => {
    const [p] = toStoredMessages([{ id: 2, role: "assistant", text: "a", reasoning: "because…" }]);
    expect(p.reasoning).toBe("because…");
  });

  it("is idempotent", () => {
    const once = toStoredMessages(convo());
    expect(toStoredMessages(once)).toEqual(once);
  });

  it("does not mutate its input", () => {
    const original = convo();
    const snapshot = JSON.stringify(original);
    toStoredMessages(original);
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it("handles an empty conversation and an assistant-only one", () => {
    expect(toStoredMessages([])).toEqual([]);
    const assistantOnly: StoredChatMessage[] = [{ id: 0, role: "assistant", text: "intro" }];
    expect(toStoredMessages(assistantOnly)).toEqual(assistantOnly);
  });
});

/**
 * The other half of the contract: what `toStoredMessages` keeps has to be what
 * the restore path reads back. A field kept but never walked (or walked but not
 * kept) fails silently — the chat looks fine until the NEXT turn comes back with
 * bare [PERSON_7] tokens nothing can re-hydrate.
 */
describe("rehydrationEntities", () => {
  const e = (type: string, n: number) => ({
    type,
    value: `${type} value ${n}`,
    placeholder: `[${type}_${n}]`,
    confidence: 0.9,
  });

  it("walks every placeholder-carrying field", () => {
    const found = rehydrationEntities([
      {
        entities: [e("PERSON", 1)],
        rag: { entities: [e("EMAIL", 1)] },
        instruction: { entities: [e("PHONE", 1)] },
        attachment: { entities: [e("IBAN", 1)] },
        toolRedactions: [{ entities: [e("ADDRESS", 1)] }],
      },
    ]);
    expect(found.map((x) => x.placeholder)).toEqual([
      "[PERSON_1]",
      "[EMAIL_1]",
      "[PHONE_1]",
      "[IBAN_1]",
      "[ADDRESS_1]",
    ]);
  });

  it("recovers tool-result placeholders — the only record that survives a reload", () => {
    // Tool turns themselves are never persisted (they are local to the run), so
    // if this walk skipped `toolRedactions` the placeholders a Paperless read
    // contributed would be unrecoverable, and the next answer — which is re-sent
    // as the assistant's placeholder `rawText` — would render them raw.
    const restored: StoredChatMessage[] = toStoredMessages([
      { id: 1, role: "user", text: "Was steht in den Unterlagen?" },
      {
        id: 2,
        role: "assistant",
        text: "Die Rente von Anna Beispiel …",
        rawText: "Die Rente von [PERSON_4] …",
        toolRedactions: [
          {
            tool: "Read a Paperless document",
            entities: [
              { type: "PERSON", value: "Anna Beispiel", placeholder: "[PERSON_4]", confidence: 1 },
            ],
          },
        ],
      },
    ]);
    const map = Object.fromEntries(
      rehydrationEntities(restored).map((x) => [x.placeholder, x.value]),
    );
    expect(map["[PERSON_4]"]).toBe("Anna Beispiel");
  });

  it("survives messages with none of those fields", () => {
    expect(rehydrationEntities([{}, { toolRedactions: [] }])).toEqual([]);
  });
});
