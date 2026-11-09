/** Device-local biometric-enrollment marker: per-user isolation, corruption
 *  safety, and the storage-unavailable degrade path (feature hides, never
 *  throws). localStorage is stubbed with a Map - vitest's node env has none
 *  (same pattern as pendingJoin.test.ts). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BIO_TROUBLE_THRESHOLD,
  bioFailureCount,
  bioLooksBroken,
  bioOfferDismissed,
  clearBioFailures,
  clearBioMarker,
  dismissBioOffer,
  getBioMarker,
  recordBioFailure,
  setBioMarker,
} from "./bioEnrollment";

const KEY = "quon_bio_v1";

function stubStorage() {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
  return map;
}

describe("bioEnrollment marker", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = stubStorage();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("set -> get round-trips and is scoped per user", () => {
    setBioMarker("user-a", { credentialId: "cred-a", createdAt: 1 });
    setBioMarker("user-b", { credentialId: "cred-b", createdAt: 2 });

    expect(getBioMarker("user-a")?.credentialId).toBe("cred-a");
    expect(getBioMarker("user-b")?.credentialId).toBe("cred-b");
    expect(getBioMarker("user-c")).toBeNull();
  });

  it("clear removes only the given user's marker", () => {
    setBioMarker("user-a", { credentialId: "cred-a", createdAt: 1 });
    setBioMarker("user-b", { credentialId: "cred-b", createdAt: 2 });
    clearBioMarker("user-a");

    expect(getBioMarker("user-a")).toBeNull();
    expect(getBioMarker("user-b")?.credentialId).toBe("cred-b");
  });

  it("re-enrollment overwrites the previous marker", () => {
    setBioMarker("user-a", { credentialId: "old", createdAt: 1 });
    setBioMarker("user-a", { credentialId: "new", createdAt: 2 });
    expect(getBioMarker("user-a")?.credentialId).toBe("new");
  });

  it("corrupted storage reads as no marker, never throws", () => {
    store.set(KEY, "{not json");
    expect(getBioMarker("user-a")).toBeNull();
    store.set(KEY, JSON.stringify({ "user-a": { credentialId: 42 } }));
    expect(getBioMarker("user-a")).toBeNull();
    store.set(KEY, JSON.stringify(null));
    expect(getBioMarker("user-a")).toBeNull();
  });

  it("the one-time offer flag is per-user and defaults to not-dismissed", () => {
    expect(bioOfferDismissed("user-a")).toBe(false);
    dismissBioOffer("user-a");
    expect(bioOfferDismissed("user-a")).toBe(true);
    expect(bioOfferDismissed("user-b")).toBe(false); // independent per user
  });

  it("storage that throws degrades to no-ops", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    });
    expect(() => setBioMarker("u", { credentialId: "c", createdAt: 1 })).not.toThrow();
    expect(getBioMarker("u")).toBeNull();
    expect(() => clearBioMarker("u")).not.toThrow();
  });
});

/**
 * The lost-passkey streak: an OS update can delete the passkey while the
 * marker and the server wrap survive, so every unlock dead-ends. WebAuthn
 * cannot tell "credential gone" from "user cancelled", so the detector is a
 * consecutive-failure streak that a success resets.
 */
describe("lost-passkey failure streak", () => {
  beforeEach(() => {
    stubStorage();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("counts consecutive failures per user", () => {
    expect(bioFailureCount("u1")).toBe(0);
    expect(recordBioFailure("u1")).toBe(1);
    expect(recordBioFailure("u1")).toBe(2);
    expect(bioFailureCount("u1")).toBe(2);
    expect(bioFailureCount("u2")).toBe(0); // independent per user
  });

  it("a success resets the streak: one-off cancels never accumulate", () => {
    recordBioFailure("u1");
    clearBioFailures("u1");
    expect(bioFailureCount("u1")).toBe(0);
    expect(recordBioFailure("u1")).toBe(1); // starts fresh
  });

  it("looks broken only when enrolled AND at the threshold", () => {
    // Failures without an enrollment marker are not "broken" - nothing to fix.
    for (let i = 0; i < BIO_TROUBLE_THRESHOLD; i++) recordBioFailure("u1");
    expect(bioLooksBroken("u1")).toBe(false);

    setBioMarker("u1", { credentialId: "c1", createdAt: 1 });
    expect(bioLooksBroken("u1")).toBe(true);

    // Below the threshold: enrolled but not suspicious.
    clearBioFailures("u1");
    recordBioFailure("u1");
    expect(bioLooksBroken("u1")).toBe(false);
  });

  it("corrupt storage counts as zero", () => {
    localStorage.setItem("quon_bio_trouble_v1", "not json");
    expect(bioFailureCount("u1")).toBe(0);
    localStorage.setItem("quon_bio_trouble_v1", JSON.stringify({ u1: "many" }));
    expect(bioFailureCount("u1")).toBe(0);
  });

  it("storage that throws degrades to no-ops", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    });
    expect(() => recordBioFailure("u")).not.toThrow();
    expect(bioFailureCount("u")).toBe(0);
    expect(() => clearBioFailures("u")).not.toThrow();
  });
});
