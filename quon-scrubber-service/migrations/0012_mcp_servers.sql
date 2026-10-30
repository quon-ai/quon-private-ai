-- Per-user MCP (Model Context Protocol) tool servers. The auth header value is
-- sealed under QUON_SERVER_SECRET (crypto_server) — useless to the server
-- operator or a DB attacker without that secret. URLs are SSRF-guarded at
-- write AND request time (net_guard).
CREATE TABLE IF NOT EXISTS user_mcp_servers (
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id          TEXT NOT NULL,
    label       TEXT NOT NULL,
    url         TEXT NOT NULL,
    -- Sealed "Header-Name: value" string (e.g. "Authorization: Bearer …"), or NULL.
    auth_cipher BLOB,
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (user_id, id)
);
