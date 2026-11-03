> **Note.** This document also covers features that are not part of this repository yet: connectors, chat tools and MCP, agents, shared projects, the desktop and Android apps. They follow once they are ready.

# QUON Threat Model

QUON is a zero-knowledge privacy gateway for chatting with frontier LLMs:
personal data is detected client-side, replaced with typed placeholders before
anything reaches a model provider, and re-hydrated locally in the answer. Chat
history, Memory, Documents, and Projects are end-to-end encrypted in the
browser; the server stores only opaque ciphertext.

This document describes what QUON protects, from whom and how, and also
what it does **not** protect against. It should be read alongside
[ARCHITECTURE.md](../ARCHITECTURE.md) (especially §4 data flows, §5 detection
pipeline, and §8 security model).

---

## 1. Assets

| Asset                                             | Where it lives                                                                                                                                                                                                                                         | Sensitivity                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| **Master Key (MK)**                               | Browser memory only (plus `sessionStorage` for reload survival). Stored server-side only in wrapped form: `wrap_pw` (password-derived key), `wrap_rec` (BIP39 recovery-phrase-derived key), optional per-device `wrap_bio` (WebAuthn-PRF-derived key). | Critical; unlocks everything below.      |
| **Plaintext chats, Memory, Documents, Projects**  | Browser only. Synced as `secretbox` ciphertext blobs under MK-derived per-collection keys; device caches (localStorage/IndexedDB) are also sealed under a MK-derived cache key.                                                                        | Critical                                 |
| **Raw PII in prompts**                            | Exists in plaintext only in the browser and transiently on the scrubber during `/scrub` detection. The model provider sees placeholders, never values.                                                                                                 | Critical                                 |
| **Re-hydration map** (`[PERSON_1]` to real value) | Browser only; persisted inside the encrypted session blob.                                                                                                                                                                                             | Critical                                 |
| **Provider API keys**                             | Server-side only: the operator's global OpenRouter key, per-user provisioned sub-keys, and per-user BYOK keys; the latter two are sealed at rest with `QUON_SERVER_SECRET`. Never sent to the browser.                                                 | High                                     |
| **Account metadata**                              | Server: email address, Argon2id auth verifier, session records, blob timestamps/sizes, usage counters.                                                                                                                                                 | Moderate; see residual risks (metadata). |
| **Recovery phrase**                               | User-held (printable recovery kit). Never sent to the server.                                                                                                                                                                                          | Critical                                 |

---

## 2. Trust boundaries

```
┌────────────────────┐   scrub / relay / sync    ┌──────────────────┐   scrubbed text only   ┌─────────────────┐
│  Browser (trusted) │ ────────────────────────▶ │  QUON server     │ ─────────────────────▶ │  Model provider │
│  MK, plaintext,    │   ciphertext blobs +      │  (semi-trusted)  │   placeholders +       │  (untrusted for │
│  re-hydration map  │   raw text for /scrub     │                  │   non-PII context      │   PII)          │
└────────────────────┘                           └──────────────────┘                        └─────────────────┘
         ▲ TLS (reverse proxy / tunnel in between — network is untrusted)
```

- **Browser**: the trusted computing base. All encryption, embedding, semantic
  search, document extraction, OCR, and re-hydration happen here.
- **QUON server (scrubber service)**: trusted with _transient_ raw prompt text
  during detection, and with provider keys. Detection is entirely in-process
  (NER + GLiNER + regex): since 2026-08-23 `/scrub` forwards text to no one, so
  raw text never leaves this boundary. **Not** trusted with stored content: sync
  blobs are opaque ciphertext, and the server never holds an unwrapped Master
  Key.
- **Model provider** (OpenRouter or a user-configured OpenAI-compatible
  endpoint): never trusted with PII. Receives scrubbed text with placeholders.
- **Network path** (CDN/tunnel/reverse proxy): untrusted; TLS end to end,
  `Secure`/`SameSite` cookies, CSRF tokens on writes.

Note the deliberate asymmetry (ARCHITECTURE §2): stored content is
**zero-knowledge** (user-controlled keys), while provider keys are a
**server-side secret** (sealed with `QUON_SERVER_SECRET`); the relay must be
able to use them, so they cannot be zero-knowledge.

---

## 3. Adversaries and mitigations

### 3.1 Honest-but-curious server operator

_Capabilities:_ full read access to the database, logs, and server filesystem;
observes traffic passing through the relay.

