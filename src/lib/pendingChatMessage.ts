/**
 * One-shot handoff for a message typed on the dashboard and sent in the chat.
 *
 * Deliberately module state, NOT a URL search param: a `?q=…` that auto-sends
 * would let a crafted link put words in the user's chat, spend their AI budget
 * and leave the answer in their history. A memory handoff can only be set by
 * code the user is already running, so the dashboard composer works and a link
 * cannot.
 *
 * Consumed exactly once (take() clears it), so a later navigation to /chat
 * never re-sends a stale message.
 */

let pending: string | null = null;

export function setPendingChatMessage(text: string): void {
  const trimmed = text.trim();
  pending = trimmed ? trimmed : null;
}

/** Read AND clear — the message may only ever be sent once. */
export function takePendingChatMessage(): string | null {
  const out = pending;
  pending = null;
  return out;
}

export function clearPendingChatMessage(): void {
  pending = null;
}
