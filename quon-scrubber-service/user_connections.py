"""Per-user BYOK chat provider connections (OpenAI-compatible).

Each user can add their own providers (OpenAI, Anthropic, Groq, local Ollama, …)
with their own API key. The key is sealed at rest under ``QUON_SERVER_SECRET``
(reusing :mod:`crypto_server`) and never returned to the browser — same trust
model as the per-user OpenRouter sub-key. OpenRouter itself stays a global
connection (see :mod:`connections`); these are strictly per-user additions.
"""

from __future__ import annotations

import json

import crypto_server as crypto
import db
import net_guard


def _row_public(row) -> dict:
    """Map a DB row to a connection dict WITHOUT the key (for listing)."""
    return {
        "id": row["id"],
        "label": row["label"],
        "base_url": row["base_url"],
        "models": json.loads(row["models"] or "[]"),
        "key_configured": row["key_cipher"] is not None,
    }


def list_for_user(user_id: str) -> list[dict]:
    """All of the user's connections (no secrets)."""
    with db.get_conn() as c:
        rows = c.execute(
            "SELECT id, label, base_url, models, key_cipher FROM user_connections"
            " WHERE user_id=? ORDER BY created_at",
            (user_id,),
        ).fetchall()
    return [_row_public(r) for r in rows]


def get_for_user(user_id: str, cid: str) -> dict | None:
    """One connection (no secret), or None."""
    with db.get_conn() as c:
        row = c.execute(
            "SELECT id, label, base_url, models, key_cipher FROM user_connections"
            " WHERE user_id=? AND id=?",
            (user_id, cid),
        ).fetchone()
    return _row_public(row) if row else None


def resolve_key(user_id: str, cid: str) -> tuple[str, str] | None:
    """``(base_url, api_key)`` for a user connection (key unsealed), or None."""
    with db.get_conn() as c:
        row = c.execute(
            "SELECT base_url, key_cipher FROM user_connections WHERE user_id=? AND id=?",
            (user_id, cid),
        ).fetchone()
    if not row or row["key_cipher"] is None:
        return None
    try:
        key = crypto.open_sealed(row["key_cipher"]).decode("utf-8")
    except Exception:
        return None
    return (row["base_url"], key) if row["base_url"] and key else None


def upsert(
    user_id: str,
    cid: str,
    label: str,
    base_url: str,
    models: list[str],
    api_key: str | None = None,
) -> None:
    """Create/update a user connection. The key is sealed; an empty/omitted
    api_key keeps the existing one (write-only)."""
    if base_url and base_url.strip():
        net_guard.validate_public_url(base_url)  # SSRF guard (raises UnsafeUrlError)
    models_json = json.dumps([m.strip() for m in models if m.strip()])
    now = db.now_ms()
    sealed = crypto.seal(api_key.strip().encode("utf-8")) if api_key and api_key.strip() else None
    with db.get_conn() as c:
        existing = c.execute(
            "SELECT key_cipher, created_at FROM user_connections WHERE user_id=? AND id=?",
            (user_id, cid),
        ).fetchone()
        if existing is None:
            c.execute(
                "INSERT INTO user_connections"
                " (user_id, id, label, base_url, models, key_cipher, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (user_id, cid, label.strip() or cid, base_url.strip(), models_json, sealed, now, now),
            )
        else:
            # Keep the existing sealed key when none was supplied.
            key_cipher = sealed if sealed is not None else existing["key_cipher"]
            c.execute(
                "UPDATE user_connections SET label=?, base_url=?, models=?, key_cipher=?,"
                " updated_at=? WHERE user_id=? AND id=?",
                (label.strip() or cid, base_url.strip(), models_json, key_cipher, now, user_id, cid),
            )


def delete(user_id: str, cid: str) -> None:
    with db.get_conn() as c:
        c.execute("DELETE FROM user_connections WHERE user_id=? AND id=?", (user_id, cid))
