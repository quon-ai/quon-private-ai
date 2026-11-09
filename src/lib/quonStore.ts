/**
 * Tiny client-side store (useSyncExternalStore + localStorage) shared across
 * routes: the protection level (scrubber on/off), the active chat model, and a
 * running count of redacted items. Persisted so Dashboard, Chat and Settings
 * stay in sync across navigations and reloads.
 */

import {
  deleteGeneratedImage,
  dropLocalGeneratedImage,
  type GeneratedImageRef,
} from "@/lib/chat/generatedImages";
import { useSyncExternalStore } from "react";

import { toStoredMessages } from "./chatPersist";
import type { FontScale } from "./fontScale";
import { isSealedLocal, openLocal, sealLocal, whenLocalCacheKey } from "./localVault";
import { DEFAULT_CHAT_MODEL } from "./quonApi";

export type ProtectionLevel = "none" | "local" | "review" | "full";

/** Reasoning/thinking budget for reasoning-capable chat models. "off" = don't send a
 *  reasoning param (provider default). Set as a global default here; a chat can override
 *  it per-conversation from the composer. */
export type ReasoningEffort = "off" | "low" | "medium" | "high";

export interface QuonState {
  protectionLevel: ProtectionLevel;
  activeModelId: string;
  redactedTotal: number;
  /** Default reasoning effort for new chats (overridable per-chat in the composer). */
  reasoningEffort: ReasoningEffort;
  /** When true, chat auto-injects relevant Memory/Document context (RAG). */
  useMemoryContext: boolean;
  /**
   * When true, the relay attaches OpenRouter's web-search server tool: the
   * MODEL decides when to search the live web (vendor-app comfort); queries
   * derive from the scrubbed prompt only, cost accrues per search performed.
   * Default ON; the composer pill switches it off for privacy-sensitive chats.
   */
  webSearchEnabled: boolean;
  /**
   * Words/values the user always wants redacted (own name, address, numbers ...),
   * sent with each /scrub request as a deterministic redaction. This is the
   * user's own PII, so - like chats - it is synced only as ciphertext (the E2E
   * `prefs` blob, see syncEngine.ts): the server never sees it in the clear.
   */
  alwaysRedact: string[];
  /**
   * Allow-list: values the user never wants treated as PII (case-insensitive,
   * whole-value). Suppresses false positives from any detector (e.g. an
   * ingredient "Xantan" mistaken for a name). Sent with each /scrub request;
   * synced E2E in the `prefs` blob (ciphertext only), same as alwaysRedact.
   */
  neverRedact: string[];
  /**
   * Entity TYPES the user turned off (e.g. ["FINANCIAL_AMOUNT","DATE"]). Empty =
   * scrub everything. Defaults to ["FINANCIAL_AMOUNT"] for new state only -
   * an existing user's stored choice is never rewritten, because a persisted []
   * cannot be told apart from a deliberate "redact amounts too". Sent as
   * `disabled_types` with each /scrub;
   * per-project overridable. Synced E2E in the `prefs` blob (it reveals only a
   * policy preference, no PII, but rides the same ciphertext channel).
   */
  disabledEntityTypes: string[];
  /**
   * Which one-time prefs migrations have already run for this ACCOUNT. Rides the
   * synced blob on purpose: if it were device-local, a second device would re-run
   * a migration and could undo a choice the user made deliberately afterwards.
   */
  prefsSchemaVersion: number;
  /**
   * Dropbox connection (OAuth refresh token + import folder), or undefined when
   * not connected. Synced E2E in the `prefs` blob (ciphertext only, under the
   * Master Key) so the connection follows the account across devices - the
   * server never sees the token in the clear. The app key is not stored here;
   * it comes from the instance config (`/connectors/config`).
   */
  dropboxConnection?: { refreshToken: string; path: string };
  /** OneDrive OAuth refresh token + import folder - same trust class and same
   *  synced-prefs home as `dropboxConnection`. */
  onedriveConnection?: { refreshToken: string; path: string };
  /**
   * Paperless-ngx connection (instance URL + API token), or undefined when not
   * connected. The token is the user's own PII-class credential: it must never
   * appear in plaintext in localStorage or on the server - it rides only inside
   * the E2E-encrypted `prefs` blob (ciphertext under the Master Key), so the
   * connection follows the account across devices. Same accepted trade-off
   * class as `dropboxConnection` (see the dropbox-token-sync-tradeoff
   * decision): MK compromise -> Paperless access until the token is
   * regenerated in Paperless.
   */
  paperlessConnection?: { baseUrl: string; token: string };
  /**
   * Read-only calendar subscription URL (.ics), or undefined. Synced E2E in the
   * `prefs` blob (ciphertext only) - a calendar URL can carry a private token,
   * so it's never stored server-side in the clear, same trust class as the
   * Dropbox token. Feeds the daily briefing (calendar.ts / dailyBriefing.ts).
   */
  calendarUrl?: string;
  /**
   * "Learn from chats" sweep cursors: chat session id -> last message id a
   * successful sweep processed (see `memoryExtract.ts`/`memorySuggestionStore.ts`).
   * Message ids only, no content - but still rides the E2E `prefs` blob rather
   * than a plain field, because a session id can itself be a hint about which
   * chats exist. Synced with a KEY-WISE MAX-MERGE on receipt (see
   * `applyRemotePrefs`), not plain last-write-wins like the rest of this
   * blob - a cursor is a monotonic watermark, so merging must never let an
   * older remote blob rewind a newer local advance (or vice versa) just
   * because some other field in that blob happened to win the timestamp gate.
   */
  sweepCursors?: Record<string, number>;
  /** @deprecated - replaced by protectionLevel === "review". Kept for migration. */
  reviewBeforeSend?: boolean;
  /**
   * Last local change time (epoch ms) of any synced preference (protection level,
   * active model, reasoning, context toggle, redact lists). Drives last-write-wins
   * for the E2E `prefs` sync blob across devices. Device-local fields
   * (redactedTotal, onboarding, revoked-shared) are not synced and don't bump it.
   */
  prefsUpdatedAt: number;
  /**
   * First-login onboarding (see onboardingStore.ts). Like `alwaysRedact`, this
   * is a per-device localStorage cache, not one of the E2E-synced blob
   * collections (chat/memory/documents/projects, see syncEngine.ts) - it does
   * not follow the account across devices. `step` only matters while `seen` is
   * false; once true the flow never runs again.
   */
  onboardingStep: 0 | 1 | 2 | "done";
  onboardingSeen: boolean;
  /**
   * Project ids whose shared-project grant disappeared out from under this
   * device (owner unshared, removed us, or deleted their account) since the
   * last time this device saw it - set by `sharedSync.refreshSharedSync` when
   * a previously-tracked grant is confirmed gone (a *successful* `/shares`
   * fetch that no longer lists it), never on a network/transient failure.
   * ScreenProjects renders a one-time banner for any id still in this list and
   * clears it via `quon.dismissSharedProjectRevoked`. Per-device, not synced.
   */
  revokedSharedProjectIds: string[];
  /**
   * Root text-size scale for this device ("die Schriften sind teilweise recht
   * klein"). Display preference of this device, like `onboardingStep`:
   * device-local, not in `SYNCED_KEYS`, so a larger phone setting never
   * shrinks/grows another device's text. Applied to `document.documentElement`
   * on boot and on change - see `lib/fontScale.ts` and `AppShell.tsx`.
   */
  fontScale: FontScale;
}

