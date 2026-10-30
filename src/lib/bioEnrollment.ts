/**
 * Device-local enrollment marker for biometric unlock.
 *
 * PLAIN localStorage on purpose (precedent: `quon_active_user` in AppShell) —
 * it must be readable BEFORE unlock, when the encrypted quonStore is still
 * sealed. It holds no secrets: just "this device enrolled credential X for
 * user Y", so ScreenUnlock knows to offer the button and which credential to
 * assert. The actual wrap of the Master Key lives server-side (/auth/bio) and
 * is useless without the physical authenticator. Keyed per userId so a second
 * account on the same browser never clobbers the first; kept on logout (the
 * button only shows for the matching locked user).
 */

const STORAGE_KEY = "quon_bio_v1";

export interface BioMarker {
  credentialId: string;
  createdAt: number;
}

type MarkerMap = Record<string, BioMarker>;

function readMap(): MarkerMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as MarkerMap;
  } catch {
    return {};
  }
}

function writeMap(map: MarkerMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* private mode / quota — feature degrades to password unlock */
  }
}

export function getBioMarker(userId: string): BioMarker | null {
  const m = readMap()[userId];
  return m && typeof m.credentialId === "string" && m.credentialId ? m : null;
}

export function setBioMarker(userId: string, marker: BioMarker): void {
  const map = readMap();
  map[userId] = marker;
  writeMap(map);
}

export function clearBioMarker(userId: string): void {
  const map = readMap();
  if (!(userId in map)) return;
  delete map[userId];
  writeMap(map);
}

// --- lost-passkey detection (failure streak) --------------------------------
// Reported from a Pixel 10 (2026-08-06): an Android update deleted the OS
// passkey while our marker and the server wrap row survived — so every unlock
// auto-fired credentials.get() for a credential the device no longer has,
// Android showed "kein Passkey vorhanden", and the app silently reset. WebAuthn
// deliberately makes "credential missing" indistinguishable from "user
// cancelled" (both NotAllowedError, for privacy), so the honest client-side
// signal is a STREAK: consecutive failed/cancelled bio attempts with no
// success. At the threshold the unlock screen stops auto-firing (no more OS
// error sheet on every visit), shows a hint, and after the next password
// unlock the dashboard offers to re-create the passkey. A real double-cancel
// trips it too — the offer is dismissible and the streak resets, so the cost
// of a false positive is one polite card.
const TROUBLE_KEY = "quon_bio_trouble_v1";

/** Failed attempts after which we assume the passkey may be gone. */
export const BIO_TROUBLE_THRESHOLD = 2;

function readTrouble(): Record<string, number> {
  try {
    const raw = localStorage.getItem(TROUBLE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as Record<string, number>;
  } catch {
    return {};
  }
}

function writeTrouble(map: Record<string, number>): void {
  try {
    localStorage.setItem(TROUBLE_KEY, JSON.stringify(map));
  } catch {
    /* private mode / quota — detection degrades, unlock itself is unaffected */
  }
}

/** Record one failed/cancelled biometric attempt; returns the new streak. */
export function recordBioFailure(userId: string): number {
  const map = readTrouble();
  const next = (typeof map[userId] === "number" ? map[userId] : 0) + 1;
  map[userId] = next;
  writeTrouble(map);
  return next;
}

/** A successful unlock (or a re-enroll / revoke) ends the streak. */
export function clearBioFailures(userId: string): void {
  const map = readTrouble();
  if (!(userId in map)) return;
  delete map[userId];
  writeTrouble(map);
}

export function bioFailureCount(userId: string): number {
  const n = readTrouble()[userId];
  return typeof n === "number" && n > 0 ? n : 0;
}

/** The passkey looks broken on this device: enrolled here, but the last
 *  BIO_TROUBLE_THRESHOLD attempts all failed. */
export function bioLooksBroken(userId: string): boolean {
  return getBioMarker(userId) != null && bioFailureCount(userId) >= BIO_TROUBLE_THRESHOLD;
}

// --- one-time "enable biometric unlock?" offer -----------------------------
// A separate plain-localStorage flag (per userId) so the post-first-login offer
// is shown at most once per user per device — independent of whether they
// enrolled. No secrets; same storage class as the marker above.
const OFFER_KEY = "quon_bio_offer_v1";

function readOfferSet(): Record<string, true> {
  try {
    const raw = localStorage.getItem(OFFER_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as Record<string, true>;
  } catch {
    return {};
  }
}

/** True once the offer has been shown-and-dismissed (or enrolled) for this user
 *  on this device — the prompt must not reappear. */
export function bioOfferDismissed(userId: string): boolean {
  return readOfferSet()[userId] === true;
}

export function dismissBioOffer(userId: string): void {
  try {
    const set = readOfferSet();
    set[userId] = true;
    localStorage.setItem(OFFER_KEY, JSON.stringify(set));
  } catch {
    /* private mode / quota — worst case the offer shows again, harmless */
  }
}
