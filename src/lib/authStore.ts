/**
 * Auth + session state, shared across the app via useSyncExternalStore.
 *
 * State machine:
 *   loading     - checking the session on boot
 *   anonymous   - no session (show login / register)
 *   locked      - valid session but the Master Key isn't in memory (needs password)
 *   ready       - session + Master Key unlocked; the app can encrypt/decrypt
 *   unreachable - couldn't reach QUON on boot (network / server error / timeout).
 *                 not the same as anonymous: the session may well be valid, we just
 *                 can't confirm it. The Master Key is kept so a retry resumes
 *                 straight to ready/locked instead of forcing a full re-login.
 *
 * The Master Key lives in memory (and sessionStorage within a tab, so a reload
 * stays unlocked). It is never persisted to localStorage or sent to the server.
 */

import { useSyncExternalStore } from "react";

import { ApiError } from "./api/http";
import { authApi, type BioKeyMaterial, type KeyMaterial, type MeResponse } from "./api/authApi";
import { clearCsrf } from "./api/csrf";
import { clearPendingChatMessage } from "./pendingChatMessage";
import { clearFolderGrant } from "./tools/folderGrant";
import {
  clearOfflineBio,
  clearOfflineBundle,
  getLastOfflineBundle,
  getOfflineBundle,
  saveOfflineBundle,
  type OfflineBundle,
} from "./offlineAccess";
import { clearBioMarker, getBioMarker, setBioMarker } from "./bioEnrollment";
import * as qc from "./crypto/quonCrypto";
import { TERMS_VERSION } from "./legal";
import { clearLocalCacheKey, setLocalCacheKey } from "./localVault";
import { adoptLang } from "./i18n/i18n";
import { getLangPref, isLang } from "./langPref";
import { captureEligibility } from "./onboardingStore";
import { setUnauthorizedHandler } from "./quonApi";
import { clearProjectKeys } from "./sharedKeyStore";
import { BioPrfUnavailableError, createBioCredential, evalPrf } from "./webauthnBio";

export type AuthStatus = "loading" | "anonymous" | "locked" | "ready" | "unreachable";

// Boot check must not hang forever: a *frozen* backend (vs. a cleanly refused
// connection) would otherwise leave the app on a blank loading screen. After this
// we fall to the `unreachable` retry state.
const BOOT_TIMEOUT_MS = 6000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("boot timeout")), ms)),
  ]);
}

/**
 * Classify a failure of the boot `me()` check. Only a genuine 401/403 means the
 * session is gone (-> re-login). Everything else - a fetch TypeError, a 5xx, or
 * our own timeout - means we simply couldn't reach QUON, and must not trigger a
 * silent logout. Pure + exported so the fail-closed rule is unit-tested directly.
 */
export function classifyBootError(e: unknown): "anonymous" | "unreachable" {
  return e instanceof ApiError && (e.status === 401 || e.status === 403)
    ? "anonymous"
    : "unreachable";
}

interface AuthState {
  status: AuthStatus;
  user: MeResponse | null;
  /** True when this state was reached without the server: the shell renders
   *  from the offline bundle and the encrypted local caches. Read-mostly mode -
   *  sending is already fail-closed elsewhere; a reconnect watcher upgrades to
   *  a real session as soon as the network returns. */
  offline: boolean;
}

let state: AuthState = { status: "loading", user: null, offline: false };
let masterKey: Uint8Array | null = null;
// X25519 identity keypair for Shared Projects - unwrapped from the login/me
// response (identity_priv_wrapped) under the MK; memory-only, like the MK's
// derived keys. Restored on every boot from the server response, so it needs
// no at-rest cache of its own.
let identityKeys: qc.IdentityKeypair | null = null;
const listeners = new Set<() => void>();
const readyListeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function set(patch: Partial<AuthState>) {
  // `offline` is sticky only within an explicit offline transition - any state
  // change that doesn't say otherwise means we talked to the server.
  state = { ...state, offline: false, ...patch };
  emit();
  if (state.status === "ready") for (const l of readyListeners) l();
}