// Derived helpers - read these instead of comparing level strings directly.
export const isProtected = (level: ProtectionLevel) => level === "local" || level === "review";
export const isReviewed = (level: ProtectionLevel) => level === "review";

const STORAGE_KEY = "quon_state_v1";

/**
 * Bump when adding a one-time prefs migration below.
 *
 * v1 - FINANCIAL_AMOUNT off by default, applied to EXISTING accounts
 * too, not just new ones. An amount identifies nobody, and redacting it usually
 * destroys the thing the user is asking about. Note the direction: this migration
 * turns redaction off, so it runs exactly once per account and never again -
 * anyone who switches amounts back on afterwards keeps that choice, on every
 * device, because the marker syncs with the rest of the prefs blob.
 *
 * v2 - the Azure DevOps integration was removed from the product,
 * so the stored connection is deleted. It carried a live Personal Access Token,
 * and dropping the field from the type alone would have ORPHANED that token: it
 * would sit in the synced ciphertext (and in this browser's cache) forever, with
 * no UI left to remove it. Deleting code does not delete data.
 */
const PREFS_SCHEMA_VERSION = 2;

/** Set when v2 actually deleted a stored Azure DevOps connection, so the call
 *  sites can push the cleaned blob (see `flushCredentialRemoval`). */
let removedCredential = false;

/** Idempotent. Safe to call on every hydrate and on every remote-prefs apply.
 *
 *  Each step is guarded by the version it was introduced at, not by a single
 *  "is this state current" check around the whole function. With one shared
 *  guard, adding v2 would re-run v1 for every account already on v1 - silently
 *  re-disabling FINANCIAL_AMOUNT for everyone who had turned it back on, which
 *  is exactly what v1's own doc comment promises will never happen.*/
function migratePrefs(s: QuonState): QuonState {
  const from = s.prefsSchemaVersion ?? 0;
  if (from >= PREFS_SCHEMA_VERSION) return s;
  let out: QuonState = s;

  if (from < 1) {
    out = {
      ...out,
      disabledEntityTypes: out.disabledEntityTypes.includes("FINANCIAL_AMOUNT")
        ? out.disabledEntityTypes
        : [...out.disabledEntityTypes, "FINANCIAL_AMOUNT"],
    };
  }

  if (from < 2) {
    const legacy = out as QuonState & { azureDevOpsConnection?: unknown };
    if (legacy.azureDevOpsConnection !== undefined) {
      const { azureDevOpsConnection: _dropped, ...rest } = legacy;
      out = rest as QuonState;
      removedCredential = true;
    }
  }

  return {
    ...out,
    prefsSchemaVersion: PREFS_SCHEMA_VERSION,
    // The LWW clock is deliberately not bumped here. Bumping it made this
    // device's freshly-migrated state out-rank every remote blob written before
    // "now", so legitimate incoming updates were dropped as stale. Not bumping
    // is safe because the migration is idempotent: the marker rides along with
    // the next real preference push, and any device that hydrates first simply
    // migrates itself to the same result.
    // The one exception is a removed CREDENTIAL - see flushCredentialRemoval.
  };
}

/** Push the cleaned prefs blob after a migration deleted a credential.
 *
 *  A migration alone never pushes: it is a pure function, outside `set`, so no
 *  listener fires and the server keeps the last blob it was given - the one
 *  still carrying the PAT. This is the deliberate exception to "never bump the
 *  LWW clock in a migration": a credential removal is a real state change that
 *  must out-rank older blobs, exactly like a disconnect. The v1 comment warns
 *  against bumping on every migration, which made every device out-rank every
 *  remote write; this bumps only when something was actually deleted. */
function flushCredentialRemoval() {
  if (!removedCredential) return;
  removedCredential = false;
  state = { ...state, prefsUpdatedAt: Date.now() };
  persist();
  const item = getPrefsItem();
  for (const l of prefsChangeListeners) l(item);
}

const defaults: QuonState = {
  protectionLevel: "local",
  activeModelId: DEFAULT_CHAT_MODEL,
  redactedTotal: 0,
  reasoningEffort: "off",
  useMemoryContext: true,
  webSearchEnabled: true,
  alwaysRedact: [],
  neverRedact: [],
  // FINANCIAL_AMOUNT is off by default. An amount is not personal data on its
  // own - "60,00" identifies nobody - and redacting it usually destroys exactly
  // what the user is asking the model about ("is this invoice plausible?").
  // Users can turn it on in Settings; this is a default, not a removal.
  disabledEntityTypes: ["FINANCIAL_AMOUNT"],
  prefsSchemaVersion: PREFS_SCHEMA_VERSION,
  onboardingStep: "done",
  onboardingSeen: true,
  revokedSharedProjectIds: [],
  prefsUpdatedAt: 0,
  fontScale: "standard",
};

// The preference fields synced cross-device via the E2E `prefs` blob. Everything
// else in QuonState (redactedTotal counter, onboarding, revoked-shared) is
// device-local and deliberately never leaves this browser.
const SYNCED_KEYS: readonly (keyof QuonState)[] = [
  "protectionLevel",
  "activeModelId",
  "reasoningEffort",
  "useMemoryContext",
  "webSearchEnabled",
  "alwaysRedact",
  "neverRedact",
  "disabledEntityTypes",
  "dropboxConnection",
  "onedriveConnection",
  "paperlessConnection",
  "calendarUrl",
  "sweepCursors",
];

