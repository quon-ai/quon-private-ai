"""Tests for chat provider connections (built-in OpenRouter + BYOK custom)."""

from __future__ import annotations

import connections
import key_resolver
import settings_store


# --- catalog + routing (connections.py) -----------------------------------
def test_chat_catalog_unions_connections(monkeypatch):
    monkeypatch.setattr(settings_store, "get_openrouter_models", lambda: ["openai/gpt-4o"])
    monkeypatch.setattr(settings_store, "is_configured", lambda: True)
    monkeypatch.setattr(
        settings_store,
        "get_custom_connections",
        lambda: [
            {
                "id": "c1",
                "label": "My OpenAI",
                "base_url": "https://api.openai.com/v1",
                "models": ["gpt-4o"],
                "api_key": "sk",
            }
        ],
    )
    cat = {m.id: m for m in connections.chat_catalog()}
    assert "openrouter::openai/gpt-4o" in cat
    assert cat["openrouter::openai/gpt-4o"].connection_id == "openrouter"
    assert cat["openrouter::openai/gpt-4o"].model == "openai/gpt-4o"
    assert "c1::gpt-4o" in cat
    assert cat["c1::gpt-4o"].connection_id == "c1"
    assert cat["c1::gpt-4o"].disabled is False  # key configured


def test_catalog_model_disabled_without_key(monkeypatch):
    monkeypatch.setattr(settings_store, "get_openrouter_models", lambda: [])
    monkeypatch.setattr(settings_store, "is_configured", lambda: False)
    monkeypatch.setattr(settings_store, "get_custom_connections", lambda: [])
    # OpenRouter falls back to its default models, all disabled (no key).
    assert all(m.disabled for m in connections.chat_catalog())


def test_resolve_for_chat_routes_per_connection(monkeypatch):
    monkeypatch.setattr(key_resolver, "resolve_openrouter_key", lambda uid: "ork" if uid else None)
    monkeypatch.setattr(
        settings_store,
        "get_custom_connection",
        lambda cid: {"id": "c1", "base_url": "https://x/v1", "api_key": "sk"} if cid == "c1" else None,
    )
    # OpenRouter -> per-user resolved key
    assert connections.resolve_for_chat("openrouter", "u1") == (settings_store.settings.openrouter_base_url, "ork")
    # default (None) -> OpenRouter
    assert connections.resolve_for_chat(None, "u1")[1] == "ork"
    # no user + provisioning -> no key
    assert connections.resolve_for_chat("openrouter", None) is None
    # custom -> its own base_url + key
    assert connections.resolve_for_chat("c1", None) == ("https://x/v1", "sk")
    # unknown connection
    assert connections.resolve_for_chat("nope", None) is None


# --- persistence round-trip (settings_store) ------------------------------
def test_custom_connection_crud(monkeypatch, tmp_path):
    monkeypatch.setattr(settings_store, "_STORE_PATH", tmp_path / "rt.json")
    monkeypatch.setattr(settings_store, "_cache", None)

    settings_store.upsert_custom_connection(
        "c1", "My OpenAI", "https://api.openai.com/v1", ["gpt-4o"], api_key="sk-test"
    )
    c = settings_store.get_custom_connection("c1")
    assert c["label"] == "My OpenAI" and c["models"] == ["gpt-4o"] and c["api_key"] == "sk-test"

    # update without a key keeps the existing key; models/label update
    settings_store.upsert_custom_connection(
        "c1", "Renamed", "https://api.openai.com/v1", ["gpt-4o", "gpt-4o-mini"]
    )
    c = settings_store.get_custom_connection("c1")
    assert c["label"] == "Renamed" and c["api_key"] == "sk-test" and "gpt-4o-mini" in c["models"]

    settings_store.delete_custom_connection("c1")
    assert settings_store.get_custom_connection("c1") is None


def test_openrouter_models_dedupe(monkeypatch, tmp_path):
    monkeypatch.setattr(settings_store, "_STORE_PATH", tmp_path / "rt.json")
    monkeypatch.setattr(settings_store, "_cache", None)
    settings_store.set_openrouter_models(["a", "a", " b ", ""])
    assert settings_store.get_openrouter_models() == ["a", "b"]


# --- Image generation: which models get the picker badge + `image_output` ---------


def test_image_output_follows_openrouters_naming_convention():
    from connections import is_image_output_slug

    for slug in [
        "google/gemini-2.5-flash-image",
        "google/gemini-3-pro-image-preview",
        "google/gemini-3.1-flash-lite-image",
        "openai/gpt-5-image",
        "openai/gpt-5-image-mini",
        "openai/gpt-5.4-image-2",
        "~google/gemini-image-latest",
    ]:
        assert is_image_output_slug(slug), slug
    for slug in [
        "~google/gemini-flash-latest",
        "anthropic/claude-sonnet-4",
        "openrouter/fusion",
        "some/imagery-model",  # "image" inside a word is not the convention
    ]:
        assert not is_image_output_slug(slug), slug


def test_default_catalog_marks_the_image_model(monkeypatch):
    import connections
    import settings_store

    monkeypatch.setattr(settings_store, "get_openrouter_models", lambda: [])
    monkeypatch.setattr(settings_store, "is_configured", lambda: True)
    monkeypatch.setattr(settings_store, "get_custom_connections", lambda: [])
    cat = {m.model: m for m in connections.chat_catalog(None)}
    assert cat["google/gemini-2.5-flash-image"].image_output is True
    assert cat["~anthropic/claude-sonnet-latest"].image_output is False
