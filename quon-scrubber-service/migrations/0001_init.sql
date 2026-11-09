-- 0001_init.sql - QUON multi-user auth, E2E sync, and OpenRouter key tables.
--
-- All timestamps are epoch milliseconds. BLOB columns hold raw bytes (salts,
-- nonces, wrapped keys, ciphertext). The server never stores plaintext PII or
-- unwrapped user key material; the only key it can use is the per-user
-- OpenRouter sub-key, which is sealed at rest with QUON_SERVER_SECRET.

-- Accounts + auth verifier. The server stores only argon2id(authToken, salt);
-- it never sees the password or any key that can open the user's Master Key.
CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,                  -- uuid4
    email         TEXT NOT NULL UNIQUE,
    status        TEXT NOT NULL DEFAULT 'pending',   -- pending|active|suspended
    auth_verifier BLOB NOT NULL,                     -- argon2id(authToken, auth_salt)
    auth_salt     BLOB NOT NULL,
    created_at    INTEGER NOT NULL,
    activated_at  INTEGER
);

-- E2E key material: only the doubly-wrapped Master Key + KDF salts. The server
-- cannot derive pwWrapKey/recWrapKey, so it cannot open wrap_pw/wrap_rec.
CREATE TABLE IF NOT EXISTS user_keys (
    user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    kdf        TEXT NOT NULL DEFAULT 'argon2id',
    kdf_params TEXT NOT NULL,                        -- json {mem, ops, parallelism, ver}
    kdf_salt   BLOB NOT NULL,                        -- salt for the password KDF (client)
    wrap_pw    BLOB NOT NULL,                        -- nonce||secretbox(MK) under pwWrapKey
    rec_salt   BLOB NOT NULL,                        -- salt for the recovery KDF (client)
    wrap_rec   BLOB NOT NULL,                        -- nonce||secretbox(MK) under recWrapKey
    updated_at INTEGER NOT NULL
);

-- Opaque server-side sessions. The cookie carries the session id + a secret; the
-- DB stores only sha256 hashes of the session secret and the CSRF token.
CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,                     -- random id (also in the cookie)
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash BLOB NOT NULL,                        -- sha256(session_secret)
    csrf_hash  BLOB NOT NULL,                        -- sha256(csrf_token)
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_seen  INTEGER,
    user_agent TEXT
);
CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions(user_id);

-- Single-use email tokens (verification + recovery-initiated reset), hashed.
CREATE TABLE IF NOT EXISTS email_tokens (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose    TEXT NOT NULL,                        -- verify|reset
    token_hash BLOB NOT NULL,                        -- sha256(token_secret)
    expires_at INTEGER NOT NULL,
    used_at    INTEGER
);
CREATE INDEX IF NOT EXISTS ix_email_tokens_user ON email_tokens(user_id);

-- Zero-knowledge sync blobs: one row per logical object (e.g. a chat session).
-- ciphertext is opaque to the server; last-write-wins by client updated_at.
CREATE TABLE IF NOT EXISTS blobs (
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    collection  TEXT NOT NULL,                       -- 'chat' (later 'memory','settings')
    id          TEXT NOT NULL,                       -- client blob id (= chat session id)
    ciphertext  BLOB NOT NULL,                       -- nonce||secretbox(json, chatKey)
    content_ver INTEGER NOT NULL DEFAULT 1,
    updated_at  INTEGER NOT NULL,                    -- client-asserted LWW time
    server_seq  INTEGER NOT NULL,                    -- per-user monotonic, drives pull-since
    deleted     INTEGER NOT NULL DEFAULT 0,          -- tombstone
    PRIMARY KEY (user_id, collection, id)
);
CREATE INDEX IF NOT EXISTS ix_blobs_pull ON blobs(user_id, collection, server_seq);

-- Per-user OpenRouter sub-key (server-side secret, sealed at rest). Used by the
-- relay to call OpenRouter on the user's behalf; never sent to the browser.
CREATE TABLE IF NOT EXISTS user_or_keys (
    user_id        TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    or_hash        TEXT NOT NULL,                    -- OpenRouter 'hash' identifier
    or_key_cipher  BLOB NOT NULL,                    -- secretbox(secret, QUON_SERVER_SECRET)
    limit_usd      REAL NOT NULL DEFAULT 5.0,
    limit_reset    TEXT,                             -- null|daily|weekly|monthly
    usage_usd      REAL NOT NULL DEFAULT 0,          -- cached last-known usage
    disabled       INTEGER NOT NULL DEFAULT 0,
    provisioned_at INTEGER,
    updated_at     INTEGER
);

-- Per-user monotonic sequence counter for the sync pull protocol.
CREATE TABLE IF NOT EXISTS sync_meta (
    user_id  TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    next_seq INTEGER NOT NULL DEFAULT 1
);
