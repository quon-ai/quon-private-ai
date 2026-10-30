# QUON Scrubber Service

The backend of QUON: a FastAPI service that pseudonymizes text **entirely on
this machine** (spaCy/Presidio NER → optional GLiNER span scoring → a regex
safety net → a guard chain → position-based replacement), relays
already-scrubbed conversations to the model provider, and stores the
end-to-end-encrypted sync blobs. No LLM takes part in detection; the provider
sees placeholders only.

This file covers only what is specific to running the service on its own.
Everything else lives in one place each — do not duplicate it here:

| Topic | Where |
| --- | --- |
| How detection works, the guards, why a hybrid | [ARCHITECTURE.md §5](../ARCHITECTURE.md#5-detection-pipeline-the-heart) |
| API (selected endpoints; the full list is `/docs` on a running service) | [ARCHITECTURE.md §6](../ARCHITECTURE.md#6-api-reference) |
| Configuration surface and every environment variable | [ARCHITECTURE.md §7](../ARCHITECTURE.md#7-configuration-surface), [docs/self-hosting.md](../docs/self-hosting.md#environment-reference) |
| Running the whole product (Docker Compose, GLiNER, SMTP, backups) | [docs/self-hosting.md](../docs/self-hosting.md) |
| Contributing a detector, a recognizer or an entity type | [docs/extending.md](../docs/extending.md) |
| What is measured, and the floors a change must keep | `tests/CORPUS_REPORT.md`, `tests/reports/HISTORY.md`, `tests/reports/SCRUB_LATENCY.md` |

## Run it on its own

```bash
cd quon-scrubber-service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt     # includes the pinned spaCy model wheels
cp .env.example .env                    # dev: COOKIE_SECURE=false; OPENROUTER_API_KEY optional
uvicorn main:app --reload               # http://localhost:8000 — GET /health, docs at /docs
```

Python 3.11+. GLiNER (`GLINER_ENABLED=true`) downloads a ~1.5 GB model once
into `HF_HOME` and needs ~3 GB of RAM; it is the detector you almost certainly
want on — see the self-hosting guide. Without SMTP configured, the account
verification link is printed in the log as `[DEV EMAIL]`.

Smoke test:

```bash
curl -s http://localhost:8000/scrub \
  -H 'content-type: application/json' \
  -d '{"text":"Email Jennifer Park at j.park@example.org, budget 2.3M €."}' | python -m json.tool
```

## Tests

```bash
pytest -q                                 # unit + contract tests (~30 s)
QUON_RUN_CORPUS=1 pytest tests/test_corpus.py -q   # synthetic corpus + the recall/precision floors
```

`tests/test_corpus.py` is the ratchet CI enforces; `tests/test_latency_ledger.py`
holds the time-to-first-placeholder budget. Reports written by a run go to the
paths in `tests/report_paths.py` (git-ignored). Detection changes are measured,
never eyeballed: keep the ratchet green and update the ledgers with the numbers.

## Layout

```
main.py            FastAPI app; mounts the routers (optional ones via optional_features.py)
scrubber.py        detect → merge → guard → replace; language heuristic
ner.py             spaCy/Presidio NER layer + the PERSON guards and denylists
gliner_detect.py   GLiNER span scorer (in-process, guarded, opt-in)
fallback.py        deterministic safety net: EMAIL / PHONE / IBAN, amounts, addresses
entities.py        the entity catalog — placeholders and GET /entities derive from it
provider.py        chat relay to the model provider (server-side key, placeholder-keeping prompt)
auth.py account.py sync.py shares.py admin.py   accounts, sessions, zero-knowledge sync
config.py          settings (env + .env); settings_store.py: runtime-mutable ones
tests/             pytest suite, corpus ratchet, ledgers
```

## Known limitations

- **Role / distribution addresses** (`dev-team@example.org`) are redacted like
  any email — better to over-redact a shared inbox than to leak a personal one.
- **Replace-all**: a person's name inside a company name (`John Smith` in
  `John Smith Consulting LLC`) is replaced too.
- **Public figures** in public text are still flagged as `PERSON`.
- With `SAFETY_NET_AMOUNTS=true` (default), public amounts such as a company's
  reported revenue are redacted as well; disable it to let amounts through.
