"""Lightweight in-process rate limiting for ``/auth/*`` (brute-force / abuse guard).

Fixed-window per-client-IP counters, no external dependency. Single-container
scope (state resets on restart) — enough to blunt credential stuffing, signup
abuse (each signup can mint a $5 sub-key) and password-reset flooding for the beta.

Client IP comes from ``CF-Connecting-IP`` (set by Cloudflare, not spoofable for
this deployment), then the left-most ``X-Forwarded-For``, then the socket peer.
"""

from __future__ import annotations

import threading
import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from config import settings

# (path-prefix, max requests, window seconds). First match wins. Generous enough
# that real users are unaffected, tight enough to stop automated abuse.
_RULES: list[tuple[str, int, int]] = [
    # The scrub-only demo, no account behind it: a human pastes a few texts,
    # a script pastes thousands. The endpoint adds a process-wide ceiling.
    ("/demo/scrub", 30, 60),
    ("/auth/login", 20, 60),
    ("/auth/register", 10, 3600),
    ("/auth/kdf", 60, 60),
    ("/auth/reset/request", 10, 3600),
    ("/auth/reset-password", 20, 3600),
    ("/auth/reset/material", 30, 3600),
    # Account self-service (all guard authToken-verified or email-gated actions).
    ("/auth/change-email/request", 5, 3600),
    ("/auth/change-email/confirm", 20, 3600),
    ("/auth/change-password", 10, 3600),
    ("/auth/recovery/rotate", 10, 3600),
    ("/auth/delete-account", 5, 3600),
    # Biometric unlock: GET fires once per unlock, PUT/DELETE on (rare) enrollment.
    ("/auth/bio", 30, 60),
    # Cloud OCR escalations are user-clicked one-offs (~$0.002/photo on the
    # user's own sub-key); this only blunts a scripted budget drain.
    ("/ocr/cloud", 30, 3600),
    # URL import: user-clicked "add a page as a document"; bounds a scripted
    # SSRF-probe / fetch-amplification loop.
    ("/fetch-url", 60, 3600),
    # Link previews: one call per web-search answer, each fanning out to a few
    # public pages — bounds using the instance as a scraping amplifier.
    ("/link-previews", 60, 3600),
    # Preview-image proxy: several per answer, and browsers cache them; the cap
    # bounds using the instance as an open image relay.
    ("/link-image", 300, 3600),
    # MCP tool proxy: consented tool calls during chats plus tools/list
    # discovery — generous, but bounds a runaway loop.
    ("/mcp/", 120, 60),
    ("/admin/", 60, 60),
    # Beta feedback: user-clicked; bounds a spam/email-amplification loop.
    ("/feedback", 10, 3600),
    # Agents CRUD + results polling (on app-open) — user-scoped, low frequency.
    ("/agents", 120, 60),
]


class _FixedWindow:
    def __init__(self) -> None:
        self._hits: dict[str, tuple[float, int]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str, limit: int, window: int, now: float) -> bool:
        with self._lock:
            start, count = self._hits.get(key, (now, 0))
            if now - start >= window:
                start, count = now, 0
            count += 1
            self._hits[key] = (start, count)
            if len(self._hits) > 50_000:  # bound memory: drop windows that have expired
                for k in [k for k, (s, _) in list(self._hits.items()) if now - s >= window]:
                    self._hits.pop(k, None)
            return count <= limit


_limiter = _FixedWindow()


# Process-wide ceilings for endpoints with no account behind them. The rules
# above bound one client; this bounds all of them together.
_global = _FixedWindow()


def allow_global(name: str, limit: int, window: int) -> bool:
    return _global.allow(f"global:{name}", limit, window, time.time())


def _client_ip(request: Request) -> str:
    # CF-Connecting-IP only when the operator says the instance is behind
    # Cloudflare (which sets it itself); anywhere else it is client-controlled.
    if settings.trust_cf_connecting_ip:
        cf = request.headers.get("cf-connecting-ip")
        if cf:
            return cf.strip()
    # X-Forwarded-For: the RIGHTMOST hop is the one the proxy in front of us
    # appended (Caddy adds the peer address); everything left of it is whatever
    # the client chose to send.
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if not settings.rate_limit_enabled:
            return await call_next(request)
        path = request.url.path
        for prefix, limit, window in _RULES:
            if path == prefix or path.startswith(prefix):
                key = f"{prefix}:{_client_ip(request)}"
                if not _limiter.allow(key, limit, window, time.time()):
                    return JSONResponse(
                        {"detail": "Too many requests — please slow down and try again shortly."},
                        status_code=429,
                    )
                break
        return await call_next(request)