/** The single synced preferences item (id "prefs"). `updatedAt` drives LWW. */
export interface PrefsItem {
  id: "prefs";
  protectionLevel: ProtectionLevel;
  activeModelId: string;
  reasoningEffort: ReasoningEffort;
  useMemoryContext: boolean;
  /** Optional: absent in blobs written by clients predating the feature. */
  webSearchEnabled?: boolean;
  alwaysRedact: string[];
  neverRedact: string[];
  /** Optional: absent in blobs written by clients predating the feature. */
  disabledEntityTypes?: string[];
  /** Absent in blobs written before the migration framework existed (treated as 0). */
  prefsSchemaVersion?: number;
  /** Optional: absent when not connected / from older clients. */
  onedriveConnection?: { refreshToken: string; path: string };
  dropboxConnection?: { refreshToken: string; path: string };
  /** Optional: absent when not connected / from older clients. */
  paperlessConnection?: { baseUrl: string; token: string };
  /** Optional: absent when no calendar is subscribed / from older clients. */
  calendarUrl?: string;
  /** Optional: absent from blobs written by clients predating the feature -
   *  must not wipe local cursors when absent (see `applyRemotePrefs`). */
  sweepCursors?: Record<string, number>;
  updatedAt: number;
}

let state: QuonState = defaults;
let hydrated = false;
const listeners = new Set<() => void>();
const prefsChangeListeners = new Set<(item: PrefsItem) => void>();

function emit() {
  for (const listener of listeners) listener();
}

// Persisted **encrypted** (localVault): the state includes the alwaysRedact list
// - the user's own PII. Without a cache key (locked/anonymous) the write is
// skipped; the in-memory state still works and is re-persisted after unlock.
function persist() {
  try {
    const sealed = sealLocal(state);
    if (sealed) localStorage.setItem(STORAGE_KEY, sealed);
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

// Load from localStorage on the first client subscription (keeps the initial
// render identical to SSR, then updates) to avoid hydration mismatches. Sealed
// state can only be opened after unlock - until then the safe defaults apply
// (protection ON). Legacy plaintext is loaded as before and re-written sealed
// once the key exists (one-time migration).
function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    if (isSealedLocal(raw)) {
      void whenLocalCacheKey().then(() => {
        const stored = openLocal<Partial<QuonState>>(raw);
        if (!stored) {
          // Sealed under a different account's key (or corrupt) - drop it.
          try {
            localStorage.removeItem(STORAGE_KEY);
          } catch {
            /* ignore */
          }
          return;
        }
        // Device-local fields always come from the cache; the synced prefs use
        // LWW so a newer remote `prefs` blob the sync engine may have already
        // applied during boot isn't clobbered by this late-decrypting cache.
        const base = { ...defaults, ...stored };
        const storedTs = stored.prefsUpdatedAt ?? 0;
        state = migratePrefs(
          storedTs >= state.prefsUpdatedAt ? base : { ...base, ...pickSyncedPrefs(state) },
        );
        flushCredentialRemoval();
        emit();
      });
      return;
    }
    const next = migratePrefs({ ...defaults, ...(JSON.parse(raw) as Partial<QuonState>) });
    if (JSON.stringify(next) !== JSON.stringify(state)) {
      state = next;
      queueMicrotask(emit);
    }
    flushCredentialRemoval();
    void whenLocalCacheKey().then(persist); // migrate the plaintext cache
  } catch {
    /* ignore corrupt state */
  }
}

function subscribe(listener: () => void) {
  hydrate();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useQuonState(): QuonState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => defaults,
  );
}

function set(patch: Partial<QuonState>) {
  // A change to any synced preference bumps the LWW clock and schedules a push;
  // device-local changes (e.g. redactedTotal) don't touch the prefs blob.
  const touchesPrefs = Object.keys(patch).some((k) => SYNCED_KEYS.includes(k as keyof QuonState));
  state = { ...state, ...patch, ...(touchesPrefs ? { prefsUpdatedAt: Date.now() } : {}) };
  persist();
  emit();
  if (touchesPrefs) {
    const item = getPrefsItem();
    for (const l of prefsChangeListeners) l(item);
  }
}

// --- E2E preferences sync (the `prefs` collection) -------------------------
/** The synced-preference fields (+ their LWW clock) of a state, for merges. */
function pickSyncedPrefs(s: QuonState): Partial<QuonState> {
  return {
    protectionLevel: s.protectionLevel,
    activeModelId: s.activeModelId,
    reasoningEffort: s.reasoningEffort,
    useMemoryContext: s.useMemoryContext,
    webSearchEnabled: s.webSearchEnabled,
    alwaysRedact: s.alwaysRedact,
    neverRedact: s.neverRedact,
    disabledEntityTypes: s.disabledEntityTypes,
    prefsSchemaVersion: s.prefsSchemaVersion,
    dropboxConnection: s.dropboxConnection,
    onedriveConnection: s.onedriveConnection,
    paperlessConnection: s.paperlessConnection,
    calendarUrl: s.calendarUrl,
    sweepCursors: s.sweepCursors,
    prefsUpdatedAt: s.prefsUpdatedAt,
  };
}

/** The current synced-preferences snapshot (consumed by the sync engine). */
export function getPrefsItem(): PrefsItem {
  return {
    id: "prefs",
    protectionLevel: state.protectionLevel,
    activeModelId: state.activeModelId,
    reasoningEffort: state.reasoningEffort,
    useMemoryContext: state.useMemoryContext,
    webSearchEnabled: state.webSearchEnabled,
    alwaysRedact: state.alwaysRedact,
    neverRedact: state.neverRedact,
    disabledEntityTypes: state.disabledEntityTypes,
    prefsSchemaVersion: state.prefsSchemaVersion,
    dropboxConnection: state.dropboxConnection,
    onedriveConnection: state.onedriveConnection,
    paperlessConnection: state.paperlessConnection,
    calendarUrl: state.calendarUrl,
    sweepCursors: state.sweepCursors,
    updatedAt: state.prefsUpdatedAt,
  };
}

/** Key-wise MAX-merge of sweep-cursor watermarks (session id -> last-processed
 *  message id). Cursors are monotonic per session, so merging is safe and
 *  commutative regardless of which side's blob happens to carry the newer
 *  `prefsUpdatedAt` - unlike every other synced field, applying a remote
 *  cursor map must never rewind a local advance (see `applyRemotePrefs` and
 *  the P5 plan's explicit callout: "a naive move loses cursor advances from
 *  another device"). Returns `local` UNCHANGED (same reference) when nothing
 *  moved, so the caller can cheaply detect whether a write is needed. */
