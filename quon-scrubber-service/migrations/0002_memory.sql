-- Migration 0002: Memory module tables
-- Two memory types: structured facts (key-value) + semantic chunks (vector embeddings).
-- All text content is stored *after* scrubbing - PII never enters these tables in the clear.

CREATE TABLE IF NOT EXISTS memory_facts (
    id          TEXT    PRIMARY KEY,
    user_id     TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key         TEXT    NOT NULL,
    value       TEXT    NOT NULL,   -- scrubbed value
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    UNIQUE(user_id, key)            -- one value per key per user (upsert semantics)
);

CREATE INDEX IF NOT EXISTS idx_memory_facts_user ON memory_facts(user_id);

CREATE TABLE IF NOT EXISTS memory_chunks (
    id          TEXT    PRIMARY KEY,
    user_id     TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text        TEXT    NOT NULL,   -- scrubbed chunk text
    embedding   BLOB,               -- serialised float32 array (little-endian); NULL until indexed
    metadata    TEXT    DEFAULT '{}', -- JSON: source, tags, etc.
    created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_chunks_user ON memory_chunks(user_id);
