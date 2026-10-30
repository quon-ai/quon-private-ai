"""The /settings/* write endpoints require authentication and are PER-USER.

Settings (PII engine, OpenRouter key, disabled models) are stored per-user and
layered over the operator-managed global default — a user's write only affects
their OWN routing, so no account can repoint another user's PII extraction. The
writes still require a session (401 anonymous); the read GET /settings stays open.
"""

from __future__ import annotations

from conftest import make_active_user

# (method, path, body) for every settings WRITE.
WRITES = [
    ("put", "/settings/openrouter-key", {"api_key": "x"}),
    ("put", "/settings/models", {"disabled_ids": []}),
    ("put", "/settings/connections/c1", {}),
    ("delete", "/settings/connections/c1", None),
]


def _call(client, method, path, body, headers=None):
    if method == "delete":
        return client.delete(path, headers=headers)
    return client.put(path, json=body, headers=headers)


def test_settings_writes_reject_anonymous(quon_client):
    # Valid bodies, so the ONLY possible failure is the auth gate (→ 401, not 422).
    for method, path, body in WRITES:
        assert _call(quon_client, method, path, body).status_code == 401, path
    assert quon_client.get("/settings/connections/c1/catalog").status_code == 401


def test_authenticated_user_may_write_their_own_settings(quon_client):
    headers = make_active_user(quon_client, "user@quon.local")
    # A regular authenticated user can set their OWN disabled models
    # (no operator role needed); a write that touches no external service → 200.
    assert (
        quon_client.put(
            "/settings/models", json={"disabled_ids": ["openrouter::x"]}, headers=headers
        ).status_code
        == 200
    )


def test_settings_read_stays_open(quon_client):
    # The non-secret read endpoint is intentionally reachable without a session.
    assert quon_client.get("/settings").status_code == 200
