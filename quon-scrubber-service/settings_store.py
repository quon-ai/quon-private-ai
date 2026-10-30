"""Runtime, mutable settings persisted to a JSON file.

Lets the Settings UI set the OpenRouter key and toggle models at runtime without
editing ``.env`` or restarting. The file is git-ignored. Runtime values take
precedence over the ``.env`` defaults.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from pathlib import Path

import net_guard
from config import settings

logger = logging.getLogger("quon.settings")

# Where the operator's live edits (model catalog, keys, PII backend) persist.
# In Docker this MUST point into the data volume (RUNTIME_SETTINGS_PATH is set
# to /app/data/runtime_settings.json in docker-compose) — the module-directory
# default lives in the image filesystem, so every `docker-compose up --build`
# recreated it from the build context and silently reverted all Settings-UI
# edits (observed live: an operator-added model vanished after each deploy,
# which also reset users' model selection via the client's validity check).
_LEGACY_STORE_PATH = Path(__file__).parent / "runtime_settings.json"
_ENV_STORE_PATH = os.environ.get("RUNTIME_SETTINGS_PATH") or ""
_STORE_PATH = Path(_ENV_STORE_PATH) if _ENV_STORE_PATH else _LEGACY_STORE_PATH
_lock = threading.Lock()
_cache: dict | None = None


def _load() -> dict:
    global _cache
    if _cache is None:
        try:
            if _STORE_PATH.exists():
                _cache = json.loads(_STORE_PATH.read_text("utf-8"))
            elif (
                _ENV_STORE_PATH
                and _STORE_PATH == Path(_ENV_STORE_PATH)
                and _LEGACY_STORE_PATH.exists()
            ):
                # One-time migration: seed the volume-backed store from the
                # image-baked legacy file, so existing config carries over on
                # the first boot after the path move. Strictly env-gated — a
                # test/dev override of _STORE_PATH must never pull in the real
                # module-directory file.
                _cache = json.loads(_LEGACY_STORE_PATH.read_text("utf-8"))
                _save(_cache)
            else:
                _cache = {}
        except (OSError, ValueError):
            _cache = {}
    return _cache


def _save(data: dict) -> None:
    global _cache
    _cache = data
    try:
        _STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
        _STORE_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")
    except OSError as exc:  # pragma: no cover - disk error
        logger.error("could not persist runtime settings: %s", exc)


def get_openrouter_key() -> str:
    """Effective key: runtime value wins, else the .env default."""
    with _lock:
        return _load().get("openrouter_api_key") or settings.openrouter_api_key


def set_openrouter_key(key: str) -> None:
    with _lock:
        data = dict(_load())
        data["openrouter_api_key"] = key.strip()
        _save(data)


def is_configured() -> bool:
    return bool(get_openrouter_key())


def get_disabled_model_ids() -> set[str]:
    with _lock:
        return set(_load().get("disabled_model_ids", []))


def set_disabled_model_ids(ids: list[str]) -> None:
    with _lock:
        data = dict(_load())
        data["disabled_model_ids"] = sorted(set(ids))
        _save(data)


# --- Provider connections -------------------------------------------------
# The built-in OpenRouter connection's exposed models (allow-list chosen from
# the catalog). Empty → fall back to a sensible default set (see connections.py).
def get_openrouter_models() -> list[str]:
    with _lock:
        return list(_load().get("openrouter_models", []))


def set_openrouter_models(ids: list[str]) -> None:
    with _lock:
        data = dict(_load())
        # Preserve order, drop blanks/dupes.
        seen: set[str] = set()
        clean = [m.strip() for m in ids if m.strip() and not (m.strip() in seen or seen.add(m.strip()))]
        data["openrouter_models"] = clean
        _save(data)


# Custom OpenAI-compatible BYOK connections. Each: {id,label,base_url,models,api_key}.
# Stored in the git-ignored runtime file, same trust model as the OpenRouter key.
def get_custom_connections() -> list[dict]:
    with _lock:
        return [dict(c) for c in _load().get("connections", [])]


def get_custom_connection(cid: str) -> dict | None:
    return next((c for c in get_custom_connections() if c.get("id") == cid), None)


def upsert_custom_connection(
    cid: str,
    label: str,
    base_url: str,
    models: list[str],
    api_key: str | None = None,
) -> None:
    if base_url and base_url.strip():
        net_guard.validate_public_url(base_url)  # SSRF guard (raises UnsafeUrlError)
    with _lock:
        data = dict(_load())
        conns = [dict(c) for c in data.get("connections", [])]
        conn = next((c for c in conns if c.get("id") == cid), None)
        if conn is None:
            conn = {"id": cid}
            conns.append(conn)
        conn["label"] = label.strip() or cid
        conn["base_url"] = base_url.strip()
        conn["models"] = [m.strip() for m in models if m.strip()]
        # Only overwrite the key when a non-empty one is supplied (write-only).
        if api_key:
            conn["api_key"] = api_key.strip()
        data["connections"] = conns
        _save(data)


def delete_custom_connection(cid: str) -> None:
    with _lock:
        data = dict(_load())
        data["connections"] = [c for c in data.get("connections", []) if c.get("id") != cid]
        _save(data)


# --- PII extraction backend ----------------------------------------------
