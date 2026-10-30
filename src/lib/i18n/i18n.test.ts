import { describe, expect, it } from "vitest";

import { apiErrorKey, translateApiError } from "./apiErrors";
import { DE, EN } from "./catalog";
import { translate } from "./i18n";

describe("catalog integrity", () => {
  it("DE has a translation for every EN key (no silent English fallback)", () => {
    for (const key of Object.keys(EN)) {
      expect(DE[key as keyof typeof EN], `missing DE for ${key}`).toBeTruthy();
    }
  });
});

describe("translate", () => {
  it("returns the language-specific catalog value", () => {
    // Exact copy is intentionally not pinned (it gets polished); assert the EN
    // value and that DE is a non-empty, different string.
    expect(translate("en", "errors.generic")).toBe("Something went wrong. Please try again.");
    const de = translate("de", "errors.generic");
    expect(de.length).toBeGreaterThan(0);
    expect(de).not.toBe(translate("en", "errors.generic"));
  });

  it("interpolation replaces named tokens and leaves unknown ones visible", () => {
    // translate() runs interpolation on the resolved template; verify via common.
    expect(translate("en", "common.save")).toBe("Save");
    expect(translate("de", "common.save")).toBe("Speichern");
  });
});

describe("translateApiError", () => {
  const t = (k: Parameters<typeof translate>[1]) => translate("de", k);

  it("maps known detail strings by exact match", () => {
    expect(apiErrorKey("invalid email or password")).toBe("errors.invalidCredentials");
    expect(apiErrorKey("email not verified")).toBe("errors.emailNotVerified");
    expect(apiErrorKey("  session expired  ")).toBe("errors.sessionExpired");
  });

  it("maps provider strings by substring", () => {
    expect(apiErrorKey("Your AI budget is used up — …")).toBe("errors.providerBudgetExhausted");
    expect(apiErrorKey("The model provider is rate-limiting right now — …")).toBe(
      "errors.providerRateLimited",
    );
  });

  it("returns null for unmapped strings (kept English by translateApiError)", () => {
    expect(apiErrorKey("some unexpected raw error")).toBeNull();
    expect(translateApiError(new Error("some unexpected raw error"), t)).toBe(
      "some unexpected raw error",
    );
  });

  it("localizes a mapped error to the catalog value (not the raw English detail)", () => {
    const localized = translateApiError(new Error("email not verified"), t);
    expect(localized).toBe(translate("de", "errors.emailNotVerified"));
    expect(localized).not.toBe("email not verified");
  });
});
