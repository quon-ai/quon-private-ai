/**
 * Payload builder for the per-message "Resend without filter" action.
 *
 * Why this exists: the scrubber occasionally false-positives on casual text
 * (e.g. German "Wann einnehmen?" → "[PERSON] einnehmen?"), which mangles the
 * question the model sees. This is a deliberate, ONE-SHOT escape hatch — not a
 * permanent allow-list entry (a future ADDRESS entity type will legitimately
 * want street names redacted, so a lasting "never redact this value" rule is
 * the wrong tool here). Clicking it resends the affected message's ORIGINAL
 * text as a brand-new turn, skipping /scrub entirely for that one send.
 *
 * Kept pure and separate from ScreenChat so the "what does an unfiltered send
 * look like" contract has a unit test independent of the UI/consent wiring.
 */

/** The fields `finalizeSend` needs to send `original` completely unscrubbed. */
export interface UnfilteredResendPayload {
  /** Passed as both the display text and the wire text — nothing was replaced. */
  scrubbed: string;
  /** Empty: no entities were detected/redacted, so no PII highlighting applies. */
  entities: [];
  /** false: uses the relay's neutral system prompt, not the "expect placeholders" one. */
  protected: false;
  /** Marks the bubble so the UI shows "Sent without filter" — never confusable
   *  with "0 items found" (protected) or "Sent unprotected" (protection level None). */
  unfiltered: true;
}

/** Build the resend payload for `original` (the pre-scrub text of the affected
 *  message). Bare text only by design — no attachment/RAG/instruction is
 *  re-attached, since the false-positive class this addresses lives in typed
 *  text and the goal is minimal additional exposure, not replaying the whole
 *  original turn. */
export function buildUnfilteredResend(original: string): UnfilteredResendPayload {
  return {
    scrubbed: original,
    entities: [],
    protected: false,
    unfiltered: true,
  };
}
