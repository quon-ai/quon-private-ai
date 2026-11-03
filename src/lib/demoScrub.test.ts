import { describe, expect, it } from "vitest";

import { DEMO_SAMPLE, placeholderType, splitByPlaceholders } from "./demoScrub";

describe("placeholderType", () => {
  it("reads the type out of a typed placeholder", () => {
    expect(placeholderType("[EMAIL_1]")).toBe("EMAIL");
    // Placeholders carry one word per type (entities.py), never the type's
    // internal name: FINANCIAL_AMOUNT renders as [AMOUNT_n].
    expect(placeholderType("[AMOUNT_12]")).toBe("AMOUNT");
  });

  it("is UNKNOWN for anything that is not a placeholder", () => {
    expect(placeholderType("EMAIL_1")).toBe("UNKNOWN");
    expect(placeholderType("[email_1]")).toBe("UNKNOWN");
  });
});

describe("splitByPlaceholders", () => {
  it("keeps plain text and placeholders in order", () => {
    expect(splitByPlaceholders("Hi [PERSON_1], mail [EMAIL_1].")).toEqual([
      { kind: "text", text: "Hi " },
      { kind: "placeholder", text: "[PERSON_1]", type: "PERSON" },
      { kind: "text", text: ", mail " },
      { kind: "placeholder", text: "[EMAIL_1]", type: "EMAIL" },
      { kind: "text", text: "." },
    ]);
  });

  it("handles a text without placeholders and an empty text", () => {
    expect(splitByPlaceholders("nothing here")).toEqual([{ kind: "text", text: "nothing here" }]);
    expect(splitByPlaceholders("")).toEqual([]);
  });

  it("handles adjacent placeholders at both ends", () => {
    expect(splitByPlaceholders("[A_1][B_2]")).toEqual([
      { kind: "placeholder", text: "[A_1]", type: "A" },
      { kind: "placeholder", text: "[B_2]", type: "B" },
    ]);
  });
});

describe("DEMO_SAMPLE", () => {
  it("contains only synthetic values", () => {
    for (const text of Object.values(DEMO_SAMPLE)) {
      expect(text).toMatch(/example\.org/);
      expect(text).toContain("DE89 3704 0044 0532 0130 00");
    }
  });
});
