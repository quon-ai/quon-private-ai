> **Note.** This document describes the whole QUON product. Not part of this repository: connectors, chat tools and MCP, agents, shared projects, the desktop and Android apps.

# QUON Architecture

This document is the shared mental model of the system: components, data flows,
the detection pipeline, design decisions, and the open questions worth
brainstorming. It's meant to be read alongside the code and updated as the
architecture evolves.

> **Status legend:** ✅ built · 🟡 partial / prototype · ⬜ planned

---

## 1. Goals & principles

1. **PII never leaves the perimeter in the clear.** Detection + redaction happen
   before any third-party provider sees the text.
2. **Fail closed, never open.** If the scrubber is unreachable, sending is
   paused: the app would rather be unavailable than leak.
3. **Defense in depth in detection.** No single detector is trusted; a
   deterministic safety net always runs under the (fallible) ML layers.
4. **Detection is local, full stop.** Every detector runs in-process on the
   server. Since 2026-08-23 there is no cloud detection path to opt into.
5. **Transparency over magic.** The user always sees what was redacted and can
   override it (Review mode).
6. **Zero-knowledge persistence.** The server stores accounts plus opaque
   ciphertext only; conversation plaintext and the user's keys never reach it.
   **Chat, Memory and Documents** are all end-to-end encrypted in the browser and
   synced as ciphertext (§3.4). There is no server-side Memory/Documents path; the
   former non-ZK `SERVER_ASSIST` mode has been removed.

---

## 2. System topology

```
┌──────────────────────────────────────────────────────────────────────────┐
│  BROWSER (TanStack Start SPA/SSR)                                          │
│                                                                            │
│   Routes: / (auth gate) /dashboard /chat /verify /recover /settings …     │
│   Auth:   authStore (loading→anonymous→locked→ready) · Master Key in mem   │
│   Crypto: quonCrypto — Argon2id + libsodium secretbox + BIP39 (sumo)       │
│   Sync:   syncEngine — encrypts each chat session, push/pull (LWW)         │
│   State:  quonStore (localStorage cache) — protection level, model, chats  │
│                                                                            │
│   re-hydration map [PERSON_1]→"Anna"  +  Master Key   (never sent)         │
└───────────────┬────────────────────────────────────────────────────────── ┘
                │  HTTPS/JSON + httpOnly session cookie + CSRF
                │  (VITE_QUON_API_URL=/api → Vite proxy / Caddy → :8000)
                ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  QUON SCRUBBER SERVICE (FastAPI)                                          │
│                                                                            │
│   /auth/*  register·verify·login·logout·me·keymaterial·reset  (sessions)  │
│   /scrub /chat /chat/stream   — authed; per-user OpenRouter key            │
│   /sync/push /sync/changes    — opaque encrypted blobs (zero-knowledge)    │
│   /account/usage  /admin/*    — OpenRouter sub-key lifecycle               │
│   /health /entities /models /settings*                                     │
│                                                                            │
│   SQLite: users·sessions·user_keys·blobs(chat·memory·docs)·user_or_keys     │
│   Detection: NER ✅ + GLiNER ✅ + regex safety-net ✅  (all in-process)     │
└──────┬───────────────────────────────────┬─────────────────────────────────┘
                                           │ chat / provisioning only
                                            ▼
                                     ┌──────────────┐
                                     │   (hosted)   │ chat + /api/v1/keys (mint)
                                     └──────────────┘
```

**Two trust boundaries (both keep secrets out of the browser-vs-server gap):**

1. **Zero-knowledge (user-controlled):** chat sessions + the re-hydration map are
   encrypted in the browser with the user's **Master Key** (never sent). The
   server stores only ciphertext blobs; it cannot read a conversation.
2. **Server-side secret (server-controlled):** the per-user OpenRouter sub-key
   lives server-side, sealed at rest with `QUON_SERVER_SECRET`. The relay uses it
   on the user's behalf; it never reaches the browser. (This is not
   zero-knowledge, and it cannot be: the relay must call OpenRouter.)

---

## 3. Components

### 3.1 Frontend (`src/`) ✅

- **Framework:** TanStack Start (React 19, file-based routing, SSR-capable).
- **UI:** Tailwind v4 + shadcn/ui (Radix). `motion` for animation. Custom
  `--quon-*` design tokens in `styles.css`.
- **Shell:** `AppShell` gates on `authStore` status (loading shows a spinner,
  anonymous shows `ScreenAuth`, locked shows `ScreenUnlock`, ready shows the app) and starts
  the sync engine on unlock. Desktop sidebar (`AppSidebar`) + mobile drawer/tabs.
- **Auth (`lib/authStore.ts`):** `useSyncExternalStore` state machine; holds the
  Master Key in memory (+ `sessionStorage` so a reload stays unlocked). Flows:
  `login`, `unlock`, `registerAccount`, `verifyEmail`, `recoverWithPhrase`,
  `logout`.
- **Crypto (`lib/crypto/quonCrypto.ts`):** `libsodium-wrappers-sumo` (Argon2id +
  secretbox) and `@scure/bip39`. Derives keys, generates + wraps the Master Key,
  encrypts/decrypts session blobs. **Sumo build required** (standard build omits
  `crypto_pwhash`).
- **Sync (`lib/syncEngine.ts` + `lib/collectionSync.ts`):** one generic
  collection sync (debounced encrypted push, pull-on-unlock, LWW, per-collection
  cursor, tombstones) drives all three collections (chat, **memory** and
  **documents**), each with its own Master-Key-derived key. See §3.4.
- **Onboarding screens:** `ScreenAuth` (login/register/recovery-kit/forgot/
  unlock), routes `verify.tsx` + `recover.tsx`. The recovery-kit step offers a
  downloadable **PDF** (`jsPDF`, dynamic-imported).