function mergeSweepCursors(
  local: Record<string, number> | undefined,
  remote: Record<string, number> | undefined,
): Record<string, number> | undefined {
  if (!remote) return local;
  let out = local;
  for (const [sessionId, remoteVal] of Object.entries(remote)) {
    const localVal = out?.[sessionId];
    if (localVal === undefined || remoteVal > localVal) {
      out = { ...(out ?? {}), [sessionId]: remoteVal };
    }
  }
  return out;
}

/**
 * Union-merge a redaction list.
 *
 * `alwaysRedact`/`neverRedact` ride the `prefs` blob, which is whole-blob
 * last-write-wins - so two devices each adding a term meant one of them was
 * silently dropped. For `alwaysRedact` that is a FAIL-OPEN: a value the user
 * explicitly asked to have redacted quietly stops being redacted, and nothing
 * surfaces it. A redact list is semantically a grow-only set, so it merges
 * rather than overwrites, unconditionally - exactly like `sweepCursors`, and for
 * the same reason (a watermark/blast-radius field must not lose to an unrelated
 * newer field in the same blob).
 *
 * Accepted trade, chosen deliberately: a removed term can come back from a
 * device that has not synced since. Resurrecting a redaction over-redacts, while
 * losing one under-redacts, and only one of those is safe. Making deletion
 * durable needs a tombstone set in the same blob - deferred until it's asked for.
 *
 * Case-insensitive de-dup (matching is case-insensitive anyway), first spelling
 * wins so the user's own capitalisation survives, and the local order is kept so
 * the Settings textarea doesn't reshuffle under the cursor.
 */
