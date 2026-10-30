"""Per-user entitlement resolution — the seam plans/subscriptions plug into.

Every limit the server enforces per user (inference budget, originals storage)
resolves through :func:`resolve`: user override (``user_entitlements`` row,
admin-set) → instance default (config). A future subscription feature only has
to write rows here (or add a plan → entitlements mapping in this module);
provisioning, quota and catalog code never change again.

Deliberately metadata-only: entitlements say how MUCH a user may use, never
WHAT they store — the zero-knowledge model is untouched.
"""

from __future__ import annotations

from dataclasses import dataclass

import db
from config import settings


@dataclass(frozen=True)
class Entitlements:
    budget_usd: float
    storage_bytes: int
    # True when any field deviates from the instance default (admin override /
    # future plan) — surfaced in the admin UI so overrides are never invisible.
    overridden: bool


def resolve(user_id: str) -> Entitlements:
    """Effective entitlements for ``user_id`` (override ?? instance default)."""
    with db.get_conn() as c:
        row = c.execute(
            "SELECT budget_usd, storage_bytes FROM user_entitlements WHERE user_id=?",
            (user_id,),
        ).fetchone()
    budget = settings.openrouter_user_limit_usd
    storage = settings.originals_quota_bytes
    overridden = False
    if row is not None:
        if row["budget_usd"] is not None:
            budget = float(row["budget_usd"])
            overridden = True
        if row["storage_bytes"] is not None:
            storage = int(row["storage_bytes"])
            overridden = True
    return Entitlements(budget_usd=budget, storage_bytes=storage, overridden=overridden)


def set_overrides(
    user_id: str, *, budget_usd: float | None, storage_bytes: int | None
) -> None:
    """Write the override row (NULL field = fall back to default). Both None
    deletes the row entirely — the user is fully back on instance defaults."""
    with db.get_conn() as c:
        if budget_usd is None and storage_bytes is None:
            c.execute("DELETE FROM user_entitlements WHERE user_id=?", (user_id,))
            return
        c.execute(
            "INSERT INTO user_entitlements(user_id, budget_usd, storage_bytes, updated_at)"
            " VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET"
            " budget_usd=excluded.budget_usd, storage_bytes=excluded.storage_bytes,"
            " updated_at=excluded.updated_at",
            (user_id, budget_usd, storage_bytes, db.now_ms()),
        )
