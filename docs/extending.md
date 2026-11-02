> **Note.** This document also covers features that are not part of this repository yet: connectors, chat tools and MCP, agents, shared projects, the desktop and Android apps. They follow once they are ready.

# Extending QUON

QUON is designed to be extended in three places today:

1. **Connectors**: pluggable data sources that import outside content
   (notes, files, documents) into QUON's encrypted document store.
2. **Detection**: the PII pipeline (entity types, recognizers, vocabulary).
3. **Chat tools**: capabilities the model can invoke, with per-action consent
   (`src/lib/tools/firstParty.ts`), plus per-user **MCP** servers
   (`src/lib/mcp/`, which the backend proxies and SSRF-guards).

All three are **compile-time contributions**: your code ships inside QUON,
reviewed like any other change. QUON deliberately has **no runtime plugin
loading**, because third-party code executing next to a user's decrypted data
would break the zero-knowledge trust model (see [threat model](threat-model.md)).
MCP servers are the one exception: they run _outside_ the app, are connected
per user, and never execute inside the page.

## The two invariants (non-negotiable)

Every contribution must preserve:

- **Zero-knowledge**: user content is read, processed, embedded and encrypted
  **in the browser**. A connector must never send content to any server in the
  clear (not even QUON's own). Anything that later reaches a model provider
  goes through the scrubber first.
- **Fail-closed**: when protection can't be guaranteed, the action must block
  rather than degrade silently.

PRs that add an unscrubbed egress path or dynamic code loading will not be
accepted, regardless of usefulness.

---

## Extending detection

Three tiers, in increasing weight:

1. **Vocabulary**: false-positive/negative word lists live in
   `quon-scrubber-service/ner_gazetteer.py` (documented frozensets). This is
   the cleanest contribution; add corpus cases for what you fix.
2. **A new recognizer** for an existing type: add a Presidio recognizer to
   `fallback._get_recognizers()` or a pattern to `detect_safety_net`.
3. **A new entity type**: ONE entry in `quon-scrubber-service/entities.py`
   (the single source of truth: placeholder + catalog description), plus a
   detector (tier 1/2, or a GLiNER label in `gliner_detect.py`), plus a frontend
   style in `src/lib/quonEntityStyles.ts` (with its `chat.entity.*` label keys).
   `tests/test_entities.py` enforces the cross-tier consistency.

**Every detection change must keep the corpus ratchet green:**

```bash
cd quon-scrubber-service
QUON_RUN_CORPUS=1 ./.venv/bin/python -m pytest tests/test_corpus.py -q
```

Recall/precision floors are ratcheted, so a contribution that trades away
recall somewhere else fails CI. Add synthetic cases for the shapes you
target (`tests/synth.py`).

---

## What's deliberately out of scope

- Runtime plugin loading (marketplace-style script import): it conflicts with
  the CSP and the master-key-in-browser threat model.
- Server-side content processing: the server must stay unable to read user
  content.
- Bespoke tool plumbing: a new capability belongs either in the first-party
  tool registry (`src/lib/tools/firstParty.ts`, which already handles consent,
  scrubbing of results and the write-confirmation flow) or behind an MCP
  server, not as a one-off code path around them.

If you have questions, open a discussion issue with the `connector-proposal`
idea first; it is cheap to review before you build.
