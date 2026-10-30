# QUON Scrubber Service

A standalone, local PII-pseudonymization microservice. It takes raw text and
returns the same text with personal data replaced by typed placeholders, plus a
structured report of what was removed.

Detection runs **three layers**, all merged before replacement:

- **NER** (spaCy/Presidio, `NER_ENABLED=true`) — person names, on-device, no
  network. The primary name detector.
- **Safety net** (`SAFETY_NET=true`) — deterministic recognizers for the
  high-confidence types: EMAIL / PHONE / IBAN, plus currency amounts
  (`SAFETY_NET_AMOUNTS`) and addresses (`SAFETY_NET_ADDRESSES`). Always on, so
  these are never missed even when a model overlooks one.
- **GLiNER** (`GLINER_ENABLED=true`) — an in-process zero-shot span scorer
  (`urchade/gliner_multi_pii-v1`) for names, credentials, IDs and addresses that
  the other two miss. CPU-only, no network. **Ships off** so a first start does
  not pull a 1.5 GB model; the reference deployment runs it on.

Replacement is done by **Presidio Anonymizer** — deterministic, position-based
string substitution only, never detection. No GPU required.

```
                  ┌─ NER (spaCy/Presidio) ─────────────────────────┐
Request → API ───>┤─ GLiNER span scoring (guarded) ────────────────├─ merge
                  └─ safety net: EMAIL/PHONE/IBAN/amount/address ──┘    │
                                                                        ▼
                              guard chain: contrast veto · type validators ·
                                           V1 PERSON cross-check
                                                                        │
                                                                        ▼
                                                    Presidio replace → Response
```

Every guard fails **open**: one that cannot decide keeps the detection. If the
NER layer does not run, detection continues on the safety net and the response
carries `fallback_mode: true`.

**No LLM is involved in detection.** The cloud/Ollama PII-extraction tier was
removed on 2026-08-23; `LLM_ENRICHMENT`, `PII_BACKEND` and `OLLAMA_*` are read
by nothing. OpenRouter is used only as the chat relay.

## Requirements

- Python 3.11+
- ~1.5 GB of disk for the GLiNER model (downloaded once, cached in `HF_HOME`)
  when `GLINER_ENABLED=true`.
- No API key is needed to run the scrubber — detection is entirely local.

## Quick start (local)

```bash
cd quon-scrubber-service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

uvicorn main:app --host 0.0.0.0 --port 8000
# interactive docs at http://localhost:8000/docs
```

Smoke test:

```bash
curl -s http://localhost:8000/scrub \
  -H 'content-type: application/json' \
  -d '{"text":"Email Jennifer Park at j.park@firma.de, budget 2.3M €."}' | python -m json.tool
```

## Docker

```bash
docker compose up -d
curl http://localhost:8000/health
```


## API

### `POST /scrub`

Request:

```json
{
  "text": "string",
  "options": {
    "language": "auto",
    "show_entities": true,
    "placeholder_style": "typed"
  }
}
```

- `language`: `auto` (heuristic detection for metadata), `de`, or `en`.
- `show_entities`: include the entity report in the response (default `true`).
- `placeholder_style`: `typed` → `[PERSON]`, `[EMAIL]`, `[TELEFON]`, …;
  `generic` → every entity becomes `[PII]`; `indexed` → `[PERSON_1]`, `[EMAIL_1]`,
  `[AMOUNT_2]`, … (one unique placeholder per distinct value). The chat uses
  `indexed` so the client can **re-hydrate** the model's answer — it sends only
  placeholders to the provider and restores the original values locally for
  display (toggle "Show anonymized" to see what the provider actually saw).

Response:

```json
{
  "scrubbed": "Email [PERSON] at [EMAIL], budget [BETRAG].",
  "original_length": 123,
  "scrubbed_length": 120,
  "entities": [
    { "type": "PERSON", "value": "Jennifer Park", "placeholder": "[PERSON]", "confidence": 0.9 }
  ],
  "metadata": {
    "model_used": "presidio-ner",
    "processing_time_ms": 1240,
    "fallback_mode": false,
    "language_detected": "en"
  }
}
```

### `GET /health`

```json
{ "status": "ok", "version": "0.1.0", "ner_ready": true, "pii_ready": true, "gliner_enabled": true, "gliner_loaded": true }
```

### `GET /entities`

Returns the full catalog of supported entity types with their placeholders and
descriptions (drives the frontend legend).

### `GET /models`

Lists the chat models offered in the client dropdown (OpenRouter slugs):
`[{ "label": "Claude Sonnet", "id": "anthropic/claude-sonnet-4.5", "disabled": false }, …]`.

### `POST /chat`

Relays an **already-scrubbed** conversation to OpenRouter and returns the reply.
The provider API key is read server-side from `OPENROUTER_API_KEY` and never
leaves the host. A system message instructs the model to keep QUON placeholders
(`[PERSON]`, `[EMAIL]`, …) verbatim so they can be restored locally.

