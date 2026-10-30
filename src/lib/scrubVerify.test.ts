/**
 * The enforcement guarantee, at the choke point.
 *
 * A hand-redaction is only meaningful if it constrains what actually leaves the
 * device. The backend does the redacting, so the client verifies the result:
 * every scrub funnels through `scrubText`, so one check there means every send
 * path fails closed through its existing catch — and a NEW send path cannot
 * forget it (which is exactly how `agents/runner.ts` had drifted).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
// Partial mock: quonApi also reaches for `isNative`, so spread the real module.
vi.mock("@/lib/platform", async (orig) => ({
  ...((await orig()) as object),
  http: () => ({ fetch: fetchMock }),
}));

import { ScrubIncompleteError, scrubText } from "./quonApi";

afterEach(() => fetchMock.mockReset());

function respond(scrubbed: string) {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({
      scrubbed,
      entities: [],
      metadata: { fallback_mode: false, skip_reason: null, low_case_signal: false },
    }),
  });
}

describe("scrubText verifies the user's always-redact list", () => {
  it("throws when a required term survived the scrub", async () => {
    // The backend answered 200, but the value the user explicitly asked to have
    // redacted is still in the text. Sending that would be the exact failure the
    // feature exists to prevent.
    respond("Hallo Anna Muster, alles gut");
    await expect(
      scrubText("Hallo Anna Muster, alles gut", { always_redact: ["Anna Muster"] }),
    ).rejects.toBeInstanceOf(ScrubIncompleteError);
  });

  it("names the surviving term so the UI can say which one", async () => {
    respond("Kundennummer 48213 bleibt");
    await expect(
      scrubText("x", { always_redact: ["Anna", "Kundennummer 48213"] }),
    ).rejects.toMatchObject({ term: "Kundennummer 48213" });
  });

  it("passes when the term was properly replaced", async () => {
    respond("Hallo [CUSTOM_1], alles gut");
    const r = await scrubText("Hallo Anna Muster, alles gut", {
      always_redact: ["Anna Muster"],
    });
    expect(r.scrubbed).toBe("Hallo [CUSTOM_1], alles gut");
  });

  it("does not block a send when the list is empty", async () => {
    respond("anything at all");
    await expect(scrubText("anything at all")).resolves.toBeTruthy();
  });

  it("does not false-positive on a term that only occurs inside a longer word", async () => {
    // The backend would not have redacted "partner" inside "Vertragspartnerin"
    // either — blocking here would break a perfectly good send.
    respond("Vertragspartnerin bleibt");
    await expect(scrubText("x", { always_redact: ["partner"] })).resolves.toBeTruthy();
  });

  it("does not false-positive on a placeholder containing the term", async () => {
    respond("Hallo [PERSON_1]");
    await expect(scrubText("x", { always_redact: ["Person", "1"] })).resolves.toBeTruthy();
  });
});