_What they can learn:_ account emails, timing/size metadata, model choices, and
the **scrubbed** text of prompts in transit (placeholders plus non-PII
content). They cannot read chat history, Memory, Documents, or Projects; those
are ciphertext under keys derived from the Master Key, which the server never
holds unwrapped.

_Mitigations:_

- Master Key generated in the browser; server stores only wrapped copies
  (`wrap_pw`, `wrap_rec`, `wrap_bio`). Auth uses a separate Argon2id-hashed
  authToken, so authentication is cryptographically independent of the
  encryption keys.
- Sync stores `nonce||ciphertext` blobs per collection; the re-hydration map
  travels inside the encrypted blob, so placeholders in relayed traffic cannot
  be resolved server-side from stored data.
- Per-user provider keys are sealed at rest with `QUON_SERVER_SECRET`.

_Documented retention change (resumable streams, 2026-08):_ a chat generation
now runs in a background task that buffers its event stream **in RAM** under a
random, user-scoped job id, so a phone that gets backgrounded (page frozen,
socket dropped) can re-attach instead of losing the answer. The buffered events
are exactly the **scrubbed, placeholder-only** tokens the relay already
forwards; re-hydration is client-side, so the buffer cannot hold real values.
What changes is retention: from seconds in flight to up to `JOB_TTL_SECONDS`
(15 min) in memory, capped per user, never written to disk, and gone on
restart (after a restart, resume returns 404 and the client falls back to its
Retry path). An operator with live process access could read a buffered
in-flight answer, the same scrubbed text they can already observe passing
through the relay; this widens the window, not the content.

_Residual:_ a database thief (or the operator) can attempt an **offline
brute-force** of a user's password against the Argon2id verifier and then open
`wrap_pw`. Argon2id (64 MiB, 3 passes) makes this expensive, not impossible;
password strength matters. The `wrap_bio` wrap key derives from 32 bytes of
hardware-held PRF entropy and is not brute-forceable this way.

### 3.2 Fully compromised or malicious server

_Capabilities:_ everything above, **plus** the ability to modify server
behavior and, above all, to serve modified client code.

This is the classic web-E2EE caveat, and we state it honestly: **the server
ships the JavaScript that implements the client-side encryption.** A malicious
operator (or an attacker with full server control) can serve a backdoored
client that exfiltrates the Master Key or plaintext on unlock. Browser-based
end-to-end encryption protects against a _curious_ or _breached-at-rest_
server; it cannot protect against a persistently malicious code-serving origin.
Mitigating this fully requires out-of-band client distribution (signed
packaged app, browser extension with pinned code), which is not currently built.

_Partial mitigations:_ self-hosting (you are the operator, so you trust the
code you deploy, which is the intended posture for a self-hosted release), and
open source code that can be audited and diffed against what an instance
serves.

A malicious server can also: drop or reorder sync blobs (denial of service /
rollback; clients merge last-write-wins and would not detect a targeted
rollback), refuse scrubbing (the client then **fails closed** and blocks
sending rather than forwarding raw text), and log scrubbed prompt text in
transit.

### 3.3 Network attacker

_Capabilities:_ observe, modify, or inject traffic between browser, server, and
provider.

_Mitigations:_

- The scrub-only demo (`POST /demo/scrub`, off by default) is the one
  endpoint that runs the detector without a session. It is capped in length,
  rate-limited per IP and for all visitors together, stores nothing and calls
  no model; an attacker gets a redaction service and nothing else.
- TLS on all hops; the reference deployment exposes no inbound ports (outbound
  tunnel only).
- Session cookies are opaque, `httpOnly`, `Secure`, `SameSite=Lax`;
  state-changing requests require a CSRF token.
- Stored content is end-to-end encrypted independently of TLS; a TLS break
  exposes scrubbed prompts and ciphertext blobs, not stored plaintext or keys.
- `CORS_ALLOW_ORIGINS` must be explicit in production (wildcard + credentials
  is rejected with a warning).

### 3.4 Malicious or curious model provider

_Capabilities:_ sees everything the relay sends, i.e. the scrubbed conversation:
typed placeholders (`[PERSON_1]`, `[IBAN_1]`, ...), all non-PII text, scrubbed
RAG context, and the system prompt.

_What is protected:_ detected PII values never reach the provider. Assistant
turns are re-sent to the provider in their **placeholder** form (not the
re-hydrated text), so history replay does not leak either.

