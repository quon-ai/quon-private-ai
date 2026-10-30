/** The base64url helpers back credential-id handling for WebAuthn (unpadded,
 *  URL-safe — the format credential.id natively uses). The ceremony functions
 *  themselves need a real authenticator and are covered by the chromium e2e. */
import { describe, expect, it } from "vitest";

import { b64urlToBytes, bytesToB64url } from "./webauthnBio";

describe("webauthnBio base64url", () => {
  it("round-trips arbitrary bytes", () => {
    const cases = [
      new Uint8Array([]),
      new Uint8Array([0]),
      new Uint8Array([251, 255, 191]), // produces +/ chars in plain base64
      crypto.getRandomValues(new Uint8Array(33)), // non-multiple-of-3 → padding
    ];
    for (const bytes of cases) {
      const s = bytesToB64url(bytes);
      expect(s).not.toMatch(/[+/=]/); // URL-safe, unpadded
      expect(Array.from(b64urlToBytes(s))).toEqual(Array.from(bytes));
    }
  });

  it("decodes WebAuthn-style unpadded ids", () => {
    // "test" → dGVzdA (unpadded)
    expect(new TextDecoder().decode(b64urlToBytes("dGVzdA"))).toBe("test");
  });
});
