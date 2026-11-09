"""Account + admin endpoints for the per-user OpenRouter key lifecycle.

``/account/usage`` lets a logged-in user see their remaining $5 credit. The
``/admin/*`` endpoints (guarded by a shared-secret ``ADMIN_TOKEN``) let the
operator raise a user's limit (Premium upgrade) or disable their key.
"""

from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

import db
import openrouter_provisioning as prov
from auth import User, current_active_user
from config import settings

router = APIRouter(tags=["account"])


class UsageResponse(BaseModel):
    provisioned: bool
    limit_usd: float | None = None
    usage_usd: float | None = None
    limit_remaining_usd: float | None = None
    disabled: bool = False


# Successful live refreshes are cached per user for a few minutes so an open
# Settings screen (or the chat-mount budget check) can't hammer the OpenRouter
# management API. In-process only - fine for the single-worker deployment.
# Fallback responses (upstream outage) are deliberately not cached so recovery
# is picked up on the next request. Admin limit/disable changes invalidate.
_USAGE_CACHE_TTL_MS = 5 * 60 * 1000
_USAGE_REFRESH_TIMEOUT_S = 6.0
_usage_cache: dict[str, tuple[int, UsageResponse]] = {}


@router.get("/account/usage", response_model=UsageResponse)
async def account_usage(user: User = Depends(current_active_user)) -> UsageResponse:
    """The user's OpenRouter credit usage. Refreshed live when provisioning is
    enabled (result cached ~5 min); otherwise the stored mirror is returned.
    Only usage/limit numbers ever leave the server - never the sub-key."""
    with db.get_conn() as c:
        row = c.execute("SELECT * FROM user_or_keys WHERE user_id=?", (user.id,)).fetchone()
    if row is None:
        return UsageResponse(provisioned=False)

    cached = _usage_cache.get(user.id)
    if cached is not None and db.now_ms() - cached[0] < _USAGE_CACHE_TTL_MS:
        return cached[1]

    if prov.is_enabled():
        try:
            data = await prov.get_key(row["or_hash"], timeout=_USAGE_REFRESH_TIMEOUT_S)
            usage = float(data.get("usage") or 0.0)
            limit = float(data["limit"]) if data.get("limit") is not None else row["limit_usd"]
            remaining = (
                float(data["limit_remaining"])
                if data.get("limit_remaining") is not None
                else max(limit - usage, 0.0)
            )
            with db.get_conn() as c:
                c.execute(
                    "UPDATE user_or_keys SET usage_usd=?, limit_usd=?, updated_at=? WHERE user_id=?",
                    (usage, limit, db.now_ms(), user.id),
                )
            fresh = UsageResponse(
                provisioned=True,
                limit_usd=limit,
                usage_usd=usage,
                limit_remaining_usd=remaining,
                disabled=bool(row["disabled"]),
            )
            _usage_cache[user.id] = (db.now_ms(), fresh)
            return fresh
        except prov.ProvisioningError:
            pass  # fall through to the stored mirror (uncached)

    return UsageResponse(
        provisioned=True,
        limit_usd=row["limit_usd"],
        usage_usd=row["usage_usd"],
        limit_remaining_usd=max(row["limit_usd"] - row["usage_usd"], 0.0),
        disabled=bool(row["disabled"]),
    )


# --- Admin -----------------------------------------------------------------
# Auth for the two legacy or-* endpoints now goes through the shared admin
# dependency (session role=admin OR ADMIN_TOKEN break-glass, audited).
from admin import require_admin_actor as _admin_actor  # noqa: E402

# (legacy token-only checker kept below for reference/tests)
def require_admin(authorization: str = Header(default="")) -> None:
    token = settings.admin_token.strip()
    if not token:
        raise HTTPException(status_code=503, detail="admin endpoints are disabled")
    presented = authorization.removeprefix("Bearer ").strip()
    if not secrets.compare_digest(presented, token):
        raise HTTPException(status_code=403, detail="forbidden")


def _hash_for(user_id: str) -> str:
    with db.get_conn() as c:
        row = c.execute("SELECT or_hash FROM user_or_keys WHERE user_id=?", (user_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="user has no provisioned key")
    return row["or_hash"]


class LimitUpdate(BaseModel):
    limit_usd: float


@router.post("/admin/users/{user_id}/or-limit")
async def admin_set_limit(
    user_id: str, body: LimitUpdate, actor: str = Depends(_admin_actor)
) -> dict:
    """Raise/lower a user's OpenRouter credit limit (e.g. Premium upgrade)."""
    await prov.set_limit(_hash_for(user_id), body.limit_usd)
    with db.get_conn() as c:
        c.execute(
            "UPDATE user_or_keys SET limit_usd=?, updated_at=? WHERE user_id=?",
            (body.limit_usd, db.now_ms(), user_id),
        )
    _usage_cache.pop(user_id, None)  # user sees the new limit immediately
    return {"ok": True, "user_id": user_id, "limit_usd": body.limit_usd}


@router.delete("/admin/users/{user_id}/or-key")
async def admin_disable(user_id: str, actor: str = Depends(_admin_actor)) -> dict:
    """Disable a user's OpenRouter sub-key (suspend access)."""
    await prov.set_disabled(_hash_for(user_id), True)
    with db.get_conn() as c:
        c.execute(
            "UPDATE user_or_keys SET disabled=1, updated_at=? WHERE user_id=?",
            (db.now_ms(), user_id),
        )
    _usage_cache.pop(user_id, None)
    return {"ok": True, "user_id": user_id, "disabled": True}
