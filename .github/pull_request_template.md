<!--
Thanks for contributing! Please read CONTRIBUTING.md first.
Do NOT include secrets (.env values, API keys, quon.db, runtime_settings.json)
or real personal data anywhere in this PR — use synthetic PII in tests.
Security fixes: report privately via Security → Report a vulnerability instead
of opening a public PR (see SECURITY.md).
-->

## What & why

<!-- What changed, and the problem it solves. Link related issues. -->

## Checklist

- [ ] **Preflight is green** — `./deploy/preflight.sh` passes locally
      (typecheck + lint + vitest + build, backend pytest, cross-browser e2e).
- [ ] **Tests added/updated** — regression test for logic fixes; unit/e2e
      coverage for new features; detection changes keep the corpus ratchet
      green (`QUON_RUN_CORPUS=1 python -m pytest tests/test_corpus.py -q`).
- [ ] **No secrets or personal data** — nothing from `.env`,
      `runtime_settings.json`, or `quon.db`; only synthetic PII in tests
      and fixtures.
- [ ] **Docs updated** — README / ARCHITECTURE / CONTRIBUTING / threat model
      adjusted if behavior, setup, or the security posture changed.
- [ ] **Invariants hold** — zero-knowledge (no plaintext or keys reach the
      server) and fail-closed scrubbing are unaffected, or the change to them
      is explicitly called out above.
