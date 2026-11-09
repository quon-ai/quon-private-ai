"""Tests for the cloud OCR fallback: the /ocr/cloud endpoint wiring (auth,
validation, error mapping) and ocr_cloud.transcribe (payload shape - ZDR
routing pinned, data-URL image, user's key - and upstream error handling).
No network is touched."""

from __future__ import annotations

import asyncio
import base64

import httpx
import pytest
from conftest import make_active_user

import key_resolver
import ocr_cloud
from provider import ProviderError

PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4"
    "//8/AwAI/AL+hc2rNAAAAABJRU5ErkJggg=="
)
JPEG_STUB = b"\xff\xd8\xff\xe0" + b"J" * 64


def b64s(data: bytes) -> str:
    return base64.b64encode(data).decode()


# --- endpoint wiring --------------------------------------------------------


def test_ocr_requires_auth(quon_client):
    r = quon_client.post("/ocr/cloud", json={"image_b64": b64s(PNG_1PX)})
    assert r.status_code == 401


def test_ocr_happy_path_forwards_sniffed_mime_and_user_key(quon_client, monkeypatch):
    headers = make_active_user(quon_client)
    monkeypatch.setattr(key_resolver, "resolve_openrouter_key", lambda uid: "sk-user-sub")
    captured: dict = {}

    async def fake_transcribe(image, mime, api_key):
        captured.update(image=image, mime=mime, api_key=api_key)
        return "Hallo Welt", "google/gemini-3.1-flash-lite"

    monkeypatch.setattr(ocr_cloud, "transcribe", fake_transcribe)
    r = quon_client.post("/ocr/cloud", json={"image_b64": b64s(PNG_1PX)}, headers=headers)
    assert r.status_code == 200
    assert r.json() == {"text": "Hallo Welt", "model": "google/gemini-3.1-flash-lite"}
    # The MIME type comes from magic bytes, never from the client's claim.
    assert captured["mime"] == "image/png"
    assert captured["image"] == PNG_1PX
    assert captured["api_key"] == "sk-user-sub"


def test_ocr_fails_closed_without_a_key(quon_client, monkeypatch):
    headers = make_active_user(quon_client)
    monkeypatch.setattr(key_resolver, "resolve_openrouter_key", lambda uid: None)
    r = quon_client.post("/ocr/cloud", json={"image_b64": b64s(PNG_1PX)}, headers=headers)
    assert r.status_code == 503


def test_ocr_rejects_invalid_base64(quon_client, monkeypatch):
    headers = make_active_user(quon_client)
    monkeypatch.setattr(key_resolver, "resolve_openrouter_key", lambda uid: "sk")
    r = quon_client.post("/ocr/cloud", json={"image_b64": "not!!base64"}, headers=headers)
    assert r.status_code == 400


def test_ocr_rejects_non_image_bytes(quon_client, monkeypatch):
    headers = make_active_user(quon_client)
    monkeypatch.setattr(key_resolver, "resolve_openrouter_key", lambda uid: "sk")
    r = quon_client.post(
        "/ocr/cloud", json={"image_b64": b64s(b"%PDF-1.4 not an image")}, headers=headers
    )
    assert r.status_code == 415


def test_ocr_rejects_oversize_image(quon_client, monkeypatch):
    headers = make_active_user(quon_client)
    monkeypatch.setattr(key_resolver, "resolve_openrouter_key", lambda uid: "sk")
    monkeypatch.setattr(ocr_cloud, "MAX_IMAGE_BYTES", 16)
    r = quon_client.post("/ocr/cloud", json={"image_b64": b64s(PNG_1PX)}, headers=headers)
    assert r.status_code == 413


def test_ocr_surfaces_provider_error_status_and_message(quon_client, monkeypatch):
    headers = make_active_user(quon_client)
    monkeypatch.setattr(key_resolver, "resolve_openrouter_key", lambda uid: "sk")

    async def failing_transcribe(image, mime, api_key):
        raise ProviderError("Your AI budget is used up — …", 402)

    monkeypatch.setattr(ocr_cloud, "transcribe", failing_transcribe)
    r = quon_client.post("/ocr/cloud", json={"image_b64": b64s(PNG_1PX)}, headers=headers)
    assert r.status_code == 402
    assert "budget" in r.json()["detail"].lower()


def test_ocr_rate_limit_rule_is_wired(quon_client, monkeypatch):
    """Pin that /ocr/cloud actually flows through the rate-limit middleware
    (the shared fixture disables limiting, so the rule is otherwise untested)."""
    import ratelimit
    from config import settings as cfg

    headers = make_active_user(quon_client)
    monkeypatch.setattr(key_resolver, "resolve_openrouter_key", lambda uid: "sk")

    async def fake_transcribe(image, mime, api_key):
        return "ok", "m"

    monkeypatch.setattr(ocr_cloud, "transcribe", fake_transcribe)
    monkeypatch.setattr(cfg, "rate_limit_enabled", True)
    # Fresh counters + a tight window so the test is fast and order-independent.
    monkeypatch.setattr(ratelimit, "_limiter", ratelimit._FixedWindow())
    monkeypatch.setattr(ratelimit, "_RULES", [("/ocr/cloud", 2, 3600)])

    body = {"image_b64": b64s(PNG_1PX)}
    assert quon_client.post("/ocr/cloud", json=body, headers=headers).status_code == 200
    assert quon_client.post("/ocr/cloud", json=body, headers=headers).status_code == 200
    assert quon_client.post("/ocr/cloud", json=body, headers=headers).status_code == 429


