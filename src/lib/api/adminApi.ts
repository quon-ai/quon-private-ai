/** Typed client for the operator admin endpoints (/admin/*).
 *
 * All calls require a session whose account has role='admin' - the server
 * enforces this on every request (403 otherwise); the UI merely hides the
 * screen for non-admins. Everything here is account METADATA (emails, status,
 * byte counts, budgets) - content stays end-to-end encrypted and is never
 * readable, for admins included. */

import { apiFetch } from "./http";

export interface AdminUser {
  id: string;
  email: string;
  status: string; // 'pending' | 'active' | 'suspended'
  role: "user" | "admin";
  created_at: number;
  activated_at: number | null;
  last_seen: number | null;
  storage_bytes: number;
  provisioned: boolean;
  key_disabled: boolean;
  limit_usd: number | null;
  /** Spent so far against the included budget; null when not provisioned. */
  usage_usd: number | null;
  budget_override_usd: number | null;
  storage_override_bytes: number | null;
}

export interface AdminInvite {
  id: string;
  note: string;
  created_at: number;
  expires_at: number;
  used_at: number | null;
  /** Plaintext invite code - present only on the create response. */
  code?: string | null;
}

export interface AdminStats {
  users_total: number;
  users_active: number;
  users_pending: number;
  users_suspended: number;
  storage_bytes_total: number;
  invites_open: number;
}

export interface AdminAuditEntry {
  actor: string;
  action: string;
  target: string;
  detail: string;
  created_at: number;
}

export const adminApi = {
  listUsers: () => apiFetch<AdminUser[]>("/admin/users"),
  setStatus: (userId: string, status: "active" | "suspended") =>
    apiFetch<{ ok: boolean }>(`/admin/users/${userId}/status`, {
      method: "POST",
      body: JSON.stringify({ status }),
    }),
  setRole: (userId: string, role: "user" | "admin") =>
    apiFetch<{ ok: boolean }>(`/admin/users/${userId}/role`, {
      method: "POST",
      body: JSON.stringify({ role }),
    }),
  deleteUser: (userId: string) =>
    apiFetch<{ ok: boolean }>(`/admin/users/${userId}`, { method: "DELETE" }),
  resendVerification: (userId: string) =>
    apiFetch<{ ok: boolean }>(`/admin/users/${userId}/resend-verification`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  setEntitlements: (userId: string, budget_usd: number | null, storage_bytes: number | null) =>
    apiFetch<{ ok: boolean; budget_usd: number; storage_bytes: number }>(
      `/admin/users/${userId}/entitlements`,
      { method: "PUT", body: JSON.stringify({ budget_usd, storage_bytes }) },
    ),
  createInvite: (note: string, ttl_hours?: number) =>
    apiFetch<AdminInvite>("/admin/invites", {
      method: "POST",
      body: JSON.stringify(ttl_hours ? { note, ttl_hours } : { note }),
    }),
  listInvites: () => apiFetch<AdminInvite[]>("/admin/invites"),
  revokeInvite: (inviteId: string) =>
    apiFetch<{ ok: boolean }>(`/admin/invites/${inviteId}`, { method: "DELETE" }),
  stats: () => apiFetch<AdminStats>("/admin/stats"),
  audit: (limit = 50) => apiFetch<AdminAuditEntry[]>(`/admin/audit?limit=${limit}`),
};
