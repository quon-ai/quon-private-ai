"""Per-user settings overrides layered over the global defaults.

Every user can override, for THEMSELVES only, their OpenRouter key and which
models they see. Anything a user hasn't set falls back to the operator-managed
global default (``settings_store`` / ``config.py``). Because each override is
scoped to its own user, no user can change another user's routing: a key or
model choice only ever affects that user's own chats, never anyone else's.
(Detection itself runs in-process on this server for everyone; there is no
per-user detection endpoint.)

Key fields are sealed at rest under ``QUON_SERVER_SECRET`` (reusing
:mod:`crypto_server`, same trust model as :mod:`user_connections`) and never
returned to the browser. Setting a key requires the server secret to be
configured; the non-secret fields work without it.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass

import crypto_server as crypto
import db
import net_guard
import settings_store


def _row(user_id: str) -> dict | None:
    try:
        with db.get_conn() as c:
            row = c.execute("SELECT * FROM user_settings WHERE user_id=?", (user_id,)).fetchone()
    except sqlite3.OperationalError:
        # The overlay table isn't there yet (fresh DB before migration 0009, or a
        # stateless detection-only test). The overlay is optional -> treat as "no
        # override" and fall back to the operator's global default (a safe value,
        # never an attacker's). Real requests run against a migrated DB.
        return None
    return dict(row) if row is not None else None


def _unseal(cipher) -> str | None:
    if not cipher:
        return None
    try:
        return crypto.open_sealed(cipher).decode("utf-8")
    except Exception:
        return None


def _upsert(user_id: str, **fields) -> None:
    """Set the given columns for a user (creating the row if needed), leaving
    every other column untouched."""
    cols = list(fields.keys())
    now = db.now_ms()
    with db.transaction() as c:
        exists = c.execute("SELECT 1 FROM user_settings WHERE user_id=?", (user_id,)).fetchone()
        if exists is None:
            c.execute(
                "INSERT INTO user_settings(user_id, updated_at) VALUES (?, ?)", (user_id, now)
            )
        assignments = ", ".join(f"{col}=?" for col in cols)
        c.execute(
            f"UPDATE user_settings SET {assignments}, updated_at=? WHERE user_id=?",
            (*[fields[col] for col in cols], now, user_id),
        )


# --- PII engine ------------------------------------------------------------
def get_openrouter_key(user_id: str | None) -> str | None:
    """This user's own OpenRouter key override, or None."""
    row = _row(user_id) if user_id else None
    return _unseal(row["openrouter_key_cipher"]) if row else None


def has_openrouter_key(user_id: str | None) -> bool:
    """Whether this user has an own-key override stored (presence only - the
    settings screen shows a "remove" control for it; the key never leaves)."""
    row = _row(user_id) if user_id else None
    return bool(row and row["openrouter_key_cipher"])


def set_openrouter_key(user_id: str, key: str) -> None:
    """Set (or clear, with an empty string) this user's OpenRouter key override."""
    cipher = crypto.seal(key.strip().encode()) if key.strip() else None
    _upsert(user_id, openrouter_key_cipher=cipher)


# --- Model visibility ------------------------------------------------------
def resolve_disabled_ids(user_id: str | None) -> set[str]:
    """The set of model ids this user has disabled: their override if set, else
    the operator's global default list."""
    row = _row(user_id) if user_id else None
    if row is not None and row["disabled_model_ids"] is not None:
        try:
            return set(json.loads(row["disabled_model_ids"]))
        except (ValueError, TypeError):
            pass
    return settings_store.get_disabled_model_ids()


def set_disabled_ids(user_id: str, ids: list[str]) -> None:
    _upsert(user_id, disabled_model_ids=json.dumps(sorted(set(ids))))
