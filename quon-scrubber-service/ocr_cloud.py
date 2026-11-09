"""Cloud OCR fallback - explicit per-photo escalation for hard cases.

The on-device tier (browser, PP-OCRv6 tiny) reads printed text well but not
handwriting. When the user explicitly opts in from the scan dialog, the photo
is relayed once through this server to a vision model on OpenRouter and only
the transcript comes back. Nothing is stored and the image bytes are never
logged; the request enforces OpenRouter's zero-data-retention routing (`zdr`
+ `data_collection: deny`) so it can only be served by ZDR endpoints.

Trust class: same as the cloud PII-extraction path (raw user data transits
OpenRouter, billed to the caller's own sub-key) - but unlike /scrub it never
happens implicitly. The endpoint goes to the trusted OpenRouter base URL from
config only (no user-supplied URL, so no SSRF surface).
"""

from __future__ import annotations

import base64

import httpx

from config import settings
from provider import ProviderError, friendly_provider_error

# The client downscales to <=2000 px and re-encodes to JPEG (~0.5–1.5 MB), so
# this cap is generous headroom, not a target.
MAX_IMAGE_BYTES = 8 * 1024 * 1024

# Magic-byte sniffing - the client's claimed MIME type is never trusted.
_SIGNATURES: list[tuple[bytes, str]] = [
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
]

# Transcription only: the model must not summarize, translate or fill gaps.
# Illegible spans become a visible marker the user resolves in the (still
# mandatory) editable review step - VLMs otherwise guess confidently.
TRANSCRIBE_PROMPT = (
    "Transcribe ALL text in this image exactly as written, top to bottom, "
    "preserving line breaks. The text may be printed or handwritten, in German "
    "or English. Keep the original spelling, punctuation, numbers and umlauts "
    "exactly. For any word or passage you cannot read with confidence, write "
    "[?] instead of guessing. Output ONLY the transcript — no commentary, no "
    "translation, no markdown fences. If the image contains no text, output "
    "nothing."
)


def sniff_image_mime(data: bytes) -> str | None:
    """Return the image MIME type from magic bytes, or None if unsupported."""
    for sig, mime in _SIGNATURES:
        if data.startswith(sig):
            return mime
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _strip_fences(text: str) -> str:
    """Drop a wrapping markdown fence if the model added one despite the prompt."""
    stripped = text.strip()
    if stripped.startswith("```") and stripped.endswith("```"):
        inner = stripped[3:-3]
        # A language tag ("```text\n...") sits on the first line - drop it.
        first_nl = inner.find("\n")
        if first_nl != -1 and " " not in inner[:first_nl].strip():
            inner = inner[first_nl + 1 :]
        return inner.strip()
    return stripped


async def transcribe(image: bytes, mime: str, api_key: str) -> tuple[str, str]:
    """OCR one image via the configured cloud vision model.

    Returns ``(text, model_used)``. Raises :class:`provider.ProviderError`
    with a user-facing message on any upstream failure. The image is held in
    memory only for the duration of the call.
    """
    payload = {
        "model": settings.ocr_cloud_model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": TRANSCRIBE_PROMPT},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{mime};base64,"
                            + base64.b64encode(image).decode("ascii")
                        },
                    },
                ],
            }
        ],
        "temperature": 0,
        # Belt and suspenders: OpenRouter's per-request ZDR switch plus the
        # older provider preference - both restrict routing to endpoints that
        # neither retain nor train on the request.
        "zdr": True,
        "provider": {"data_collection": "deny"},
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": settings.openrouter_app_url,
        "X-Title": settings.openrouter_app_name,
    }
    url = settings.openrouter_base_url.rstrip("/") + "/chat/completions"
    try:
        async with httpx.AsyncClient(timeout=settings.ocr_cloud_timeout) as client:
            response = await client.post(url, json=payload, headers=headers)
    except httpx.TimeoutException as exc:
        raise ProviderError(
            "The cloud model took too long to read this photo — try again.", 504
        ) from exc
    except httpx.HTTPError as exc:
        raise ProviderError(f"Couldn't reach the model provider ({exc}).", 502) from exc

    if response.status_code != 200:
        raise ProviderError(
            friendly_provider_error(response.status_code, response.content),
            response.status_code,
        )

    try:
        data = response.json()
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise ProviderError("Unexpected reply from the model provider.", 502) from exc

    text = _strip_fences(content if isinstance(content, str) else "")
    if not text:
        raise ProviderError(
            "The cloud model couldn't read any text in this photo.", 502
        )
    model_used = data.get("model") or settings.ocr_cloud_model
    return text, str(model_used)