# --- transcribe() -----------------------------------------------------------


class _FakeResponse:
    def __init__(self, status_code: int = 200, payload: dict | None = None, content: bytes = b""):
        self.status_code = status_code
        self._payload = payload or {}
        self.content = content

    def json(self):
        return self._payload


class _FakeClient:
    """Stands in for httpx.AsyncClient - records the POST, returns a canned
    response or raises a canned exception."""

    def __init__(self, response: _FakeResponse | None = None, exc: Exception | None = None):
        self.response = response
        self.exc = exc
        self.calls: list[dict] = []

    def __call__(self, *args, **kwargs):  # AsyncClient(timeout=...) -> self
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, url, json=None, headers=None):
        self.calls.append({"url": url, "json": json, "headers": headers})
        if self.exc:
            raise self.exc
        return self.response


def _ok_response(text: str) -> _FakeResponse:
    return _FakeResponse(
        payload={
            "model": "google/gemini-3.1-flash-lite",
            "choices": [{"message": {"content": text}}],
        }
    )


def test_transcribe_payload_pins_zdr_and_carries_the_image(monkeypatch):
    fake = _FakeClient(response=_ok_response("Zeile 1\nZeile 2"))
    monkeypatch.setattr(ocr_cloud.httpx, "AsyncClient", fake)
    text, model = asyncio.run(ocr_cloud.transcribe(JPEG_STUB, "image/jpeg", api_key="sk-user"))
    assert text == "Zeile 1\nZeile 2"
    assert model == "google/gemini-3.1-flash-lite"

    call = fake.calls[0]
    body = call["json"]
    # Zero-data-retention routing must be pinned on every request.
    assert body["zdr"] is True
    assert body["provider"] == {"data_collection": "deny"}
    assert body["temperature"] == 0
    parts = body["messages"][0]["content"]
    assert parts[0]["type"] == "text"
    image_url = parts[1]["image_url"]["url"]
    assert image_url.startswith("data:image/jpeg;base64,")
    assert base64.b64decode(image_url.split(",", 1)[1]) == JPEG_STUB
    assert call["headers"]["Authorization"] == "Bearer sk-user"
    assert call["url"].endswith("/chat/completions")


def test_transcribe_maps_provider_402_to_friendly_budget_error(monkeypatch):
    fake = _FakeClient(
        response=_FakeResponse(
            status_code=402, content=b'{"error":{"message":"Insufficient credits"}}'
        )
    )
    monkeypatch.setattr(ocr_cloud.httpx, "AsyncClient", fake)
    with pytest.raises(ProviderError) as exc_info:
        asyncio.run(ocr_cloud.transcribe(JPEG_STUB, "image/jpeg", api_key="sk"))
    assert exc_info.value.status == 402
    assert "budget" in str(exc_info.value).lower()


def test_transcribe_timeout_raises_504(monkeypatch):
    fake = _FakeClient(exc=httpx.ConnectTimeout("slow"))
    monkeypatch.setattr(ocr_cloud.httpx, "AsyncClient", fake)
    with pytest.raises(ProviderError) as exc_info:
        asyncio.run(ocr_cloud.transcribe(JPEG_STUB, "image/jpeg", api_key="sk"))
    assert exc_info.value.status == 504


def test_transcribe_rejects_empty_transcript(monkeypatch):
    fake = _FakeClient(response=_ok_response("   "))
    monkeypatch.setattr(ocr_cloud.httpx, "AsyncClient", fake)
    with pytest.raises(ProviderError) as exc_info:
        asyncio.run(ocr_cloud.transcribe(JPEG_STUB, "image/jpeg", api_key="sk"))
    assert "couldn't read any text" in str(exc_info.value)


def test_transcribe_strips_markdown_fences(monkeypatch):
    fake = _FakeClient(response=_ok_response("```text\nHallo Welt\n```"))
    monkeypatch.setattr(ocr_cloud.httpx, "AsyncClient", fake)
    text, _ = asyncio.run(ocr_cloud.transcribe(JPEG_STUB, "image/jpeg", api_key="sk"))
    assert text == "Hallo Welt"


# --- magic-byte sniffing ----------------------------------------------------


def test_sniff_image_mime_known_and_unknown_types():
    assert ocr_cloud.sniff_image_mime(PNG_1PX) == "image/png"
    assert ocr_cloud.sniff_image_mime(JPEG_STUB) == "image/jpeg"
    assert ocr_cloud.sniff_image_mime(b"RIFF\x00\x00\x00\x00WEBPVP8 ") == "image/webp"
    assert ocr_cloud.sniff_image_mime(b"GIF89a trailer") is None
    assert ocr_cloud.sniff_image_mime(b"%PDF-1.4") is None
    assert ocr_cloud.sniff_image_mime(b"") is None