function setMasterKey(mk: Uint8Array | null) {
  masterKey = mk;
  if (mk) {
    void qc.persistMasterKey(mk);
    // Unlock the at-rest encryption of the local caches (chat history,
    // Memory/Documents, preferences) - stores deferred loading until now.
    setLocalCacheKey(qc.deriveLocalCacheKey(mk));
  } else {
    qc.clearPersistedMasterKey();
    clearLocalCacheKey();
    // All key material shares the MK's lifetime: identity keypair and the
    // shared-project keyring die on logout / account switch / deletion too.
    identityKeys = null;
    clearProjectKeys();
  }
}

/** Unwrap and hold the account's identity private key when a server response
 *  carries identity material (registered once via ensureIdentity, then returned
 *  by login/me). A blob that doesn't open under this MK (corrupt or foreign) is
 *  treated as absent - the share flows re-register or fail loudly later; the
 *  login/unlock itself must never break on it. */
function installIdentity(user: MeResponse | null, mk: Uint8Array): qc.IdentityKeypair | null {
  if (!user?.identity_pub || !user.identity_priv_wrapped) return null;
  try {
    identityKeys = {
      pub: qc.base64ToBytes(user.identity_pub),
      priv: qc.openIdentityPriv(user.identity_priv_wrapped, mk),
    };
  } catch {
    identityKeys = null;
  }
  return identityKeys;
}

/** The unlocked Master Key, or null when locked/anonymous. */
export function getMasterKey(): Uint8Array | null {
  return masterKey;
}

/** The current account's user id (any non-anonymous state), or null. Used for
 *  per-user device-local markers like the agent-runner opt-in - a synchronous,
 *  non-hook accessor (mirrors getMasterKey). */
export function getActiveUserId(): string | null {
  return state.user?.id ?? null;
}

/** The unlocked identity keypair for Shared Projects, or null when the app is
 *  locked or the account has no identity yet (see ensureIdentity). */
export function getIdentityKeys(): qc.IdentityKeypair | null {
  return identityKeys;
}

/** Register a callback fired whenever the app reaches the `ready` state (used by
 *  the sync engine to start pulling). Returns an unsubscribe function. */
export function onReady(cb: () => void): () => void {
  readyListeners.add(cb);
  if (state.status === "ready") cb();
  return () => readyListeners.delete(cb);
}

export function useAuth(): AuthState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

/** Called once on app boot (and by the "retry" action) to resolve the initial
 *  state. Distinguishes a genuine "no session" (401/403 -> anonymous, re-login)
 *  from the server being unreachable (network error / 5xx / timeout ->
 *  `unreachable`, keep the Master Key and offer a retry). It must never silently
 *  wipe the session just because the scrubber is momentarily down. */
export async function initAuth(): Promise<void> {
  set({ status: "loading" });
  let me: MeResponse;
  try {
    me = await withTimeout(authApi.me(), BOOT_TIMEOUT_MS);
  } catch (e) {
    if (classifyBootError(e) === "anonymous") {
      // The session is genuinely gone -> re-login; the persisted key is now stale.
      setMasterKey(null);
      set({ status: "anonymous", user: null });
    } else if (!(await enterOfflineFromBoot())) {
      // Network failure / 5xx / timeout AND nothing cached to fall back on:
      // we can't confirm the session, but it may still be valid. Keep the
      // Master Key; show a retry instead of a fake logout.
      set({ status: "unreachable", user: null });
    }
    return;
  }
  if (me.status !== "active") {
    set({ status: "anonymous", user: null });
    return;
  }
  adoptAccountLang(me); // account language is authoritative once known
  const mk = await qc.loadPersistedMasterKey();
  if (mk) {
    setMasterKey(mk); // also re-installs the local-cache key after a reload
    installIdentity(me, mk);
    set({ status: "ready", user: me });
  } else {
    set({ status: "locked", user: me });
  }
}

/** The offline bundle's profile, shaped like the /auth/me response the rest of
 *  the app expects. Labels the UI only - no security decision hangs on it. */
function offlineUser(b: OfflineBundle): MeResponse {
  return {
    id: b.user.id,
    email: b.user.email,
    status: "active",
    role: b.user.role,
    onboarding_pending: false,
    ui_language: b.user.ui_language ?? null,
  };
}

