-- QUON Agents — Phase 1: server-side "web-watch" agents (Option C).
--
-- ZERO-KNOWLEDGE: the runner only ever operates on the agent SPEC (a search
-- query — interest metadata, NOT the user's encrypted documents/memory) and
-- PUBLIC web results. Each result is sealed (libsodium sealed box) to the user's
-- OWN X25519 identity pubkey (users.identity_pub) BEFORE it is stored, so the
-- operator/DB only ever sees ciphertext only the user's client can open.
--
-- `spec_json` holds the search query + filters. It is NOT private encrypted
-- content, but it IS interest metadata visible to the operator (disclosed in the
-- UI, same trust class as a web search through QUON). Everything the runner
-- PRODUCES is sealed.
CREATE TABLE IF NOT EXISTS agents (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    kind         TEXT NOT NULL,              -- 'web-watch' (only kind in phase 1)
    spec_json    TEXT NOT NULL,              -- {"query": "...", ...} — interest metadata
    schedule     TEXT NOT NULL DEFAULT 'daily',
    enabled      INTEGER NOT NULL DEFAULT 1,
    last_run_at  INTEGER,                    -- epoch seconds of the last runner pass
    last_hash    TEXT,                       -- hash of the last result (skip identical re-runs)
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agents_user ON agents(user_id);
CREATE INDEX IF NOT EXISTS idx_agents_due ON agents(enabled, last_run_at);

-- One sealed result per runner pass that produced something new.
CREATE TABLE IF NOT EXISTS agent_results (
    id           TEXT PRIMARY KEY,
    agent_id     TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sealed_blob  TEXT NOT NULL,              -- base64 crypto_box_seal(result, identity_pub)
    created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_results_agent ON agent_results(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_results_user ON agent_results(user_id, created_at);
