import { afterEach, describe, expect, it, vi } from "vitest";

const scrubText = vi.fn();
vi.mock("@/lib/quonApi", () => ({ scrubText: (...a: unknown[]) => scrubText(...a) }));

import { mergeScrubPieces, scrubLarge, splitForScrub, SCRUB_PIECE_CHARS } from "./scrubChunked";
import type { Entity, ScrubResult } from "@/lib/quonApi";

afterEach(() => scrubText.mockReset());

function res(scrubbed: string, entities: Entity[]): Pick<ScrubResult, "scrubbed" | "entities"> {
  return { scrubbed, entities };
}
const ent = (type: string, value: string, placeholder: string): Entity => ({
  type,
  value,
  placeholder,
  confidence: 0.9,
});

describe("splitForScrub", () => {
  it("returns the text as one piece when under the limit", () => {
    expect(splitForScrub("hello", 100)).toEqual(["hello"]);
    expect(splitForScrub("", 100)).toEqual([]);
  });

  it("pieces concatenate back to EXACTLY the original", () => {
    const text = Array.from({ length: 50 }, (_, i) => `Absatz ${i} mit etwas Text.\n\n`).join("");
    const pieces = splitForScrub(text, 200);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.join("")).toBe(text);
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(200);
  });

  it("hard-slices a single line longer than the limit (still rejoins)", () => {
    const text = "x".repeat(500);
    const pieces = splitForScrub(text, 100);
    expect(pieces.every((p) => p.length <= 100)).toBe(true);
    expect(pieces.join("")).toBe(text);
  });

  it("prefers paragraph boundaries (no entity split mid-line where avoidable)", () => {
    const text = "Anna Müller\n\nThomas Kapferer\n\nPetra Schmidt\n\n";
    const pieces = splitForScrub(text, 20);
    expect(pieces.join("")).toBe(text);
    // each name stays whole within a piece
    expect(pieces.some((p) => p.includes("Thomas Kapferer"))).toBe(true);
  });
});

describe("mergeScrubPieces (value-aware placeholder namespace)", () => {
  it("collapses the SAME value across pieces to one placeholder", () => {
    const a = res("Vertrag mit [PERSON_1].", [ent("PERSON", "Anna Müller", "[PERSON_1]")]);
    const b = res("Auch [PERSON_1] unterschreibt.", [ent("PERSON", "Anna Müller", "[PERSON_1]")]);
    const merged = mergeScrubPieces([a, b]);
    expect(merged.scrubbed).toBe("Vertrag mit [PERSON_1].Auch [PERSON_1] unterschreibt.");
    expect(merged.entities).toHaveLength(1); // Anna appears once
    expect(merged.entities[0].value).toBe("Anna Müller");
  });

  it("keeps DIFFERENT values that share a local placeholder distinct", () => {
    // Each piece independently numbered [PERSON_1]; different people.
    const a = res("[PERSON_1] zahlt.", [ent("PERSON", "Anna Müller", "[PERSON_1]")]);
    const b = res("[PERSON_1] auch.", [ent("PERSON", "Thomas Kapferer", "[PERSON_1]")]);
    const merged = mergeScrubPieces([a, b]);
    expect(merged.entities).toHaveLength(2);
    // b's local [PERSON_1] must be renumbered so it can't read as Anna.
    expect(merged.scrubbed).toBe("[PERSON_1] zahlt.[PERSON_2] auch.");
    const byPlaceholder = Object.fromEntries(merged.entities.map((e) => [e.placeholder, e.value]));
    expect(byPlaceholder["[PERSON_1]"]).toBe("Anna Müller");
    expect(byPlaceholder["[PERSON_2]"]).toBe("Thomas Kapferer");
  });

  it("numbers types independently", () => {
    const a = res("[PERSON_1] IBAN [IBAN_1]", [
      ent("PERSON", "Anna", "[PERSON_1]"),
      ent("IBAN", "CH93...", "[IBAN_1]"),
    ]);
    const b = res("[PERSON_1] IBAN [IBAN_1]", [
      ent("PERSON", "Tom", "[PERSON_1]"),
      ent("IBAN", "DE12...", "[IBAN_1]"),
    ]);
    const merged = mergeScrubPieces([a, b]);
    expect(merged.scrubbed).toBe("[PERSON_1] IBAN [IBAN_1][PERSON_2] IBAN [IBAN_2]");
  });
});