function mergeRedactList(local: string[] | undefined, remote: string[] | undefined): string[] {
  const out = [...(local ?? [])];
  const seen = new Set(out.map((t) => t.trim().toLowerCase()));
  for (const term of remote ?? []) {
    const key = term.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out;
}

/** True when the union added something the local list didn't have. */
function redactListGrew(local: string[] | undefined, merged: string[]): boolean {
  return merged.length !== (local ?? []).length;
}

/** Merge a decrypted remote prefs blob (LWW for every field EXCEPT
 *  `sweepCursors`, which key-wise max-merges unconditionally - see
 *  `mergeSweepCursors`). Never regresses a local edit and never echoes back
 *  to the server (no change listeners fired). */
export function applyRemotePrefs(item: PrefsItem): void {
  const mergedCursors = mergeSweepCursors(state.sweepCursors, item.sweepCursors);
  const cursorsChanged = mergedCursors !== state.sweepCursors;
  // Grow-only, regardless of which blob is newer - see mergeRedactList.
  const mergedAlways = mergeRedactList(state.alwaysRedact, item.alwaysRedact);
  const mergedNever = mergeRedactList(state.neverRedact, item.neverRedact);
  const redactGrew =
    redactListGrew(state.alwaysRedact, mergedAlways) ||
    redactListGrew(state.neverRedact, mergedNever);

  if (state.prefsUpdatedAt >= item.updatedAt) {
    // The rest of this blob is not newer (or old blobs without cursors -
    // `mergeSweepCursors` is a no-op then), but a cursor advance still needs
    // to land even when it arrives bundled with an otherwise-stale blob.
    if (cursorsChanged || redactGrew) {
      state = {
        ...state,
        sweepCursors: mergedCursors,
        alwaysRedact: mergedAlways,
        neverRedact: mergedNever,
      };
      persist();
      emit();
    }
    return;
  }
  state = {
    ...state,
    protectionLevel: item.protectionLevel ?? state.protectionLevel,
    activeModelId: item.activeModelId ?? state.activeModelId,
    reasoningEffort: item.reasoningEffort ?? state.reasoningEffort,
    useMemoryContext: item.useMemoryContext ?? state.useMemoryContext,
    webSearchEnabled: item.webSearchEnabled ?? state.webSearchEnabled,
    alwaysRedact: mergedAlways,
    neverRedact: mergedNever,
    disabledEntityTypes: item.disabledEntityTypes ?? state.disabledEntityTypes,
    // Not "?? state.prefsSchemaVersion": a blob written before the migration
    // framework has no version, and that absence is exactly the signal that it
    // still needs migrating. Falling back to the local value would let a fresh
    // install's default mask an un-migrated account.
    prefsSchemaVersion: item.prefsSchemaVersion ?? 0,
    // Connection fields take the newer blob's value directly (no `?? state`):
    // for these, "absent" means the user removed the connection, and that
    // disconnect must propagate. A connected device always writes the field
    // (pickSyncedPrefs reads it from state), so `undefined` here only ever means
    // an explicit disconnect - never an accidental omission. Using `?? state`
    // would pin a stale connection forever and a "disconnect" on one device would
    // never reach the others.
    dropboxConnection: item.dropboxConnection,
    onedriveConnection: item.onedriveConnection,
    paperlessConnection: item.paperlessConnection,
    calendarUrl: item.calendarUrl,
    sweepCursors: mergedCursors,
    prefsUpdatedAt: item.updatedAt,
  };
  // An older client's blob still carries the removed Azure DevOps connection.
  // The field is not adopted above (it no longer exists locally), but the copy
  // the SERVER holds still contains the PAT - so flag it here too. Without this
  // the ciphertext is only ever cleaned by the one device that happened to have
  // the connection cached locally; a fresh device would read the credential,
  // drop it, and leave it sitting on the server forever.
  if ((item as PrefsItem & { azureDevOpsConnection?: unknown }).azureDevOpsConnection !== undefined)
    removedCredential = true;
  state = migratePrefs(state);
  flushCredentialRemoval();
  persist();
  emit();
}

/** Last processed message id for a chat session; undefined = never swept.
 *  Backs `memorySuggestionStore.ts`'s re-exported `getSweepCursor` (see the
 *  `sweepCursors` field doc comment for why this lives here). */
export function getSweepCursor(sessionId: string): number | undefined {
  return state.sweepCursors?.[sessionId];
}

/** Advance a session's cursor (call only after a fully successful extraction).
 *  A normal synced write - bumps `prefsUpdatedAt` and schedules a push, same
 *  as any other preference change; the MAX-merge guard lives on the
 *  RECEIVING side (`applyRemotePrefs`), not here. */
export function setSweepCursor(sessionId: string, lastMessageId: number): void {
  const current = state.sweepCursors ?? {};
  if (current[sessionId] === lastMessageId) return; // no-op, no needless push
  set({ sweepCursors: { ...current, [sessionId]: lastMessageId } });
}

/** Reset all cursors (tests). */
export function resetSweepCursors(): void {
  if (!state.sweepCursors) return;
  set({ sweepCursors: {} });
}

/** Subscribe to synced-preference changes (the sync engine pushes each). */
export function onPrefsChange(cb: (item: PrefsItem) => void): () => void {
  prefsChangeListeners.add(cb);
  return () => prefsChangeListeners.delete(cb);
}

/** Reset the local UI/preferences state to safe defaults on logout / account
 *  switch. Critically this drops `alwaysRedact` - the user's own name/address/IDs
 *  to redact on device (PII) - and the protection level, so a different account in
 *  the same browser never inherits them (they were also sent to /scrub per turn).
 *  Local-only; nothing server-side. Defaults keep protection ON (fail safe). */
export function resetState(): void {
  state = defaults;
  hydrated = false;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  emit();
}

// --- Chat history (sidebar recents) ----------------------------------------

/**
 * A persisted message. Mirrors the in-component `ChatMessage` shape closely
 * enough to fully restore a conversation (including what was actually sent to
 * the provider and which entities were redacted, so answers can be re-hydrated).
 *
 * This type is the persisted + synced contract - treat it as a wire format,
 * and declare every field a message can carry. `saveChatSession` is called
 * with the component's `ChatMessage[]`, and passing a variable (not an object
 * literal) defeats TypeScript's excess-property check, so a field absent from
 * this interface - `attachment` (up to 200 KB of text!), `reasoning`,
 * `streamInterrupted`, `skipReason`, `lowCaseSignal`, `contextEmpty` - is
 * silently serialized, encrypted and pushed to the relay anyway. Declaring
 * them keeps the cost of adding one visible; what a session may carry is
 * enforced at runtime by `toStoredMessages` (`chatPersist.ts`).
 */
export interface StoredChatMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  scrubbed?: string;
  entities?: Array<{
    type: string;
    value: string;
    placeholder: string;
    confidence: number;
  }>;
  fallbackMode?: boolean;
  protected?: boolean;
  /** user only: this turn was sent via "Resend without filter" - /scrub was never
   *  called, `text`/`scrubbed` are identical (the original, unredacted text) and
   *  `entities` is empty by construction. Kept distinct from `protected: false`
   *  (which also covers protection level "None") so the bubble can tell "the user
   *  deliberately bypassed detection for this one message" apart from "protection
   *  was off for this whole chat" - they are different trust signals. */
  unfiltered?: boolean;
  isError?: boolean;
  rawText?: string;
  /** assistant only: friendly label of the model that produced this answer
   *  (captured at send). Absent on old chats. */
  model?: string;
  /** assistant only: indices of detected artifacts the user dismissed. Persisted
   *  (and synced) because artifacts are re-detected from the answer text on every
   *  render - without this the dismissed card would come back on reload. */
  dismissedArtifacts?: number[];
  /** assistant only: web pages the model cited (web search on). Public URLs +
   *  titles, so a restored chat still shows where the answer came from. */
  /** Pictures the model generated - references only; the bytes live in
   *  the sealed local store / the originals sync collection. */
  images?: GeneratedImageRef[];
  sources?: Array<{ url: string; title: string }>;
  /** assistant only: what the filter stripped out of tool RESULTS during this
   *  turn, one entry per tool call. Persisted for two reasons: it is the record
   *  the redaction footer renders, and it is the only place the tools'
   *  placeholder->value pairs survive a reload - an assistant turn is re-sent as
   *  `rawText` (the placeholder view), so without these `rebuildRefs` cannot
   *  re-hydrate the next answer and bare [PERSON_7] tokens reach the screen.
   *  Small by construction: `mergeScrubPieces` de-duplicates by (type, value),
   *  so a name repeated 40x in a document is one entry. */
  toolRedactions?: Array<{
    tool: string;
    entities: Array<{ type: string; value: string; placeholder: string; confidence: number }>;
  }>;
  /** user only: retrieved Memory/Document context injected for this turn (RAG). */
  rag?: {
    /** Context text actually sent to the model (scrubbed when protection is on). */
    context: string;
    sources: Array<{
      kind: "memory" | "document";
      title: string;
      snippet: string;
      score: number;
    }>;
    /** Context placeholder->value pairs, so the answer re-hydrates on restore. */
    entities?: Array<{ type: string; value: string; placeholder: string; confidence: number }>;
  };
  /** user only: the project instruction injected for this turn (scrubbed when
   *  protection is on). Persisted so restored chats re-send + re-hydrate identically. */
  instruction?: {
    /** Instruction text actually sent to the model (scrubbed under protection). */
    text: string;
    /** Placeholder->value pairs so the answer re-hydrates on restore. */
    entities?: Array<{ type: string; value: string; placeholder: string; confidence: number }>;
  };
  /** user only: a document attached to this turn (scrubbed under protection).
   *  `text` is kept only on the last user turn - the only one it is ever read
   *  back from - while name/entities stay on every turn. See `chatPersist.ts`. */
  attachment?: {
    name: string;
    text: string;
    entities?: Array<{ type: string; value: string; placeholder: string; confidence: number }>;
    truncated?: boolean;
    /** True when several documents were combined via "Attach all documents". */
    combined?: boolean;
  };
  /** assistant only: the model's streamed reasoning ("thinking"), re-hydrated.
   *  Deliberately persisted so the collapsible panel survives a reload. */
  reasoning?: string;
  /** assistant only: the stream was cut off mid-answer; the partial text is kept. */
  streamInterrupted?: boolean;
  /** user only: why AI enrichment was skipped (when `fallbackMode`). */
  skipReason?: string | null;
  /** user only: input had no case signal - NER names were deferred to the LLM. */
  lowCaseSignal?: boolean;
  /** user only: retrieval ran but nothing cleared the relevance gate, so no
   *  context was injected. Drives the honest "nothing matched" note. */
  contextEmpty?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: StoredChatMessage[];
  /** true when the user pinned this chat (pinned sort to the top). */
  pinned?: boolean;
  /** true when the user renamed it - stops auto-title from overwriting. */
  titleEdited?: boolean;
  /** Project this chat belongs to; undefined = global (shown under Recents). */
  projectId?: string;
}