- **Chat management (`AppSidebar`):** per-chat menu: rename (inline), pin
  (pinned-first sort), delete (with an `AlertDialog` confirm). Changes go through
  `renameChatSession` / `togglePinChatSession` / `deleteChatSession` in
  `quonStore`, so they push to sync (rename/pin = blob update; delete = tombstone).
- **Release notes (`ReleaseNotesModal` + `lib/releases.ts`):** a one-time
  "What's new" popup, shown once per release (latest id tracked in localStorage).
- **State (`lib/quonStore.ts`):** `useSyncExternalStore` + `localStorage` cache.
  Protection level, model, and chat history (synced E2E-encrypted; each session
  carries `pinned` / `titleEdited`).
- **Local vault (`lib/localVault.ts`):** the device caches are **encrypted at
  rest**: chat history + preferences (incl. the `alwaysRedact` PII list) in
  localStorage and Memory/Documents/Projects in IndexedDB are sealed as
  `enc1:<secretbox>` under a cache key = `KDF(MK, "quonloc0")`, installed on
  unlock and cleared on logout. Before unlock nothing is read from or written to
  disk (stores start empty and hydrate when the key arrives; writes without a
  key are skipped; the server sync stays the durable copy). Legacy plaintext
  caches migrate on first unlock; ciphertext from another account fails to open
  and is dropped.
