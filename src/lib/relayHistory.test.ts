import type { ChatTurn } from "./quonApi";
import { describe, expect, it } from "vitest";
import { toRelayHistory, type RelayableMessage, withTurnContext } from "./relayHistory";

describe("toRelayHistory", () => {
  it("sends scrubbed text for user turns, never the original", () => {
    const convo: RelayableMessage[] = [
      { id: 1, role: "user", text: "Ich bin Anna Müller", scrubbed: "Ich bin [PERSON_1]" },
    ];
    expect(toRelayHistory(convo)).toEqual([{ role: "user", content: "Ich bin [PERSON_1]" }]);
  });

  it("sends rawText (placeholders) for assistant turns, never the re-hydrated text", () => {
    // Regression: assistant turns used to be relayed as the re-hydrated `text`,
    // leaking the real values back to the provider on the NEXT send whenever the
    // model had echoed a placeholder in its reply.
    const convo: RelayableMessage[] = [
      { id: 1, role: "user", text: "Mail an Anna Müller", scrubbed: "Mail an [PERSON_1]" },
      {
        id: 2,
        role: "assistant",
        text: "Hallo Anna Müller, gerne!", // re-hydrated for display
        rawText: "Hallo [PERSON_1], gerne!",
      },
      { id: 3, role: "user", text: "Kürzer bitte", scrubbed: "Kürzer bitte" },
    ];
    const history = toRelayHistory(convo);
    expect(history[1]).toEqual({ role: "assistant", content: "Hallo [PERSON_1], gerne!" });
    expect(JSON.stringify(history)).not.toContain("Anna Müller");
  });

  it("falls back to text for assistant turns without rawText (legacy sessions, unprotected)", () => {
    const convo: RelayableMessage[] = [
      { id: 1, role: "user", text: "Hi" },
      { id: 2, role: "assistant", text: "Hello!" },
    ];
    expect(toRelayHistory(convo)[1]).toEqual({ role: "assistant", content: "Hello!" });
  });

  it("drops the intro bubble (id 0) and error bubbles", () => {
    const convo: RelayableMessage[] = [
      { id: 0, role: "assistant", text: "intro" },
      { id: 1, role: "user", text: "Hi", scrubbed: "Hi" },
      { id: 2, role: "assistant", text: "⚠️ Model provider error", isError: true },
      { id: 3, role: "user", text: "again", scrubbed: "again" },
    ];
    expect(toRelayHistory(convo)).toEqual([
      { role: "user", content: "Hi" },
      { role: "user", content: "again" },
    ]);
  });
});

describe("withTurnContext: the attachment must sit next to its turn", () => {
  const u = (t: string): ChatTurn => ({ role: "user", content: t });
  const a = (t: string): ChatTurn => ({ role: "assistant", content: t });
  const sys = (t: string): ChatTurn => ({ role: "system", content: t });

  it("splices this turn's context immediately before the last user turn", () => {
    // The reported shape: a running chat, a document attached to the newest
    // message. At the head, the model read it as belonging to the first
    // question and answered "I only have the first report".
    const out = withTurnContext(
      [u("erste Frage"), a("erste Antwort"), u("und dieses hier?")],
      [],
      [sys("DOC B")],
    );
    expect(out.map((t) => t.content)).toEqual([
      "erste Frage",
      "erste Antwort",
      "DOC B",
      "und dieses hier?",
    ]);
  });

  it("keeps standing context (the project instruction) at the head", () => {
    const out = withTurnContext([u("frage")], [sys("PERSONA")], [sys("DOC")]);
    expect(out.map((t) => t.content)).toEqual(["PERSONA", "DOC", "frage"]);
  });

  it("is unchanged for a first turn: where the old order was already right", () => {
    const out = withTurnContext([u("frage")], [], [sys("DOC")]);
    expect(out.map((t) => t.content)).toEqual(["DOC", "frage"]);
  });

  it("does nothing when there is no per-turn context", () => {
    const base = [u("a"), a("b"), u("c")];
    expect(withTurnContext(base, [sys("P")], [])).toEqual([sys("P"), ...base]);
  });

  it("never drops context when there is no user turn to attach it to", () => {
    const out = withTurnContext([a("nur eine Antwort")], [], [sys("DOC")]);
    expect(out.map((t) => t.content)).toContain("DOC");
  });

  it("attaches to the last user turn even when an assistant turn follows it", () => {
    // A retry re-sends a conversation whose final turn is the assistant's.
    const out = withTurnContext([u("frage"), a("antwort")], [], [sys("DOC")]);
    expect(out.map((t) => t.content)).toEqual(["DOC", "frage", "antwort"]);
  });
});
