-- Per-user settings overrides. Each field is nullable: NULL means "use the
-- global default" (config.py / runtime_settings.json, operator-managed). A user
-- can override the PII detection engine, their OpenRouter key, and which models
-- they see — for THEMSELVES only, so no user can affect another user's routing.
-- The two key fields are sealed at rest under QUON_SERVER_SECRET (same trust
-- model as user_connections / the per-user sub-key) and never sent to the browser.
CREATE TABLE IF NOT EXISTS user_settings (
    user_id               TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    pii_backend           TEXT,      -- 'cloud' | 'local' | NULL (=default)
    pii_cloud_model       TEXT,      -- NULL = default
    pii_cloud_base_url    TEXT,      -- NULL = default (OpenRouter)
    pii_cloud_key_cipher  BLOB,      -- secretbox(api_key); NULL = default
    openrouter_key_cipher BLOB,      -- secretbox(api_key); NULL = default (sub-key/global)
    disabled_model_ids    TEXT,      -- JSON array; NULL = use global default
    updated_at            INTEGER NOT NULL
);
