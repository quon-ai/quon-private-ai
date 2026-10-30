/** Typed client for the QUON zero-knowledge sync relay. */

import { apiFetch } from "./http";

export interface BlobOut {
  collection: string;
  id: string;
  ciphertext: string; // base64
  content_ver: number;
  updated_at: number;
  deleted: boolean;
  server_seq: number;
}

export interface ChangesResponse {
  changes: BlobOut[];
  latest_seq: number;
}

export interface BlobIn {
  collection: string;
  id: string;
  ciphertext: string; // base64; "" only when deleted
  content_ver?: number;
  updated_at: number;
  deleted?: boolean;
  /** Shared-project blob: routed to the project's shared store (grant-checked). */
  project_id?: string;
}

export interface PushResult {
  collection: string;
  id: string;
  /** `quota` = per-user storage quota exceeded (originals collection only);
   *  `forbidden` = shared-project write refused (reader role / no grant) —
   *  both distinct from transient failures so the client can stop retrying. */
  status: "accepted" | "stale" | "quota" | "forbidden";
  server_seq: number;
  updated_at: number;
  project_id?: string | null;
}

export interface PushResponse {
  results: PushResult[];
  /** Personal stream cursor only — shared cursors advance via project_latest_seqs. */
  latest_seq: number;
  /** Per-project seq for every shared project written in this batch. */
  project_latest_seqs?: Record<string, number>;
}

export interface OriginalsUsage {
  used_bytes: number;
  quota_bytes: number;
}

const proj = (projectId?: string) =>
  projectId ? `&project_id=${encodeURIComponent(projectId)}` : "";

export const syncApi = {
  changes: (collection: string, since: number, projectId?: string) =>
    apiFetch<ChangesResponse>(
      `/sync/changes?collection=${encodeURIComponent(collection)}&since=${since}${proj(projectId)}`,
    ),
  push: (changes: BlobIn[]) =>
    // 120s, not the 30s default: an originals-chunk push carries ~340KB of
    // base64 per chunk, and a slow uplink must finish, not time out.
    apiFetch<PushResponse>(
      "/sync/push",
      { method: "POST", body: JSON.stringify({ changes }) },
      120_000,
    ),
  /** Lazy single-blob pull (originals chunks — kept out of the delta loop so
   *  originals never auto-download onto every device). 404 = absent/deleted. */
  blob: (collection: string, id: string, projectId?: string) =>
    apiFetch<BlobOut>(
      `/sync/blob?collection=${encodeURIComponent(collection)}&id=${encodeURIComponent(id)}${proj(projectId)}`,
    ),
  /** Live originals-quota usage (byte counts only) — the Documents screen's
   *  "X of 200 MB" storage line. */
  originalsUsage: () => apiFetch<OriginalsUsage>("/sync/originals/usage"),
};