- **CSP (`src/server.ts` + `router.tsx`):** production responses carry an
  **enforcing, nonce-based Content-Security-Policy**. The server entry mints a
  per-request nonce (AsyncLocalStorage), the router's `ssr.nonce` tags every
  framework-injected inline script (hydration state, stream chunks: the reason
  a static header can't work), and the same nonce lands in the header.
  `script-src 'self' 'nonce-...' 'wasm-unsafe-eval'`; `connect-src` whitelists only
  self + huggingface.co/CDN + cdn.jsdelivr.net (also throttles exfiltration).
  `QUON_CSP=off` escape hatch; `QUON_CSP_CONNECT_EXTRA` for local prod testing.
- **API clients:** `lib/quonApi.ts` (scrub/chat, credentials + CSRF) and
  `lib/api/*` (`http`, `authApi`, `syncApi`).
- **Health (`hooks/useQuonHealth.ts`):** polls `/health` every 30s.

### 3.2 Backend (`quon-scrubber-service/`) ✅

FastAPI app (`main.py`). Per-request handlers are stateless; durable state lives
in SQLite (accounts, sessions, sync blobs, keys). Modules:

| Module                       | Responsibility                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main.py`                    | HTTP endpoints (scrub, chat relay, models, settings, agents, MCP, OCR, feedback...), router mounting, CORS, lifespan (migrations + NER warmup)                                                                                                                                                                                                                         |
| `db.py`                      | SQLite connection (WAL/FK), forward-only migration runner, `server_seq`                                                                                                                                                                                                                                                                                                |
| `migrations/`                | 15 forward-only steps: `0001_init` (auth/sync) · `0002_memory`\* · `0003_documents`\* · `0004_user_connections` · `0005_change_email` · `0006_onboarding` · `0007_shared_projects` · `0008_terms_acceptance` · `0009_user_settings` · `0010_bio_keys` · `0011_ui_language` · `0012_mcp_servers` · `0013_admin` · `0014_agents` · `0015_last_active` (\*legacy, see §4) |
| `auth.py`                    | Register/verify/login/logout/me/keymaterial/reset; `current_user` dep, sessions + CSRF                                                                                                                                                                                                                                                                                 |
| `crypto_server.py`           | Argon2id auth verifier (PyNaCl) + secretbox sealing of the sub-key                                                                                                                                                                                                                                                                                                     |
| `email_service.py`           | SMTP verification/reset mail: STARTTLS (587) or implicit TLS (465); logs links in dev                                                                                                                                                                                                                                                                                  |
| `openrouter_provisioning.py` | Mint/get/limit/disable/delete per-user sub-keys (`/api/v1/keys`)                                                                                                                                                                                                                                                                                                       |
| `account.py`                 | `/account/usage` + admin sub-key lifecycle                                                                                                                                                                                                                                                                                                                             |
| `sync.py`                    | Zero-knowledge blob push/pull (LWW)                                                                                                                                                                                                                                                                                                                                    |
| `key_resolver.py`            | Per-user key: provisioned sub-key, then BYOK, then global, then fail closed                                                                                                                                                                                                                                                                                            |
| `scrubber.py`                | Orchestrates detection, merge and Presidio replacement; placeholder catalog                                                                                                                                                                                                                                                                                            |
| `ner.py`                     | spaCy/Presidio NER: person names + structured patterns                                                                                                                                                                                                                                                                                                                 |
| `fallback.py`                | Deterministic regex safety net (EMAIL/PHONE/IBAN/amounts)                                                                                                                                                                                                                                                                                                              |
| `provider.py`                | OpenRouter chat relay (blocking + streaming), system prompts                                                                                                                                                                                                                                                                                                           |
| `settings_store.py`          | Runtime-mutable settings (global key, model catalog), persisted to `runtime_settings.json`                                                                                                                                                                                                                                                                             |
| `config.py`                  | Pydantic settings, all env-overridable defaults                                                                                                                                                                                                                                                                                                                        |
| `models.py`                  | Pydantic request/response schemas                                                                                                                                                                                                                                                                                                                                      |
| `admin.py`                   | Admin panel: invite codes, users, entitlements, storage stats, audit trail (metadata only)                                                                                                                                                                                                                                                                             |
| `agents.py`                  | Scheduled agents (server-side web watches); each result **sealed to the user's X25519 public key** (the server never holds a readable result)                                                                                                                                                                                                                          |
| `shares.py`                  | Read-only project sharing between accounts: membership, `shared_blobs`, sealed key grants                                                                                                                                                                                                                                                                              |
| `stream_jobs.py`             | Resumable chat streams that survive a backgrounded phone or a dropped connection (`/chat/stream/resume`)                                                                                                                                                                                                                                                               |
| `user_mcp.py`                | Per-user MCP servers: registration + proxied calls (SSRF-guarded)                                                                                                                                                                                                                                                                                                      |
| `user_connections.py`        | Per-user BYOK provider connections (sealed at rest)                                                                                                                                                                                                                                                                                                                    |
| `user_settings.py`           | Per-user overrides of the operator defaults (OpenRouter key, visible models)                                                                                                                                                                                                                                                                                           |
| `connections.py`             | Provider connections + the chat model catalog (global + per-user)                                                                                                                                                                                                                                                                                                      |
| `entities.py`                | **Single source of truth** for entity types: placeholder, catalog copy                                                                                                                                                                                                                                                                                                 |
| `ner_gazetteer.py`           | Curated word lists driving false-positive/negative behaviour                                                                                                                                                                                                                                                                                                           |
| `entitlements.py`            | Plan/quota resolution per user                                                                                                                                                                                                                                                                                                                                         |
| `ratelimit.py`               | Request rate limiting (`RATE_LIMIT_ENABLED`)                                                                                                                                                                                                                                                                                                                           |
| `net_guard.py`               | SSRF guard; blocks private/link-local targets for every outbound user-supplied URL                                                                                                                                                                                                                                                                                     |
| `fetch_url.py`               | Server-side readability extraction ("import a URL as a document")                                                                                                                                                                                                                                                                                                      |
| `link_preview.py`            | Link previews for web-search citations                                                                                                                                                                                                                                                                                                                                 |
| `ocr_cloud.py`               | Optional cloud OCR fallback for scans with no text layer (per-photo consent)                                                                                                                                                                                                                                                                                           |
| `github_issues.py`           | Beta feedback filed as GitHub issues (optional)                                                                                                                                                                                                                                                                                                                        |

> **There is no server-side Memory/Documents code.** Earlier revisions of this
> document listed `memory/` and `documents/` packages as "server-assist only
> (non-ZK; off by default)". That optional non-ZK mode was **deleted**; the
> packages no longer exist (only a tombstone comment in `main.py`). The server
> stores Memory and Documents exclusively as opaque ciphertext in the `blobs`
> table via `/sync`; extraction, chunking, embedding and re-hydration all happen
> on the client. There is nothing to enable and nothing to misconfigure.

### 3.3 External services

- **OpenRouter** ✅: the single upstream for chat completions (Claude/GPT/
  Gemini/Auto). Detection never calls it. The key is server-side only.

### 3.4 Memory & Documents (zero-knowledge, client-side) ✅

Both features are **end-to-end encrypted like chat**: the browser does
everything, the server only stores ciphertext. They reuse the same sync relay
as chat (§4.6) as two more collections, `memory` and `documents`, each
encrypted with its own Master-Key-derived key (`deriveMemoryKey` /
`deriveDocsKey`). The generic `createCollectionSync` (`src/lib/collectionSync.ts`)
drives all three (chat/memory/documents) with one LWW push/pull code path.

- **Embeddings** (`src/lib/embedding/embedder.ts`): the **multilingual**
  `paraphrase-multilingual-MiniLM-L12-v2` (384-dim), so a German query matches
  English notes and vice versa; it is lazy-loaded and runs **on the device**. Text never
  leaves the device to be embedded, so semantic search stays zero-knowledge. Each
  stored vector is tagged with its model id; on a model change,
  `src/lib/reembed.ts` re-embeds stale items lazily (so old data keeps working
  without re-entry).

  Two runtimes behind one interface: **Transformers.js in a Web Worker** on the
  web, and **native ONNX Runtime in Rust** (`src-tauri/src/embed.rs`) in the
  desktop app, chosen via `embed()` at the platform seam (§3.5). The native path
  exists for a concrete reason: compiling the ONNX WASM runtime inside WKWebView
  drove the memory pressure behind the reported black-flash restarts (issue
  #36/#37).

  The two runtimes are not vector-identical and were never expected to be:
  int8 quantization rounds differently across them (self-cosine ≈ 0.995). The
  invariant that matters for RAG is therefore **top-1 retrieval
  equivalence** (the same query must retrieve the same best match), and that is
  what `src-tauri/tests/embed_parity.rs` asserts against a golden set produced by
  the JS runtime. Vectors written by either runtime carry the same model id and
  mix freely in one store.

- **Memory** (`src/lib/memoryStore.ts`, `ScreenMemory`): facts/notes with tags.
  Adding one embeds it on-device and stores it as an encrypted blob; search embeds the query and
  ranks locally (`src/lib/search/vector.ts`, cosine top-k).
- **Documents** (`src/lib/documents/extract.ts` + `chunker.ts`,
  `src/lib/documentStore.ts`, `ScreenDocuments`): upload, extract (pdf.js /
  mammoth / native), chunk and embed, all in the browser; one encrypted blob per
  document (chunks + vectors nested). A query embeds locally and ranks chunks.
- **Scrubbing posture:** the stored text is the user's **original** content,
  encrypted at rest. Scrubbing only applies when content is sent to a cloud LLM,
  i.e. at chat-injection time (below), not at storage time.
- **Context-aware chat (RAG, `src/lib/rag.ts`):** on send, `ScreenChat` embeds the
  query on-device and retrieves relevant **Memory** (`retrieveContext`), **scrubs**
  it via `/scrub` (same conversation placeholder map as the message), and injects
  it as a leading `system` turn. Automatic retrieval is **memory-only**: documents
  reach a prompt only when the user attaches one explicitly, or when they pinned it
  to a project (`pinnedDocContext`). Pulling document chunks automatically was
  removed: many chunks per document meant many independent chances at a spurious
  mid-cosine hit, and a wrong page injected silently is worse than no page. The provider only ever sees placeholders; the answer is
  re-hydrated client-side, and each reply shows which snippets it used. A per-chat
  "Context" toggle (`useMemoryContext`) turns it off. See §4.7.

**No server-side Memory/Documents.** Memory and Documents are zero-knowledge only:
built, embedded, searched and re-hydrated in the browser and synced as opaque
ciphertext. The former non-ZK `SERVER_ASSIST` mode (server-side `memory/` +
`documents/` modules, scrubbed-plaintext storage, `pseudonym_maps`, an async
ingestion queue and a server vector store) has been **removed** to keep the server
surface minimal. Legacy migrations `0002_memory` / `0003_documents` still create
their tables for schema-history continuity, but nothing in this build reads them.

---

### 3.5 Shells & the platform capability seam ✅

QUON runs in more than one shell: the browser (the reference implementation),
a **native macOS app** (Tauri v2: Rust host + WKWebView), and later mobile
shells. One rule keeps that a single codebase: **feature code asks for a
capability, never for a platform** (`src/lib/platform/`). Every capability has
a lazy web default and resolves the native implementation on first use, so there is no
install step that could be raced (a real bug class, found 2026-08-05).

| Capability | Web                                      | Native (macOS)                                                                                                                       |
| ---------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `http()`   | `fetch` (CORS-bound)                     | host-side requests: own cookie jar, no CORS, so QUON's API works from `tauri://localhost` and LAN services are reachable             |
| `mail()`   | `null` (card says "desktop app")         | IMAP in Rust (TLS, MIME, keychain password); search/read/import as a **live source**                                                 |
| `files()`  | `null` (FS Access API / input fallback)  | OS folder picker runs host-side; reads canonicalize+prefix contained; writes: folders, new text files, moves; never delete/overwrite |
| `embed()`  | `null` (Transformers.js in a Web Worker) | ONNX Runtime in Rust, same quantized MiniLM; keeps the WASM runtime out of the webview (§3.4)                                        |

Native-only trust notes: the IMAP session is read-only by protocol
(EXAMINE + BODY.PEEK); mail credentials live in the OS keychain, never in JS;
picked folders are accessible only for the app run in which they were granted,
and the only writes inside one (subfolders, new text files, moves) are
non-destructive (never delete, never overwrite) and consented per call.
See `docs/threat-model.md` §3.8b.

### 3.6 Offline access ✅

All user data is already cached on-device encrypted at rest (localVault,
key derived from the master key). The offline front door
(`src/lib/offlineAccess.ts`) caches a minimal profile plus the password/bio
key material, so with no server in reach the app resumes read-only, a cold
start still unlocks locally (password or passkey; the PRF ceremony needs no
server), and a watcher upgrades to a real session on reconnect. The
trade-off (threat model §5): disk access enables an offline dictionary attack
on the password. That is the standard local-vault trade-off, priced by Argon2id
and erased on logout.

## 4. Core data flows

### 4.1 Scrub + send a message (Filter level) ✅

```
1. User types raw text in ScreenChat.
2. Browser → POST /scrub { text, options:{ placeholder_style:"indexed" } }
3. Backend detection pipeline (see §5) → entities + scrubbed text
4. Browser receives entities; builds/extends the conversation-global
   re-hydration map  [PERSON_1] → "Anna Müller"  (indices are conversation-wide)
5. Browser → POST /chat/stream { model, messages:[…scrubbed…], protected:true }
6. Backend relays to OpenRouter with the placeholder-preserving system prompt;
   streams deltas back as SSE  data:{delta:"…"}
7. Browser appends deltas; when done, applyPlaceholders() maps placeholders in
   the answer back to real values → naturally readable reply.
8. Both the redacted view and the re-hydrated view are kept; user can toggle.
```

The provider only ever sees `[PERSON_1] called about [IBAN_1]`, never the real
name or account.

### 4.2 Review level (manual approval) ✅

Between steps 3 and 5, a `ReviewPanel` holds the scrub result:

- shows the exact text that will be sent, placeholders highlighted;
- lists each detected entity with an un-redact toggle ("send real value");
- lets the user select any **missed** text and redact it manually;
- relays the (possibly edited) text only on **Send**.

`buildSentText()` reconstructs the outgoing string from the user's choices.

### 4.3 Unprotected (None level) ✅

The browser skips `/scrub` and sends `protected:false`, and the backend uses a
neutral system prompt (no mention of placeholders). The UI flags the message as
having left the device unprotected.

### 4.4 Health / status ✅

`useQuonHealth` polls `/health` and feeds the response to `deriveStatus()`:

| Status          | Meaning                                                                          |
| --------------- | -------------------------------------------------------------------------------- |
| 🟢 **active**   | Service up + the in-process detection stack ready (NER, and GLiNER when enabled) |
| 🟡 **fallback** | Service up but the NER layer did not run; regex safety net only                  |
| 🔴 **offline**  | Service unreachable; sending paused (fail closed)                                |
| ⚪ **loading**  | First probe in flight                                                            |

### 4.5 Onboarding + auth ✅

```
Register (browser):  Argon2id(password) → authToken + pwWrapKey; MK=random;
                     BIP39 mnemonic → recWrapKey; wrap_pw, wrap_rec
  → POST /auth/register {authToken, kdf_salt, kdf_params, wrap_pw, rec_salt, wrap_rec}
  → server: user(pending) + user_keys; email a verify link
  → browser shows the recovery kit (12 words)
Verify:  GET link → POST /auth/verify {token}
  → server (synchronous, fails closed): mint a spend-capped provider sub-key (if a provisioning key is set), seal it,
    activate the account, set httpOnly session + CSRF cookies
Login (new device):  GET /auth/kdf → derive authToken → POST /auth/login
  → server verifies, returns wrap_pw; browser unwraps the Master Key locally
Unlock (locked tab): password → /auth/keymaterial → unwrap MK → ready
Recover:  recovery phrase → unwrap MK → re-wrap under a new password → reset
Biometric unlock (per device, opt-in): WebAuthn platform passkey with the PRF
  extension → prfOutput (released by secure hardware after Face ID/fingerprint)
  → bioWrapKey = KDF(prfOutput, "quonbio0"); wrap_bio = secretbox(MK, bioWrapKey)
  stored per (user, credential) via /auth/bio. Unlock: GET /auth/bio →
  credentials.get(prf) → unwrap MK → ready. PRF-only, no weaker fallback
  (iOS 18+/current Android); the session cookie stays the auth factor — the
  PRF ceremony is key RELEASE, not authentication.
```

The server only ever holds `argon2id(authToken)` and the wrapped Master Key
(`wrap_pw`, `wrap_rec`, optional per-device `wrap_bio`). It cannot derive any
of the wrap keys, so it cannot read the user's data. For `wrap_bio` the wrap
key is not even brute-forceable: it derives from 32 bytes of hardware-held
entropy rather than a password.

### 4.6 Sync (zero-knowledge) ✅

```
On unlock:  chatKey = KDF(MasterKey)
  pull:  GET /sync/changes?collection=chat&since=<seq>
         → decrypt each blob locally, LWW-merge into history; advance the cursor
  push:  on a local save (debounced) → secretbox(session, chatKey)
         → POST /sync/push [{id, ciphertext, updated_at}]  (tombstones on clear)
```

The server stores `nonce||ciphertext` per session and resolves conflicts by
last-write-wins on the client `updated_at`. It never sees plaintext.

### 4.7 Context-aware chat (RAG) ✅

```
On send (Context toggle on, protection on):
  1. embed the query on-device → retrieve top Memory items (hybrid vector +
     lexical candidates, fused; relevance GATE; char-budgeted). Documents are
     not auto-retrieved — attached or project-pinned only.  [src/lib/rag.ts]
  2. scrub the retrieved context  → POST /scrub      (placeholders shared with the
     message's conversation map; values recorded for re-hydration)
  3. scrub the user's message     → POST /scrub      (fail-closed)
  4. inject the scrubbed context as a leading `system` turn, then stream
     POST /chat/stream { messages:[system(context), …turns], protected:true }
  5. provider sees only placeholders; the answer is re-hydrated client-side
  6. the user bubble shows a "Context used · N memories · M doc snippets" chip
```

Retrieval and ranking are 100% on-device; the only thing that leaves is the
**scrubbed** context (verified: the `/chat/stream` body carries `[AMOUNT_2]`,
`[PERSON_1]`, ... and never the real values). Context is best-effort: if
retrieval or the context scrub fails, the message still sends without context (the message scrub stays
fail-closed). Context entities are stored on the turn so a restored chat
re-hydrates and keeps unique placeholder numbers.

---

## 5. Detection pipeline (the heart) ✅

Three layers run and their results are merged before a single deterministic
replacement pass. **No layer is load-bearing alone.**

```
            ┌──────────────────────────────────────────────┐
text ──────▶│ 1. spaCy/Presidio NER   (person names, +      │
            │    built-in EMAIL/PHONE/IBAN/CC/SSN patterns) │── results ─┐
            ├──────────────────────────────────────────────┤            │
text ──────▶│ 2. GLiNER span scoring (in-process, guarded)  │── results ─┤─▶ merge
            │    names, credentials, IDs, addresses         │            │   (dedupe,
            ├──────────────────────────────────────────────┤            │    span-resolve)
text ──────▶│ 3. Regex safety net  (EMAIL/PHONE/IBAN, opt.  │── results ─┘     │
            │    amounts, addresses) — ALWAYS runs          │                  ▼
            └──────────────────────────────────────────────┘             guard chain
                                                                    (veto · validators ·
                                                                       V1 cross-check)
                                                                              │
                                                                              ▼
                                                                    Presidio Anonymizer
                                                                     (position-based replace)
                                                                              │
                                                                              ▼
                                                          scrubbed text + Entity[] report
```

**The case for a hybrid.** No single detector is trustworthy alone. Presidio's
recognizers are precise but narrow, spaCy misses whatever its training data never
labelled, and GLiNER is a _zero-shot_ span scorer, which means it matches the
concept a label names and will cheerfully tag `Notar` or `Käufer` as a person.
So EMAIL/PHONE/IBAN (and optionally amounts and addresses) are an **always-on
deterministic safety net** beneath both ML layers.

Every ML claim then passes a guard chain, and every guard fails OPEN, which
means a guard that cannot decide keeps the detection:

- **Per-claim guards:** a PERSON needs grammar evidence (a `PROPN` or an
  out-of-vocabulary token; it dies on a pronoun, a determiner, or a determiner
  child). An ADDRESS needs a digit, a street morpheme, or a `PROPN`.
- **Contrast veto:** each PERSON is re-scored against company / software /
  product / job-title labels and dropped if one of those wins.
- **Structural type validators:** a value must be _possible_ for its type.
  EMAIL needs an `@`, IBAN its shape, ROUTING ≥8 digits (a port number is not a
  routing number).
- **V1 cross-check:** every surviving PERSON gets one more GLiNER query over
  ±120 characters of context; a real score below 0.05 drops it, and no verdict
  keeps it.

There is **no LLM in this path.** The cloud PII-extraction tier was removed on
2026-08-23; `fallback_mode: true` now means the _NER layer_ did not run
(`fallback_mode = not ner_used`) and the regex net is carrying the request.

**German precision:** spaCy often tags capitalized sentence-initial verbs as
PERSON. A POS filter (`NER_PERSON_POS_FILTER`) drops single-token PERSON
candidates that aren't proper nouns, plus a denylist of salutations/verbs.

**Deliberately dropped:** NER LOCATION/ORG/DATE labels are discarded: public
cities/companies aren't PII and produce false positives. Relative durations
("3 Wochen") are dropped from DATE; concrete calendar dates are kept.

### Placeholder styles

| Style     | Output                            | Use                                |
| --------- | --------------------------------- | ---------------------------------- |
| `typed`   | `[PERSON]`, `[EMAIL]`, `[BETRAG]` | Human-readable legend              |
| `generic` | `[PII]` for everything            | Maximum opacity                    |
| `indexed` | `[PERSON_1]`, `[EMAIL_2]`         | **Default in chat**; re-hydratable |

The indexed style (regex `[A-Z]+_\d+`) is what makes client-side re-hydration
possible: each placeholder is a stable, unique handle. Indices are assigned
**conversation-wide** so the same person keeps the same number across turns.

### Entity catalog

`PERSON · EMAIL · PHONE · IBAN · ROUTING · FINANCIAL_AMOUNT · DATE · PIN ·
INTERNAL_URL · CREDENTIAL · TAX_ID · INSURANCE_ID` (served by `GET /entities`,
drives the frontend legend).

---

## 6. API reference

> **Selected endpoints, not the full surface.** The backend exposes ~80 routes
> across `main.py` (scrub, chat relay, models, settings, agents, MCP, OCR,
> feedback), `auth.py`, `account.py`, `admin.py`, `sync.py` and `shares.py`. The
> table below covers the ones that carry the architecture; the **authoritative,
> always-current list is the generated OpenAPI schema**: run the backend and
> open `/docs` (or `GET /openapi.json`).

Endpoints marked 🔒 require an active session (cookie + CSRF on writes).

| Method    | Path                                                                             | Purpose                                                                                    |
| --------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `POST`    | `/auth/register`                                                                 | Create a pending account + store wrapped keys; email a verify link                         |
| `POST`    | `/auth/verify`                                                                   | Confirm email, mint sub-key (sync, fails closed), activate, start session                  |
| `GET`     | `/auth/kdf`                                                                      | KDF salt/params for an email (dummy for unknown addresses, against enumeration)            |
| `POST`    | `/auth/login`                                                                    | Verify authToken; session; return password-wrapped Master Key                              |
| `POST`    | `/auth/logout` 🔒                                                                | Invalidate the session                                                                     |
| `GET`     | `/auth/me` 🔒                                                                    | Current account (id, email, status)                                                        |
| `GET`     | `/auth/keymaterial` 🔒                                                           | Wrapped Master Key + KDF params (unlock on this device)                                    |
| `POST`    | `/auth/reset/request` · `GET /auth/reset/material` · `POST /auth/reset-password` | Recovery-phrase password reset                                                             |
| `POST`    | `/scrub` 🔒                                                                      | Pseudonymize text; returns scrubbed text + entity report                                   |
| `POST`    | `/chat` · `/chat/stream` 🔒                                                      | Relay the scrubbed conversation to OpenRouter (per-user key); SSE stream                   |
| `GET`     | `/sync/changes` 🔒                                                               | Pull encrypted blobs since a `server_seq` (collections: chat · **memory** · **documents**) |
| `POST`    | `/sync/push` 🔒                                                                  | Upsert encrypted blobs (LWW); tombstones                                                   |
| `GET`     | `/account/usage` 🔒                                                              | User's OpenRouter usage / limit / remaining                                                |
| `POST`    | `/admin/users/{id}/or-limit` · `DELETE .../or-key`                               | Admin: raise limit / disable (bearer token)                                                |
| `GET`     | `/health` · `/entities` · `/models`                                              | Public liveness, entity catalog, model list                                                |
| `GET/PUT` | `/settings*`                                                                     | Non-secret settings (model catalog; key write-only)                                        |

The `protected` flag on chat requests selects the system prompt: a
placeholder-preserving one when the text was scrubbed, a neutral one when it
wasn't (so the model doesn't apply its own privacy heuristics to real text).

