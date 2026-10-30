"""Zero-knowledge sync relay: push/pull, last-write-wins, tombstones, isolation."""

from __future__ import annotations

import base64

from conftest import b64, make_active_user


def _push(client, headers, changes):
    return client.post("/sync/push", json={"changes": changes}, headers=headers)


def test_push_pull_roundtrip(quon_client):
    c = quon_client
    h = make_active_user(c, "s1@x.de")
    r = _push(
        c,
        h,
        [
            {"collection": "chat", "id": "c1", "ciphertext": b64(b"cipher1"), "updated_at": 100},
            {"collection": "chat", "id": "c2", "ciphertext": b64(b"cipher2"), "updated_at": 100},
        ],
    )
    assert r.status_code == 200
    assert {x["status"] for x in r.json()["results"]} == {"accepted"}

    got = c.get("/sync/changes", params={"collection": "chat", "since": 0}).json()
    assert got["latest_seq"] == 2
    blobs = {x["id"]: x for x in got["changes"]}
    assert base64.b64decode(blobs["c1"]["ciphertext"]) == b"cipher1"


def test_lww_stale_rejected(quon_client):
    c = quon_client
    h = make_active_user(c, "s2@x.de")
    _push(c, h, [{"collection": "chat", "id": "c1", "ciphertext": b64(b"v1"), "updated_at": 200}])

    stale = _push(
        c, h, [{"collection": "chat", "id": "c1", "ciphertext": b64(b"old"), "updated_at": 150}]
    )
    assert stale.json()["results"][0]["status"] == "stale"

    fresh = _push(
        c, h, [{"collection": "chat", "id": "c1", "ciphertext": b64(b"v2"), "updated_at": 300}]
    )
    assert fresh.json()["results"][0]["status"] == "accepted"


def test_tombstone_and_delta(quon_client):
    c = quon_client
    h = make_active_user(c, "s3@x.de")
    _push(c, h, [{"collection": "chat", "id": "c1", "ciphertext": b64(b"a"), "updated_at": 100}])
    _push(
        c, h, [{"collection": "chat", "id": "c1", "ciphertext": "", "updated_at": 200, "deleted": True}]
    )
    delta = c.get("/sync/changes", params={"collection": "chat", "since": 1}).json()
    last = delta["changes"][-1]
    assert last["id"] == "c1" and last["deleted"] is True


def test_user_isolation(quon_client):
    c = quon_client
    h1 = make_active_user(c, "iso1@x.de")
    _push(c, h1, [{"collection": "chat", "id": "c1", "ciphertext": b64(b"secret"), "updated_at": 100}])
    c.post("/auth/logout", headers=h1)

    make_active_user(c, "iso2@x.de")
    assert c.get("/sync/changes", params={"collection": "chat", "since": 0}).json()["changes"] == []


def test_sync_requires_auth(quon_client):
    quon_client.cookies.clear()
    assert (
        quon_client.get("/sync/changes", params={"collection": "chat", "since": 0}).status_code
        == 401
    )
