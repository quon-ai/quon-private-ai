import type { ChatTurn } from "./quonApi";

/** Minimal structural view of a chat bubble - what toRelayHistory needs from
 *  ScreenChat's ChatMessage. */
export interface RelayableMessage {
  id: number;
  role: "user" | "assistant";
  /** user: the original text typed; assistant: the re-hydrated reply */
  text: string;
  /** user only: what was actually sent to the provider */
  scrubbed?: string;
  /** assistant only: the raw answer with placeholders, before re-hydration */
  rawText?: string;
  isError?: boolean;
}

/** Build the message history that goes to the model provider.
 *
 *  Privacy invariant: the provider must only ever see placeholder text, never
 *  re-hydrated values. User turns send `scrubbed` (falling back to the typed
 *  text when protection was off). Assistant turns send `rawText` - the answer
 *  as the provider produced it, placeholders intact - never the re-hydrated
 *  `text`, which contains the user's real data again. The intro bubble (id 0)
 *  and error bubbles are dropped.
 */
export function toRelayHistory(convo: RelayableMessage[]): ChatTurn[] {
  return convo
    .filter((m) => m.id !== 0 && !m.isError)
    .map((m) => ({
      role: m.role,
      content: m.role === "user" ? (m.scrubbed ?? m.text) : (m.rawText ?? m.text),
    }));
}

/**
 * Splice this turn's context (the attachment, the retrieved RAG context) in
 * front of the user turn it belongs to, instead of at the head of the request.
 *
 * The attachment preamble says "the user attached a document to this message".
 * With the system turn at position 0 - before the whole conversation - a
 * one-turn chat reads correctly, but from the second turn on it does not: the
 * nearest user message is the first one, so the model attributes the newly
 * attached document to the opening question and answers "I only have the first
 * report" or "only the text 'hier' arrived, without an attachment" while the
 * document is in the request the whole time. Nothing is lost; it is
 * mis-addressed.
 *
 * Standing context (a project instruction: persona, rules for the whole chat)
 * is not this and stays at the head - pass it in `head`.
 */
export function withTurnContext(
  history: ChatTurn[],
  head: ChatTurn[],
  turnContext: ChatTurn[],
): ChatTurn[] {
  if (turnContext.length === 0) return [...head, ...history];
  let lastUser = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "user") {
      lastUser = i;
      break;
    }
  }
  // No user turn to attach to (retry of an empty conversation): head is all we
  // can honestly do - never drop the context.
  if (lastUser < 0) return [...head, ...history, ...turnContext];
  return [...head, ...history.slice(0, lastUser), ...turnContext, ...history.slice(lastUser)];
}