---

## 7. Configuration surface

- **Frontend:** build-time Vite vars (`VITE_QUON_*`): backend URL, master
  switch, placeholder style.
- **Backend:** Pydantic settings (`config.py`), all env-overridable. Two classes
  of value:
  - **Startup defaults** (timeouts, model names, NER flags, safety-net toggles).
  - **Runtime-mutable** (`settings_store.py`, persisted to `runtime_settings.json`):
    global OpenRouter key, model catalog, disabled model ids. Editable live from the Settings UI without a restart.
  - **Durable per-user state** lives in SQLite (`DATABASE_PATH`). Prod must set
    `QUON_SERVER_SECRET` (sub-key sealing), `COOKIE_SECURE=true`, explicit
    `CORS_ALLOW_ORIGINS` and SMTP.

See README §Configuration for the common knobs; `config.py` for the full set
with rationale.

---

## 8. Security model

| Concern             | Stance                                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chat content        | **Zero-knowledge.** E2E-encrypted with the user's Master Key; server stores ciphertext only.                                                                                   |
| Memory & Documents  | **Zero-knowledge.** Extracted/embedded/searched in the browser; synced as ciphertext (own MK-derived keys). No server-side path (the non-ZK `SERVER_ASSIST` mode was removed). |
| Master Key          | Browser-only; doubly wrapped (password + recovery phrase). Server can't derive the wrap keys.                                                                                  |
| Auth                | ✅ Real: Argon2id verifier (auth and encryption keys independent, Bitwarden-style), opaque httpOnly sessions + CSRF, email verification.                                       |
| Provider API key    | **Server-side only.** Global key + per-user sub-key (sealed at rest with `QUON_SERVER_SECRET`). Never bundled.                                                                 |
| Re-hydration map    | Browser-only; included inside the encrypted session blob.                                                                                                                      |
| Fail mode           | **Closed.** Scrubber offline means sending is paused; a provisioning failure leaves the account pending.                                                                       |
| Transport / cookies | TLS in prod (Cloudflare/Caddy); `COOKIE_SECURE=true`, `SameSite=Lax`.                                                                                                          |
| CORS                | Explicit origins required with cookies; wildcard+credentials logs a warning.                                                                                                   |
| Secrets in repo     | `.env`, `quon.db`, tunnel tokens are git-ignored.                                                                                                                              |