```json
// Request
{ "model": "openrouter/auto",
  "messages": [{ "role": "user", "content": "Mail [PERSON] at [EMAIL]" }] }
// Response
{ "answer": "…", "model": "anthropic/claude-4.5-sonnet-…" }
```

Configure the provider via `OPENROUTER_API_KEY` (set it in the service `.env`)
and optionally `OPENROUTER_BASE_URL`, `OPENROUTER_TIMEOUT`.

## Entity types & placeholders

| Type             | Placeholder    |     | Type         | Placeholder          |
| ---------------- | -------------- | --- | ------------ | -------------------- |
| PERSON           | `[PERSON]`     |     | PIN          | `[PIN]`              |
| EMAIL            | `[EMAIL]`      |     | INTERNAL_URL | `[INTERN-URL]`       |
| PHONE            | `[TELEFON]`    |     | CREDENTIAL   | `[ZUGANGSDATEN]`     |
| IBAN             | `[IBAN]`       |     | TAX_ID       | `[STEUER-ID]`        |
| ROUTING          | `[ROUTING-NR]` |     | INSURANCE_ID | `[VERSICHERUNGS-ID]` |
| FINANCIAL_AMOUNT | `[BETRAG]`     |     | DATE         | `[DATUM]`            |

## Configuration

All settings are environment variables (see `.env.example`):

| Variable             | Default                  | Meaning                                                |
| -------------------- | ------------------------ | ------------------------------------------------------ |
| `CORS_ALLOW_ORIGINS` | `*`                      | Comma-separated allowed origins                        |
| `LOG_LEVEL`          | `INFO`                   | Logging level                                          |
| `MAX_TEXT_LENGTH`    | `50000`                  | Input character cap                                    |
| `SAFETY_NET`         | `true`                   | Always run Presidio EMAIL/PHONE/IBAN alongside the LLM |
| `SAFETY_NET_AMOUNTS` | `true`                   | Also catch currency amounts deterministically          |

## Tests

```bash
pip install -r requirements-dev.txt
pytest -m "not integration"          # fast: unit + contract (~10s)
pytest -m integration -s           # slow: 58-case quality suite + REPORT (~3min)
```

- `tests/test_scrubber.py` / `tests/test_ner.py` / `tests/test_expectations.py` —
  deterministic unit tests (no network).
- `tests/test_api.py` — contract tests + the **58-case quality suite**
  (`@pytest.mark.integration`). POSTs every case in `tests/test_texts.py` to
  `/scrub`, grades recall + precision, prints summary tables, and writes
  `tests/REPORT.md` plus an append-only row in `tests/reports/HISTORY.md`.

Grading per case: **A** 0 missed / 0 false+, **B** 0 missed / 1 false+,
**C** 1 missed / 0 false+, **D** 1+ missed or 2+ false+, **F** >30% missed.

Optional CI gates for the integration suite (0 = disabled):

```bash
QUON_TEST_MIN_RECALL=95 QUON_TEST_MIN_PRECISION=88 pytest -m integration -s
QUON_TEST_MAX_FP=20 pytest -m integration -s
```

falls back to NER+regex only.

## Project layout

```
main.py          FastAPI app + endpoints
scrubber.py      Core logic: locate entities, pseudonymize, language heuristic
fallback.py      Presidio EMAIL/PHONE/IBAN recognizers (offline mode)
models.py        Pydantic request/response schemas
config.py        Settings
tests/           test_texts.py (corpus), test_api.py (runner), test_scrubber.py
```

## Known limitations

- **Role / distribution emails** (`dev-team@firma.de`, `board@company.com`) are
  redacted like any email — both the prompt and the safety net treat every
  address as PII. Several corpus cases intentionally probe this; expect some
  false positives. (This is the privacy-safe default: better to over-redact a
  shared inbox than to leak a personal one.)
- **Replace-all** means a person's name embedded in a company name
  (`John Smith` inside `John Smith Consulting LLC`) is also replaced.
- **Public figures** in public news (`Tim Cook`) are still flagged as `PERSON`.
- With `SAFETY_NET_AMOUNTS=true`, public amounts (e.g. a company's reported
  revenue) are redacted too — the privacy-safe default; disable it to leave
  amounts to the LLM.
- Detection quality tracks the model, and the difference is measured, not
  guessed (full synthetic corpus, 2026-08-14 — `tests/reports/HISTORY.md`):
  INSURANCE_ID and INTERNAL_URL. 7b is therefore the default despite being
  slower (~3.5s/case on an M1, materially slower CPU-only). Use 3b only where
  speed beats recall — and know what you are trading. `PERSON` is LLM-only and
  non-deterministic — set a `seed` or sample multiple times for more consistency.
- `presidio-analyzer` pulls spaCy in transitively. It is never loaded (no NER,
  no model); remove the dependency for a strictly spaCy-free install and the
  fallback degrades gracefully to no-op.

```

```
