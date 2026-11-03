> **Note.** This document also covers features that are not part of this repository yet: connectors, chat tools and MCP, agents, shared projects, the desktop and Android apps. They follow once they are ready.

# Contributing to QUON

Thanks for your interest in improving QUON. This document covers the local dev
setup, the quality gate every change must pass, and the project's contribution
terms.

Start with [README.md](README.md) (product and features) and
[ARCHITECTURE.md](ARCHITECTURE.md) (data flows, detection pipeline,
zero-knowledge design). Most review feedback comes down to the invariants
described there, especially **fail closed** (never forward unscrubbed text) and
**zero knowledge** (plaintext and keys never reach the server).

## Development setup

Two components, talking over HTTP.

### Frontend (`src/`): TanStack Start (React 19), Tailwind v4

```bash
npm install   # no flags needed: .npmrc pins legacy-peer-deps=true for the repo
cp .env.example .env
# then set VITE_QUON_API_URL=/api in .env; the shipped default points straight
# at :8000, which is cross-origin: the session cookie is SameSite=Lax, is never
# sent, and login fails with no error message at all.
npm run dev                      # http://localhost:8080 (proxies /api to the backend)
```

### Backend (`quon-scrubber-service/`): FastAPI + SQLite

```bash
cd quon-scrubber-service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt      # includes spaCy model wheels
cp .env.example .env                     # dev: set COOKIE_SECURE=false; OPENROUTER_API_KEY optional
uvicorn main:app --reload                # http://localhost:8000, GET /health to verify
```

Register an account in the app; without SMTP configured the account is active
right away (`EMAIL_VERIFICATION=auto`). To exercise the mail flow set
`EMAIL_VERIFICATION=required`; the link is then printed in the backend log as
`[DEV EMAIL]`.

The production configuration (environment reference, HTTPS, backups) is in
[docs/self-hosting.md](docs/self-hosting.md).

## Quality gate

**`./deploy/preflight.sh` must pass before a PR is ready.** It runs:

1. Frontend: `npm run preflight` = typecheck + ESLint + `vitest run` + build.
2. Backend: `pytest -q` (the full suite).
3. Detection ratchet: the synthetic corpus with recall/precision floors
   (`QUON_RUN_CORPUS=1`). It is deterministic and needs no API key; every
   detector runs in-process (GLiNER only when `GLINER_ENABLED=1`).

It deliberately does **not** run the end-to-end suite: run that yourself with
`npm run e2e` (Playwright, Chromium **and** WebKit, against a throwaway stack).
Locally the suite is timing-sensitive: a busy machine produces failures that
pass in isolation seconds later, so CI is the authority for E2E.

`SKIP_BACKEND=1 ./deploy/preflight.sh` skips stage 2 for a frontend-only change.

CI (`.github/workflows/ci.yml`) runs all three stages **plus** the cross-browser
E2E suite, and it is what gates a merge; supply-chain jobs (SBOM, license gate,
vulnerability scans) live in `.github/workflows/supply-chain.yml`.

### Testing expectations

- **Bug fixes in pure logic** (chunker, vector search, placeholder
  re-hydration, redaction, sync merge) must come with a regression test.
- **Detection changes** (NER, gazetteers, the regex safety net, the guard
  chain) must keep the corpus ratchet green: run
  `QUON_RUN_CORPUS=1 python -m pytest tests/test_corpus.py -q` in
  `quon-scrubber-service/`. The floors only ratchet upward: a change that
  lowers recall or precision below the floor will not be merged. If your
  change legitimately improves quality, raise the floors with it.
  [docs/detection-evaluation.md](docs/detection-evaluation.md) explains what the
  corpus measures and what it cannot see.
- **Larger features** should include unit coverage and, where they touch user
  flows, an e2e spec (Chromium + WebKit).
- Fail-closed behavior is not negotiable: any change to the scrub/send path
  must keep "scrubber unreachable means sending blocked, input preserved"
  true, and tests should prove it.

## Secrets and data

Never commit or paste into PRs/issues:

- `.env`, `.env.production`, `runtime_settings.json`, `quon.db` (all
  git-ignored; keep them that way),
- API keys, session tokens, or real personal data (use synthetic PII in tests
  and reproductions).

## Extending QUON (connectors & detection)

To improve PII detection or add a data source, read
**[docs/extending.md](docs/extending.md)** first. It lists the invariants every
extension must preserve (zero-knowledge, fail-closed, no runtime plugin
loading) and the detection tiers: vocabulary, then a recognizer, then a new
entity type via `entities.py`. Data-source connectors have their own guide,
`docs/extending-connectors.md`, which ships together with the connectors: the
Connector interface and registry, the idempotent-ingest contract and the i18n
requirements.

## Pull requests

- Keep PRs focused; describe what changed and why.
- Update the relevant docs (README/ARCHITECTURE/this file) when behavior or
  setup changes.
- Fill in the PR template checklist: preflight green, tests added, no
  secrets, docs updated.
- For security-sensitive findings, **do not open a PR or issue**; follow
  [SECURITY.md](SECURITY.md) instead.

## License of contributions: the CLA

QUON is licensed to everyone under the AGPL-3.0 (`LICENSE`). Contributions are
accepted under the Contributor License Agreement in [CLA.md](CLA.md): you keep
the copyright in your work and grant the project owner a licence to it that
includes distributing QUON under other terms. That last part is the reason the
agreement exists. It keeps a commercial or hosted offering of QUON, and a
future licence change, possible without asking every past contributor again.
The agreement does not transfer copyright, and it takes nothing away from the
AGPL grant you receive like everyone else.

Signing is one comment on your first pull request: a bot asks, you reply with
the sentence it quotes, and the signature (GitHub login, date, agreement
version) is recorded on the `cla-signatures` branch of this repository, where
anyone can see it. One signature covers all later contributions. If you
contribute on behalf of an employer, make sure you are authorised to sign for
it; the agreement says what that means.

`git commit -s` is welcome but no longer required.

## Code of conduct

All project spaces are governed by the
[Code of Conduct](CODE_OF_CONDUCT.md). Be excellent to each other.