**Inherent limitation:** password-based zero-knowledge means a DB thief can
_offline brute-force_ the password against the Argon2id verifier and then open
the Master Key. Argon2id (64 MiB / 3 passes) makes this expensive; losing both
password **and** recovery phrase makes data unrecoverable (by design).

**Hardened since:** rate-limiting on `/auth/*` incl. the account-management
routes (`ratelimit.py`); SSRF guard for BYOK endpoints and the chat relay
`base_url` (`net_guard.py`, validated at write time **and** re-validated at
request time against DNS rebinding); auth required on global `/settings` writes;
the change-email confirm race fails closed as 409.

**Shipped since this section was first written:** an enforcing, per-request
**nonce-based CSP** sent by the SSR app itself (`src/server.ts`, production
builds only), and `/auth/*` account-enumeration defenses (dummy KDF params,
fake-success register, dummy Argon2 on unknown logins). Note that `script-src`
also carries `'unsafe-eval'` for the on-device OCR WASM engine, a documented
trade-off.

**Known gaps to harden:** audit logging; `QUON_SERVER_SECRET` rotation
procedure; provisioning-key blast radius. See §11 and
[docs/threat-model.md](docs/threat-model.md).

---

## 9. Deployment topology (reference) 🟡

The supported topology is the bundled `docker-compose.yml`, one origin with TLS
terminated by Caddy:

