"""Original-bytes sync: the lazy single-blob endpoint + the per-user quota on
the ``originals`` collection (chunked encrypted file bytes)."""

from __future__ import annotations

import base64

from conftest import b64, make_active_user


def _push(client, headers, changes):
    return client.post("/sync/push", json={"changes": changes}, headers=headers)


def _orig(id_, payload: bytes, updated_at=100, deleted=False):
    return {
        "collection": "originals",
        "id": id_,
        "ciphertext": b64(payload) if payload else "",
        "updated_at": updated_at,
        "deleted": deleted,
    }


# --- GET /sync/blob ---------------------------------------------------------


def test_blob_roundtrip(quon_client):
    c = quon_client
    h = make_active_user(c, "ob1@x.de")
    _push(c, h, [_orig("orig:d1:0", b"chunk-zero")])

    r = c.get("/sync/blob", params={"collection": "originals", "id": "orig:d1:0"})
    assert r.status_code == 200
    body = r.json()
    assert base64.b64decode(body["ciphertext"]) == b"chunk-zero"
    assert body["id"] == "orig:d1:0" and body["deleted"] is False


def test_blob_missing_is_404(quon_client):
    c = quon_client
    make_active_user(c, "ob2@x.de")
    r = c.get("/sync/blob", params={"collection": "originals", "id": "orig:nope:0"})
    assert r.status_code == 404


def test_blob_tombstoned_is_404(quon_client):
    c = quon_client
    h = make_active_user(c, "ob3@x.de")
    _push(c, h, [_orig("orig:d1:0", b"bytes")])
    _push(c, h, [_orig("orig:d1:0", b"", updated_at=200, deleted=True)])
    r = c.get("/sync/blob", params={"collection": "originals", "id": "orig:d1:0"})
    assert r.status_code == 404


def test_blob_user_isolation(quon_client):
    c = quon_client
    h1 = make_active_user(c, "ob4a@x.de")
    _push(c, h1, [_orig("orig:d1:0", b"secret")])
    c.post("/auth/logout", headers=h1)

    make_active_user(c, "ob4b@x.de")
    r = c.get("/sync/blob", params={"collection": "originals", "id": "orig:d1:0"})
    assert r.status_code == 404


def test_blob_requires_auth(quon_client):
    quon_client.cookies.clear()
    r = quon_client.get("/sync/blob", params={"collection": "originals", "id": "x"})
    assert r.status_code == 401


# --- quota on push ----------------------------------------------------------


def test_quota_rejects_blob_with_distinct_status(quon_client, monkeypatch):
    from config import settings

    monkeypatch.setattr(settings, "originals_quota_bytes", 100)
    c = quon_client
    h = make_active_user(c, "oq1@x.de")

    ok = _push(c, h, [_orig("orig:d1:0", b"x" * 60)])
    assert ok.json()["results"][0]["status"] == "accepted"

    over = _push(c, h, [_orig("orig:d1:1", b"y" * 60)])
    assert over.json()["results"][0]["status"] == "quota"

    # The rejected blob was NOT stored.
    r = c.get("/sync/blob", params={"collection": "originals", "id": "orig:d1:1"})
    assert r.status_code == 404


def test_quota_replacing_same_id_does_not_double_count(quon_client, monkeypatch):
    from config import settings

    monkeypatch.setattr(settings, "originals_quota_bytes", 100)
    c = quon_client
    h = make_active_user(c, "oq2@x.de")

    _push(c, h, [_orig("orig:d1:0", b"x" * 60)])
    # 60 stored + 80 replacement would read as 140 if the old bytes counted;
    # the replacement frees them, so it must be accepted.
    r = _push(c, h, [_orig("orig:d1:0", b"z" * 80, updated_at=200)])
    assert r.json()["results"][0]["status"] == "accepted"


def test_quota_freed_by_tombstone(quon_client, monkeypatch):
    from config import settings

    monkeypatch.setattr(settings, "originals_quota_bytes", 100)
    c = quon_client
    h = make_active_user(c, "oq3@x.de")

    _push(c, h, [_orig("orig:d1:0", b"x" * 90)])
    full = _push(c, h, [_orig("orig:d2:0", b"y" * 90)])
    assert full.json()["results"][0]["status"] == "quota"

    _push(c, h, [_orig("orig:d1:0", b"", updated_at=200, deleted=True)])
    freed = _push(c, h, [_orig("orig:d2:0", b"y" * 90, updated_at=300)])
    assert freed.json()["results"][0]["status"] == "accepted"


def test_quota_only_applies_to_originals_collection(quon_client, monkeypatch):
    from config import settings

    monkeypatch.setattr(settings, "originals_quota_bytes", 10)
    c = quon_client
    h = make_active_user(c, "oq4@x.de")

    r = _push(
        c,
        h,
        [{"collection": "chat", "id": "c1", "ciphertext": b64(b"x" * 500), "updated_at": 100}],
    )
    assert r.json()["results"][0]["status"] == "accepted"


def test_quota_mixed_batch_other_blobs_still_accepted(quon_client, monkeypatch):
    from config import settings

    monkeypatch.setattr(settings, "originals_quota_bytes", 100)
    c = quon_client
    h = make_active_user(c, "oq5@x.de")

    r = _push(
        c,
        h,
        [
            _orig("orig:d1:0", b"x" * 90),
            _orig("orig:d1:1", b"y" * 90),  # over quota
            {"collection": "documents", "id": "d1", "ciphertext": b64(b"doc"), "updated_at": 100},
        ],
    )
    statuses = {x["id"]: x["status"] for x in r.json()["results"]}
    assert statuses == {"orig:d1:0": "accepted", "orig:d1:1": "quota", "d1": "accepted"}


# --- GET /sync/originals/usage ----------------------------------------------


def test_usage_starts_empty_and_reports_quota(quon_client):
    c = quon_client
    make_active_user(c, "ou1@x.de")
    r = c.get("/sync/originals/usage")
    assert r.status_code == 200
    body = r.json()
    assert body["used_bytes"] == 0
    from config import settings

    assert body["quota_bytes"] == settings.originals_quota_bytes


def test_usage_counts_live_bytes_and_frees_on_tombstone(quon_client):
    c = quon_client
    h = make_active_user(c, "ou2@x.de")
    _push(c, h, [_orig("orig:d1:0", b"x" * 300), _orig("orig:d1:1", b"y" * 200)])

    used = c.get("/sync/originals/usage").json()["used_bytes"]
    # Ciphertext is stored as bytes; b64 round-trips back to the raw sizes.
    assert used == 500

    _push(c, h, [_orig("orig:d1:1", b"", updated_at=200, deleted=True)])
    assert c.get("/sync/originals/usage").json()["used_bytes"] == 300


def test_usage_ignores_other_collections_and_requires_auth(quon_client):
    c = quon_client
    h = make_active_user(c, "ou3@x.de")
    _push(
        c,
        h,
        [{"collection": "chat", "id": "c1", "ciphertext": b64(b"x" * 999), "updated_at": 100}],
    )
    assert c.get("/sync/originals/usage").json()["used_bytes"] == 0

    c.post("/auth/logout", headers=h)
    assert c.get("/sync/originals/usage").status_code == 401
