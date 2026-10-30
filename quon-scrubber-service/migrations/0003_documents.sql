-- Migration 0003: Document module tables
-- Tracks uploaded files, their scrubbed chunks, per-document pseudonym maps,
-- and async ingestion job state.
-- All chunk text is stored *after* PII-scrubbing; real values live only in pseudonym_maps
-- and must never be sent to any external service.

CREATE TABLE IF NOT EXISTS documents (
    id           TEXT    PRIMARY KEY,
    user_id      TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename     TEXT    NOT NULL,
    content_type TEXT    NOT NULL DEFAULT 'application/octet-stream',
    -- pending | processing | ready | failed
    status       TEXT    NOT NULL DEFAULT 'pending',
    error        TEXT,               -- last error message if status=failed
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id);

CREATE TABLE IF NOT EXISTS doc_chunks (
    id           TEXT    PRIMARY KEY,
    document_id  TEXT    NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id      TEXT    NOT NULL,
    text         TEXT    NOT NULL,   -- scrubbed chunk text
    embedding    BLOB,               -- serialised float32 array; NULL until indexed
    chunk_index  INTEGER NOT NULL,   -- 0-based position within the document
    created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_doc_chunks_document ON doc_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_doc_chunks_user     ON doc_chunks(user_id);

-- Reversible pseudonymisation: maps placeholder tokens back to the original values.
-- Scoped per document + user.  Never leave the server; never sent to an LLM.
CREATE TABLE IF NOT EXISTS pseudonym_maps (
    id           TEXT    PRIMARY KEY,
    document_id  TEXT    NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id      TEXT    NOT NULL,
    placeholder  TEXT    NOT NULL,   -- e.g. "PERSON_1"
    real_value   TEXT    NOT NULL,   -- e.g. "Anna Müller"
    created_at   INTEGER NOT NULL,
    UNIQUE(document_id, placeholder)
);

CREATE INDEX IF NOT EXISTS idx_pseudonym_maps_doc  ON pseudonym_maps(document_id);
CREATE INDEX IF NOT EXISTS idx_pseudonym_maps_user ON pseudonym_maps(user_id);

-- Async ingestion job tracking (one row per ingest request).
CREATE TABLE IF NOT EXISTS ingestion_jobs (
    id           TEXT    PRIMARY KEY,
    document_id  TEXT    NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id      TEXT    NOT NULL,
    -- queued | processing | done | failed
    status       TEXT    NOT NULL DEFAULT 'queued',
    error        TEXT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_user ON ingestion_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_doc  ON ingestion_jobs(document_id);
