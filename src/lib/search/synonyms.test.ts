import { describe, expect, it } from "vitest";

import { synonymsOf } from "./synonyms";

describe("synonymsOf", () => {
  it("is bidirectional within a cluster", () => {
    expect(synonymsOf("einkommen")).toContain("gehalt");
    expect(synonymsOf("gehalt")).toContain("einkommen");
  });

  it("never includes the term itself", () => {
    expect(synonymsOf("einkommen")).not.toContain("einkommen");
  });

  it("returns [] for a word that is not in any curated cluster", () => {
    expect(synonymsOf("talbach")).toEqual([]);
    expect(synonymsOf("ferritin")).toEqual([]);
  });

  it("spans DE + EN in the income cluster", () => {
    expect(synonymsOf("gehalt")).toEqual(
      expect.arrayContaining(["income", "salary", "wage", "earnings"]),
    );
  });

  describe("deliberately rejected clusters stay rejected", () => {
    it("'Wohnung' (apartment) is NOT connected to 'Adresse' (postal address)", () => {
      expect(synonymsOf("wohnung")).toEqual([]);
      expect(synonymsOf("adresse")).not.toContain("wohnung");
    });

    it("the bare word 'nummer' is not a cluster member at all", () => {
      expect(synonymsOf("nummer")).toEqual([]);
      expect(synonymsOf("rufnummer")).not.toContain("nummer");
    });

    it("a general 'arbeit'/'job' cluster was left out entirely", () => {
      expect(synonymsOf("arbeit")).toEqual([]);
    });
  });
});