```
Browser → Caddy :443 (automatic TLS, ONE origin) ─┬─ /*     → frontend :8080
                                                   └─ /api/* → scrubber :8000
```

Operator guide, including TLS, SMTP, backups and upgrades:
[docs/self-hosting.md](docs/self-hosting.md).

Everything is single-origin on purpose: the `/api/*` route makes the API
same-origin with the frontend, so session cookies + CSRF are first-party (dev
mirrors this via the Vite `/api` proxy, see §7).

The container serves the built `dist/` with `deploy/serve-frontend.mjs`, which
performs **no `Host` validation**, so you can put it behind your own proxy or
a tunnel freely. (`allowedHosts` / `QUON_ALLOWED_HOSTS` in `vite.config.ts` applies only
to `vite preview` in development, not to the shipped image.) What _does_ have to
match the public origin is the backend's `APP_BASE_URL` and
`CORS_ALLOW_ORIGINS`.

The scrubber container mounts a **`quon-data` volume at `/app/data`** for the
SQLite DB (`DATABASE_PATH=/app/data/quon.db`) so accounts/sync survive restarts;
`docker-compose.yml` wires the new env (server secret, provisioning key, SMTP,
cookie/CORS). The `/api/*` Caddy route makes the API same-origin with the
frontend, so session cookies + CSRF are first-party (dev mirrors this via the
Vite proxy). The DB layer is single-instance (SQLite); see §11 for scaling.

