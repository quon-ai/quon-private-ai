/** Typed client for the QUON auth endpoints. */

import type { KdfParams } from "@/lib/crypto/quonCrypto";
import { apiFetch } from "./http";

export interface MeResponse {
  id: string;
  email: string;
  status: string;
  /** 'user' | 'admin' - gates the /admin UI (the server re-checks every admin
   *  endpoint; this only controls visibility). Optional for cached/legacy
   *  responses, absent = 'user'. */
  role?: "user" | "admin";
  /** True exactly once, on the /auth/verify response for a brand-new signup -
   *  the one unambiguous server-observable "this account just came alive"
   *  event (verify and the later unlock() may happen on different devices, so
   *  nothing client-only can substitute). Always false elsewhere (login/me/
   *  reset/change-*), including for this same account on every later call. */
  onboarding_pending: boolean;
  /** X25519 identity public key for Shared Projects (base64), null until the
   *  account registers one via POST /auth/identity. */
  identity_pub?: string | null;
  /** The matching private key wrapped under the Master Key (base64) - opaque to
   *  the server, unwrapped client-side on login/unlock (CTX "quonidk0"). */
  identity_priv_wrapped?: string | null;
  /** Account-bound UI language ("de"|"en"), or null when the account has no
   *  explicit choice yet. Populated on login and /auth/me. */
  ui_language?: "de" | "en" | null;
}

/** Set-once identity registration (POST /auth/identity). The server answers 409
 *  when an identity already exists - another tab/device won the race; re-fetch
 *  /auth/me and adopt theirs (see authStore.ensureIdentity). */
export interface IdentityBody {
  identity_pub: string;
  identity_priv_wrapped: string;
}

export interface KeyMaterial {
  wrap_pw: string;
  kdf_salt: string;
  kdf_params: KdfParams;
}

export interface KdfResponse {
  kdf_salt: string;
  kdf_params: KdfParams;
}

export interface AuthResult {
  user: MeResponse;
  key_material: KeyMaterial;
}

export interface RegisterBody {
  email: string;
  /** Closed-beta invite code; omitted/ignored when the server has none configured. */
  invite_code?: string;
  /** Accepted Nutzungsvereinbarung version (src/lib/legal.ts TERMS_VERSION). */
  terms_version?: string;
  /** Chosen UI language ("de"|"en") - stored on the account + used for the
   *  verification email. */
  language?: string;
  auth_token: string;
  kdf_salt: string;
  kdf_params: KdfParams;
  wrap_pw: string;
  rec_salt: string;
  wrap_rec: string;
}

export interface ResetMaterial {
  rec_salt: string;
  wrap_rec: string;
  kdf_params: KdfParams;
}

export interface ResetPasswordBody {
  token: string;
  auth_token: string;
  kdf_salt: string;
  kdf_params: KdfParams;
  wrap_pw: string;
}

export interface ChangePasswordBody {
  /** Proves the current password (authToken derived from it). */
  current_auth_token: string;
  /** New password material - the Master Key re-wrapped under the new password. */
  auth_token: string;
  kdf_salt: string;
  kdf_params: KdfParams;
  wrap_pw: string;
}

/** Biometric-unlock wrap of the Master Key (WebAuthn PRF; /auth/bio). */
export interface BioKeyMaterial {
  wrap_bio: string;
  prf_salt: string;
}

export const authApi = {
  register: (b: RegisterBody) =>
    apiFetch<MeResponse>("/auth/register", { method: "POST", body: JSON.stringify(b) }),
  kdf: (email: string) => apiFetch<KdfResponse>(`/auth/kdf?email=${encodeURIComponent(email)}`),
  login: (email: string, auth_token: string) =>
    apiFetch<AuthResult>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, auth_token }),
    }),
  verify: (token: string) =>
    apiFetch<MeResponse>("/auth/verify", { method: "POST", body: JSON.stringify({ token }) }),
  logout: () => apiFetch<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  me: () => apiFetch<MeResponse>("/auth/me"),
  keymaterial: () => apiFetch<KeyMaterial>("/auth/keymaterial"),
  requestReset: (email: string) =>
    apiFetch<{ ok: boolean }>("/auth/reset/request", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  resetMaterial: (token: string) =>
    apiFetch<ResetMaterial>(`/auth/reset/material?token=${encodeURIComponent(token)}`),
  resetPassword: (b: ResetPasswordBody) =>
    apiFetch<MeResponse>("/auth/reset-password", { method: "POST", body: JSON.stringify(b) }),
  changeEmailRequest: (new_email: string) =>
    apiFetch<{ ok: boolean }>("/auth/change-email/request", {
      method: "POST",
      body: JSON.stringify({ new_email }),
    }),
  changeEmailConfirm: (token: string) =>
    apiFetch<MeResponse>("/auth/change-email/confirm", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  changePassword: (b: ChangePasswordBody) =>
    apiFetch<MeResponse>("/auth/change-password", { method: "POST", body: JSON.stringify(b) }),
  rotateRecovery: (b: { current_auth_token: string; rec_salt: string; wrap_rec: string }) =>
    apiFetch<{ ok: boolean }>("/auth/recovery/rotate", { method: "POST", body: JSON.stringify(b) }),
  setIdentity: (b: IdentityBody) =>
    apiFetch<{ ok: boolean }>("/auth/identity", { method: "POST", body: JSON.stringify(b) }),
  deleteAccount: (auth_token: string) =>
    apiFetch<{ ok: boolean }>("/auth/delete-account", {
      method: "POST",
      body: JSON.stringify({ auth_token }),
    }),
  setUiLanguage: (language: "de" | "en") =>
    apiFetch<{ ok: boolean; language: string }>("/auth/ui-language", {
      method: "PUT",
      body: JSON.stringify({ language }),
    }),
  bioGet: (credentialId: string) =>
    apiFetch<BioKeyMaterial>(`/auth/bio?credential_id=${encodeURIComponent(credentialId)}`),
  bioPut: (b: { credential_id: string; wrap_bio: string; prf_salt: string }) =>
    apiFetch<{ ok: boolean }>("/auth/bio", { method: "PUT", body: JSON.stringify(b) }),
  bioDelete: (credentialId: string) =>
    apiFetch<{ ok: boolean }>(`/auth/bio?credential_id=${encodeURIComponent(credentialId)}`, {
      method: "DELETE",
    }),
};