/** Pinned first, then most-recently-updated. */
function sortSessions(list: ChatSession[]): ChatSession[] {
  return [...list].sort((a, b) => {
    const pinDiff = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
    return pinDiff !== 0 ? pinDiff : b.updatedAt - a.updatedAt;
  });
}

const HISTORY_KEY = "quon_chat_history_v1";
const MAX_HISTORY = 30;

const historyListeners = new Set<() => void>();
// Sync hooks: fired when a session is saved (push) or sessions are cleared
// (tombstone push). Remote merges use applyRemote* and do not fire these,
// so a pull never echoes back as a push.
const sessionChangeListeners = new Set<(s: ChatSession) => void>();
const sessionDeleteListeners = new Set<(ids: string[]) => void>();
let history: ChatSession[] = [];
let historyHydrated = false;

/** Rebuild a persisted session into the full shape, tolerating the older title-only
 *  format. Must copy every persisted field - notably `projectId`: dropping it here
 *  silently kicked project chats back into "Recents" on each reload and broke their
 *  RAG scope (saved project Memory/Documents stopped reaching the model). */
export function reviveStoredSession(s: Partial<ChatSession>): ChatSession {
  return {
    id: s.id ?? `chat_${Math.random().toString(36).slice(2)}`,
    title: s.title ?? "Chat",
    createdAt: s.createdAt ?? Date.now(),
    updatedAt: s.updatedAt ?? s.createdAt ?? Date.now(),
    messages: Array.isArray(s.messages) ? s.messages : [],
    pinned: s.pinned ?? false,
    titleEdited: s.titleEdited ?? false,
    projectId: s.projectId,
  };
}

function hydrateHistory() {
  if (historyHydrated || typeof window === "undefined") return;
  historyHydrated = true;
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return;
    if (isSealedLocal(raw)) {
      // Encrypted at rest - can only open after unlock. Merge instead of
      // replace: saves that landed while the key was pending win over the
      // loaded snapshot (same pattern as the IndexedDB stores).
      void whenLocalCacheKey().then(() => {
        const stored = openLocal<Array<Partial<ChatSession>>>(raw);
        if (!stored) {
          // Another account's ciphertext (or corrupt) - unreadable, drop it.
          try {
            localStorage.removeItem(HISTORY_KEY);
          } catch {
            /* ignore */
          }
          return;
        }
        const byId = new Map(stored.map(reviveStoredSession).map((s) => [s.id, s]));
        for (const s of history) byId.set(s.id, s);
        history = sortSessions([...byId.values()]);
        // Re-persist: a save/pull that landed while decrypting overwrote the
        // cache with only the sessions known then - write the merged set back.
        persistHistory();
        emitHistory();
      });
      return;
    }
    const parsed = JSON.parse(raw) as Array<Partial<ChatSession>>;
    history = sortSessions(parsed.map(reviveStoredSession));
    void whenLocalCacheKey().then(persistHistory); // migrate the plaintext cache
  } catch {
    /* ignore */
  }
}

function emitHistory() {
  for (const l of historyListeners) l();
}

/**
 * Did anything a `useChatHistory` consumer actually RENDERS change?
 *
 * Streaming calls `saveChatSession` once per token (ScreenChat persists on every
 * `messages` change); if every call called `emitHistory()`, the sidebar,
 * dashboard and projects screens would re-render per token. None of them read
 * `.messages`: the sidebar renders `title`/`pinned`/`projectId`, the others
 * group and count. And a streaming save is `bump: false`, so `updatedAt` doesn't
 * move either. A per-token emit would repaint several screens to show nothing
 * new.
 *
 * Session *content* still reaches the sync engine unconditionally, via
 * `sessionChangeListeners` - this gate is presentation only.
 */
function sidebarShapeChanged(prev: ChatSession[], next: ChatSession[]): boolean {
  if (prev.length !== next.length) return true; // added / evicted / reordered away
  for (let i = 0; i < prev.length; i++) {
    const a = prev[i];
    const b = next[i];
    if (
      a.id !== b.id || // order changed, or a different session at this slot
      a.title !== b.title ||
      a.pinned !== b.pinned ||
      a.projectId !== b.projectId ||
      a.updatedAt !== b.updatedAt // drives recents sort
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Coalesce the history write.
 *
 * The write is whole-history - `sealLocal(history)` serializes and encrypts all
 * sessions - and `saveChatSession` runs once per streamed token, synchronously,
 * on the main thread, at exactly the moment tokens are rendering. Measured cost
 * of one such write: ~8 ms for a light history, ~62 ms mid-size, ~221 ms for a
 * heavy one. Per token that is not a hitch, it is a stall.
 *
 * Content saves (streaming) are coalesced into a trailing write; anything
 * structural flushes immediately, so a rename or a delete is never at risk.
 *
 * Durability trade: `localStorage.setItem` is synchronous and completes before
 * the tab dies, so deferring exposes up to COALESCE_MS of tokens on a hard kill.
 * That is bounded below the ~700 ms the streaming `persist()` throttle already
 * exposed, the visibility/pagehide flushes below cover ordinary tab closes, and
 * the sync push is a second net. Net durability is unchanged.
 */
const COALESCE_MS = 400;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

// Chat history is full plaintext conversations (incl. detected PII values) - it
// only ever hits disk sealed. No key (locked) -> skip; re-persisted after unlock.
function writeHistoryNow() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  try {
    const sealed = sealLocal(history);
    if (sealed) localStorage.setItem(HISTORY_KEY, sealed);
  } catch (e) {
    // Do not swallow this. The whole history is one localStorage value, and
    // WebKit refuses past ~5 MB (Chromium not until ~48 MB, which is why this
    // never shows up in dev). On refusal the PREVIOUS value survives, so the
    // in-memory session looks fine all day and history silently reverts to an
    // older snapshot on reload. Compression + the persistence projection make
    // this far harder to reach; it must still be visible when it happens.
    console.error("[chat] history could not be persisted locally", e);
  }
}

/** Structural change (rename, pin, delete, project move, logout) - write now. */
function persistHistory() {
  writeHistoryNow();
}

/** Content-only change (a streamed token) - fold into a trailing write. */
function persistHistorySoon() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    writeHistoryNow();
  }, COALESCE_MS);
}