---

## 10. Roadmap

| Feature                      | State | Notes                                                                                                                                                                                                                                                                          |
| ---------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Multi-user auth**          | ✅    | Email+password, verification, sessions, CSRF, per-user isolation (SQLite).                                                                                                                                                                                                     |
| **E2E sync**                 | ✅    | Zero-knowledge encrypted chat blobs; BIP39 recovery; LWW.                                                                                                                                                                                                                      |
| **Per-user provider keys**   | ✅    | Optional: a provisioning key mints a spend-capped sub-key per user; otherwise one shared key or BYOK.                                                                                                                                                                          |
| **Memory**                   | ✅    | Zero-knowledge: facts/notes embedded on-device (Transformers.js on the web, native Rust in the desktop app), searched locally, synced as encrypted blobs. Maintenance surfaces contradictions, restatements and stale facts for a human decision: superseding, never deleting. |
| **Documents**                | ✅    | Zero-knowledge: in-browser extract (pdf.js/mammoth), chunk, embed, store as an encrypted blob; on-device semantic query.                                                                                                                                                       |
| **Context-aware chat (RAG)** | ✅    | On-device retrieval of relevant Memory/Document snippets, **scrubbed** and injected as a system turn; the answer is re-hydrated (§4.7). Per-chat Context toggle.                                                                                                               |
| **Connectors**               | ✅    | Folder (native FS in the desktop app), email export, **IMAP live source** (desktop), Paperless, Dropbox, OneDrive, Obsidian, URL import; live-source-first (docs/extending.md).                                                                                                |
| **Chat tools**               | ✅    | First-party consented tools (own store + connected sources) and a per-user MCP client (proxied, SSRF-guarded). Threat model §3.10.                                                                                                                                             |
| **Native desktop (macOS)**   | 🟡    | Tauri shell shipping as beta: IMAP mail, real filesystem (incl. "look in this folder" chat tools), native Rust embeddings, offline. Pending: signing/notarization, auto-update. Mobile (Capacitor) next per native-apps-plan.                                                  |
| **Offline access**           | ✅    | Read-only offline resume + local unlock against cached key material (§3.6).                                                                                                                                                                                                    |
| **Admin & invites**          | ✅    | Roles, invite codes, entitlements, audit trail (metadata only).                                                                                                                                                                                                                |
| **Full Local**               | ⬜    | Protection level where _only_ on-device models answer; nothing leaves the device.                                                                                                                                                                                              |
| **Server-served `/models`**  | 🟡    | Frontend has a fixed list mirroring the backend; converge on one source of truth.                                                                                                                                                                                              |