_What is not protected (semantic leakage):_ the surrounding context is real
text. "My [PERSON_1] has [diagnosis] and works at the courthouse in [small
town]" can be deanonymizing even with perfect detection. Indexed placeholders
are stable across a conversation by design (that is what makes re-hydration
and natural answers work), so a provider can track that `[PERSON_1]` in turn 1
is the same entity in turn 12 and accumulate attributes against it
(co-reference inference, see §5). Users handling highly sensitive material
should treat scrubbing as strong PII _value_ protection, not content
anonymization.

_Mitigations:_ hybrid detection with a deterministic always-on safety net
(§3.9 below); Review mode for manual inspection/override before sending; the
"always redact" personal list; per-user BYOK so users can choose a provider
they trust; opt-in cloud OCR pinned to zero-data-retention routing.

### 3.5 XSS attacker

_Capabilities:_ execute script in the app origin, the single most dangerous
client-side attack, since the Master Key lives in browser memory.

_Mitigations:_

- **Enforcing, nonce-based CSP** on production HTML responses: the server
  mints a per-request nonce, the SSR framework tags every inline script with
  it, and the matching `Content-Security-Policy` header is set on the
  response. `connect-src` is a tight allowlist (self + the model-download CDNs
  the in-browser ML needs), which also throttles exfiltration paths.
- React's default output encoding; rendered HTML from documents (DOCX/HTML
  viewing) passes through a sanitizer.
- **Mermaid diagrams in answers** are the one place MODEL output is injected as
  markup (`dangerouslySetInnerHTML` with generated SVG,
  `src/components/quon/MermaidBlock.tsx`). Diagram source is untrusted twice
  over: it is model output, and the model may have been quoting an attacker's
  document. There are two independent barriers: mermaid runs with
  `securityLevel: "strict"` (labels sanitised, `click` handlers refused;
  `src/lib/mermaid.ts`), and the nonce-based CSP forbids inline script execution
  regardless, so even a sanitizer escape yields inert markup rather than script
  in the app origin. Detection of untagged diagram blocks is deliberately
  conservative (a known keyword must start the first line), so ordinary code
  blocks are never routed into the renderer.

_Documented trade-off:_ `script-src` carries **`'unsafe-eval'`**. The
on-device photo-OCR engine is an Emscripten/embind WASM build whose runtime
requires `new Function()`; `'wasm-unsafe-eval'` alone does not cover it, and
the engine's Web Worker inherits the document CSP. This weakens CSP's
mitigation of _injected inline_ code paths; the nonce requirement on script
elements remains the primary barrier. The planned clean fix is isolating the
OCR engine in a separate-origin sandbox so the main app can drop
`'unsafe-eval'` again.

_Documented trade-off (user-chosen connector origin in `connect-src`, 2026-07):_
saving a network connector (Paperless) stores its ORIGIN (never the token)
in a plain cookie; the SSR entry appends that origin to `connect-src` after a
hard shape check (exactly one `https://host[:port]` or plain-http loopback, no
path/wildcard, bounded length; `src/lib/cspExtra.ts`). Costs, accepted
deliberately so hosted users can attach their own archive without operator
involvement: (a) the frontend server/operator learns the connector hostname
(the cookie rides every request; metadata only, content stays browser-direct);
(b) an attacker who ALREADY has XSS in the session gains that one user-chosen
origin as an exfiltration target. The validator is unit-tested as a security
boundary; a malformed cookie is ignored and can never break page delivery.

### 3.6 Other users of the same instance

_Capabilities:_ a registered account on the same server.

_Mitigations:_

- Per-user data isolation on every authed route (sessions resolve to a user
  id; blobs, keys, and usage are user-scoped).
- **Per-user settings:** BYOK endpoints and provider keys are per-user
  overrides over the operator default; one user's endpoint choice only ever
  routes _their own_ text, never anyone else's.
- SSRF guard on user-supplied endpoint URLs (BYOK chat endpoints),
  validated at write time and re-validated at request time against DNS
  rebinding.
- Rate limiting on `/auth/*` and other sensitive routes.
- Account-enumeration defenses: `/auth/kdf` returns shape-correct dummy
  parameters for unknown emails, login runs a dummy Argon2 for unknown
  accounts, and registration fake-succeeds for taken addresses (with a notice
  email to the real owner).
- Provisioned provider sub-keys are per-user and hard-capped, limiting
  cross-user cost abuse.

### 3.7 Shared-project member (Shared Projects v1)

