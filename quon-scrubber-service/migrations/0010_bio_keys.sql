-- Biometric-unlock key wraps (WebAuthn PRF), one row per enrolled device
-- credential. Zero-knowledge: wrap_bio is nonce||secretbox(MasterKey) under a
-- key the CLIENT derives from the authenticator's PRF output - that secret
-- lives in the device's secure hardware (Secure Enclave / StrongBox) and is
-- released only after on-device biometric verification, so this row is useless
-- to the server or a DB attacker. prf_salt is the public PRF eval input.
CREATE TABLE IF NOT EXISTS user_bio_keys (
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id TEXT NOT NULL,   -- base64url WebAuthn credential id (opaque)
    wrap_bio      BLOB NOT NULL,   -- nonce||secretbox(MK, KDF(prfOutput,"quonbio0"))
    prf_salt      BLOB NOT NULL,   -- 32 bytes, public PRF eval input
    created_at    INTEGER NOT NULL,
    last_used_at  INTEGER,
    PRIMARY KEY (user_id, credential_id)
);