/** Force any coalesced write to disk now. Called before the tab suspends, and
 *  available to anything that needs the on-disk copy to be current. No-op when
 *  nothing is pending. */
export function flushChatHistoryWrite(): void {
  if (persistTimer) writeHistoryNow();
}

// Get the pending write out before the tab suspends. Mirrors the registration
// collectionSync uses for the same reason.
if (typeof document !== "undefined" && document.addEventListener) {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushChatHistoryWrite();
  });
  window.addEventListener("pagehide", flushChatHistoryWrite);
}

/** Subscribe to changes in what the history LOOKS like (see
 *  `sidebarShapeChanged`) - not to every message that lands. */
export function subscribeChatHistory(cb: () => void): () => void {
  hydrateHistory();
  historyListeners.add(cb);
  return () => {
    historyListeners.delete(cb);
  };
}

/** Sessions for the sidebar, most-recently-updated first. */
export function useChatHistory(): ChatSession[] {
  return useSyncExternalStore(
    subscribeChatHistory,
    () => history,
    () => [],
  );
}

/** Generate a new session id. The session is only persisted once it is saved. */
export function createChatSessionId(): string {
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function getChatSession(id: string): ChatSession | undefined {
  hydrateHistory();
  return history.find((s) => s.id === id);
}

function deriveTitle(messages: StoredChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user" && m.text.trim());
  return firstUser?.text.trim().slice(0, 60) || "New chat";
}

/**
 * Upsert a session's messages.
 *
 * `bump` controls recents ordering: pass `true` (the default) only when the user
 * actually sends a prompt, which moves the session to the top. Background saves
 * - restoring a chat, persisting streamed tokens - pass `false` so simply
 * opening or watching a chat never reshuffles the list.
 */
export function saveChatSession(
  id: string,
  messages: StoredChatMessage[],
  options?: { bump?: boolean; projectId?: string },
): void {
  hydrateHistory();
  const now = Date.now();
  const before = history;
  const existing = history.find((s) => s.id === id);
  const bump = options?.bump ?? true;
  const next: ChatSession = {
    id,
    // Keep a user-chosen name; otherwise derive from the first message.
    title: existing?.titleEdited ? existing.title : deriveTitle(messages),
    titleEdited: existing?.titleEdited,
    pinned: existing?.pinned,
    // Carry the project forward across background streaming saves; an explicit
    // projectId (first save of a chat started in a project) wins. Clearing a
    // chat's project goes through setChatProject, not here.
    projectId: options?.projectId ?? existing?.projectId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: bump ? now : (existing?.updatedAt ?? now),
    // The persistence boundary. Without this the store keeps whatever the chat
    // screen happened to be holding - including ~200 KB of attachment text per
    // turn - and the session grows into both the relay's per-blob cap and the
    // localStorage quota. Send-equivalent; see chatPersist.ts.
    messages: toStoredMessages(messages),
  };
  if (existing && !bump) {
    history = history.map((s) => (s.id === id ? next : s));
  } else {
    history = [next, ...history.filter((s) => s.id !== id)].slice(0, MAX_HISTORY);
  }
  history = sortSessions(history);
  // One predicate for both: a structural change is exactly what the sidebar
  // renders, and exactly what must reach disk immediately. A streamed token is
  // neither - it repaints nothing and can ride a trailing write.
  if (sidebarShapeChanged(before, history)) {
    persistHistory();
    emitHistory();
  } else {
    persistHistorySoon();
  }
  // Sync always sees the change, gate or no gate.
  for (const l of sessionChangeListeners) l(next);
}

export function clearChatHistory() {
  const ids = history.map((s) => s.id);
  history = [];
  persistHistory();
  emitHistory();
  for (const l of sessionDeleteListeners) l(ids);
}

/** Drop the local chat history (in-memory + the localStorage cache) without
 *  firing delete listeners - i.e. no server tombstones. Used on logout / account
 *  switch so a different account in the same browser never sees the previous
 *  account's cached chats. The ciphertext on the server is untouched and re-pulls
 *  on next login. Mirrors resetMemory/resetDocuments. */
export function resetChatHistory(): void {
  history = [];
  historyHydrated = false;
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    /* ignore */
  }
  emitHistory();
}

// --- sync integration ------------------------------------------------------
/** Subscribe to local session saves (the sync engine pushes them). */
export function onSessionChange(cb: (s: ChatSession) => void): () => void {
  sessionChangeListeners.add(cb);
  return () => sessionChangeListeners.delete(cb);
}

/** Subscribe to local clears (the sync engine pushes tombstones). */
export function onSessionDelete(cb: (ids: string[]) => void): () => void {
  sessionDeleteListeners.add(cb);
  return () => sessionDeleteListeners.delete(cb);
}

export function getAllSessions(): ChatSession[] {
  hydrateHistory();
  return history;
}

/** Merge a session pulled from sync (last-write-wins by updatedAt). Does not
 *  fire change listeners, so it never echoes back to the server. */
export function applyRemoteSession(s: ChatSession): void {
  hydrateHistory();
  const existing = history.find((x) => x.id === s.id);
  if (existing && existing.updatedAt >= s.updatedAt) return;
  // Compact fat sessions arriving from a device still running older code, so
  // one un-updated device can't keep re-inflating this one's local cache.
  // Must not touch `updatedAt` - the relay's staleness test is a strict `>`,
  // so the compacted copy is accepted at the same timestamp and heals the
  // server-side blob at the next reconcile push, without clobbering a genuinely
  // newer edit from another device.
  const compacted: ChatSession = { ...s, messages: toStoredMessages(s.messages) };
  history = sortSessions([compacted, ...history.filter((x) => x.id !== s.id)]).slice(
    0,
    MAX_HISTORY,
  );
  // A pull applies many sessions in a loop; one whole-history write each was
  // Nx the cost of one. The server already holds this data, so a coalesced
  // write that a hard kill loses is simply re-pulled.
  persistHistorySoon();
  emitHistory();
}

/** Rename a chat (custom name sticks; pushed to sync). */
export function renameChatSession(id: string, title: string): void {
  hydrateHistory();
  const clean = title.trim().slice(0, 80) || "Untitled chat";
  let changed: ChatSession | undefined;
  history = sortSessions(
    history.map((s) => {
      if (s.id !== id) return s;
      changed = { ...s, title: clean, titleEdited: true, updatedAt: Date.now() };
      return changed;
    }),
  );
  if (!changed) return;
  persistHistory();
  emitHistory();
  for (const l of sessionChangeListeners) l(changed);
}

