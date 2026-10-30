# The core edition

This repository is the **core** of QUON: the privacy gateway itself. It is a
cut of the full product, chosen so that everything here is tested, settled and
runs on its own. Features grow back into it one by one.

## What is in

| Area | What you get |
| --- | --- |
| **Detection** | spaCy/Presidio NER + GLiNER + a deterministic regex net, followed by a guard chain; measured against a corpus ratchet in CI. |
| **Chat** | filter → model provider → local re-hydration; Review mode; your own always/never-redact lists; **fails closed** when the detector is unreachable; stream resume; image output. |
| **Accounts** | password + recovery phrase, optional passkey unlock, zero-knowledge key wrapping. |
| **Encrypted sync** | chats, memory, documents and projects as ciphertext per collection — the server never holds plaintext or keys. |
| **Memory and documents** | on-device embeddings and search; attachments; PDF/DOCX extraction; photo scan (on-device OCR, with a consented per-photo cloud fallback). |
| **Projects**, the **Trust** page, onboarding, German and English. |
| **Self-hosting** | `docker compose up` with Caddy, plus a minimal admin screen (users, invites). |

## What is not in — and why

| Area | Why it waits |
| --- | --- |
| Connectors (Dropbox, OneDrive, IMAP, Paperless, folder access) and MCP servers | Need the operator's own OAuth app registrations or the desktop app; each is a new path for data to leave. |
| Chat tools (the model acting: saving memories, reading files, creating folders) | The largest prompt-injection surface; the tool loop is the part of the chat that changed most recently. |
| Agents | Scheduled, unattended paid model calls — a cost trap for a new instance. |
| URL import and link previews | The server fetching arbitrary URLs. Guarded, but the core does not need it. |
| Shared projects | Cross-user key exchange — worth its own review before it is public. |
| Calendar briefing | Depends on the calendar connector. |
| Feedback dialog | Mails the operator and files issues in the operator's own tracker. |
| Native apps (macOS, Android) | Beta; signing and distribution are a separate track. |

## The criteria to come back

A feature joins the core when all four hold:

1. **Tested** — unit tests and an end-to-end spec that run in CI.
2. **Settled** — no fix needed for about six weeks, or the recent fixes are understood.
3. **Self-contained** — works after `docker compose up`, without the author's accounts, keys or infrastructure.
4. **Inside the promise** — adds no new way for data to leave the device and no new way for the model to act on the world, or states and consents it plainly.

## How the cut is made

The cut is mechanical, not a fork: the full product and the core share every
screen. Two registries differ between the editions —
`src/lib/features.ts` (which entry points exist) and
`quon-scrubber-service/optional_features.py` (which routes are mounted) — plus
`src/lib/syncExtras.ts` for background runners. The modules behind a feature
are absent here; a handful of inert stubs let the shared screens compile.

Some documents in `docs/` describe the full product and say so at the top.

## Known follow-ups

- The frontend still lists the native shells' npm packages (Tauri, Capacitor)
  because the platform seam imports them lazily; they are never used here.
- The `Native` CI job is defined but skipped (it builds the desktop shell).
- Configuration knobs for absent features remain in `config.py` and the
  compose file; they are ignored.
