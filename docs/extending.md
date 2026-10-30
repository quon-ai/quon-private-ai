> **Core edition.** This document describes the full QUON product. The core edition leaves out some features (connectors, chat tools and MCP, agents, shared projects, native apps) — see [docs/CORE.md](./CORE.md) for the list and the criteria.

# Extending QUON

QUON is designed to be extended in three places today:

1. **Connectors** — pluggable data sources that import outside content
   (notes, files, documents) into QUON's encrypted document store.
2. **Detection** — the PII pipeline (entity types, recognizers, vocabulary).
3. **Chat tools** — capabilities the model can invoke, with per-action consent
   (`src/lib/tools/firstParty.ts`), plus per-user **MCP** servers
   (`src/lib/mcp/`, proxied and SSRF-guarded by the backend).

All three are **compile-time contributions**: your code ships inside QUON,
reviewed like any other change. QUON deliberately has **no runtime plugin
loading** — third-party code executing next to a user's decrypted data would
break the zero-knowledge trust model (see [threat model](threat-model.md)).
MCP servers are the one exception that proves the rule: they run _outside_ the
app, are connected per user, and never execute inside the page.

## The two invariants (non-negotiable)

Every contribution must preserve:

- **Zero-knowledge** — user content is read, processed, embedded and encrypted
  **in the browser**. A connector must never send content to any server in the
  clear (not even QUON's own). Anything that later reaches a model provider
  goes through the scrubber first.
- **Fail-closed** — when protection can't be guaranteed, the action must block,
  not degrade silently.

PRs that add an unscrubbed egress path or dynamic code loading will not be
accepted, regardless of usefulness.

---

## Writing a connector

A connector is a folder under `src/lib/connectors/<your-id>/` plus **one line**
in `src/lib/connectors/registry.ts`. The UI (`ScreenConnectors`) is fully
generic — it renders every registered connector from the interface alone.

### Anatomy

```
src/lib/connectors/
  types.ts            ← the Connector interface (read this first)
  registry.ts         ← add your one line here
  <your-id>/
    index.ts          ← the Connector object (metadata + wiring)
    importer.ts       ← source → ingestDocument() (the only file touching both)
    …                 ← source-access helpers
```

### Skeleton

```ts
// src/lib/connectors/example/index.ts
import { FileText } from "lucide-react";
import type { Connector } from "../types";
import { importExample, disconnectExample } from "./importer";

export const exampleConnector: Connector = {
  id: "example",
  name: "Example", // product name, as-is
  descriptionKey: "connectors.example.description", // i18n (see below)
  icon: FileText,
  capabilities: { import: true, export: false, sync: false },
  isSupported: () => true,
  // "picker": your import() opens its own picker (e.g. File System Access).
  // "file-input": the UI renders an <input> and hands you `fallbackFiles`.
  importMode: () => "file-input",
  fileInput: { directory: false, accept: ".txt,.md" },
  import: importExample,
  disconnect: disconnectExample,
};
```

### Ingest: idempotent by design

Use the shared pipeline — never write to the document store directly:

```ts
import { ingestDocument } from "@/lib/documents/ingest";
import { deleteDocument, getDocumentsByConnector } from "@/lib/documentStore";

const ID = "example";
const docId = (ref: string) => `${ID}:${ref}`; // stable per source item

await ingestDocument({
  id: docId(ref), // same id on re-import → update in place
  file,
  filename,
  mime,
  projectId: opts?.projectId,
  source: { connector: ID, ref, hash }, // hash unchanged → skip re-embedding
});

// disconnect(): remove everything this connector imported — nothing else.
for (const d of getDocumentsByConnector(ID)) deleteDocument(d.id);
```

`ref` is your stable per-item id (a path, a message id, a remote id). `hash`
is a content hash — compare against `existing.source?.hash` to skip unchanged
items (see `obsidian/importer.ts` for the reference implementation, and
`connectors/shared/` for reusable folder-access helpers).

### i18n

All user-facing strings are catalog keys, never literals. Add your
`connectors.<id>.*` keys (English **and** German — a missing German key is a
compile error) to `src/lib/i18n/catalogs/connectors.ts`. Generic card strings
(`connectors.connect`, …) are used unless you override them via
`Connector.ui`.

### Network sources

The only shipped patterns are local reads (folder/file pickers) and
direct-from-browser API calls where the **user's browser** talks to the
**user's own service** (credentials stored client-side encrypted, CORS/CSP
documented — see the Paperless connector for the reference implementation). A
connector that routes user content through any intermediate server will be
rejected.

### Live source FIRST — the guiding principle for network connectors

A large external source (a mailbox, a Dropbox, a document archive) must NOT be
bulk-mirrored into QUON documents. Decided 2026-08-07 after the first real
IMAP run tried exactly that ("das fliegt nicht"): the source stays the source,
and QUON interacts with it —