/** Pin / unpin a chat (pinned sort to the top; pushed to sync). */
export function togglePinChatSession(id: string): void {
  hydrateHistory();
  let changed: ChatSession | undefined;
  history = sortSessions(
    history.map((s) => {
      if (s.id !== id) return s;
      changed = { ...s, pinned: !s.pinned, updatedAt: Date.now() };
      return changed;
    }),
  );
  if (!changed) return;
  persistHistory();
  emitHistory();
  for (const l of sessionChangeListeners) l(changed);
}

/** Move a chat into a project (or out of any project with `undefined`). Pushed to
 *  sync; bumps updatedAt so the latest scope wins across devices (LWW). */
export function setChatProject(id: string, projectId: string | undefined): void {
  hydrateHistory();
  let changed: ChatSession | undefined;
  history = sortSessions(
    history.map((s) => {
      if (s.id !== id || s.projectId === projectId) return s;
      changed = { ...s, projectId, updatedAt: Date.now() };
      return changed;
    }),
  );
  if (!changed) return;
  persistHistory();
  emitHistory();
  for (const l of sessionChangeListeners) l(changed);
}

/** Delete a single chat (tombstone pushed to sync). */
export function deleteChatSession(id: string): void {
  hydrateHistory();
  const gone = history.find((s) => s.id === id);
  if (!gone) return;
  // Generated images live outside the chat blob - drop the local bytes
  // and tombstone the server chunks, or the quota they take would outlive
  // the chat on every device.
  for (const m of gone.messages) for (const ref of m.images ?? []) void deleteGeneratedImage(ref);
  history = history.filter((s) => s.id !== id);
  persistHistory();
  emitHistory();
  for (const l of sessionDeleteListeners) l([id]);
}

/** Apply a remote tombstone (delete) without echoing back to the server. */
export function applyRemoteDeletion(id: string): void {
  hydrateHistory();
  const gone = history.find((x) => x.id === id);
  if (!gone) return;
  // Local bytes only - the deleting device tombstones the server chunks.
  for (const m of gone.messages)
    for (const ref of m.images ?? []) void dropLocalGeneratedImage(ref);
  history = history.filter((x) => x.id !== id);
  persistHistory();
  emitHistory();
}

export const quon = {
  setProtectionLevel: (protectionLevel: ProtectionLevel) => set({ protectionLevel }),
  setActiveModel: (activeModelId: string) => set({ activeModelId }),
  /** Set the active model as a system CORRECTION (the current id isn't a valid
   *  catalog option), not a user choice: persist locally but do not bump the
   *  prefs clock or push. Otherwise a fresh device's default-model correction
   *  would out-timestamp - and thus discard - the real choice still coming down
   *  from the server's E2E prefs blob. Also right per-device: one device's
   *  invalid model shouldn't overwrite another's valid one. */
  correctActiveModel: (activeModelId: string) => {
    if (state.activeModelId === activeModelId) return;
    state = { ...state, activeModelId };
    persist();
    emit();
  },
  setReasoningEffort: (reasoningEffort: ReasoningEffort) => set({ reasoningEffort }),
  setUseMemoryContext: (useMemoryContext: boolean) => set({ useMemoryContext }),
  setAlwaysRedact: (alwaysRedact: string[]) => set({ alwaysRedact }),
  /** Append one term (a durable hand-redaction from the viewer / Review panel).
   *  Case-insensitive de-dup - matching is case-insensitive anyway, and a
   *  second spelling would just be a confusing duplicate row in Settings. */
  addAlwaysRedact: (term: string) => {
    const t = term.trim();
    if (!t) return;
    const has = state.alwaysRedact.some((x) => x.trim().toLowerCase() === t.toLowerCase());
    if (!has) set({ alwaysRedact: [...state.alwaysRedact, t] });
  },
  setNeverRedact: (neverRedact: string[]) => set({ neverRedact }),
  setDisabledEntityTypes: (disabledEntityTypes: string[]) => set({ disabledEntityTypes }),
  setDropboxConnection: (dropboxConnection: { refreshToken: string; path: string } | undefined) =>
    set({ dropboxConnection }),
  setOnedriveConnection: (onedriveConnection: { refreshToken: string; path: string } | undefined) =>
    set({ onedriveConnection }),
  setPaperlessConnection: (paperlessConnection: { baseUrl: string; token: string } | undefined) =>
    set({ paperlessConnection }),
  setCalendarUrl: (calendarUrl: string | undefined) => set({ calendarUrl }),
  setWebSearchEnabled: (webSearchEnabled: boolean) => set({ webSearchEnabled }),
  /** @deprecated Use setProtectionLevel("review") / ("local") instead. */
  setReviewBeforeSend: (on: boolean) =>
    set({
      protectionLevel: on
        ? "review"
        : isProtected(state.protectionLevel)
          ? "local"
          : state.protectionLevel,
    }),
  addRedacted: (count: number) => {
    if (count > 0) set({ redactedTotal: state.redactedTotal + count });
  },
  setOnboardingStep: (onboardingStep: QuonState["onboardingStep"]) => set({ onboardingStep }),
  setOnboardingSeen: (onboardingSeen: boolean) => set({ onboardingSeen }),
  /** Device-local - see the `fontScale` field docstring. Does not touch the
   *  synced prefs clock (not in SYNCED_KEYS), same as onboarding fields. */
  setFontScale: (fontScale: FontScale) => set({ fontScale }),
  /** Record that `projectId`'s shared-project grant was confirmed gone (see
   *  the field docstring on QuonState). No-op if already recorded. */
  markSharedProjectRevoked: (projectId: string) => {
    if (state.revokedSharedProjectIds.includes(projectId)) return;
    set({ revokedSharedProjectIds: [...state.revokedSharedProjectIds, projectId] });
  },
  /** Clear the one-time revoked-access banner for `projectId` (user dismissed it). */
  dismissSharedProjectRevoked: (projectId: string) => {
    if (!state.revokedSharedProjectIds.includes(projectId)) return;
    set({
      revokedSharedProjectIds: state.revokedSharedProjectIds.filter((id) => id !== projectId),
    });
  },
};

/** Synchronous read of the current state - for one-off checks outside a React
 *  render (e.g. the auth->onboarding eligibility bridge). Prefer `useQuonState`
 *  in components. */
export function getQuonState(): QuonState {
  return state;
}
