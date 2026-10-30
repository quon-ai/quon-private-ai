import { describe, expect, it } from "vitest";

import { buildSentText, type ReviewItem } from "./ReviewPanel";

const item = (p: Partial<ReviewItem> & Pick<ReviewItem, "placeholder" | "value" | "active">) =>
  ({ type: "PERSON", ...p }) as ReviewItem;

describe("buildSentText", () => {
  const base = "Hi [PERSON_1], call [PHONE_1]. Code is hunter2";

  it("keeps detected items redacted, un-redacts toggled-off ones, applies manual ones", () => {
    const out = buildSentText(base, [
      item({ placeholder: "[PERSON_1]", value: "Anna", active: true }), // stays redacted
      item({ placeholder: "[PHONE_1]", value: "+49 30 1", active: false }), // sent real
      item({ placeholder: "[CRED_1]", value: "hunter2", active: true, isManual: true }), // user redacted
    ]);
    expect(out).toBe("Hi [PERSON_1], call +49 30 1. Code is [CRED_1]");
  });

  it("never sends a value the user kept redacted", () => {
    const out = buildSentText(base, [
      item({ placeholder: "[PERSON_1]", value: "Anna", active: true }),
    ]);
    expect(out).not.toContain("Anna");
    expect(out).toContain("[PERSON_1]");
  });

  it("ignores an inactive manual selection", () => {
    const out = buildSentText(base, [
      item({ placeholder: "[CRED_1]", value: "hunter2", active: false, isManual: true }),
    ]);
    expect(out).toBe(base); // hunter2 left as-is, nothing applied
  });
});
