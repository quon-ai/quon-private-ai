"""OpenRouter provisioning (management) API client + per-user key lifecycle.

Uses a *provisioning key* (distinct from inference keys) to mint, monitor, patch
and delete per-user sub-keys under the platform OpenRouter account:

    POST   /api/v1/keys           create  -> { key (secret, once), data:{ hash, ... } }
    GET    /api/v1/keys/{hash}    read    -> { data:{ usage, limit, limit_remaining, ... } }
    PATCH  /api/v1/keys/{hash}    update  -> name | disabled | limit | limit_reset
    DELETE /api/v1/keys/{hash}    delete

The minted secret is returned only once on creation; we seal it at rest with
``crypto_server.seal`` and store the stable ``hash`` for later monitor/patch/delete.
The provisioning key lives server-side only (``OPENROUTER_PROVISIONING_KEY``).

Self-hosted QUON Home typically has no provisioning key - :func:`is_enabled`
returns False there and onboarding falls back to BYOK.
"""

from __future__ import annotations

import logging

import httpx

import crypto_server as crypto
import db
import entitlements
from config import settings

logger = logging.getLogger("quon.provisioning")


class ProvisioningError(RuntimeError):
    """A provisioning API call failed. ``status`` is an HTTP code to surface."""

    def __init__(self, message: str, status: int = 502) -> None:
        super().__init__(message)
        self.status = status


def is_enabled() -> bool:
    """True when both a provisioning key and the at-rest server secret are set."""
    return bool(settings.openrouter_provisioning_key.strip()) and crypto.server_secret_configured()


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.openrouter_provisioning_key.strip()}",
        "Content-Type": "application/json",
    }


def _base() -> str:
    return settings.openrouter_provisioning_base_url.rstrip("/")


async def _request(
    method: str, path: str, *, json: dict | None = None, timeout: float = 20.0
) -> dict:
    url = f"{_base()}{path}"
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.request(method, url, headers=_headers(), json=json)
    except (httpx.HTTPError, httpx.TimeoutException) as exc:
        raise ProvisioningError(f"provisioning request failed: {exc}") from exc
    if resp.status_code // 100 != 2:
        raise ProvisioningError(
            f"provisioning {method} {path} -> {resp.status_code}: {resp.text[:200]}"
        )
    try:
        return resp.json()
    except ValueError as exc:
        raise ProvisioningError("provisioning response was not JSON") from exc


# --- Raw API wrappers -----------------------------------------------------
async def create_key(name: str, limit_usd: float) -> tuple[str, dict]:
    """Mint a sub-key. Returns (secret, data). ``secret`` is shown only once."""
    payload = {
        "name": name,
        "limit": limit_usd,
        "limit_reset": None,
        "include_byok_in_limit": False,
    }
    body = await _request("POST", "/keys", json=payload)
    secret = body.get("key")
    data = body.get("data") or {}
    if not secret or not data.get("hash"):
        raise ProvisioningError("provisioning response missing 'key' or 'data.hash'")
    return secret, data


async def get_key(key_hash: str, *, timeout: float = 20.0) -> dict:
    body = await _request("GET", f"/keys/{key_hash}", timeout=timeout)
    return body.get("data") or body


async def set_limit(key_hash: str, limit_usd: float) -> dict:
    body = await _request("PATCH", f"/keys/{key_hash}", json={"limit": limit_usd})
    return body.get("data") or body


async def set_disabled(key_hash: str, disabled: bool) -> dict:
    body = await _request("PATCH", f"/keys/{key_hash}", json={"disabled": disabled})
    return body.get("data") or body


async def delete_key(key_hash: str) -> None:
    await _request("DELETE", f"/keys/{key_hash}")


# --- Per-user lifecycle ---------------------------------------------------
async def ensure_user_key(user_id: str) -> bool:
    """Idempotently ensure the user has a sealed OpenRouter sub-key.

    Returns True if the user has (or now has) a provisioned key, False when
    provisioning is disabled (self-hosted BYOK). Raises :class:`ProvisioningError`
    when provisioning is enabled but the API call fails - the caller keeps the
    account *pending* (fails closed) so it never goes active without a usable key.
    """
    with db.get_conn() as c:
        existing = c.execute(
            "SELECT user_id FROM user_or_keys WHERE user_id=?", (user_id,)
        ).fetchone()
    if existing is not None:
        return True
    if not is_enabled():
        logger.info("provisioning disabled — user %s will use BYOK", user_id)
        return False

    budget = entitlements.resolve(user_id).budget_usd
    secret, data = await create_key(f"quon-user-{user_id}", budget)
    sealed = crypto.seal(secret.encode("utf-8"))
    now = db.now_ms()
    with db.get_conn() as c:
        c.execute(
            "INSERT OR REPLACE INTO user_or_keys(user_id, or_hash, or_key_cipher,"
            " limit_usd, limit_reset, usage_usd, disabled, provisioned_at, updated_at)"
            " VALUES (?,?,?,?,?,?,?,?,?)",
            (
                user_id,
                data["hash"],
                sealed,
                float(data.get("limit") or budget),
                data.get("limit_reset"),
                float(data.get("usage") or 0.0),
                1 if data.get("disabled") else 0,
                now,
                now,
            ),
        )
    logger.info("provisioned OpenRouter sub-key for user %s (hash=%s)", user_id, data["hash"])
    return True


def get_user_key_secret(user_id: str) -> str | None:
    """Unseal and return the user's OpenRouter sub-key secret, or None.

    Server-side only - the relay uses this to call OpenRouter on the user's
    behalf. Never expose the result to the browser.
    """
    with db.get_conn() as c:
        row = c.execute(
            "SELECT or_key_cipher, disabled FROM user_or_keys WHERE user_id=?", (user_id,)
        ).fetchone()
    if row is None or row["disabled"]:
        return None
    return crypto.open_sealed(row["or_key_cipher"]).decode("utf-8")
