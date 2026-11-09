/**
 * Typed client for the Shared Projects endpoints (grants + invites).
 *
 * Zero-knowledge contract: the server stores per-member grants whose `sealed_pk`
 * is the 32-byte project key sealed (crypto_box_seal) to that member's X25519
 * identity public key - opaque ciphertext to the server. Invites are out-of-band
 * links only (`src/lib/shareLink.ts`); the server learns who accepted, never an
 * email lookup (would reopen the closed account-enumeration oracle).
 */

import { apiFetch } from "./http";

export type ShareRole = "owner" | "writer" | "reader";

/** One row of GET /shares - the caller's grant on a shared project. */
export interface ShareGrant {
  project_id: string;
  role: ShareRole;
  /** True when the caller owns this share. */
  owner: boolean;
  member_count: number;
  created_at: number;
  /** The caller's own sealed project key (base64) - what lets a fresh device
   *  restore project keys from grants without a re-invite. */
  sealed_pk: string;
}

export interface ShareMember {
  user_id: string;
  email: string;
  role: ShareRole;
  granted_at: number;
}

export const sharesApi = {
  /** All projects shared with (or by) the caller, incl. their own sealed_pk. */
  list: () => apiFetch<{ shares: ShareGrant[] }>("/shares").then((r) => r.shares),

  /** Turn an owned project into a shared one. `sealed_pk` is the project key
   *  sealed to the OWNER's own identity_pub (self-grant, so every device of the
   *  owner can restore the PK from the grant like any other member). */
  create: (project_id: string, sealed_pk: string) =>
    apiFetch<ShareGrant>("/shares", {
      method: "POST",
      body: JSON.stringify({ project_id, sealed_pk }),
    }),

  /** Mint a single-use invite token for a shared project (owner only). The token
   *  goes into the invite link's fragment together with the PK - the PK itself
   *  never touches the server (see shareLink.ts). */
  invite: (projectId: string) =>
    apiFetch<{ token: string; expires_at: number }>(
      `/shares/${encodeURIComponent(projectId)}/invites`,
      { method: "POST" },
    ),

  /** Redeem an invite. `sealed_pk` is the project key (from the link fragment)
   *  sealed to the ACCEPTING member's own identity_pub - their durable grant. */
  accept: (token: string, sealed_pk: string) =>
    apiFetch<{ project_id: string; role: ShareRole }>("/shares/accept", {
      method: "POST",
      body: JSON.stringify({ token, sealed_pk }),
    }),

  /** Member list of a shared project (members only). */
  members: (projectId: string) =>
    apiFetch<{ members: ShareMember[] }>(`/shares/${encodeURIComponent(projectId)}/members`).then(
      (r) => r.members,
    ),

  /** Owner removes a member. */
  removeMember: (projectId: string, userId: string) =>
    apiFetch<{ ok: boolean }>(
      `/shares/${encodeURIComponent(projectId)}/members/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    ),

  /** A reader leaves the shared project. */
  leave: (projectId: string) =>
    apiFetch<{ ok: boolean }>(`/shares/${encodeURIComponent(projectId)}/leave`, {
      method: "POST",
    }),

  /** Owner unshares the project entirely (server drops share + grants + blobs;
   *  members keep what they already pulled - no PK rotation in v1). */
  unshare: (projectId: string) =>
    apiFetch<{ ok: boolean }>(`/shares/${encodeURIComponent(projectId)}`, {
      method: "DELETE",
    }),
};