_Capabilities:_ an invited account holding a valid grant for a shared project.

_Design:_ sharing is end-to-end encrypted: items re-encrypt under a random
project key delivered via sealed-box grants to each member's X25519 identity
key; invite links carry the key in the **URL fragment**, which never reaches
the server.

_v1 limitations (by design, documented in the UI):_

- Invitees are **read-only**; the server additionally rejects reader writes.
- Chats are never shared; original document bytes stay device-local.
- **Revoking is not key rotation:** revoking a member removes their grant and future
  access, but a member who already held the project key could retain
  ciphertext they previously synced. Treat revocation as access removal going
  forward, not retroactive secrecy.
- Invite links are bearer tokens (single-use): anyone who obtains an unused
  link can join as the invitee. There is no independent identity verification
  of the joining account (trust-on-first-use, see §5).

### 3.8 Malicious or compromised MCP tool server

Users can register their own MCP (Model Context Protocol) tool servers; tools
run in chats behind a consent gate. A hostile tool server is a real adversary:
it _legitimately_ receives re-hydrated arguments after consent, and its
results re-enter the model conversation.

_What it can do:_

- Read every argument the user approved (shown re-hydrated in the consent
  dialog precisely so the user knows this).
- Return **prompt-injection payloads** in tool results, trying to steer the
  model or trigger further tool calls.
- Exfiltrate nothing beyond what was consented; it never sees the Master
  Key, stored content, or the conversation.

_Mitigations:_

- **Consent gate per call** (default deny; "always allow" is per-tool,
  per-device, sealed at rest). A backgrounded chat auto-denies.
- Tool **results are scrubbed** like user input before they re-enter the
  relay, with collision-free placeholder folding, so the model provider never
  sees raw tool output; if the scrubber is unreachable the result is
  **withheld (fail-closed)**, never forwarded raw.
- Tool-call rounds are capped per message (loop bound), the proxy is
  rate-limited, SSRF-guarded (write + request time), and the server's auth
  secret is sealed under `QUON_SERVER_SECRET`, never sent to the browser.
- Residual risk: prompt injection inside scrubbed results can still influence
  the model's _text_, but any follow-up tool call it provokes hits the
  consent gate again.
- Transport honesty: tool traffic transits the QUON backend proxy (the user's
  own machine when self-hosted; an explicit trade-off shown in the UI on
  hosted instances).

### 3.8b Mailbox access via the IMAP connector (desktop app only)

The desktop app can search a mailbox, read single mails on demand and import
picked ones as documents (IMAP, read-only; deliberately NOT a mirror). The
design keeps the line the email-integration research drew. **No QUON server is
ever involved**: the Rust host on the user's own device connects to the mail
server over TLS, parses MIME locally, and the page ingests the text through
the ordinary encrypt-at-rest / scrub-on-use pipeline. What that means per
adversary:

- **QUON operator:** sees only the usual ciphertext blobs; cannot tell mail
  from any other document. No mail credentials, no mail metadata.
- **Device attacker:** the app password lives in the OS keychain
  (`com.quon.desktop.mail`), gated by the OS, not in localStorage; the mail
  content sits in the same sealed local caches as every document.
- **Mail server / network:** sees a normal IMAP client login from the user's
  own IP, strictly less exposure than the "majors'" server-side fetching,
  which logs in from a datacenter and retains fetched excerpts.
- **Mail content as attack input:** mails are attacker-controlled text
  (anyone can send one). They reach the model only through the scrubbed
  tool-result / document-context path, and the untrusted-content rules of
  §3.10 apply unchanged: a mail that says "delete my documents" is context,
  not an instruction. The chat tools (`search_mail`, `read_mail`,
  `import_mail`) are read/read/write-consented like their Paperless
  counterparts, advertised only when mail is actually connected in the
  desktop app. Prompt injection via imported content is the standing, **not yet
  fully mitigated** surface here (see §3.10) and it rises in priority with this
  connector: mail is attacker-writable by definition; anyone can send you one.
- **Write scope:** none. The session uses EXAMINE + BODY.PEEK; QUON cannot
  mark, move, send or delete mail even if fully compromised, because the IMAP session
  itself is read-only.

### 3.8c Conversational filesystem access (desktop app only)

In the desktop app the user can say "schau in diesen Ordner" and the model can
then list, read and (with consent) import files, create subfolders, create new
text files, and move or rename files and folders. The gates are layered on
purpose:

