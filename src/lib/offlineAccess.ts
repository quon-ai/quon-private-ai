/**
 * Offline access — unlock and read your data with no server in reach.
 *
 * Everything the app shows is already cached on this device, encrypted at rest
 * under a key derived from the Master Key (localVault). What was missing for a
 * Claude-app-like offline experience was purely the FRONT DOOR: `initAuth`
 * needed `/auth/me` and `unlock()` needed `/auth/keymaterial`, so a dead
 * network meant "QUON nicht erreichbar" even though every byte of data was
 * sitting locally. This module caches exactly the front-door material:
 *
 * - a minimal user profile (to render the shell and pick the right caches),
 * - the password key material (kdf salt/params + `wrap_pw`),
 * - optionally the biometric key material (`wrap_bio` + `prf_salt`) — the PRF
 *   ceremony itself is fully local, so with this cached, Face ID/fingerprint
 *   unlock works offline too.
 *
 * PLAIN localStorage on purpose: it must be readable before any key exists.
 * What that means, honestly (also in docs/threat-model.md): `wrap_pw` is a
 * secretbox ciphertext whose key is Argon2id(password) — caching it lets
 * someone with disk access mount an OFFLINE dictionary attack on the account
 * password. That is the same trade-off every local password-manager vault
 * (Bitwarden, 1Password) makes, and the KDF parameters are chosen to make it
 * expensive. `wrap_bio` opens only with the physical authenticator's PRF
 * output; kdf salt/params are handed to anyone who knows the email anyway.
 * Nothing here weakens the server-side zero-knowledge model — the server
 * still only ever sees ciphertext.
 *
 * Lifecycle: written on every successful login/unlock (so it tracks password
 * changes), refreshed on biometric prefetch, erased on logout and on account
 * deletion. Lock ≠ logout: locking keeps the bundle, exactly like the OS
 * keychain keeps a vault.
 */

import type { BioKeyMaterial, KeyMaterial, MeResponse } from "./api/authApi";

const STORAGE_KEY = "quon_offline_v1";

/** The slice of the profile the shell needs to render before a server round
 *  trip. Deliberately NOT the full MeResponse: nothing here may gate a
 *  security decision, it only labels the UI and selects the right caches. */
export interface OfflineProfile {
  id: string;
  email: string;
  role?: "user" | "admin";
  ui_language?: "de" | "en" | null;
}

export interface OfflineBundle {
  user: OfflineProfile;
  km: KeyMaterial;
  bio?: BioKeyMaterial & { credential_id: string };
  savedAt: number;
}

interface Stored {
  /** userId of the account that last unlocked on this device. */
  last?: string;
  accounts?: Record<string, OfflineBundle>;
}

function read(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as Stored;
  } catch {
    return {};
  }
}

function write(s: Stored): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* private mode / quota — offline access degrades, online is unaffected */
  }
}

function toProfile(user: MeResponse): OfflineProfile {
  return { id: user.id, email: user.email, role: user.role, ui_language: user.ui_language };
}

/** Store/refresh the password front door after a successful login or unlock. */
export function saveOfflineBundle(user: MeResponse, km: KeyMaterial): void {
  const s = read();
  const accounts = s.accounts ?? {};
  const prev = accounts[user.id];
  accounts[user.id] = {
    user: toProfile(user),
    km,
    bio: prev?.bio, // keep the bio material across password refreshes
    savedAt: Date.now(),
  };
  write({ last: user.id, accounts });
}

/** Store/refresh the biometric front door (fetched by the unlock screen's
 *  prefetch while online). No-op if the account has no bundle yet — the bio
 *  material alone can't render the shell. */
export function saveOfflineBio(userId: string, credentialId: string, km: BioKeyMaterial): void {
  const s = read();
  const bundle = s.accounts?.[userId];
  if (!bundle) return;
  bundle.bio = { ...km, credential_id: credentialId };
  bundle.savedAt = Date.now();
  write(s);
}

/** Drop the cached bio front door (turned off / revoked / credential rotated). */
export function clearOfflineBio(userId: string): void {
  const s = read();
  const bundle = s.accounts?.[userId];
  if (!bundle?.bio) return;
  delete bundle.bio;
  write(s);
}

export function getOfflineBundle(userId: string): OfflineBundle | null {
  const b = read().accounts?.[userId];
  return b && typeof b.user?.id === "string" && b.km?.wrap_pw ? b : null;
}

/** The bundle of the account that last unlocked on this device — what a cold
 *  offline boot has to go on (there is no /auth/me to name the user). */
export function getLastOfflineBundle(): OfflineBundle | null {
  const s = read();
  return s.last ? getOfflineBundle(s.last) : null;
}

/** Logout / account deletion: the front door goes with the session. */
export function clearOfflineBundle(userId: string): void {
  const s = read();
  if (s.accounts && userId in s.accounts) delete s.accounts[userId];
  if (s.last === userId) delete s.last;
  write(s);
}