1. **search** it from QUON (server-side where the protocol allows: IMAP
   SEARCH, the Paperless/Dropbox query APIs) returning cheap metadata, never
   content;
2. **read** single items on demand (`browse.fetchText` / a read chat tool);
3. **import** only what the user explicitly picks (`browse.importSelection` /
   a consented import chat tool) — idempotent, so re-picking updates in place.

A full mirror, if ever justified, is a separate explicit opt-in — never the
connect-button default. The IMAP connector is the reference implementation of
this shape; Paperless and Dropbox already follow it.

### The local filesystem is a live source too (desktop app)

The same shape applies to a folder on the user's machine: `pick_folder` (an OS
dialog — the grant is a human gesture, never a model-supplied path), then
list/read on demand and import only what is picked. See
`src/lib/tools/folderGrant.ts` + the folder tools in `firstParty.ts`, and
docs/threat-model.md §3.8c for why arguments are resolved against a listing
instead of being trusted as paths.

### Live sources (`browse.fetchText`)

A network connector whose source already holds **extracted text** (Paperless
serves its OCR `content` over the API) can go beyond import: implement the
optional `fetchText(ref)` on `Connector.browse` and QUON can use the source
**live, without copying it** —

- the chat paperclip gains a "From <source>…" picker (`RemoteDocPicker`): the
  picked document's text is staged as an **ephemeral message attachment** —
  no `DocItem`, no index, no originals quota; the chip says so honestly. It
  still flows through the exact same scrub-before-send pipeline as any
  attachment.
- first-party chat tools can search/read the source on demand (see
  `src/lib/tools/firstParty.ts`, the `search_paperless` /
  `read_paperless_document` trio). Tools over a live external source MUST set
  `provenance: "external"` — their results are external content and flip the
  run's injection guard (a later write shows the provenance banner, see
  threat-model §3.10) — and should be advertised only while the connector is
  configured (`available`).

Rules for a live source: every request goes through ONE shared fetch helper
with a **timeout** (AbortController + setTimeout — not `AbortSignal.timeout`,
Safari <16.4) and mapped, actionable error messages; search may be delegated
to the source's own index (that's the point), but text always comes back to
the device before anything else happens — the scrubber, not the source, is
what stands between the text and the model provider.

### Checklist for a connector PR

- [ ] Folder + one registry line; UI untouched (it's generic).
- [ ] `ref`-stable, `hash`-gated idempotent re-import; clean `disconnect()`.
- [ ] i18n keys DE+EN; no hardcoded strings.
- [ ] Unit tests for your parser/access layer (fixtures, no network).
- [ ] A hermetic e2e if feasible (the Obsidian spec drives the
      `fallbackFiles` path — copy that pattern).
- [ ] `./deploy/preflight.sh` green (and `npm run e2e` if you touched the UI —
      preflight does not run it).

---

## Extending detection

Three tiers, in increasing weight:

1. **Vocabulary** — false-positive/negative word lists live in
   `quon-scrubber-service/ner_gazetteer.py` (documented frozensets). Cleanest
   contribution; add corpus cases for what you fix.
2. **A new recognizer** for an existing type — add a Presidio recognizer to
   `fallback._get_recognizers()` or a pattern to `detect_safety_net`.
3. **A new entity type** — ONE entry in `quon-scrubber-service/entities.py`
   (the single source of truth: placeholder, catalog description, optional
   LLM hint) + a detector (tier 1/2 or the LLM hint) + a frontend style in
   `src/lib/quonEntityStyles.ts` (+ its `chat.entity.*` label keys).
   `tests/test_entities.py` enforces the cross-tier consistency, including a
   byte-golden test of the LLM prompt — extending adds lines, never silently
   rewrites evaluated wording.

**Every detection change must keep the corpus ratchet green:**

```bash
cd quon-scrubber-service
QUON_RUN_CORPUS=1 ./.venv/bin/python -m pytest tests/test_corpus.py -q
```

Recall/precision floors are ratcheted — a contribution that trades away
recall somewhere else will fail CI. Add synthetic cases for the shapes you
target (`tests/synth.py`).

---

## What's deliberately out of scope

- Runtime plugin loading (marketplace-style script import) — conflicts with
  the CSP and the master-key-in-browser threat model.
- Server-side content processing — the server must stay unable to read user
  content.
- **Bespoke** tool plumbing: a new capability belongs either in the first-party
  tool registry (`src/lib/tools/firstParty.ts`, which already handles consent,
  scrubbing of results and the write-confirmation flow) or behind an MCP server
  — not as a one-off code path around them.

Questions? Open a discussion issue with the `connector-proposal` idea first —
cheap to review before you build.
