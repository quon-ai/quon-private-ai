/**
 * Pure decision logic for how `runChat`'s stream catch (ScreenChat.tsx) should
 * present a failed generation — extracted so the rule is unit-tested directly
 * (report #8, 2026-07-15 UX walkthrough): a mid-stream connection drop used to
 * overwrite the tokens the user was already reading with a bare error string.
 *
 * Three outcomes:
 *  - a session/auth failure (401) always becomes a plain error bubble — the
 *    global 401 hook (see quonApi.ts / authStore.ts) is already sending the app
 *    to the sign-in screen, so this is just the fallback message if a bubble is
 *    still rendered in the instant before that transition lands;
 *  - a failure with NO tokens received yet becomes the classic full error
 *    bubble, exactly as before;
 *  - a failure with partial tokens already received KEEPS that text (the
 *    caller re-applies it) and only adds a small trailing note — the bubble
 *    still reads as an (incomplete) answer, not as an error.
 */
export interface StreamErrorDecision {
  /** True: caller keeps the already-accumulated (rehydrated) text/rawText in the
   *  bubble and marks it `streamInterrupted` instead of replacing it. */
  keepPartial: boolean;
  /** Bubble text to use when NOT keeping the partial answer. */
  errorText?: string;
  /** Trailing note rendered under a kept-partial bubble. */
  note?: string;
}

export const STREAM_INTERRUPTED_NOTE = "Connection lost — response incomplete.";

export function classifyStreamError(params: {
  /** Length of the raw (placeholder) answer text accumulated before the error. */
  partialLen: number;
  /** True when the failure was a 401 — the session is gone, not a provider/
   *  network issue (see isUnauthorizedError in quonApi.ts). */
  unauthorized: boolean;
  /** The error's message, used verbatim in the classic full-error bubble. */
  detail: string;
}): StreamErrorDecision {
  if (params.unauthorized) {
    return { keepPartial: false, errorText: "Session expired — sign in to continue." };
  }
  if (params.partialLen > 0) {
    return { keepPartial: true, note: STREAM_INTERRUPTED_NOTE };
  }
  return { keepPartial: false, errorText: `⚠️ Model provider error — ${params.detail}` };
}