/** Boot with no server: resume unlocked if the tab still holds the Master Key,
 *  otherwise land on the (offline-capable) unlock screen - the cached key
 *  material lets unlock()/biometric work without a round trip. Returns false
 *  when nothing is cached, and the caller falls back to the retry screen. */
async function enterOfflineFromBoot(): Promise<boolean> {
  const bundle = getLastOfflineBundle();
  if (!bundle) return false;
  const user = offlineUser(bundle);
  adoptAccountLang(user);
  watchForReconnect();
  const mk = await qc.loadPersistedMasterKey();
  if (mk) {
    setMasterKey(mk);
    set({ status: "ready", user, offline: true });
  } else {
    set({ status: "locked", user, offline: true });
  }
  return true;
}

/** While offline, quietly try to reach the server again (browser `online`
 *  event + a slow interval) and upgrade in place - without bouncing the UI
 *  through `loading`. A 401/403 on reconnect means the session expired while
 *  we were away: honest logout, exactly as if it had happened online. */
let reconnectTimer: ReturnType<typeof setInterval> | null = null;
function watchForReconnect(): void {
  if (reconnectTimer !== null || typeof window === "undefined") return;
  const attempt = async () => {
    if (!state.offline) return stopWatching();
    try {
      const me = await withTimeout(authApi.me(), BOOT_TIMEOUT_MS);
      stopWatching();
      if (me.status !== "active") {
        setMasterKey(null);
        set({ status: "anonymous", user: null });
        return;
      }
      adoptAccountLang(me);
      if (masterKey) {
        installIdentity(me, masterKey);
        set({ status: "ready", user: me });
      } else {
        set({ status: "locked", user: me });
      }
    } catch (e) {
      if (classifyBootError(e) === "anonymous") {
        stopWatching();
        setMasterKey(null);
        set({ status: "anonymous", user: null });
      }
      /* still unreachable - stay offline, try again later */
    }
  };
  const stopWatching = () => {
    if (reconnectTimer !== null) clearInterval(reconnectTimer);
    reconnectTimer = null;
    window.removeEventListener("online", onOnline);
  };
  const onOnline = () => void attempt();
  window.addEventListener("online", onOnline);
  reconnectTimer = setInterval(() => void attempt(), 30_000);
}

/** Switch the live UI language to the account's stored choice, if it has one.
 *  The account is authoritative over the device pref once known (login/me), so a
 *  new device inherits the language automatically. No-op when the account has no
 *  explicit language yet (keeps the device/default). */
function adoptAccountLang(user: MeResponse): void {
  if (isLang(user.ui_language)) adoptLang(user.ui_language);
}

/** Full login from the anonymous state: derive authToken, start a session,
 *  unlock the Master Key. */
export async function login(email: string, password: string): Promise<void> {
  const { kdf_salt, kdf_params } = await authApi.kdf(email);
  const { authToken, pwWrapKey } = await qc.deriveAuth(password, kdf_salt, kdf_params);
  const res = await authApi.login(email, authToken);
  const mk = qc.unlockMasterKey(res.key_material.wrap_pw, pwWrapKey);
  setMasterKey(mk);
  installIdentity(res.user, mk);
  adoptAccountLang(res.user);
  // The offline front door: with this cached, a dead network no longer means
  // a dead app (see offlineAccess.ts for the honest trade-off).
  saveOfflineBundle(res.user, res.key_material);
  set({ status: "ready", user: res.user });
}

/** Unlock the Master Key for an existing session (the `locked` state). */
export async function unlock(password: string): Promise<void> {
  let km: KeyMaterial;
  let offline = false;
  try {
    km = await authApi.keymaterial();
  } catch (e) {
    // No server in reach (a 401 means the session died - that must surface,
    // not silently degrade): unlock against the cached key material instead.
    // The password proves ownership locally; the server was never part of the
    // MK derivation anyway (zero-knowledge).
    const cached = state.user ? getOfflineBundle(state.user.id) : getLastOfflineBundle();
    if (classifyBootError(e) === "anonymous" || !cached) throw e;
    km = cached.km;
    offline = true;
  }
  const { pwWrapKey } = await qc.deriveAuth(password, km.kdf_salt, km.kdf_params);
  const mk = qc.unlockMasterKey(km.wrap_pw, pwWrapKey);
  setMasterKey(mk);
  installIdentity(state.user, mk); // /auth/me (the `locked` state) carried it
  if (!offline && state.user) saveOfflineBundle(state.user, km);
  if (offline) watchForReconnect();
  set({ status: "ready", offline });
}