---

## 11. Open questions for brainstorming

These are the live architecture debates, good fodder for a parallel design
session while implementation continues.

### Detection & correctness

- **False-negative budget.** What recall target per entity type is "good enough"
  for a privacy tool? The measurement side is answered: 58 golden cases plus a
  ~1500-case synthetic corpus, reported as leak rate with Wilson intervals and
  locked by per-type ratchet floors (`quon-scrubber-service/tests/test_corpus.py`).
  The open part is the target itself: which types justify a false-positive cost
  to push recall higher.
- **Re-identification risk.** Indexed placeholders preserve structure
  (`[PERSON_1]` consistent across a conversation). Does that consistency itself
  leak (e.g. a model inferring relationships)? Trade-off vs. natural answers.
- **Cross-message coherence.** Indices are conversation-wide today. How does this
  survive editing/branching/regenerating a turn?
- **Reversibility attacks.** Could a malicious provider craft answers that
  smuggle out info via placeholder ordering/counts? Worth a threat model.

### Full-local mode

- What's the smallest on-device chat model that's actually useful, and how do we
  present the quality/privacy trade-off in the UI?
- Does "Full Local" add an on-device LLM for _chat_? On a
  single-box self-host that contends with the detection models for RAM/CPU.

### Architecture & scaling

- **SQLite is single-instance.** Multi-user auth + per-user keys + E2E sync are
  built, but on one SQLite file. Scaling out (multiple replicas) needs Litestream/
  rqlite or a move to Postgres. When does that become necessary?
- **Sync conflict merging is out of scope** (LWW per chat session). Concurrent
  edits on two devices silently drop one. Worth CRDTs / per-message granularity?
- **Provisioning-key blast radius:** one management key mints/deletes every
  sub-key. Rotation + storage hygiene + per-user spend monitoring?
- Should re-hydration ever move server-side for non-browser clients (API,
  mobile)? That breaks the "Master Key never leaves the browser" invariant; is
  there a middle ground (per-session ephemeral map)?

### Memory & Documents

- **RAG retrieval quality.** Injection is wired (§4.7) with a fixed top-k +
  score-floor + char budget. Open: tune these per corpus, add re-ranking, and
  decide whether multi-turn queries should re-retrieve or reuse prior context.
- **Cross-turn / context placeholder coherence.** Context and message are scrubbed
  separately, so the same entity can get different placeholder numbers across a
  turn (same limitation as cross-message coherence). Re-hydration is still correct;
  a shared dedup-by-value pass would tighten it.
- **Browser embedding cost.** The multilingual model is larger than an
  English-only one on first load and CPU
  embedding of a large PDF is slow. Worth a WebGPU path, a smaller model, or a
  progress UI for big documents?
- _(Resolved:_ local cache size. Memory/Documents/Projects moved from
  `localStorage` to **IndexedDB** (`lib/idbStore.ts`), and since 2026-07-03 all
  device caches are **encrypted at rest** via `lib/localVault.ts`._)_
- _(Resolved:_ trust model. Memory/Documents are **zero-knowledge, client-side**
  (encrypted `blobs`, in-browser embeddings/extraction); the former server-side
  `SERVER_ASSIST` mode was removed entirely on 2026-07-02._)_

### Product / UX

- Surfacing `fallback_mode` (NER layer down) clearly enough that users
  understand "names may be missed" without alarm fatigue.
- Per-entity-type protection (e.g. keep amounts, redact names): worth the
  complexity?

---

## 12. Glossary

- **PII**: personally identifiable information.
- **Placeholder / token**: `[PERSON_1]`, an opaque stand-in for a redacted value.
- **Re-hydration**: mapping placeholders back to real values, client-side.
- **Safety net**: the always-on deterministic regex layer (never fails open).
- **Cross-check**: the V1 verifier: a second GLiNER query over a PERSON
  claim's context, which must not refute it.
- **Fallback mode**: response state when the NER layer did not run; the
  deterministic regex net still stands.
- **Fail closed**: refuse to send rather than send unprotected.
- **Master Key (MK)**: per-user random key that encrypts all of a user's data;
  lives only in the browser, wrapped twice (password + recovery phrase).
- **Wrap**: encrypting the MK under a password- or recovery-derived key so the
  server can store it without being able to open it.
- **authToken**: high-entropy value derived from the password, sent to the
  server (stored only as an Argon2id verifier); distinct from the wrap key.
- **Recovery phrase**: a BIP39 12-word mnemonic; the only way to recover the MK
  if the password is lost.
- **Sync blob**: one chat session encrypted into opaque ciphertext; the unit of
  zero-knowledge sync (last-write-wins by `updated_at`).
- **Zero-knowledge**: the server stores/relays data it cannot read.
