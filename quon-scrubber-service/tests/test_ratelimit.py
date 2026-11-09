"""Fixed-window rate limiter used to throttle /auth/* (ratelimit._FixedWindow)."""

from __future__ import annotations

from ratelimit import _FixedWindow


def test_window_blocks_over_limit_then_resets():
    lim = _FixedWindow()
    # 5 allowed within the window...
    for _ in range(5):
        assert lim.allow("k", 5, 60, 1000.0) is True
    # ...the 6th in the same window is blocked...
    assert lim.allow("k", 5, 60, 1000.0) is False
    # ...and the next window starts fresh.
    assert lim.allow("k", 5, 60, 1061.0) is True


def test_keys_are_independent():
    lim = _FixedWindow()
    assert lim.allow("a", 1, 60, 1000.0) is True
    assert lim.allow("a", 1, 60, 1000.0) is False  # a exhausted
    assert lim.allow("b", 1, 60, 1000.0) is True  # b unaffected


def test_auth_endpoint_is_rate_limited(quon_client, monkeypatch):
    """The middleware actually throttles /auth/* (kdf: 60/min) and returns 429."""
    import ratelimit
    from config import settings

    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    ratelimit._limiter._hits.clear()
    try:
        codes = [
            quon_client.get("/auth/kdf?email=probe@example.invalid").status_code for _ in range(62)
        ]
    finally:
        ratelimit._limiter._hits.clear()
    assert codes[0] == 200  # early requests succeed (anti-enumeration dummy salt)
    assert 429 in codes  # the per-IP limit is enforced
