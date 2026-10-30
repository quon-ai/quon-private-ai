/**
 * The projection between "the conversation the chat screen is holding" and
 * "what a chat session is allowed to persist and sync".
 *
 * Why this exists: there was no such boundary. `saveChatSession(id, messages)`
 * is called with the component's `ChatMessage[]`, and because that is a variable
 * rather than an object literal, TypeScript's excess-property check never fired
 * — so every field the component happened to be holding was serialized, encrypted
 * and pushed to the relay. Most of it is never read back:
 *
 *  - `attachment.text` — up to ATTACHMENT_CHAR_BUDGET (200_000 chars). One
 *    "attach all documents" turn is ~200 KB of JSON, on EVERY turn thereafter.
 *    This was the single biggest contributor to a chat blob, larger than RAG.
 *  - `rag.context` — the full retrieved context, copied into every user turn.
 *  - `instruction.text` — likewise.
 *
 * The result grew as O(turns × per-turn-context), which is what walks a chat
 * into the relay's 4 MiB per-blob cap (`collectionSync.ts`), and — because the
 * local history cache is ONE localStorage value for all sessions — into
 * WebKit's ~5 MB localStorage quota, where the write fails and is swallowed.
 *
 * The fix is a growth-class change, not a constant factor: those three fields
 * are only ever read for the LAST user turn (`ScreenChat.tsx` builds the
 * provider request from `[...convo].reverse().find(m => m.role === "user")`),
 * so keeping them only there makes a session O(turns) + O(one context).
 *
 * ⚠️ What must survive on EVERY turn: all `*.entities`. `rehydrationEntities`
 * (below, the walk `rebuildRefs` uses) reads every message's `entities`,
 * `rag.entities`, `instruction.entities`, `attachment.entities` and
 * `toolRedactions[].entities` to restore placeholder numbering, so a follow-up
 * turn keeps unique placeholders and the answer re-hydrates. They are small;
 * the text they describe is not. The walk lives HERE, next to the projection,
 * so "what is kept" and "what is read back" cannot drift apart — they are two
 * halves of one contract, and a field added to one is visibly missing from the
 * other.
 *
 * Measured on a 100-turn chat with Context on and three attach-all turns:
 * 1.21 MiB → 0.26 MiB (4.6×).
 */
import type { Entity } from "./quonApi";
import type { StoredChatMessage } from "./quonStore";

/** Sources are rendered truncated anyway (`slice(0, 140)`), so the stored
 *  snippet only has to be long enough that the display never runs out. */
const SNIPPET_MAX = 200;

/** Index of the last user turn — the only turn whose heavy context is ever
 *  read back (to re-send on retry, and to keep a restored chat send-identical). */
function lastUserIndex(messages: StoredChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return i;
  }
  return -1;
}

/**
 * Project a conversation into its persisted form.
 *
 * Pure, idempotent, and **send-equivalent**: `toRelayHistory(project(msgs))`
 * equals `toRelayHistory(msgs)`, and the provider request built from the last
 * user turn is byte-identical. Applied both when saving locally and when
 * accepting a session from another (possibly older, fatter) device.
 */
export function toStoredMessages(messages: StoredChatMessage[]): StoredChatMessage[] {
  const keepIdx = lastUserIndex(messages);

  return messages.map((m, i) => {
    const out: StoredChatMessage = { ...m };
    const isLastUser = i === keepIdx;

    // `scrubbed`/`rawText` are what actually leaves the device; `text` is the
    // re-hydrated view. When they are identical (no PII was found, or protection
    // was off) the copy is pure duplication — `toRelayHistory` already falls back
    // `scrubbed ?? text` / `rawText ?? text`, so dropping it is send-identical.
    // ⚠️ Only when EQUAL. Dropping a differing `rawText` would make an assistant
    // turn re-send its re-hydrated text — i.e. leak the real values back to the
    // provider. The equality check is the safety property; see the tests.
    if (out.scrubbed === out.text) delete out.scrubbed;
    if (out.rawText === out.text) delete out.rawText;

    if (out.attachment) {
      out.attachment = {
        ...out.attachment,
        // Keep name/truncated/combined/entities always — the bubble still renders
        // "10 Dokumente" and rebuildRefs still needs the entities.
        text: isLastUser ? out.attachment.text : "",
      };
    }

    if (out.rag) {
      out.rag = {
        ...out.rag,
        context: isLastUser ? out.rag.context : "",
        sources: out.rag.sources?.map((s) =>
          s.snippet && s.snippet.length > SNIPPET_MAX
            ? { ...s, snippet: s.snippet.slice(0, SNIPPET_MAX) }
            : s,
        ),
      };
    }

    if (out.instruction) {
      out.instruction = {
        ...out.instruction,
        text: isLastUser ? out.instruction.text : "",
      };
    }

    return out;
  });
}

/** Every message field that carries placeholder→value pairs, in message order.
 *
 *  Extracted from `ScreenChat`'s `rebuildRefs` so this list is testable and sits
 *  beside `toStoredMessages`, whose job is to make sure these same fields
 *  survive. Missing one is silent and only shows up much later: a restored chat
 *  loses those placeholders, and the NEXT answer renders bare `[PERSON_7]`
 *  tokens because an assistant turn is re-sent as its placeholder view.
 *
 *  Structural parameter type so both the component's `ChatMessage` and the
 *  persisted `StoredChatMessage` fit without a conversion. */
export function rehydrationEntities(
  messages: Array<{
    entities?: Entity[];
    rag?: { entities?: Entity[] };
    instruction?: { entities?: Entity[] };
    attachment?: { entities?: Entity[] };
    toolRedactions?: Array<{ entities: Entity[] }>;
  }>,
): Entity[] {
  const out: Entity[] = [];
  for (const m of messages) {
    if (m.entities) out.push(...m.entities);
    // Context (RAG), project instruction and attachment entities: the answer may
    // reference any of them, and a follow-up turn must not reuse their indices.
    if (m.rag?.entities) out.push(...m.rag.entities);
    if (m.instruction?.entities) out.push(...m.instruction.entities);
    if (m.attachment?.entities) out.push(...m.attachment.entities);
    // Tool results (Paperless / Dropbox / MCP reads). These are NOT in the
    // persisted turns at all — tool turns are local to the run — so this record
    // is the only place their placeholders survive a reload.
    for (const g of m.toolRedactions ?? []) out.push(...g.entities);
  }
  return out;
}