// --- biometric unlock (WebAuthn PRF) ---------------------------------------
// wrap_bio = secretbox(MK, KDF(prfOutput, "quonbio0")) - a third wrap of the
// same MK, so it survives password changes exactly like the recovery phrase
// does (the Settings card says so; "Turn off" is the explicit revoke).

/** Enroll this device for biometric unlock. Requires `ready` (the MK is
 *  wrapped). Create-then-get: several platforms (notably iOS) return PRF
 *  results only on get(), so after create + prf.enabled check we run one
 *  immediate assertion - the user confirms twice, the card copy warns.
 *  Throws BioPrfUnavailableError (fail honest - nothing enrolled) and
 *  BioCancelledError (caller resets silently). */
export async function enrollBiometric(): Promise<void> {
  const mk = getMasterKey();
  if (!mk || !state.user) throw new Error("Unlock QUON first to enable biometric unlock.");
  const { credentialId, prfEnabled } = await createBioCredential(state.user.id, state.user.email);
  if (!prfEnabled) throw new BioPrfUnavailableError();
  const prfSalt = crypto.getRandomValues(new Uint8Array(32));
  const prfOutput = await evalPrf(credentialId, prfSalt);
  const bioWrapKey = await qc.deriveBioWrapKey(prfOutput);
  await authApi.bioPut({
    credential_id: credentialId,
    wrap_bio: await qc.wrapMasterKeyForBio(mk, bioWrapKey),
    prf_salt: qc.bytesToBase64(prfSalt),
  });
  setBioMarker(state.user.id, { credentialId, createdAt: Date.now() });
}

/** Unlock from `locked` with the device biometric. `km` is prefetched by
 *  ScreenUnlock so credentials.get() runs inside the click's transient
 *  activation (Safari requirement) - no network before the prompt. Mirrors
 *  unlock() exactly once the MK is recovered. */
export async function unlockWithBiometric(credentialId: string, km: BioKeyMaterial): Promise<void> {
  const prfOutput = await evalPrf(credentialId, qc.base64ToBytes(km.prf_salt));
  const bioWrapKey = await qc.deriveBioWrapKey(prfOutput);
  const mk = await qc.unlockMasterKeyBio(km.wrap_bio, bioWrapKey);
  setMasterKey(mk);
  installIdentity(state.user, mk);
  // The PRF ceremony is fully local - if the km came from the offline cache
  // (ScreenUnlock's fallback), this stays an offline unlock.
  set({ status: "ready", offline: state.offline });
}

/** Turn biometric unlock off for this device: server row + local marker. The
 *  OS-level passkey can't be removed programmatically - the card copy points
 *  the user at their device's password settings. */
export async function disableBiometric(): Promise<void> {
  if (!state.user) return;
  const marker = getBioMarker(state.user.id);
  if (marker) await authApi.bioDelete(marker.credentialId);
  clearBioMarker(state.user.id);
  clearOfflineBio(state.user.id);
}

/** Make sure this account has an X25519 identity keypair for Shared Projects
 *  and return its public key. Lazy - called by the share/accept flows, never at
 *  login, so accounts that don't share pay nothing. The first call generates a
 *  keypair, wraps the private key under the MK and registers it (set-once);
 *  a 409 means another tab/device won the race, so theirs is canonical and we
 *  adopt it via a fresh /auth/me. */
