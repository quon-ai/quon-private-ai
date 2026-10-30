"""Verify a user's OWN OpenRouter key before it is stored.

Why (beta feedback #84, #91 — two users, three bursts of chat failures):
the budget banner says "add your own key", the settings card says OpenRouter,
and both users pasted a key from another vendor. A user's override WINS over
the provisioned sub-key, so from that moment every chat failed — and
OpenRouter's answer for a non-``sk-or-`` token is the misleading
"401 Missing Authentication header" (measured 2026-10-20: an Anthropic key,
a quoted key, a doubled "Bearer" and an empty token all get exactly that;
only a well-formed unknown key gets "User not found"). Checking the key at
save time turns a silent, lasting breakage into one clear message.
"""

from __future__ import annotations

import httpx

from config import settings

OPENROUTER_KEY_PREFIX = "sk-or-"

NOT_AN_OPENROUTER_KEY = (
    "That is not an OpenRouter key — an OpenRouter key starts with sk-or-… "
    "(openrouter.ai → Keys). A key from OpenAI or Anthropic does not work here."
)
KEY_UNKNOWN = "OpenRouter does not know this key — check it at openrouter.ai → Keys."
KEY_UNVERIFIED = "Could not verify the key with OpenRouter right now — try again in a moment."


class KeyRejected(Exception):
    """The key must not be stored. `status` is the HTTP status to answer with."""

    def __init__(self, message: str, status: int) -> None:
        super().__init__(message)
        self.status = status


async def verify_openrouter_key(key: str, *, timeout: float = 8.0) -> None:
    """Raise KeyRejected unless `key` is a well-formed OpenRouter key that
    OpenRouter itself accepts. The format check needs no network; the live
    check asks OpenRouter's key endpoint, which costs nothing."""
    key = key.strip()
    if not key.startswith(OPENROUTER_KEY_PREFIX):
        raise KeyRejected(NOT_AN_OPENROUTER_KEY, 400)
    url = f"{settings.openrouter_base_url.rstrip('/')}/auth/key"
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(url, headers={"Authorization": f"Bearer {key}"})
    except (httpx.HTTPError, httpx.TimeoutException) as exc:
        raise KeyRejected(KEY_UNVERIFIED, 503) from exc
    if resp.status_code in (401, 403):
        raise KeyRejected(KEY_UNKNOWN, 400)
    if resp.status_code != 200:
        raise KeyRejected(KEY_UNVERIFIED, 503)
