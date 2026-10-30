"""Persistence path of the operator runtime settings.

In Docker the store must live on the data volume (RUNTIME_SETTINGS_PATH) — the
in-image module-directory default is recreated from the build context on every
`up --build`, which silently reverted all Settings-UI edits (live incident:
an operator-added model vanished from the catalog after each deploy, resetting
users' model selection through the client's validity check)."""

from __future__ import annotations

import importlib
import json


def _reload_with_env(monkeypatch, env_path):
    if env_path is None:
        monkeypatch.delenv("RUNTIME_SETTINGS_PATH", raising=False)
    else:
        monkeypatch.setenv("RUNTIME_SETTINGS_PATH", str(env_path))
    import settings_store

    return importlib.reload(settings_store)


def test_env_path_is_used_and_created_on_write(monkeypatch, tmp_path):
    store = tmp_path / "data" / "runtime_settings.json"  # parent doesn't exist yet
    ss = _reload_with_env(monkeypatch, store)
    try:
        ss.set_openrouter_models(["openrouter/auto", "openrouter/fusion"])
        assert store.exists()
        assert json.loads(store.read_text())["openrouter_models"] == [
            "openrouter/auto",
            "openrouter/fusion",
        ]
    finally:
        _reload_with_env(monkeypatch, None)


def test_first_boot_migrates_the_legacy_module_file(monkeypatch, tmp_path):
    legacy = tmp_path / "legacy.json"
    legacy.write_text(json.dumps({"openrouter_models": ["openrouter/fusion"]}))
    store = tmp_path / "data" / "runtime_settings.json"
    ss = _reload_with_env(monkeypatch, store)
    try:
        monkeypatch.setattr(ss, "_LEGACY_STORE_PATH", legacy)
        assert ss.get_openrouter_models() == ["openrouter/fusion"]  # seeded from legacy
        assert store.exists()  # …and persisted to the volume path
    finally:
        _reload_with_env(monkeypatch, None)


def test_no_migration_without_the_env_var(monkeypatch, tmp_path):
    # A test/dev override of _STORE_PATH (the quon_client fixture pattern) must
    # never pull in the real module-directory file.
    ss = _reload_with_env(monkeypatch, None)
    try:
        legacy = tmp_path / "legacy.json"
        legacy.write_text(json.dumps({"openrouter_models": ["should-not-leak"]}))
        monkeypatch.setattr(ss, "_LEGACY_STORE_PATH", legacy)
        monkeypatch.setattr(ss, "_STORE_PATH", tmp_path / "isolated.json")
        monkeypatch.setattr(ss, "_cache", None)
        assert ss.get_openrouter_models() == []
    finally:
        _reload_with_env(monkeypatch, None)
