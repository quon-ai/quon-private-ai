-- Per-user BYOK chat provider connections (OpenAI-compatible). The API key is
-- sealed at rest under QUON_SERVER_SECRET (same trust model as the per-user
-- OpenRouter sub-key) and never sent to the browser. OpenRouter itself stays a
-- global/operator connection; these are each user's own added providers.
CREATE TABLE IF NOT EXISTS user_connections (
    user_id     TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id          TEXT    NOT NULL,                 -- client-generated connection id
    label       TEXT    NOT NULL,
    base_url    TEXT    NOT NULL,
    models      TEXT    NOT NULL DEFAULT '[]',    -- JSON array of model slugs
    key_cipher  BLOB,                             -- secretbox(api_key, QUON_SERVER_SECRET)
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS ix_user_connections_user ON user_connections(user_id);
