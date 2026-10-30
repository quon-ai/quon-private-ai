-- Admin foundation: operator role, audit trail, single-use invites, and
-- per-user entitlement overrides (the seam subscription plans plug into later).

-- 'user' | 'admin'. The first account registered on a fresh instance becomes
-- admin (auth.register); existing instances promote via the ADMIN_TOKEN
-- break-glass endpoint. Admin grants METADATA-level management only — the
-- zero-knowledge model is unchanged (no role can read user content).
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';

-- Every admin mutation is recorded (who, what, target, when). actor is a user
-- id for session-authenticated admins or 'token' for ADMIN_TOKEN calls.
CREATE TABLE IF NOT EXISTS admin_audit (
    id          TEXT PRIMARY KEY,             -- uuid4
    actor       TEXT NOT NULL,
    action      TEXT NOT NULL,                -- e.g. 'user.suspend', 'invite.create'
    target      TEXT NOT NULL DEFAULT '',     -- user id / invite id / ''
    detail      TEXT NOT NULL DEFAULT '',     -- small human-readable summary (no PII beyond email)
    created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit(created_at);

-- Single-use, expiring invite codes (alternative to the one static
-- signup_invite_code). Only sha256(code) is stored; the plaintext code is
-- shown exactly once at creation.
CREATE TABLE IF NOT EXISTS invites (
    id          TEXT PRIMARY KEY,             -- uuid4
    code_hash   BLOB NOT NULL UNIQUE,         -- sha256(code)
    note        TEXT NOT NULL DEFAULT '',     -- operator label ("für Anna")
    created_by  TEXT NOT NULL,                -- actor (user id or 'token')
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    used_at     INTEGER,                      -- NULL = still open
    used_by     TEXT                          -- user id once a real account consumed it
);

-- Per-user entitlement OVERRIDES. NULL field = use the instance default
-- (config: openrouter_user_limit_usd / originals_quota_bytes). Resolution
-- lives in entitlements.py — the single seam a future subscription plan
-- feeds into.
CREATE TABLE IF NOT EXISTS user_entitlements (
    user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    budget_usd    REAL,
    storage_bytes INTEGER,
    updated_at    INTEGER NOT NULL
);