export async function ensureIdentity(): Promise<{ pub: Uint8Array }> {
  if (identityKeys) return { pub: identityKeys.pub };
  const mk = getMasterKey();
  if (!mk) throw new Error("Unlock QUON first to use shared projects.");
  // The account may already have an identity we haven't unwrapped (e.g. it was
  // registered from another device after this session's /auth/me).
  const held = installIdentity(state.user, mk);
  if (held) return { pub: held.pub };
  const fresh = qc.generateIdentityKeypair();
  try {
    await authApi.setIdentity({
      identity_pub: qc.bytesToBase64(fresh.pub),
      identity_priv_wrapped: qc.wrapIdentityPriv(fresh.priv, mk),
    });
    identityKeys = fresh;
    return { pub: fresh.pub };
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 409) throw e;
    // Lost the set-once race - fetch the winning identity and unwrap it.
    const me = await authApi.me();
    set({ user: me });
    const adopted = installIdentity(me, mk);
    if (!adopted) {
      throw new Error("An identity exists for this account but could not be unlocked.");
    }
    return { pub: adopted.pub };
  }
}

/** Create an account (pending until email verification). Returns the recovery
 *  mnemonic to show in the recovery kit. Does not start a session. */
export interface RegistrationResult {
  /** The 12-word recovery phrase, shown exactly once. */
  mnemonic: string;
  /** True when the instance does not verify e-mail addresses (EMAIL_VERIFICATION
   *  auto without SMTP, or off): the account is usable right away and the caller
   *  signs the user in instead of sending them to their inbox. */
  active: boolean;
}

export async function registerAccount(
  email: string,
  password: string,
  inviteCode?: string,
): Promise<RegistrationResult> {
  const { material } = await qc.buildRegistration(password);
  const me = await authApi.register({
    email,
    invite_code: inviteCode?.trim() || undefined,
    terms_version: TERMS_VERSION,
    language: getLangPref(), // store the chosen UI language + match the verify email

    auth_token: material.authToken,
    kdf_salt: material.kdfSalt,
    kdf_params: material.kdfParams,
    wrap_pw: material.wrapPw,
    rec_salt: material.recSalt,
    wrap_rec: material.wrapRec,
  });
  const active = me.status === "active";
  // Without a verify step this response is the one that carries onboarding
  // eligibility (verifyEmail does the same for the mail flow).
  if (active) captureEligibility(me.onboarding_pending);
  return { mnemonic: material.mnemonic, active };
}

/** Confirm the email token. On success a session is active but `locked` until
 *  the password unlocks the Master Key. */
export async function verifyEmail(token: string): Promise<MeResponse> {
  const me = await authApi.verify(token);
  captureEligibility(me.onboarding_pending); // one-shot signal - see onboardingStore.ts
  set({ status: "locked", user: me });
  return me;
}

export async function logout(): Promise<void> {
  try {
    await authApi.logout();
  } catch {
    /* ignore network errors on logout */
  }
  if (state.user) clearOfflineBundle(state.user.id);
  clearCsrf();
  // A filesystem grant must never outlive the session it was given in.
  clearFolderGrant();
  // A message typed on the dashboard but never sent must not be waiting for the
  // NEXT account that signs in on this device.
  clearPendingChatMessage();
  setMasterKey(null);
  set({ status: "anonymous", user: null });
}

/** Recover access with the recovery phrase and set a new password. */
export async function recoverWithPhrase(
  token: string,
  mnemonic: string,
  newPassword: string,
): Promise<void> {
  const mat = await authApi.resetMaterial(token);
  const mk = await qc.recoverMasterKey(mnemonic, mat.rec_salt, mat.wrap_rec, mat.kdf_params);
  const rewrap = await qc.rewrapForPassword(mk, newPassword);
  await authApi.resetPassword({
    token,
    auth_token: rewrap.authToken,
    kdf_salt: rewrap.kdfSalt,
    kdf_params: rewrap.kdfParams,
    wrap_pw: rewrap.wrapPw,
  });
}

/** Change the password from within a `ready` session. Proves the current password
 *  (server-side verifier check), then re-wraps the UNCHANGED Master Key under the
 *  new one - so synced data stays decryptable and the recovery phrase keeps
 *  working. This session survives; the server invalidates all other sessions. */
