import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyPlaceholders,
  browserLanguageHint,
  checkHealth,
  enrichmentSkipReason,
  isUnauthorizedError,
  PLACEHOLDER_RE,
  QuonError,
  setUnauthorizedHandler,
} from "./quonApi";

// The zero-evidence language tie-break sent with every scrub (see
// ScrubOptions.language_hint): the backend uses it ONLY when the text itself
// carries no language signal — bare noun queries like "Milchreis Rezept",
// the single biggest real-world PERSON-FP class (2026-07-08 review).
describe("browserLanguageHint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["de", "de"],
    ["de-DE", "de"],
    ["de-AT", "de"],
    ["en", "en"],
    ["en-US", "en"],
    ["EN-GB", "en"], // case-insensitive
  ])("maps navigator.language %s to %s", (locale, expected) => {
    vi.stubGlobal("navigator", { language: locale });
    expect(browserLanguageHint()).toBe(expected);
  });

  it("returns undefined for locales the scrubber has no model for", () => {
    for (const locale of ["fr-FR", "es", "ja-JP", ""]) {
      vi.stubGlobal("navigator", { language: locale });
      expect(browserLanguageHint()).toBeUndefined();
    }
  });

  it("is SSR-safe (no navigator on the server)", () => {
    vi.stubGlobal("navigator", undefined);
    expect(browserLanguageHint()).toBeUndefined();
  });
});

describe("PLACEHOLDER_RE", () => {
  it("matches indexed placeholders only", () => {
    const found = "Hi [PERSON_1], [EMAIL_2] and [AMOUNT_10]".match(PLACEHOLDER_RE);
    expect(found).toEqual(["[PERSON_1]", "[EMAIL_2]", "[AMOUNT_10]"]);
  });

  it("does not match un-indexed or lowercase tokens", () => {
    expect("[PERSON] [person_1] [123]".match(PLACEHOLDER_RE)).toBeNull();
  });
});

describe("applyPlaceholders", () => {
  it("re-hydrates known tokens and leaves unknown ones intact", () => {
    const out = applyPlaceholders("Hi [PERSON_1], mail [EMAIL_2] or [PHONE_9]", {
      "[PERSON_1]": "Anna",
      "[EMAIL_2]": "a@b.com",
    });
    expect(out).toBe("Hi Anna, mail a@b.com or [PHONE_9]");
  });

  it("replaces every occurrence in a single pass (no cascade)", () => {
    const out = applyPlaceholders("[A_1] then [A_1]", { "[A_1]": "[A_2]", "[A_2]": "BOOM" });
    expect(out).toBe("[A_2] then [A_2]"); // [A_2] from the map is NOT re-expanded
  });

  it("re-hydrates lightly mutated tokens a model echoes back", () => {
    const map = { "[PERSON_1]": "Anna", "[EMAIL_2]": "a@b.com" };
    // case drift, hyphen/space separators, inner padding, markdown-bold wrapper
    expect(applyPlaceholders("Hi [Person_1]", map)).toBe("Hi Anna");
    expect(applyPlaceholders("Hi [PERSON-1]", map)).toBe("Hi Anna");
    expect(applyPlaceholders("Hi [PERSON 1]", map)).toBe("Hi Anna");
    expect(applyPlaceholders("Hi [ PERSON_1 ]", map)).toBe("Hi Anna");
    expect(applyPlaceholders("Mail **[EMAIL_2]**", map)).toBe("Mail **a@b.com**");
  });

  it("leaves an unknown bracketed token untouched (no half-render)", () => {
    // A prose token that normalizes to a key not in the map must pass through.
    expect(applyPlaceholders("See [Section 1] below", { "[PERSON_1]": "Anna" })).toBe(
      "See [Section 1] below",
    );
  });

  it("re-hydrates a BRACKET-LESS token the model inlined (report: PERSON_1s → name)", () => {
    // The model dropped the brackets forming a German genitive; the answer showed
    // a raw "PERSON_1" instead of the name — most visible after toggling Filter
    // off on a follow-up turn (the historical map still holds the value).
    const map = { "[PERSON_1]": "Anna", "[IBAN_2]": "CH93…" };
    expect(applyPlaceholders("PERSON_1s Bedürfnisse", map)).toBe("Annas Bedürfnisse");
    expect(applyPlaceholders("Konto IBAN_2 ist gesperrt", map)).toBe("Konto CH93… ist gesperrt");
  });

  it("never alters a bare uppercase_number token that isn't a placeholder", () => {
    const map = { "[PERSON_1]": "Anna" };
    // no map entry → pure no-op, even though the shape matches
    expect(applyPlaceholders("Norm ISO_9001 und Modell GPT_4", map)).toBe(
      "Norm ISO_9001 und Modell GPT_4",
    );
    // lowercase never matches the bare alternative
    expect(applyPlaceholders("jede 2 Nacht, person_1 klein", map)).toBe(
      "jede 2 Nacht, person_1 klein",
    );
  });
});

// report #5 (2026-07-15 UX walkthrough): an expired session used to surface as
// "QUON is unreachable" (scrub) or "Model provider error — session expired"
// (relay) — both send the user to fix the wrong thing. `isUnauthorizedError` is
// the shared classifier ScreenChat/authStore use to tell a real 401 apart from a
// generic network/server failure; `setUnauthorizedHandler` is the hook authStore
// registers so any authenticated call reaching a genuine 401 forces the app back
// to the sign-in screen instead of every subsequent call failing confusingly.
describe("isUnauthorizedError", () => {
  it("is true only for a QuonError carrying status 401", () => {
    expect(isUnauthorizedError(new QuonError("nope", 401))).toBe(true);
  });

  it("is false for other statuses, non-401 QuonErrors, and non-QuonError values", () => {
    expect(isUnauthorizedError(new QuonError("forbidden", 403))).toBe(false);
    expect(isUnauthorizedError(new QuonError("network-level, no status"))).toBe(false);
    expect(isUnauthorizedError(new Error("boom"))).toBe(false);
    expect(isUnauthorizedError("boom")).toBe(false);
    expect(isUnauthorizedError(undefined)).toBe(false);
  });
});

describe("setUnauthorizedHandler / request() 401 handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(() => {}); // reset to a no-op so later tests aren't affected
  });

  it("fires the registered handler and throws a QuonError with status 401 on a 401 response", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }),
    );

    await expect(checkHealth()).rejects.toMatchObject({ name: "QuonError", status: 401 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire the handler for a non-401 failure (server error, not a session issue)", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }),
    );

    await expect(checkHealth()).rejects.toMatchObject({ name: "QuonError", status: 500 });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe("enrichmentSkipReason", () => {
  it("maps known reasons to a non-empty localized phrase (default German)", () => {
    // The exact wording is language-dependent (catalog-driven); assert it maps to
    // a distinct, non-empty phrase per reason rather than pinning English text.
    const reasons = ["timeout", "budget", "rate_limit", "auth"];
    const phrases = reasons.map((r) => enrichmentSkipReason(r));
    for (const p of phrases) expect(typeof p === "string" && p.length > 0).toBe(true);
    expect(new Set(phrases).size).toBe(reasons.length); // all distinct
  });

  it("returns null for unknown / missing reasons", () => {
    expect(enrichmentSkipReason("nonsense")).toBeNull();
    expect(enrichmentSkipReason(undefined)).toBeNull();
    expect(enrichmentSkipReason(null)).toBeNull();
  });
});
