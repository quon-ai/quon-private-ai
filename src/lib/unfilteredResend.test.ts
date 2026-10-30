import { describe, expect, it } from "vitest";

import { buildUnfilteredResend } from "./unfilteredResend";

describe("buildUnfilteredResend", () => {
  it("passes the original text through verbatim as both display and wire text", () => {
    const original = "Wann einnehmen?";
    expect(buildUnfilteredResend(original)).toEqual({
      scrubbed: original,
      entities: [],
      protected: false,
      unfiltered: true,
    });
  });

  it("never redacts anything, regardless of how PII-shaped the text looks", () => {
    // The whole point of this escape hatch: even a message that WOULD normally
    // trip the scrubber (an email-shaped string here) must cross unscrubbed —
    // the user explicitly chose to bypass detection for this one send.
    const original = "Reach me at anna@example.com about Rehbergplatz";
    const payload = buildUnfilteredResend(original);
    expect(payload.scrubbed).toBe(original);
    expect(payload.entities).toHaveLength(0);
  });
});
