"""Server-side cryptographic helpers (libsodium / PyNaCl).

Two distinct, server-only uses:

* **Hashing** - a salted Argon2id *verifier* for the high-entropy client
  ``authToken`` and SHA-256 hashes for opaque session / email-token secrets,
  compared in constant time. The server never stores these secrets in clear.
  (The brute-force-hardening Argon2 already ran client-side over the password;
  ``authToken`` is high-entropy, so INTERACTIVE limits keep login cheap on a Pi.)

* **Sealing** - authenticated encryption (secretbox) of the per-user OpenRouter
  sub-key *at rest*, under a key derived from ``QUON_SERVER_SECRET``. This is not
  zero-knowledge: the relay legitimately needs the sub-key. It keeps provider
  secrets encrypted on disk and strictly out of the browser.
"""

from __future__ import annotations

import hashlib
import hmac
import os
from functools import lru_cache

import nacl.pwhash
import nacl.secret
import nacl.utils

from config import settings

_OPS = nacl.pwhash.argon2id.OPSLIMIT_INTERACTIVE
_MEM = nacl.pwhash.argon2id.MEMLIMIT_INTERACTIVE
# Test-harness-only: the e2e stack sets QUON_TEST_LIGHT_KDF=1 so the ~130
# logins don't each pay a production Argon2 verify. Fail-closed by design:
# params must match between registration and login (the verifier is a
# deterministic re-derivation), so flipping this on an EXISTING database
# invalidates every verifier - nothing gets weaker-but-accepted. main.py's
# production guard refuses to boot with this flag + COOKIE_SECURE=true.
if os.environ.get("QUON_TEST_LIGHT_KDF") == "1":
    _OPS = nacl.pwhash.argon2id.OPSLIMIT_MIN
    _MEM = nacl.pwhash.argon2id.MEMLIMIT_MIN
SALT_BYTES = nacl.pwhash.argon2id.SALTBYTES  # 16
VERIFIER_BYTES = 32


def random_bytes(n: int) -> bytes:
    return nacl.utils.random(n)


def new_salt() -> bytes:
    """A fresh Argon2id salt (SALT_BYTES long)."""
    return nacl.utils.random(SALT_BYTES)


# --- Auth verifier (server-side hash of the client authToken) -------------
def argon2_verifier(auth_token: bytes, salt: bytes) -> bytes:
    """Derive the stored verifier from the client ``authToken`` and a salt."""
    return nacl.pwhash.argon2id.kdf(
        VERIFIER_BYTES, auth_token, salt, opslimit=_OPS, memlimit=_MEM
    )


def verify_auth_token(auth_token: bytes, salt: bytes, expected: bytes) -> bool:
    """Constant-time check of a presented ``authToken`` against the stored verifier."""
    return hmac.compare_digest(argon2_verifier(auth_token, salt), expected)


# --- Opaque secret hashing (sessions, email tokens) -----------------------
def sha256(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def hash_matches(secret: bytes, expected_hash: bytes) -> bool:
    return hmac.compare_digest(sha256(secret), expected_hash)


def hmac_sha256(key: str, message: str) -> bytes:
    """Keyed hash used for deterministic anti-enumeration salts."""
    return hmac.new(key.encode("utf-8"), message.encode("utf-8"), hashlib.sha256).digest()


# --- Sealing the per-user OpenRouter sub-key at rest ----------------------
@lru_cache(maxsize=1)
def _server_box() -> nacl.secret.SecretBox | None:
    secret = settings.quon_server_secret.strip()
    if not secret:
        return None
    key = hashlib.sha256(secret.encode("utf-8")).digest()  # 32 bytes
    return nacl.secret.SecretBox(key)


def server_secret_configured() -> bool:
    return _server_box() is not None


def seal(plaintext: bytes) -> bytes:
    """Encrypt ``plaintext`` under the server secret. Returns ``nonce||ciphertext``."""
    box = _server_box()
    if box is None:
        raise RuntimeError("QUON_SERVER_SECRET is not configured")
    return bytes(box.encrypt(plaintext))


def open_sealed(blob: bytes) -> bytes:
    """Decrypt a value produced by :func:`seal`."""
    box = _server_box()
    if box is None:
        raise RuntimeError("QUON_SERVER_SECRET is not configured")
    return box.decrypt(blob)
