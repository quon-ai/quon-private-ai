-- 0007_shared_projects.sql - Shared Projects v1 (read-only, zero-knowledge).
--
-- A shares a project (Memory, Documents incl. originals, instruction - chats
-- explicitly not) with B on the same instance; the server stores only
-- ciphertext. Every shared project has a client-generated random Project Key
-- (PK); the server never sees it. Each member's grant stores the PK as a
-- libsodium sealed box to that member's X25519 identity pubkey (opaque BLOB
-- here). Invite tokens are one-time JOIN capabilities (hashed at rest, same
-- pattern as email_tokens); the PK itself travels in the invite link's URL
-- fragment, which never reaches the server.

-- Client-generated X25519 identity keypair (set-once via POST /auth/identity;
-- nullable - existing accounts backfill lazily on first use of sharing).
-- identity_priv_wrapped is wrapped client-side under the user's Master Key
-- (CTX "quonidk0") - the server stores it only so the user's other devices can
-- unwrap it; it cannot use it. Applied exactly once by the migration runner
-- (schema_migrations), so bare ADD COLUMNs are safe (same as 0005/0006).
ALTER TABLE users ADD COLUMN identity_pub BLOB;
ALTER TABLE users ADD COLUMN identity_priv_wrapped BLOB;

-- One row per project that has been shared. project_id is the client's opaque
-- project uuid (unguessable; the server learns nothing about unshared projects).
CREATE TABLE IF NOT EXISTS project_shares (
    project_id    TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_project_shares_owner ON project_shares(owner_user_id);

-- Membership ACL. sealed_pk = sealed box of the PK to this member's own
-- identity pubkey (each member submits their own copy - at share time for the
-- owner, at accept time for a reader). v1 roles: 'owner' (pushes) | 'reader'
-- (pull-only).
CREATE TABLE IF NOT EXISTS project_grants (
    project_id TEXT NOT NULL REFERENCES project_shares(project_id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK(role IN ('owner','reader')),
    sealed_pk  BLOB NOT NULL,
    granted_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS ix_project_grants_user ON project_grants(user_id);

-- One-time invite tokens: the DB stores only sha256(secret); the wire token is
-- "<id>.<secret>" so validation is an indexed lookup (email_tokens pattern).
CREATE TABLE IF NOT EXISTS share_invites (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES project_shares(project_id) ON DELETE CASCADE,
    token_hash BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at    INTEGER
);
CREATE INDEX IF NOT EXISTS ix_share_invites_project ON share_invites(project_id);

-- Project-partitioned twin of `blobs`: same LWW columns, but keyed by project
-- (not user) and sequenced per PROJECT so all members share one delta stream.
-- ON DELETE CASCADE means unsharing a project drops its ciphertext with it.
CREATE TABLE IF NOT EXISTS shared_blobs (
    project_id  TEXT NOT NULL REFERENCES project_shares(project_id) ON DELETE CASCADE,
    collection  TEXT NOT NULL,
    id          TEXT NOT NULL,
    ciphertext  BLOB NOT NULL,                       -- opaque; encrypted under the PK
    content_ver INTEGER NOT NULL DEFAULT 1,
    updated_at  INTEGER NOT NULL,                    -- client-asserted LWW time
    server_seq  INTEGER NOT NULL,                    -- per-PROJECT monotonic
    deleted     INTEGER NOT NULL DEFAULT 0,          -- tombstone
    PRIMARY KEY (project_id, collection, id)
);
CREATE INDEX IF NOT EXISTS ix_shared_blobs_pull ON shared_blobs(project_id, server_seq);

-- Per-project monotonic sequence counter (twin of sync_meta).
CREATE TABLE IF NOT EXISTS shared_sync_meta (
    project_id TEXT PRIMARY KEY REFERENCES project_shares(project_id) ON DELETE CASCADE,
    next_seq   INTEGER NOT NULL DEFAULT 1
);