describe("scrubLarge", () => {
  it("uses a single /scrub under the split threshold", async () => {
    scrubText.mockResolvedValue({
      scrubbed: "[PERSON_1]",
      entities: [ent("PERSON", "Anna", "[PERSON_1]")],
      metadata: { fallback_mode: false },
    });
    const out = await scrubLarge("short text");
    expect(scrubText).toHaveBeenCalledTimes(1);
    expect(out.scrubbed).toBe("[PERSON_1]");
    expect(out.fallbackMode).toBe(false);
  });

  it("splits large text into parallel scrubs and merges value-aware", async () => {
    const big = "Anna Müller.\n\n".repeat(2000); // > threshold, many pieces
    scrubText.mockImplementation(async () =>
      res("[PERSON_1] ".repeat(0) + "[PERSON_1].", [ent("PERSON", "Anna Müller", "[PERSON_1]")]),
    );
    // add metadata to each mocked result
    scrubText.mockImplementation(async () => ({
      scrubbed: "[PERSON_1].",
      entities: [ent("PERSON", "Anna Müller", "[PERSON_1]")],
      metadata: { fallback_mode: false },
    }));
    const out = await scrubLarge(big);
    expect(scrubText.mock.calls.length).toBeGreaterThan(1); // it split
    // Anna is the same everywhere → exactly one entity after merge
    expect(out.entities).toHaveLength(1);
    expect(out.entities[0].placeholder).toBe("[PERSON_1]");
  });

  it("retries a TRANSIENT piece failure and still succeeds (no dead send)", async () => {
    vi.useFakeTimers();
    try {
      const big = "z".repeat(SCRUB_PIECE_CHARS + 5000); // 2 pieces
      let failedOnce = false;
      scrubText.mockImplementation(async () => {
        if (!failedOnce) {
          failedOnce = true; // exactly one transient failure across all pieces
          throw new Error("network blip");
        }
        return { scrubbed: "ok", entities: [], metadata: { fallback_mode: false } };
      });
      const p = scrubLarge(big);
      await vi.runAllTimersAsync(); // advance the backoff timers
      await expect(p).resolves.toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed only after retries are exhausted (a piece rejecting every time)", async () => {
    vi.useFakeTimers();
    try {
      const big = "x".repeat(SCRUB_PIECE_CHARS + 5000);
      scrubText.mockRejectedValue(new Error("scrub down")); // every attempt fails
      const p = scrubLarge(big);
      const assertion = expect(p).rejects.toThrow("scrub down");
      await vi.runAllTimersAsync();
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks fallbackMode when any piece degraded", async () => {
    const big = "y".repeat(SCRUB_PIECE_CHARS + 5000);
    let n = 0;
    scrubText.mockImplementation(async () => {
      n += 1;
      return { scrubbed: "ok", entities: [], metadata: { fallback_mode: n === 1 } };
    });
    const out = await scrubLarge(big);
    expect(out.fallbackMode).toBe(true);
  });
});

describe("scrubLarge progress (feedback #57)", () => {
  /** The indexing had a progress bar while the scrub — the core of the
   *  service — sat behind a static label. The callback contract: fires once
   *  per finished piece with a growing `done`, total = piece count, and (1,1)
   *  for the single-call path so callers need no size special-case. */
  it("reports every piece of a large scrub, ending at (total, total)", async () => {
    scrubText.mockImplementation(async () => ({
      scrubbed: "clean",
      entities: [],
      metadata: { fallback_mode: false },
    }));
    const big = "Absatz mit Text.\n\n".repeat(2000); // well over the threshold
    const calls: Array<[number, number]> = [];
    await scrubLarge(big, undefined, (done, total) => calls.push([done, total]));
    expect(calls.length).toBeGreaterThan(1);
    const total = calls[0][1];
    expect(calls.map(([d]) => d)).toEqual(Array.from({ length: total }, (_, i) => i + 1));
    expect(calls[calls.length - 1]).toEqual([total, total]);
  });

  it("reports (1,1) for a small single-call scrub", async () => {
    scrubText.mockResolvedValue({
      scrubbed: "kurz",
      entities: [],
      metadata: { fallback_mode: false },
    });
    const calls: Array<[number, number]> = [];
    await scrubLarge("kurz", undefined, (done, total) => calls.push([done, total]));
    expect(calls).toEqual([[1, 1]]);
  });
});

describe("a stalled piece is reported, not swallowed", () => {
  // The report was "hängt komplett ohne Fehler, der Timer zählt weiter hoch".
  // It was not a hang: the per-request timeout is 180s and there are 3 attempts,
  // so ONE unresponsive piece stalls a send for ~9 minutes with nothing on screen
  // but a ticking clock. Measured on the documents that triggered it: ~150k chars
  // → 19 pieces → 4 waves, 18 done (99%) and one retrying. Nothing distinguished
  // that from a dead UI, so it has to be said out loud.
  const ok = () => ({ scrubbed: "clean", entities: [], metadata: { fallback_mode: false } });

  it("calls onRetry before each retry, numbered for display", async () => {
    let calls = 0;
    scrubText.mockImplementation(async () => {
      calls += 1;
      if (calls < 3) throw new Error("timed out");
      return ok();
    });

    const seen: Array<{ attempt: number; attempts: number }> = [];
    await scrubLarge("short text", undefined, undefined, (info) =>
      seen.push({ attempt: info.attempt, attempts: info.attempts }),
    );

    // Two failures → two reports, numbered so the UI can say "2 of 3", "3 of 3".
    expect(seen).toEqual([
      { attempt: 2, attempts: 3 },
      { attempt: 3, attempts: 3 },
    ]);
  });

  it("says nothing when the first attempt succeeds", async () => {
    scrubText.mockResolvedValue(ok());
    const onRetry = vi.fn();
    await scrubLarge("short text", undefined, undefined, onRetry);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("still throws once the attempts are exhausted — fail-closed preserved", async () => {
    scrubText.mockRejectedValue(new Error("timed out"));
    const onRetry = vi.fn();
    await expect(scrubLarge("short text", undefined, undefined, onRetry)).rejects.toThrow();
    // Reported twice, then gave up: reporting must not swallow the failure.
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("reports a retry from a MULTI-piece scrub too", async () => {
    let n = 0;
    scrubText.mockImplementation(async () => {
      n += 1;
      if (n === 1) throw new Error("timed out"); // one piece stalls once
      return ok();
    });
    const onRetry = vi.fn();
    await scrubLarge("x".repeat(SCRUB_PIECE_CHARS * 3), undefined, undefined, onRetry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("passes the error along so a caller can log WHY it stalled", async () => {
    const boom = new Error("/scrub timed out after 180s");
    let first = true;
    scrubText.mockImplementation(async () => {
      if (first) {
        first = false;
        throw boom;
      }
      return ok();
    });
    const seen: unknown[] = [];
    await scrubLarge("short text", undefined, undefined, (i) => seen.push(i.error));
    expect(seen).toEqual([boom]);
  });
});
