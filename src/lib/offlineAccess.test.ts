/** The offline front door: per-account bundles in plain localStorage (readable
 *  before any key exists — see the module header for the honest trade-off).
 *  localStorage is stubbed with a Map, same pattern as bioEnrollment.test.ts. */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import type { MeResponse } from "./api/authApi";
import {
  clearOfflineBio,
  clearOfflineBundle,
  getLastOfflineBundle,
  getOfflineBundle,
  saveOfflineBio,
  saveOfflineBundle,
} from "./offlineAccess";

function stubStorage() {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
  return map;
}

const USER: MeResponse = {
  id: "u1",
  email: "a@example.com",
  status: "active",
  role: "user",
  onboarding_pending: false,
  ui_language: "de",
};
const KM = {
  wrap_pw: "wrapped-mk",
  kdf_salt: "salt",
  kdf_params: { alg: "argon2id" as const, ops: 2, mem: 67108864, v: 19 },
};

describe("offlineAccess", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = stubStorage();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips the bundle and tracks the last account", () => {
    saveOfflineBundle(USER, KM);
    const b = getOfflineBundle("u1");
    expect(b?.km.wrap_pw).toBe("wrapped-mk");
    expect(b?.user).toEqual({ id: "u1", email: "a@example.com", role: "user", ui_language: "de" });
    expect(getLastOfflineBundle()?.user.id).toBe("u1");
  });

  it("stores only the minimal profile — never the whole /auth/me response", () => {
    // identity_priv_wrapped etc. have no business in plain localStorage.
    saveOfflineBundle({ ...USER, identity_priv_wrapped: "SECRETISH" } as MeResponse, KM);
    expect(store.get("quon_offline_v1")).not.toContain("SECRETISH");
  });

  it("the last pointer follows the most recent unlock across accounts", () => {
    saveOfflineBundle(USER, KM);
    saveOfflineBundle({ ...USER, id: "u2", email: "b@example.com" }, KM);
    expect(getLastOfflineBundle()?.user.id).toBe("u2");
    expect(getOfflineBundle("u1")).not.toBeNull(); // both remain unlockable
  });

  it("bio material attaches to an existing bundle and survives a km refresh", () => {
    saveOfflineBundle(USER, KM);
    saveOfflineBio("u1", "cred-1", { wrap_bio: "wb", prf_salt: "ps" });
    expect(getOfflineBundle("u1")?.bio?.credential_id).toBe("cred-1");
    // A later password unlock refreshes the km — the bio door must survive.
    saveOfflineBundle(USER, { ...KM, wrap_pw: "rewrapped" });
    const b = getOfflineBundle("u1");
    expect(b?.km.wrap_pw).toBe("rewrapped");
    expect(b?.bio?.credential_id).toBe("cred-1");
  });

  it("bio material without a bundle is a no-op (cannot render a shell from it)", () => {
    saveOfflineBio("ghost", "cred-9", { wrap_bio: "wb", prf_salt: "ps" });
    expect(getOfflineBundle("ghost")).toBeNull();
  });

  it("clearOfflineBio removes only the bio door", () => {
    saveOfflineBundle(USER, KM);
    saveOfflineBio("u1", "cred-1", { wrap_bio: "wb", prf_salt: "ps" });
    clearOfflineBio("u1");
    const b = getOfflineBundle("u1");
    expect(b?.bio).toBeUndefined();
    expect(b?.km.wrap_pw).toBe("wrapped-mk");
  });

  it("logout erases the account's front door entirely", () => {
    saveOfflineBundle(USER, KM);
    clearOfflineBundle("u1");
    expect(getOfflineBundle("u1")).toBeNull();
    expect(getLastOfflineBundle()).toBeNull();
  });

  it("corrupt or throwing storage degrades to 'nothing cached'", () => {
    store.set("quon_offline_v1", "not json");
    expect(getLastOfflineBundle()).toBeNull();
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
    expect(() => saveOfflineBundle(USER, KM)).not.toThrow();
    expect(getOfflineBundle("u1")).toBeNull();
  });
});
