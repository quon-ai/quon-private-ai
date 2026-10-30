/**
 * One-shot signal: the user EXPLICITLY asked for a new chat (sidebar "+" /
 * "New chat"). ScreenChat's session effect needs this to tell a real new-chat
 * navigation apart from the router's stale pre-send tick — both arrive as
 * "/chat with no ?c=", but they must be handled oppositely (reset vs. ignore).
 * See the pendingSelfNavRef block in ScreenChat: without this signal, a "+"
 * pressed inside the ~2s self-navigation window was mistaken for the stale
 * tick, the reset was skipped, and the late-committing ?c=<old> navigation
 * pulled the view (and the NEXT send) back into the old chat — the
 * entanglement bug chat-runner.spec.ts:53 guards.
 */

let explicitNewChatTs = 0;

export function markExplicitNewChat(): void {
  explicitNewChatTs = Date.now();
}

export function getExplicitNewChatTs(): number {
  return explicitNewChatTs;
}
