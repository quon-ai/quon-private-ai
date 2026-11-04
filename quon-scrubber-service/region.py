"""OpenRouter in-region routing (EU) — strict mode.

With ``OPENROUTER_REGION=eu`` every chat request goes to OpenRouter's EU
domain, where prompts and completions are processed on provider endpoints in
the EU/EEA, UK and Switzerland and OpenRouter's own logging is skipped. The
EU domain FAILS CLOSED: a model without an in-region endpoint is refused
("No endpoints found supporting your data region"), never routed elsewhere.
Measured on 2026-11-03 against the live catalog: Claude Sonnet/Opus latest,
GPT latest and Mistral Large work; Gemini Flash latest, Fusion, Kimi K3 and
the image model do not, and the web-search plugin is refused for every model.

So "strict EU" is three things, all here:

* the chat base URL (key management and the key check stay on the global
  domain — those are account operations, not inference);
* the catalog is filtered to what the EU domain actually serves. Concrete
  ids come from the EU ``/models`` list (free, cached, refreshed hourly).
  The floating ``~vendor/…-latest`` aliases are not in that list and the
  endpoints API does not resolve them, so each alias in the catalog is
  PROBED once a day with a one-token request. Unknown (list unreachable,
  probe failed) keeps the model visible — the request itself still fails
  closed on OpenRouter's side, with a worded error;
* web search is reported unavailable, so the client hides the toggle and the
  relay never attaches the plugin.

Zero-knowledge is untouched: this only changes WHERE the already-scrubbed
request is processed.
"""

from __future__ import annotations

import asyncio
import logging
import time

import httpx

from config import settings

logger = logging.getLogger("quon.region")

LIST_TTL_S = 3600.0
PROBE_TTL_S = 24 * 3600.0
PROBE_TIMEOUT_S = 25.0

_eu_ids: set[str] | None = None
_eu_ids_at = 0.0
_alias_ok: dict[str, tuple[bool, float]] = {}


def region() -> str:
    return "eu" if settings.openrouter_region.strip().lower() == "eu" else "global"


def is_eu() -> bool:
    return region() == "eu"


def chat_base_url() -> str:
    """Where chat completions go. Everything else (keys, usage) stays global."""
    return settings.openrouter_eu_base_url if is_eu() else settings.openrouter_base_url


def web_search_available() -> bool:
    return not is_eu()


def available(slug: str) -> bool | None:
    """True/False when known for this region, None when unknown (or global)."""
    if not is_eu():
        return None
    if slug.startswith("~"):
        hit = _alias_ok.get(slug)
        return hit[0] if hit else None
    if _eu_ids is None:
        return None
    return slug in _eu_ids


def reset() -> None:
    global _eu_ids, _eu_ids_at
    _eu_ids = None
    _eu_ids_at = 0.0
    _alias_ok.clear()


async def refresh(catalog: list[str], *, now: float | None = None) -> None:
    """Refresh the EU model list (hourly) and probe stale catalog aliases (daily)."""
    if not is_eu():
        return
    global _eu_ids, _eu_ids_at
    t = now if now is not None else time.monotonic()
    base = settings.openrouter_eu_base_url.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            if _eu_ids is None or t - _eu_ids_at >= LIST_TTL_S:
                r = await client.get(f"{base}/models")
                if r.status_code == 200:
                    ids = {m.get("id") for m in (r.json().get("data") or []) if m.get("id")}
                    if ids:
                        _eu_ids = ids
                        _eu_ids_at = t
                        logger.info("eu routing: %d models served in-region", len(ids))
                else:
                    logger.warning("eu routing: model list -> %s", r.status_code)
            key = settings.openrouter_api_key.strip()
            for slug in catalog:
                if not slug.startswith("~"):
                    continue
                hit = _alias_ok.get(slug)
                if hit and t - hit[1] < PROBE_TTL_S:
                    continue
                if not key:
                    continue  # nothing to probe with — stays unknown (visible)
                verdict = await _probe_alias(client, base, key, slug)
                if verdict is not None:
                    _alias_ok[slug] = (verdict, t)
                    logger.info("eu routing: alias %s %s", slug, "served" if verdict else "NOT served")
    except (httpx.HTTPError, httpx.TimeoutException, ValueError) as exc:
        logger.warning("eu routing: refresh failed (%s) — keeping the last known state", exc)


async def _probe_alias(client: httpx.AsyncClient, base: str, key: str, slug: str) -> bool | None:
    """A one-token request: 200 → served in-region; 404/403 → not; else unknown."""
    try:
        r = await client.post(
            f"{base}/chat/completions",
            headers={"Authorization": f"Bearer {key}"},
            json={"model": slug, "messages": [{"role": "user", "content": "ok"}], "max_tokens": 1},
            timeout=PROBE_TIMEOUT_S,
        )
    except (httpx.HTTPError, httpx.TimeoutException):
        return None
    if r.status_code == 200:
        return True
    if r.status_code in (403, 404):
        return False
    return None


async def refresh_loop(catalog_fn) -> None:
    """Startup + hourly. `catalog_fn` returns the current OpenRouter slug list."""
    while True:
        try:
            await refresh(list(catalog_fn()))
        except Exception:  # noqa: BLE001 — a background refresh must never die
            logger.exception("eu routing: refresh crashed; retrying next cycle")
        await asyncio.sleep(LIST_TTL_S)
