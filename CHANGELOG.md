> **Note.** This document also covers features that are not part of this repository yet — connectors, chat tools and MCP, agents, shared projects, the desktop and Android apps. They follow once they are ready.

# Changelog

All notable changes to QUON are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
once it reaches 1.0.

## [Unreleased]

### Added

- **Open-source release (AGPL-3.0).** The privacy gateway — detection, the
  filtered chat, accounts, encrypted sync, memory, documents, projects and the
  self-host stack — is published under the AGPL. Features still under review
  (connectors, chat tools, agents, URL import, the briefing, the native apps)
  follow later; they register in three registries (`optional_features.py`,
  `features.ts`, `syncExtras.ts`) instead of being wired into screens.
- **E-mail verification is optional.** `EMAIL_VERIFICATION=auto` (default)
  verifies by mail when SMTP is configured and otherwise activates accounts
  on creation — a home server needs no mail relay. The invite-code field
  appears only on instances that require one.

### Fixed

- **GLiNER loads on a fresh install.** On a machine that had never run QUON
  before, the third detector failed to load (its tokenizer conversion needs
  `protobuf`, which only ever arrived by accident) and detection silently ran
  without it while the flag said it was on. The package is now a declared
  requirement, and the tests that cover GLiNER skip — instead of failing —
  on a box where it is genuinely unavailable.
- **„Schau in diesen Ordner" works in one go** (desktop app). After picking
  the folder, the model was told to list its files but did not have that tool
  until the next message.
- Folder and mail actions show German names in the German interface instead of
  „Pick folder" / „List folder files".