export async function changePassword(current: string, next: string): Promise<void> {
  const mk = getMasterKey();
  if (!mk) throw new Error("Unlock QUON first to change your password.");
  const km = await authApi.keymaterial();
  // authToken derived from the CURRENT password + current salt = what the server
  // stored; a wrong current password produces a non-matching token -> server 403.
  const { authToken: currentAuthToken } = await qc.deriveAuth(current, km.kdf_salt, km.kdf_params);
  const rewrap = await qc.rewrapForPassword(mk, next);
  await authApi.changePassword({
    current_auth_token: currentAuthToken,
    auth_token: rewrap.authToken,
    kdf_salt: rewrap.kdfSalt,
    kdf_params: rewrap.kdfParams,
    wrap_pw: rewrap.wrapPw,
  });
}

/**
 * Rotate the recovery phrase (the "I lost my written-down phrase" path): the
 * OLD phrase was never stored anywhere - that is the ZK point - so the only
 * honest remedy is generating a new one while unlocked. Verifies the current
 * password server-side (a hijacked session alone must not be able to brick or
 * take over recovery), swaps rec_salt/wrap_rec atomically, and returns the new
 * 12 words for one-time display. MK, password and sessions stay untouched.
 */
export async function rotateRecoveryPhrase(currentPassword: string): Promise<string> {
  const mk = getMasterKey();
  if (!mk) throw new Error("Unlock QUON first to renew your recovery phrase.");
  const km = await authApi.keymaterial();
  const { authToken: currentAuthToken } = await qc.deriveAuth(
    currentPassword,
    km.kdf_salt,
    km.kdf_params,
  );
  // Must derive with the account's stored params - see buildRecoveryRotation.
  const rotation = await qc.buildRecoveryRotation(mk, km.kdf_params);
  await authApi.rotateRecovery({
    current_auth_token: currentAuthToken,
    rec_salt: rotation.recSalt,
    wrap_rec: rotation.wrapRec,
  });
  return rotation.mnemonic;
}

/** Ask to change the account email; a confirmation link is sent to the new
 *  address. The email only changes once that link is confirmed. */
export async function requestEmailChange(newEmail: string): Promise<void> {
  await authApi.changeEmailRequest(newEmail.trim().toLowerCase());
}

/** Confirm an email change from the link (token-authenticated; may run without a
 *  session). Reflects the new email locally when it's the logged-in user. */
export async function confirmEmailChange(token: string): Promise<MeResponse> {
  const me = await authApi.changeEmailConfirm(token);
  if (state.user && state.user.id === me.id) set({ user: me });
  return me;
}

/** Permanently delete the account after proving the password, then sign out. */
export async function deleteAccount(password: string): Promise<void> {
  const km = await authApi.keymaterial();
  const { authToken } = await qc.deriveAuth(password, km.kdf_salt, km.kdf_params);
  await authApi.deleteAccount(authToken);
  // Server rows are gone via cascade; drop this device's marker too. Markers on
  // Other devices self-heal through the GET /auth/bio 404 path.
  if (state.user) clearBioMarker(state.user.id);
  setMasterKey(null);
  set({ status: "anonymous", user: null });
}

/** Handles a 401 surfaced by any authenticated call made after boot (chat/scrub/
 *  relay - see quonApi.ts's `setUnauthorizedHandler`). This is the same
 *  conclusion `classifyBootError` reaches for a boot-time 401: the session is
 *  genuinely gone (expired, revoked, account deleted elsewhere), never a network
 *  hiccup - a fetch-level failure or 5xx throws a plain QuonError with no
 *  `status`, so `isUnauthorizedError` (and therefore this) only fires on a real
 *  401. Transitions straight to `anonymous` so the UI shows the sign-in screen
 *  instead of every subsequent call failing with a misleading error. A no-op
 *  once already anonymous/loading, so a burst of concurrent 401s (scrub + relay
 *  both in flight) doesn't re-fire.
 */
function handleUnauthorized(): void {
  if (state.status === "anonymous" || state.status === "loading") return;
  setMasterKey(null);
  set({ status: "anonymous", user: null });
}

setUnauthorizedHandler(handleUnauthorized);
