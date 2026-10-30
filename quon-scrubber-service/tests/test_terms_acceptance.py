"""Sign-up records which Nutzungsvereinbarung version the user accepted.

Proof of consent = version + timestamp (migration 0008). The checkbox in the
client gates the request; the server persists whatever version is sent so we can
later show WHICH wording a given account agreed to and WHEN.
"""

from __future__ import annotations

import db
from conftest import register_body


def _terms_row(email: str) -> tuple[str | None, int | None]:
    with db.get_conn() as c:
        row = c.execute(
            "SELECT terms_version, terms_accepted_at FROM users WHERE email=?", (email,)
        ).fetchone()
    return (row["terms_version"], row["terms_accepted_at"])


def test_register_records_accepted_terms_version(quon_client):
    c = quon_client
    body = register_body("consent@x.de")
    body["terms_version"] = "2026-07-09"

    r = c.post("/auth/register", json=body)
    assert r.status_code == 201

    version, accepted_at = _terms_row("consent@x.de")
    assert version == "2026-07-09"
    assert isinstance(accepted_at, int) and accepted_at > 0


def test_register_without_version_records_no_acceptance(quon_client):
    """Backward-compat: a payload without terms_version stores NULL, not a wrong
    version — never a false record of consent."""
    c = quon_client
    r = c.post("/auth/register", json=register_body("noterms@x.de"))
    assert r.status_code == 201

    version, accepted_at = _terms_row("noterms@x.de")
    assert version is None
    assert accepted_at is None