- **A pasted key from the wrong provider no longer breaks every chat**
  (feedback #84, #91). After the „Budget fast aufgebraucht" banner two users
  added their own key under Settings — one from OpenAI or Anthropic, not from
  OpenRouter. QUON stored it, used it instead of the included key, and every
  chat failed with „API-Schlüssel abgelehnt". A key is now checked when you
  save it: it must be an OpenRouter key (sk-or-…) and OpenRouter must accept
  it, otherwise you see what is wrong right there and nothing is stored. The
  banner and the settings hint now say „OpenRouter-Schlüssel". And an own key
  can now be REMOVED again from the settings card („Schlüssel entfernen") — the
  included credit is used again at once.

- **Projects, memory and documents no longer vanish on a device after the
  browser cleared its cache** (feedback #88). On a phone under storage
  pressure the browser can evict QUON's local database while keeping the
  small bookkeeping that says „already synced up to here" — so the app never
  asked the server again and the screens stayed empty. QUON now notices a
  missing database and pulls everything back from the server. It also asks
  the browser to keep its storage, and an update in one open QUON window no
  longer locks the database for another.

- **A silent connection no longer hangs the answer** (feedback #85). On a
  mobile connection the stream could stay open without delivering a single
  byte, and the chat showed „Antwort wird erstellt…" indefinitely while the
  server had long finished. The app now notices when nothing — not even the
  server's keep-alive — has arrived for a minute, reconnects, and picks the
  answer up where it left off.
- **The protection status is the same everywhere** (feedback #87). The pill
  in the menu and the badge in the header could disagree („Geschützt" next to
  a red shield) because every indicator ran its own check with its own
  result. There is one check now, and every indicator shows its answer — which
  also removes the burst of parallel status requests on every app start.

- **A provider refusal was shown as „Verbindung verloren"** (feedback #84).
  When the AI provider rejected a request outright — for example because the
  account's API key was refused — the chat tried five times to resume a stream
  that had already answered, then reported a lost connection. You now see the
  real reason straight away („Der KI-Anbieter hat den API-Schlüssel dieses
  Kontos abgelehnt …"), and the server log names the upstream reason so the
  operator can fix the key.

### Added

- **QUON can organize a folder you opened** (desktop app only). After you pick
  the folder, the model can create subfolders, create new notes (.md, .txt,
  .csv) and move or rename files and folders — „Leg mir eine Ablagestruktur an
  und sortier meine Notizen ein" now works end to end. You approve every
  request on a card that shows every folder, every move and the full content
  of every new file. QUON never deletes anything and never overwrites or edits
  an existing file, so everything it does can be undone by moving back; it
  cannot leave the folder you picked.
- **Image generation** (feedback #79). Pick an image model in the model
  picker — it carries an „Bild" badge — and describe the picture; the answer
  comes back with the image, which you can download. Your prompt is protected
  exactly like any message (personal data is replaced on the device before it
  leaves). The picture itself is stored encrypted like a document original —
  on this device at once, and synced to your other devices in the background —
  never inside the chat text. Deleting the chat deletes its pictures.

- **Android shell (Capacitor)** — `android/` builds the same prerendered client
  the macOS app ships into an Android app with a secure-context WebView, native
  HTTP (own cookie jar, no CORS) and QUON launcher icons. Build with
  `npm run android:build` and Android Studio; see `docs/android.md`. Background
  agents, folder access, the native embedder and the Play listing are the next
  phase.
- **Android: the answer streams, and survives switching apps.** Capacitor's
  native HTTP buffers whole responses, so the first build showed the answer
  only at the end and, after a switch to another app, "model provider error"
  instead of picking the answer up again. The chat stream now goes through
  QUON's own native plugin (`StreamHttp`): tokens arrive as they are
  generated, the connection keeps reading on a native thread while the app is
  in the background, and the existing resume path re-attaches if it was cut.
- **Check & redact an attachment before it is sent** (feedback #72). The
  staged attachment chip has a „Prüfen & schwärzen" button that opens the real
  document viewer — rendered PDF pages, the Detection preview, select-to-redact
  — in Filter mode too, not only in Review. For a document from your library a
  redaction is saved on the document as before; for a fresh upload, a Paperless
  document or a combined attachment it applies to that one message, enforced
  through the same verified `always_redact` path, and the button says so
  („In dieser Nachricht schwärzen"). Review's „Original ansehen & schwärzen"
  now works for every attachment, not just single library documents.
- **Links in chat can be read.** Paste a URL and the model can fetch the public
  page through the `read_url` tool — the same server-side, SSRF-guarded fetch
  Documents already used. The consent card states that the QUON server sees
  the URL; private and app-only links are refused honestly.
- **Math renders.** `$\rightarrow$`, `$E = mc^2$` and `$$ … $$` are typeset
  (KaTeX, loaded only for answers that contain TeX) instead of printed raw.
- **Detection status where the setting is made** (feedback #54): the Detection
  tab now says whether the engines are up and what they are, and links to how
  detection works.
- **Admin sees credit used per account**, not only the cap.
- **Recovery-kit PDF has a copyable line**: all twelve words in order in one
  text run, so a drag-select pastes correctly (the numbered grid copied out of
  order).
- **Diagnostics record the send path**: every failed API request (path and
  status, never a body), the shape of each send, and the page's lifecycle
  (visibility, network, back/forward-cache restore). Two iPhone reports of
  "Fehler beim Senden" had arrived with logs containing nothing but crash
  markers.

- **Trust page (`/trust`)** — the data flow as a picture, with the filter as the
  hero: what leaves the device, what never does, and where each step runs.
- **Detection preview in documents** — the filter's hits painted directly into
  the document, so you can see what would be redacted before you attach it.
- **Scrub progress** — long documents show how far the on-device scrub has got
  instead of an indeterminate spinner.
- **Redact lists explain themselves** — the "always"/"never redact" settings now
  state how each list is applied.

- **Native macOS app (beta)** — the same codebase in a Tauri v2 shell. Features
  ask for a _capability_, never a platform (`src/lib/platform/`): host-side HTTP
  without CORS, IMAP, real filesystem access, and native embeddings.
- **E-Mail (IMAP) as a live source** (desktop app only) — search the mailbox
  from QUON, read single mails on demand, import only what you pick. The session
  is read-only by protocol (EXAMINE + BODY.PEEK) and the password lives in the
  OS keychain, never in JS. Never a bulk mirror.
- **"Look in this folder"** (desktop app only) — point the chat at a folder and
  let it list, read and import single files. Tool arguments resolve against the
  enumerated listing, never as filesystem paths, and a grant dies with the app run.
- **Native embeddings in Rust** — the desktop app runs the same quantized
  multilingual MiniLM through ONNX Runtime instead of loading a WASM ML runtime
  into the webview. Retrieval-equivalent with the browser path, so vectors from
  both mix in one store.
- **Connectors**: Dropbox and OneDrive (browser-direct, OAuth/PKCE), Paperless-ngx,
  local folders, `.eml`/`.mbox` email exports, and "add a URL as a document".
  All read-only, all landing as encrypted documents.
- **Chat tools + MCP client** — with your consent per action, the model can search
  and read your own stores and connected sources, and save or import what you
  approve. Read tools can be remembered; write tools always ask and show exactly
  what would be written. Per-user MCP servers are proxied and SSRF-guarded.
- **Agents** — scheduled web-watches, server-side or on-device, results sealed to
  your identity key.
- **Offline access** — a warm app resumes read-only from the encrypted local
  caches; a cold start still unlocks with your password or biometrics.
- **Mermaid diagrams** render as diagrams, including the untagged blocks models
  emit, with a switch back to the source.
- **Memory maintenance** — contradictions, restatements and stale facts are
  surfaced for a human decision; picking a winner supersedes, never deletes.
- **Admin panel** — invite codes, users, entitlements, storage stats and an audit
  trail (metadata only).
- Smaller: web search with source previews, a daily
  briefing with optional `.ics` calendar subscription, artifacts, resumable chat
  streams, a reasoning-effort control, gallery multi-scan, document pinning and
  renaming, and a beta feedback channel.

### Changed

- **The microphone button now points at your keyboard's dictation** instead of
  running a speech engine. QUON's own engines are gone: the Web Speech API
  looks like on-device dictation but is a cloud service — Safari uploads the
  audio to Apple, Chrome to Google — which would have sent raw, unscrubbed
  speech to a third party before the filter ever saw it, and audio cannot be
  filtered. It was also unavailable in the installed iPhone app and failed on
  macOS without Siri and a separate system permission. The keyboard's mic key
  runs on your device, needs no download and no permission from QUON, works
  everywhere including the installed app — and QUON only ever receives the
  finished text. Tapping the button tells you where that key is on your device.

- Attachment budget raised from 50k to 200k characters; long documents are
  scrubbed as parallel pieces (measured, not assumed).
- **Detection is now entirely in-process.** The pipeline is spaCy/Presidio NER +
  GLiNER + a deterministic regex net, followed by a guard chain (contrast veto,
  structural type validators, and a V1 cross-check that re-scores every PERSON
  claim against ±120 characters of its context). Every guard fails open.
- `fallback_mode: true` **changed meaning**: it now reports that the NER layer
  did not run. It previously reported that the LLM enrichment layer was
  unavailable.

### Removed

- **`openrouter/fusion`** is gone from the model catalog — it misbehaved too
  often. Operators: it is also stored in the device-local `runtime_settings.json`
  on existing instances, which overrides the code; remove it there too.

- **BREAKING — the Azure DevOps work-item integration is gone.** The connector
  card, the five `*_work_item` chat tools and the `dev.azure.com` /
  `*.visualstudio.com` CSP allowance were all removed. If you had it connected,
  **your stored Personal Access Token is deleted automatically** on first load —
  from this browser's cache and from the synced `prefs` blob, so it does not
  linger in ciphertext with no UI left to remove it. Revoke the token in Azure
  DevOps as well if you no longer need it; QUON cannot revoke it for you.

- **BREAKING — the LLM PII-extraction tier is gone.** Detection no longer calls
  any model provider, and `LLM_ENRICHMENT`, `PII_BACKEND`, `PII_CLOUD_MODEL` and
  every `OLLAMA_*` variable are read by nothing; remove them from your `.env`.
  `PUT /settings/pii` was removed with it, and the PII-engine card is gone from
  Settings. Consequences for operators: a chat message is billed **once** now,
  not twice, and no prompt text leaves the machine for detection.

### Fixed

- **Landscape scans no longer come back as garbage.** The on-device reader
  only recognises upright horizontal lines, so a page photographed or scanned
  sideways (or upside down) was read letter-salad. When the first pass looks
  sideways (tall text boxes) or reads poorly, the photo is now turned and read
  again — up to three more passes — and the best reading wins.
- **Photos can be attached through „Dokument anhängen" too** (feedback #77,
  #78). The chat paperclip's document picker accepted no image type, so an
  Android picker greyed out every JPG — it read as "images can't be uploaded".
  A photo picked there now goes through the same scan-and-review as the camera
  and gallery entries.

- **iPhone: the app no longer dies at every boot** (feedback #68, #76 —
  Safari's „Auf … ist wiederholt ein Problem aufgetreten"). Three things loaded
  or retried far too much on a 4 GB phone: every screen pre-loaded the
  on-device embedding model (113 MB model, 16 MB tokenizer, ~23 MB runtime
  WebKit compiles) on open; documents indexed under an older model were
  re-embedded on every chat open; and a large document's original was pushed
  to the server at every boot, held three times over in memory — each one
  killed the page and was retried on the next boot, for days. On iPhones and
  other low-memory devices the model now loads only when something needs it,
  embeds in smaller batches and is released after a minute idle; the
  re-embed pass never loads it by itself; originals over 8 MB stay on the
  phone (a notice says so — open the document on a computer once and it
  syncs). And on ANY device, two short-lived crashes in a row switch the next
  boot into a safe mode that skips all optional background work, so a loop
  cannot continue. The diagnostics log now records the numbers (documents,
  chunks, memory items, pending originals, storage, policy) and a 5 s
  heartbeat, so the next report says what the device was carrying.

- **The document viewer's redaction confirmation vanished.** After „Immer
  schwärzen" the button unmounted with the cleared selection and took its own
  „gespeichert — N Stellen" line with it, so the viewer never showed the
  outcome it promises. It stays now; a fresh selection resets it.

- **Dictation had never worked** (the on-device Whisper decoder never created
  a session, and the failure was invisible on phones); replaced by the
  keyboard's dictation — see Changed.

- The native app's "black flash" restarts: macOS was killing the webview for CPU,
  and the WASM ML runtime was the cost. Chat drafts now also survive a restart.
- A lost passkey (eaten by an OS update) is detected and a new one offered.
- Cross-device chat loss caused by a sync cursor that skipped other devices' writes.
- Numerous detection false positives on technical identifiers and kinship terms.

### Security

- **Dependency round of 2026-10-30.** Every advisory with a compatible fix was
  taken: TanStack Start (reflected XSS in server-function responses, critical),
  DOMPurify (five IN_PLACE / template bypasses, critical), seroval, xmldom,
  adm-zip, js-yaml, brace-expansion, source-map-js, sharp (libvips), undici and
  Vitest's mocker. An unused direct `zod` dependency was removed rather than
  migrated. Two low/moderate findings without a compatible fix (KaTeX via
  Mermaid, uuid via the Capacitor CLI) carry dated exceptions until the
  Mermaid 12 and Capacitor 8.6 bumps are verified.
- The minimum-release-age supply-chain guard now actually runs
  (`scripts/check-release-age.mjs` in CI). It previously lived in a bun config
  that nothing in this project ever executed.

## [0.9.0] – 2026-07-19

First source-available release (Business Source License 1.1). Baseline feature
set at the time of publication:

### Added

- **Zero-knowledge private chat** with frontier LLMs: PII (names, emails,
  phones, IBANs, amounts, dates, PINs, credentials, tax/insurance IDs) is
  detected and replaced with typed placeholders before anything reaches a model
  provider, then re-hydrated locally in the answer. Hybrid detection —
  spaCy/Presidio NER + an always-on regex safety net + optional LLM enrichment
  (cloud via OpenRouter or local via Ollama) — with fail-closed behavior when
  the scrubber is unreachable.
- **Protection levels**: None → Filter (default) → Review (manual approval of
  every redaction before sending), with per-message redaction transparency and
  inline PII highlighting.
- **Accounts with end-to-end encryption**: Argon2id-derived Master Key (never
  sent to the server), wrapped under password and a BIP39 recovery phrase;
  chat history synced across devices as opaque ciphertext; device caches
  encrypted at rest; enforcing nonce-based CSP in production.
- **Memory & Documents (zero-knowledge)**: notes and uploaded files (PDF,
  DOCX, TXT, MD, CSV, JSON, HTML) are extracted, chunked, and embedded
  entirely in the browser (Transformers.js, multilingual embeddings), searched
  semantically on-device, and synced only as encrypted blobs. Includes an
  in-app document viewer with original-layout PDF/DOCX rendering.
- **Context-aware chat (RAG)**: relevant memory/document snippets are
  retrieved on-device, scrubbed before leaving the browser, injected into the
  prompt, and re-hydrated in the answer — with a per-chat toggle and a
  "context used" indicator.
- **Projects**: group chats with strictly scoped per-project memory,
  documents, instructions, and chat defaults.
- **Shared Projects v1**: end-to-end encrypted, read-only project sharing
  between accounts on one instance — project keys exchanged via sealed-box
  grants, invite keys carried in the URL fragment (never sent to the server).
- **Photo OCR**: photograph letters or contracts to text, fully on-device
  (German + English), with an editable review step — plus an explicit,
  per-photo opt-in cloud fallback for hard cases (EXIF-stripped, pinned to
  zero-data-retention routing, never stored).
- **Biometric unlock**: Face ID / Touch ID / fingerprint via WebAuthn PRF —
  hardware-released key material wraps the same Master Key, with no weaker
  fallback.
- **Internationalization**: full German/English UI (German default),
  account-bound language preference, bilingual transactional emails.
- **Bring your own provider (BYOK)**: per-user OpenAI-compatible endpoints
  (SSRF-guarded, keys sealed at rest) alongside the OpenRouter catalog; per-user
  settings for PII backend and model routing; optional auto-provisioned,
  hard-capped per-user OpenRouter sub-keys for hosted instances.
- **Personal redaction lists**: per-user "never redact" and "always redact"
  entries; per-message one-shot "resend without filter" escape hatch.
- **Connectors v0**: read-only Obsidian vault import, fully client-side.
- **Quality & supply-chain CI**: typecheck/lint/unit/build, backend test
  suite, a ~1,500-case detection corpus with enforced recall/precision ratchet
  floors, cross-browser end-to-end tests (Chromium + WebKit), SBOM generation,
  license gating, and vulnerability scanning.