- **The model cannot choose the root.** Only `pick_folder` opens the real macOS
  dialog; the USER chooses, and the Rust host registers exactly that root. A
  prompt-injected "read ~/.ssh/id_rsa" has nowhere to go.
- **Every later argument is resolved against the listing**, not treated as a
  path: `read_folder_file`/`import_folder_file` match the model's string
  against entries QUON actually enumerated inside the grant, so a traversal
  string (`../../...`) finds nothing. Independently, the host
  canonicalizes and prefix-checks every read (src-tauri/src/files.rs), the
  belt to this suspenders.
- **The writes (`create_folders`, `write_folder_file` and
  `move_folder_items`, since 2026-10-25) are the only places model output becomes
  a path**, always a RELATIVE one under the picked root. All three are
  NON-DESTRUCTIVE by construction: nothing is ever deleted, and nothing is ever
  overwritten. A new file is created with O_CREAT|O_EXCL (`create_new`), and a
  file move is `link()` + `unlink()`, which fails where `rename()` would silently
  replace a file that appeared since the check. So every action can be undone
  by moving back. Writes are text only (`.md`, `.txt`, `.csv`), so nothing written
  can be executed by opening it, and editing an existing file is deliberately
  not offered, because it is the one operation that destroys content.
  Paths are validated twice, in JS before the consent card
  (`src/lib/tools/folderPaths.ts`), so a refused name is shown as refused and
  never as approvable, and again in the host (`mkdir_contained` in
  `src-tauri/src/files.rs`), which is the authority: no `..`, no absolute
  paths, no hidden names (a leading dot covers `.git` and `.ssh`), no `\`, `:`
  or control characters, at most 6 levels deep; per call at most 20 folders,
  100 moves or 10 files of 512 KB.
  The host cannot reuse the read path's canonicalize check here (a path that
  does not exist yet has no canonical form), so it walks every source and
  target path one segment at a time and refuses any symlink on the way, in
  either direction (a move can neither pull a file in through a link nor push
  one out). A plain
  `create_dir_all` would follow a symlink planted inside the grant and create
  folders wherever it points; the canonicalize check afterwards would notice,
  but only after the folder already existed outside. The test suite pins this
  (`refuses_to_create_through_a_symlink_that_leaves_the_root`, which fails
  against `create_dir_all`; and `writes_text_only_and_never_through_a_planted_link`,
  where `create` + `truncate` instead of `create_new` writes the file at a
  dangling symlink's target OUTSIDE the root).
  Every call needs consent with every folder, every move and the full file
  content shown, and write tools can never be set to "always allow".
- **The grant is memory-only and per session.** It dies with the app and on
  sign-out (authStore.logout calls clearFolderGrant). Silently remembered
  filesystem access would be worth more to an attacker than it is worth to the
  user; re-picking is one click.

File CONTENT is attacker-controlled in the same sense as mail (§3.8b): a
document may contain injected instructions. It reaches the model only through
the scrubbed tool-result path, and the §3.10 untrusted-content rules apply
unchanged: reading a file can never itself trigger a write; import and
`create_folders` are separate, consented write tools, and a write that follows
external content in the same turn (a listing or a file read) gets an explicit
provenance warning on its consent card. A backgrounded app denies by default.

### 3.9 Detection-evasion / imperfect detection (cross-cutting)

This is the most likely failure mode, though not an adversary with a face: PII
the pipeline does not catch ships to the provider in the clear.

_Mitigations (defense in depth; no layer is load-bearing alone):_

- Three merged layers, all in-process on the server: spaCy/Presidio NER, GLiNER
  span scoring (opt-in, for context-dependent PII) and an **always-on
  deterministic regex safety net** (EMAIL/PHONE/IBAN, optionally amounts) that
  never depends on an ML model being up. A guard chain filters the merged result.
- **Fail closed:** if the scrubber is unreachable, sending is blocked and the
  input preserved. If the NER model is not loaded, the regex safety net still
  stands and the response is flagged `fallback_mode` (surfaced honestly in the
  UI as reduced detection).
- Review mode: manual approval, un-redaction, and manual redaction of missed
  spans before each send.
- Per-user "always redact" list for the user's own high-value identifiers.
- A ~1,500-case synthetic evaluation corpus with recall/precision **ratchet
  floors enforced in CI**; a detection regression fails the build.

_Residual:_ recall is <100% by nature. Novel formats, unusual languages,
misspellings, and context-dependent identifiers can slip through. QUON's
detection currently targets German and English.

### 3.9b Server-mediated URL fetch (web_fetch tool + "add a URL as a document" + calendar subscription)

Three features have the QUON **server** fetch a user-supplied public URL: the
`web_fetch` chat tool, the `POST /fetch-url` document import, and the read-only
**calendar (.ics) subscription** (`POST /fetch-url` with `raw=true`, parsed
client-side to feed the daily briefing). This is a deliberate, disclosed
departure from zero-knowledge _for the URL and the fetched public content_: the
server sees the address the user asked for and the returned public bytes (never
the user's private/encrypted data). The extracted text / parsed events stay on
the client; the calendar URL itself is stored **E2E-encrypted** in the prefs
blob (a calendar link can embed a private token, so it is never persisted
server-side in the clear).

_Mitigations:_

- **SSRF:** `net_guard.validate_public_url` on the initial URL AND on every
  redirect `Location`; the fetch uses `follow_redirects=False` and re-validates
  each hop, so a redirect can never bounce to a loopback/private/cloud-metadata
  host (https-only, public-IP-only; capped hops).
- **Amplification/DoS:** response body read incrementally and aborted past a
  size cap; short total timeout; only `text/html`/`text/plain` extracted (no
  binary download); the route is rate-limited (60/h/IP).
- **Honesty:** the Documents UI states plainly that the server fetches the URL
  and sees the address + public content.

_Residual:_ interest metadata (which pages a user imports) is visible to the
server operator, unlike the rest of QUON. Users who need that hidden should not
use URL import / web_fetch. Self-hosters' server is their own machine.

### 3.9c Link previews for web-search results (`/link-previews`, `/link-image`)

When an answer cites web results, the sources strip shows them with a picture.
The pictures are fetched **by the server**, not the browser, and re-served from
QUON's own origin. This is the same trust class as §3.9b, but note the
alternative it replaces: putting the merchant's `og:image` straight into an
`<img src>` would tell every cited site the user's IP, the time, and (via the
Referer) that this particular person just asked about them. That passive leak is
precisely what QUON exists to prevent, which is why the sources strip has never
carried remote favicons either.

_Mitigations:_

- **SSRF, twice over:** both endpoints re-validate every redirect hop with
  `net_guard.validate_public_url` (`follow_redirects=False`). This matters more
  here than for §3.9b: the image URL comes from `og:image` on a page that was
  itself found by a model's web search, i.e. it is fully attacker-controlled.
  The URL that reaches `/link-image` is therefore never trusted because a
  previous step produced it.
- **Content confusion:** the proxied image's `Content-Type` is decided by MAGIC
  BYTES, never by the origin's header, so an origin cannot get arbitrary bytes
  re-served from QUON's domain under an `image/*` label it chose itself.
  Non-image bodies are refused (415).
- **Amplification/DoS:** bodies are STREAMED with a hard cap (512 KB HTML,
  3 MB image) rather than buffered-then-checked; per-answer fan-out is capped
  (6 URLs, 4 concurrent); both routes are rate-limited (60/h previews,
  300/h images).
- **Availability coupling:** every failure degrades to "no picture"; a dead or
  hostile site can never break the answer it was cited in.

_Residual:_ the operator's server sees the cited URLs (already true via the
relay, which carries the same annotations) and performs outbound fetches on the
user's behalf, so the instance's IP appears in those sites' logs instead of the
user's. That is the intended trade.

### 3.10 Injected content driving a first-party write tool

QUON exposes first-party chat tools (`quon__*`) that run in the browser over
the user's own decrypted stores: reads (`search_documents`, `search_dropbox`)
and WRITES (`save_memory`, `save_document`, `import_dropbox_document`,
`import_paperless_document`).
`import_dropbox_document` fetches the chosen Dropbox file's BYTES on-device
(the Dropbox token never leaves the browser, same ZK trust as the Dropbox
connector) and ingests them into the encrypted store; the model only supplies a
search query, the import is scoped to the current project (never the model's
choice), idempotent by Dropbox path+hash, and capped per call. Combined with
untrusted content sources (MCP tool results, web content), these writes assemble
the classic
"lethal trifecta": private data + injected instructions + a side-effect
channel. The scrubber structurally caps the _provider_ channel (an injected
"send the IBAN" can only ever carry `[IBAN_1]` to the model), but a write
executes in the browser with REAL values, so writes get their own tier:

_Mitigations:_

- **Write tools are never silent and never "always-allowed"**, structurally:
  the always-allow store ignores/refuses entries for `trust:"write"` tools even
  if present (a stale or tampered consent entry cannot arm a write). Every
  write shows a per-action consent card with the FULL re-hydrated payload
  (real values; the point is catching a poisoned write before it lands).
- **Provenance warning:** once an untrusted tool result has entered a run, any
  write proposed afterwards carries an explicit banner on its consent card
  ("follows content read from an external tool this turn"). Warn-not-block:
  read-then-write is the legitimate flow.
- **Provenance is an axis of its own, orthogonal to the read/write tier.**
  Trust tier answers the side-effect question (which consent card); provenance
  answers the injection question (who authored the content). MCP results
  always count as external. Since the Paperless round, _first-party_ tools can
  carry `provenance: "external"` too: `search_paperless` /
  `read_paperless_document` are read-tier (no side effect, always-allow
  eligible) but their RESULT is document content from a live outside archive;
  a scanned letter is attacker-authorable input (anyone can mail the user a
  poisoned letter that Paperless OCRs). Executing any external-provenance tool
  flips the run's injection guard exactly like an MCP result, so a later write
  gets the banner. First-party reads over the user's OWN encrypted stores
  remain the only tools that don't flip it.
- First-party reads execute locally and return the user's own data (or, for
  external-provenance reads, data fetched browser-direct from the user's own
  service); their results are scrubbed before re-entering the relay like any
  tool result (fail-closed when the scrubber is down; large results go
  through the same chunked scrubbing as attachments, so "too big to scrub in
  time" cannot become a reason to skip the scrub).
- Tool rounds stay capped; a read result can never auto-approve a later write;
  backgrounded chats auto-deny all tool consent.

- **No first-party tool writes outside the user's own stores.** This used to be
  the sharpest case: the Azure DevOps tools wrote into a THIRD-PARTY system
  (typically the user's employer's backlog), so a poisoned write was visible to
  colleagues and might not be cleanly reversible. That integration was removed
  in 2026-08, and with it the whole category. Every remaining `trust:"write"`
  tool (`save_memory`, `save_document`, `create_agent`, the `import_*` family)
  targets the user's own encrypted store, where the blast radius of a bad write
  is their own data and the fix is deleting the item. External REACHES still
  exist (MCP servers the user configures can do anything their own tools do),
  but those are out-of-tree by construction and carry `provenance:"external"`.

_Residual:_ the consent card is the safety margin; a user who reflexively
approves defeats it. The banner, the mandatory content preview and the
structural always-allow exclusion reduce, but cannot eliminate, that risk. The
residual is now bounded by the user's own store for first-party tools; for
user-configured MCP servers it is whatever those servers can reach.

### 3.11 Client agent runner (device agents, Phase 2)

A **device agent** is a saved prompt (`kind:"doc-digest"`) that runs
unattended on a device the user marked as a runner, over the user's OWN
encrypted memory/documents, with no per-run consent. Its definition and results
live only in the E2E-encrypted `jobs` sync collection (key `deriveJobsKey`, ctx
`quonjob0`); the server relays opaque blobs and never runs or reads it (unlike a
server-side web-watch, whose query is public metadata in the `agents` table).

_Mitigations:_

- **Same fail-closed relay as chat.** Each run scrubs the retrieved context AND
  the saved prompt in ONE `scrubText` pass before any relay; if the scrubber is
  unreachable the run ends `error` and the model is NEVER called, so no raw PII
  leaves the device (`runner.executeAgentPrompt`; `runner.test.ts` asserts
  `chatStream` is not called when scrub throws). Retrieved snippets carry the
  user's real memory text, so scrubbing them is mandatory; storing the result
  encrypted does not exempt the outbound relay.
- **No new server surface / no plaintext at rest.** Reuses the collection-
  agnostic sync; prompt and result are ciphertext everywhere off-device.
- **Runs only while a device is open + unlocked** (MK is browser-only). A
  service worker cannot run agents (no MK). The UI says so; QUON makes no
  background-execution promise it can't keep.
- **Exactly-once across devices.** A run is claimed by writing the claiming
  device id into the synced blob; the LWW _total order_ (`jobItemWins`:
  updatedAt, then a globally-unique `claimSeq`) plus a post-claim confirm window
  make two simultaneous runners converge to ONE owner: no double execution,
  no double provider spend (`jobsStore.test.ts`). A dead claimant (no heartbeat
  past `RECLAIM_MS`) is reclaimable.

_Residual:_ a device agent is NOT gated by per-run consent (that is its point),
so a poisoned memory/document could steer its prompt; the provider only ever
sees scrubbed text, but the _result_ the user reads could be influenced by
injected content in their own store. Tool-using device agents (which would
reintroduce the write-tool surface of §3.10) are deliberately NOT in v1.

---

## 4. Mitigation summary

| Mitigation                                                                          | Where           | Defends against                                  |
| ----------------------------------------------------------------------------------- | --------------- | ------------------------------------------------ |
| Argon2id KDF (auth verifier independent of wrap keys)                               | client + server | 3.1, 3.3 (credential theft, offline attack cost) |
| MK wrapped via `secretbox` (password, recovery phrase, WebAuthn PRF)                | client          | 3.1, 3.2-at-rest                                 |
| Per-collection MK-derived keys; ciphertext-only sync (LWW)                          | client + server | 3.1, 3.3                                         |
| Sealed local caches (localStorage/IndexedDB encrypted under a MK-derived cache key) | client          | device theft while locked                        |
| Fail-closed scrubbing; `fallback_mode` honesty                                      | client + server | 3.9                                              |
| Always-on regex safety net under the NER and GLiNER layers                          | server          | 3.9                                              |
| Corpus ratchet floors in CI                                                         | CI              | 3.9 (regressions)                                |
| Nonce-based enforcing CSP + tight `connect-src`                                     | server (SSR)    | 3.5                                              |
| SSRF guard (write-time + request-time, DNS-rebinding aware)                         | server          | 3.6, server-side pivoting                        |
| Rate limits on auth/sensitive routes                                                | server          | 3.3, 3.6                                         |
| Enumeration defenses (dummy KDF/login, fake-success register)                       | server          | 3.6                                              |
| Per-user settings/keys; sealed sub-keys; hard spend caps                            | server          | 3.1, 3.6                                         |
| Opaque httpOnly sessions + CSRF; explicit CORS                                      | server          | 3.3, 3.5                                         |
| Sealed-box project-key grants; fragment-carried invite keys                         | client          | 3.7                                              |

---

## 5. Residual risks and out of scope

- **Metadata.** The server (and to a degree the provider) sees timing, message
  and blob sizes, sync frequency, model choice, and account email. QUON does
  not attempt metadata privacy.
- **Semantic leakage / co-reference inference.** Scrubbing removes PII
  _values_; it cannot remove _meaning_. Consistent indexed placeholders let a
  provider accumulate attributes about the same entity across turns.
- **Detection recall < 100%.** See §3.9. Review mode exists precisely because
  no automatic detector is sufficient for the highest-stakes content.
- **Malicious code-serving origin.** See §3.2: a persistently malicious
  operator can backdoor the web client. Self-host if your threat model
  includes the operator.
- **Device compromise.** Malware, a hostile browser extension, or a shared
  unlocked device sits inside the trusted computing base. The MK is in memory
  while unlocked; locked-at-rest caches help only against offline access.
- **Offline dictionary attack on the cached key material.** To make offline
  unlock work (reading your data with no server in reach), the device caches
  the password key material, `wrap_pw` (a secretbox ciphertext whose key is
  Argon2id(password)) plus the public KDF salt/params, in plain localStorage
  (`quon_offline_v1`). An attacker with disk access can therefore mount an
  offline dictionary attack on the account password; the Argon2id parameters
  are what makes that expensive. This is the same trade-off every local
  password-manager vault (Bitwarden, 1Password) makes, it does not weaken the
  server-side zero-knowledge model, and logging out erases the cache. The
  cached `wrap_bio` opens only with the physical authenticator's PRF output.
- **Trust-on-first-use in sharing.** Invite links are bearer secrets; member
  identity keys are not verified out of band in v1, and revocation does not
  rotate the project key.
- **Lost credentials.** Losing both the password and the recovery phrase makes
  data unrecoverable; that is by design, and stated to users.
- **Third-party model behavior.** What a provider does with scrubbed text
  (retention, training) is governed by that provider's terms; QUON pins
  zero-data-retention routing where the API supports it (e.g. cloud OCR) but
  cannot enforce provider-side conduct.
- **Denial of service** against a self-hosted instance is out of scope beyond
  basic rate limiting.

---

## 6. Reporting

Found a hole in any of the above, or a gap between this document and what the
code actually does? Please report it privately: see [SECURITY.md](../SECURITY.md).
