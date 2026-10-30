> **Core edition.** This document describes the full QUON product. The core edition leaves out some features (connectors, chat tools and MCP, agents, shared projects, native apps) — see [docs/CORE.md](./docs/CORE.md) for the list and the criteria.

# Contributing to QUON

Thanks for your interest in improving QUON. This document covers the local dev
setup, the quality gate every change must pass, and the project's contribution
terms.

Start with [README.md](README.md) (product and features) and
[ARCHITECTURE.md](ARCHITECTURE.md) (data flows, detection pipeline,
zero-knowledge design) — most review feedback comes down to the invariants
described there, especially **fail closed** (never forward unscrubbed text) and
**zero knowledge** (plaintext and keys never reach the server).

## Development setup

Two components, talking over HTTP.

### Frontend (`src/`) — TanStack Start (React 19), Tailwind v4

```bash
npm install   # no flags needed — .npmrc pins legacy-peer-deps=true for the repo
cp .env.example .env
# then set VITE_QUON_API_URL=/api in .env — the shipped default points straight
# at :8000, which is cross-origin: the session cookie is SameSite=Lax, is never
# sent, and login fails with no error message at all.
npm run dev                      # http://localhost:8080 (proxies /api to the backend)
```

### Backend (`quon-scrubber-service/`) — FastAPI + SQLite

```bash
cd quon-scrubber-service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt      # includes spaCy model wheels
cp .env.example .env                     # dev: set COOKIE_SECURE=false; OPENROUTER_API_KEY optional
uvicorn main:app --reload                # http://localhost:8000 — GET /health to verify
```

Register an account in the app; without SMTP configured, the verification link
is printed in the backend log as `[DEV EMAIL]`.

See [quon-scrubber-service/SETUP.md](quon-scrubber-service/SETUP.md) for the
full operator/production configuration.

## Quality gate

**`./deploy/preflight.sh` must pass before a PR is ready.** It runs:

1. Frontend: `npm run preflight` = typecheck + ESLint + `vitest run` + build.
2. Backend: `pytest -q` (the full suite).
3. Detection ratchet: the synthetic corpus with recall/precision floors
   (`QUON_RUN_CORPUS=1` — deterministic, **no API key needed**; the LLM layer
   is off, NER + regex only).

It deliberately does **not** run the end-to-end suite: run that yourself with
`npm run e2e` (Playwright, Chromium **and** WebKit, against a throwaway stack).
Locally the suite is timing-sensitive — a busy machine produces failures that
pass in isolation seconds later — so CI is the authority for E2E.

`SKIP_BACKEND=1 ./deploy/preflight.sh` skips stage 2 for a frontend-only change.

CI (`.github/workflows/ci.yml`) runs all three stages **plus** the cross-browser
E2E suite, and it is what gates a merge; supply-chain jobs (SBOM, license gate,
vulnerability scans) live in `.github/workflows/supply-chain.yml`.

### Testing expectations

- **Bug fixes in pure logic** (chunker, vector search, placeholder
  re-hydration, redaction, sync merge) must come with a regression test.
- **Detection changes** (NER, gazetteers, regex safety net, LLM merge logic)
  must keep the corpus ratchet green: run
  `QUON_RUN_CORPUS=1 python -m pytest tests/test_corpus.py -q` in
  `quon-scrubber-service/`. The floors only ratchet upward — a change that
  lowers recall or precision below the floor will not be merged. If your
  change legitimately improves quality, raise the floors with it.
- **Larger features** should include unit coverage and, where they touch user
  flows, an e2e spec (Chromium + WebKit).
- Fail-closed behavior is sacred: any change to the scrub/send path must keep
  "scrubber unreachable ⇒ sending blocked, input preserved" true, and tests
  should prove it.

## Secrets and data

Never commit or paste into PRs/issues:

- `.env`, `.env.production`, `runtime_settings.json`, `quon.db` (all
  git-ignored — keep them that way),
- API keys, session tokens, or real personal data (use synthetic PII in tests
  and reproductions).

## Extending QUON (connectors & detection)

Want to contribute a new data-source connector or improve PII detection?
Read **[docs/extending.md](docs/extending.md)** first — it covers the
Connector interface + registry, the idempotent-ingest contract, the i18n
requirements, the detection tiers (vocabulary → recognizer → new entity type
via `entities.py`), and the invariants (zero-knowledge, fail-closed, no
runtime plugin loading) every extension must preserve.

## Pull requests

- Keep PRs focused; describe what changed and why.
- Update the relevant docs (README/ARCHITECTURE/this file) when behavior or
  setup changes.
- Fill in the PR template checklist — preflight green, tests added, no
  secrets, docs updated.
- For security-sensitive findings, **do not open a PR or issue** — follow
  [SECURITY.md](SECURITY.md) instead.

## License of contributions

QUON is source-available under the **Business Source License 1.1** (see the
license file in the repository root). Contributions are accepted under the
standard **inbound = outbound** rule: by submitting a pull request, you agree
that your contribution is licensed to the project under the same license as
the repository (including its scheduled change to Apache-2.0). There is no
separate CLA.

## Code of conduct

All project spaces are governed by the
[Code of Conduct](CODE_OF_CONDUCT.md). Be excellent to each other.
