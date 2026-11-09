/**
 * Identity lifecycle in the auth store - the seams Shared Projects builds on:
 * ensureIdentity registers exactly one keypair (wrapped under the MK, set-once),
 * login installs identity material the server already has, the 409 race adopts
 * the other tab's identity via /auth/me, and logout drops the keys. All network
 * calls are mocked; the crypto (Argon2, secretbox, sealed boxes) is real.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api/authApi", () => ({
  authApi: {
    kdf: vi.fn(),
    login: vi.fn(),
    me: vi.fn(),
    logout: vi.fn(async () => ({ ok: true })),
    setIdentity: vi.fn(),
  },
}));

import { authApi, type MeResponse } from "./api/authApi";
import { ApiError } from "./api/http";
import { ensureIdentity, getIdentityKeys, login, logout } from "./authStore";
import {
  base64ToBytes,
  buildRegistration,
  bytesToBase64,
  generateIdentityKeypair,
  generateProjectKey,
  openSealedFromIdentity,
  sealToIdentity,
  wrapIdentityPriv,
  type RegistrationMaterial,
} from "./crypto/quonCrypto";

const PW = "correct horse battery staple";
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const mocked = vi.mocked(authApi);

// One real registration for the whole file (Argon2 is expensive); each test
// re-runs the login path against its wire material.
let material: RegistrationMaterial;
let masterKey: Uint8Array;

beforeAll(async () => {
  ({ material, masterKey } = await buildRegistration(PW));
}, 60000);

function user(extra: Partial<MeResponse> = {}): MeResponse {
  return {
    id: "u1",
    email: "a@example.com",
    status: "active",
    onboarding_pending: false,
    identity_pub: null,
    identity_priv_wrapped: null,
    ...extra,
  };
}

async function loginAs(u: MeResponse): Promise<void> {
  mocked.kdf.mockResolvedValue({ kdf_salt: material.kdfSalt, kdf_params: material.kdfParams });
  mocked.login.mockResolvedValue({
    user: u,
    key_material: {
      wrap_pw: material.wrapPw,
      kdf_salt: material.kdfSalt,
      kdf_params: material.kdfParams,
    },
  });
  await login(u.email, PW);
}

beforeEach(async () => {
  vi.clearAllMocks();
  mocked.logout.mockResolvedValue({ ok: true });
  await logout(); // drops MK, identity keys and project keys between tests
});

describe("ensureIdentity", () => {
  it("throws when the app is locked (no Master Key)", async () => {
    await expect(ensureIdentity()).rejects.toThrow(/unlock/i);
  });

  it("generates, wraps and registers a keypair exactly once; the wrapped priv opens under the MK", async () => {
    await loginAs(user());
    expect(getIdentityKeys()).toBeNull(); // lazy - login alone mints nothing

    mocked.setIdentity.mockResolvedValue({ ok: true });
    const { pub } = await ensureIdentity();

    expect(mocked.setIdentity).toHaveBeenCalledTimes(1);
    const body = mocked.setIdentity.mock.calls[0][0];
    expect(eq(base64ToBytes(body.identity_pub), pub)).toBe(true);

    // The registered material is self-consistent: a project key sealed to the
    // registered pub opens with the held keypair (i.e. priv matches pub and
    // survived the wrap -> the server-side copy is usable on the next device).
    const id = getIdentityKeys()!;
    const pk = generateProjectKey();
    expect(eq(openSealedFromIdentity(sealToIdentity(pk, id.pub), id.pub, id.priv), pk)).toBe(true);

    // Second call is a no-op (no second registration).
    await ensureIdentity();
    expect(mocked.setIdentity).toHaveBeenCalledTimes(1);
  }, 30000);

  it("adopts the winning identity via /auth/me on a 409 set-once race", async () => {
    await loginAs(user());
    const winner = generateIdentityKeypair(); // the other tab's keypair
    const winnerUser = user({
      identity_pub: bytesToBase64(winner.pub),
      identity_priv_wrapped: wrapIdentityPriv(winner.priv, masterKey),
    });
    mocked.setIdentity.mockRejectedValue(new ApiError(409, "identity already set"));
    mocked.me.mockResolvedValue(winnerUser);

    const { pub } = await ensureIdentity();
    expect(eq(pub, winner.pub)).toBe(true);
    expect(eq(getIdentityKeys()!.priv, winner.priv)).toBe(true);
  }, 30000);

  it("surfaces non-409 registration failures", async () => {
    await loginAs(user());
    mocked.setIdentity.mockRejectedValue(new ApiError(500, "boom"));
    await expect(ensureIdentity()).rejects.toThrow("boom");
    expect(getIdentityKeys()).toBeNull(); // nothing half-installed
  }, 30000);
});

describe("identity install on login / drop on logout", () => {
  it("unwraps identity material carried by the login response (no network mint)", async () => {
    const id = generateIdentityKeypair();
    await loginAs(
      user({
        identity_pub: bytesToBase64(id.pub),
        identity_priv_wrapped: wrapIdentityPriv(id.priv, masterKey),
      }),
    );
    expect(eq(getIdentityKeys()!.pub, id.pub)).toBe(true);
    expect(eq(getIdentityKeys()!.priv, id.priv)).toBe(true);

    await ensureIdentity(); // already held -> must not re-register
    expect(mocked.setIdentity).not.toHaveBeenCalled();
  }, 30000);

  it("treats identity material that does not open under this MK as absent (login survives)", async () => {
    const id = generateIdentityKeypair();
    const foreignMk = generateProjectKey(); // 32 random bytes = some other MK
    await loginAs(
      user({
        identity_pub: bytesToBase64(id.pub),
        identity_priv_wrapped: wrapIdentityPriv(id.priv, foreignMk),
      }),
    );
    expect(getIdentityKeys()).toBeNull(); // fail soft: unlocked, but no identity
  }, 30000);

  it("logout drops the identity keypair", async () => {
    await loginAs(user());
    mocked.setIdentity.mockResolvedValue({ ok: true });
    await ensureIdentity();
    expect(getIdentityKeys()).not.toBeNull();

    await logout();
    expect(getIdentityKeys()).toBeNull();
  }, 30000);
});
