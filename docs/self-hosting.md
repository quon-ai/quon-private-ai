> **Core edition.** This document describes the full QUON product. The core edition leaves out some features (connectors, chat tools and MCP, agents, shared projects, native apps) — see [docs/CORE.md](./CORE.md) for the list and the criteria.

# Self-hosting QUON

QUON is a zero-knowledge privacy gateway for chatting with frontier LLMs:
personal data is detected and replaced with typed placeholders **in the
browser and on your own server** before anything reaches a model provider.
Self-hosting means the server you trust is your own.

This guide covers the supported path: **Docker Compose behind Caddy** with
automatic HTTPS. Everything runs on one origin — the frontend at `/`, the
backend at `/api/*` — which is what the frontend build and the production
Content-Security-Policy expect.

## Requirements

- A Linux host with Docker + Docker Compose v2 (`docker compose`), x86-64
  (ARM64 should work — the base images are multi-arch — but is untested).
- **RAM:** ~2 GB for the backend at runtime (spaCy German+English NER models +
  Presidio). Add several GB more only if you enable the optional local Ollama
  model. **Note the build needs more than the runtime:** `docker compose up
--build` compiles the SSR frontend bundle on the host — budget ~4 GB and
  10–20 minutes on a small VPS, or build elsewhere and ship the image.
- **Disk:** a few GB (images + the `quon-data` volume). The local PII model
  (optional) adds ~2 GB.
- A domain with DNS pointing at the host, ports 80/443 reachable (Caddy
  obtains and renews TLS certificates automatically).
- An [OpenRouter](https://openrouter.ai) API key — either one shared key for
  the instance, or none at all (then every user brings their own key in
  Settings → Connections).

### What it costs to run

The software is free; **the model calls are not.** QUON is a gateway — it has no
inference of its own, so every message is billed by your provider, pay-per-token:

- **Each chat message costs once** — the answer. PII detection runs entirely
  in-process on your server (spaCy/Presidio + a deterministic regex net +
  GLiNER); it calls no provider, so it adds no per-message charge and no egress.
- **Agents call a paid model on a schedule**, unattended — bound it with
  `AGENT_MIN_INTERVAL_SECONDS`.
- **Everything else is free**: embeddings, semantic search, OCR and dictation all
  run on the user's device. Only chat and the optional cloud-OCR fallback leave
  the machine.

Actual spend depends entirely on the models you expose and how much people chat —
watch it on your OpenRouter dashboard for the first week. If you host for others,
`OPENROUTER_PROVISIONING_KEY` gives each user their own **capped** sub-key
(`OPENROUTER_USER_LIMIT_USD`, default $5) instead of a shared uncapped one.

## Quick start

```bash
git clone <this repo> quon && cd quon
cp .env.example .env
# Edit .env — at minimum:
#   QUON_DOMAIN          your domain, e.g. quon.example.com
#   QUON_SERVER_SECRET   openssl rand -base64 32   (keep it stable forever!)
#   OPENROUTER_API_KEY   or leave empty for BYOK-only
#   SMTP_*               required for real users (email verification)
#   SIGNUP_INVITE_CODE   SET THIS before the host is reachable — see below
docker compose up -d --build
```

First build takes a few minutes (frontend bundle + spaCy models). Then open
`https://<QUON_DOMAIN>` and register the first account.

> ### ⚠️ Register the first account before anyone else can
>
> Three defaults combine badly on a public host, and the window opens the moment
> DNS resolves — which is _before_ the build finishes:
>
> - **`SIGNUP_INVITE_CODE` is empty by default ⇒ registration is open.**
> - **The first account created on a fresh instance becomes the admin.**
> - **Without `OPENROUTER_PROVISIONING_KEY`, every user's chat _and_ cloud PII
>   extraction bills your single shared `OPENROUTER_API_KEY` — uncapped.**
>
> So a stranger who finds the host first becomes your admin and spends your
> money. Do one of these _before_ the instance is reachable:
>
> - set `SIGNUP_INVITE_CODE` in `.env` (simplest — registration then requires it), or
> - set `OPENROUTER_PROVISIONING_KEY` so each user gets their own capped sub-key, or
> - bring the stack up on a host that is not yet public, register your admin
>   account, and only then point DNS at it.
>
> The backend logs a loud warning on every boot while open registration and a
> shared key are combined. To promote a second admin later, use an existing
> admin's `POST /admin/users/{id}/role`, or the `ADMIN_TOKEN` break-glass.

Sanity checks:

```bash
docker compose ps
curl -s https://<QUON_DOMAIN>/api/health   # {"status":"ok",...}
```

The backend **refuses to start** (with a clear log message) if
`QUON_SERVER_SECRET` is missing or CORS is a wildcard while Secure cookies
are on — check `docker compose logs scrubber` if it restarts.

## Email verification (SMTP)

Registration requires a verified email address. Without `SMTP_HOST`, the
verification links are only written to the backend log:

```bash
docker compose logs scrubber | grep "DEV EMAIL"
```

That works for trying it out, but set up real SMTP (any provider) before
inviting other users. `SMTP_FROM` should match your domain.

## Access control

- `SIGNUP_INVITE_CODE` — when set, registration requires this code. Leave
  empty for open registration.
- `OPENROUTER_PROVISIONING_KEY` — optional: mints a spend-capped OpenRouter
  sub-key per user (`OPENROUTER_USER_LIMIT_USD`, default $5). Without it,
  users share the instance key or bring their own.
- `ADMIN_TOKEN` — guards the `/admin/*` key-lifecycle endpoints. Set it even
  if you don't use them.

## Turn GLiNER on — you almost certainly want it

Detection has three in-process layers, and the third one ships **off**:

```bash
# in your .env
GLINER_ENABLED=true
```

`GLINER_ENABLED` defaults to `false` so that a first `docker compose up` on a
small box does not spend a minute downloading a 1.5 GB model before it answers
anything. That default is a cold-start courtesy, **not** a recommendation:
the reference deployment runs with it on, and the detection numbers quoted in
this repo are measured with it on. With it off you get spaCy/Presidio plus the
regex net and materially weaker coverage of names, credentials and IDs.

Cost of turning it on: ~1.5 GB of model downloaded once into the `quon-data`
volume (`HF_HOME`), a few hundred MB of RSS, and roughly +0.5 s per scrub on
CPU. No GPU, no extra service, no network calls at detection time.

Confirm it actually loaded — the flag being set is not proof:

```bash
curl -s localhost:8000/health
# {"status":"ok","version":"0.1.0","ner_ready":true,"pii_ready":true,
#  "gliner_enabled":true,"gliner_loaded":true}
```

`gliner_enabled: true` with `gliner_loaded: false` means the download or the
load failed and you are silently running two layers instead of three.

## Operator settings

Runtime settings the operator edits in the app (model catalog, provider
connections) persist in `runtime_settings.json` **on the
`quon-data` volume** — they survive rebuilds and upgrades. Inspect with:

```bash
docker compose exec scrubber cat /app/data/runtime_settings.json
```

## Paperless-ngx connector

The Paperless connector fetches your documents' OCR text **directly from the
browser** — no server in between, so QUON's zero-knowledge model holds. Two
prerequisites on your side:

1. **Paperless CORS** — allow the QUON origin:

   ```
   PAPERLESS_CORS_ALLOWED_HOSTS=https://<your QUON domain>
   ```

2. **QUON CSP** (production builds enforce a `connect-src` allowlist) — this is
   automatic: saving the connector stores the Paperless ORIGIN (never the
   token) in a cookie, and the frontend server appends that one shape-validated
   origin to the page's `connect-src` (the app reloads once after the first
   save so the new policy applies). Trade-offs, stated honestly: the frontend
   server learns the Paperless hostname, and a hypothetical XSS attacker in
   your session gains that single origin as an exfiltration target — see
   `docs/threat-model.md`. Operators can still allowlist instance-wide via
   `QUON_CSP_CONNECT_EXTRA=https://<paperless domain>` (env on the frontend
   service); the two mechanisms combine.

The API token (Paperless → settings → API token) is stored encrypted on the
device only.

### Live use (search, chat attachments, chat tools)

Beyond the one-time import, QUON can use Paperless **live**: search it from
the connector card, attach a document to a chat message on demand (nothing is
stored in QUON), and let the model search/read the archive via chat tools.
All of that is the same browser-direct channel, so the requirements are the
same two settings as above — but they now matter on every chat turn, not just
at import time:

- **https on Paperless** — for a hosted (https) QUON the browser refuses a
  plain-http Paperless (mixed content). `tailscale serve` is the easiest fix
  (see the table below).
- **CORS** (`PAPERLESS_CORS_ALLOWED_HOSTS`) must include the QUON origin.
- **CSP** — handled automatically via the connector-origin cookie (see above);
  the operator env `QUON_CSP_CONNECT_EXTRA` remains as an instance-wide
  alternative.

If Paperless is unreachable (box asleep, tailnet down), requests time out
after ~15 s with an actionable error — chat tool calls report the failure to
the model instead of hanging, and nothing is sent unscrubbed.

### "My Paperless is local, without https"

The common self-hosted case. What matters is not QUON's preference but what the
**browser** permits: a page served over https may not fetch a plain-http origin
(mixed content). So:

| Your QUON is served over | Paperless URL                              | Works?                                 |
| ------------------------ | ------------------------------------------ | -------------------------------------- |
| https                    | `https://…`                                | yes                                    |
| https                    | `http://localhost:8100` (loopback)         | yes — loopback is a trustworthy origin |
| https                    | `http://192.168.x.y:8100` / a Tailscale IP | **no — the browser blocks it**         |
| http (self-hosted / LAN) | `http://…`                                 | yes                                    |

If you use the hosted app (https) and Paperless has no TLS, give Paperless https
— it is easier than it sounds:

- **Tailscale** (if you already reach the box over a tailnet): `tailscale serve
--bg 8100` publishes it as `https://<machine>.<tailnet>.ts.net` with a real
  certificate. No port forwarding, no self-signed cert warnings.
- **Reverse proxy**: put Paperless behind the same Caddy/nginx that already
  terminates TLS for your other services.

Self-signed certificates work only if the browser already trusts them; otherwise
the fetch fails the same way.

## Dropbox connector

The Dropbox connector downloads files **directly from the browser** via the
Dropbox HTTP API (bytes never touch the QUON server) using OAuth 2.0 PKCE —
no client secret, the refresh token is stored encrypted on the device only.

**The operator registers ONE Dropbox app for the instance** (the standard
multi-tenant OAuth model: the app is just QUON's client id; every user then
authorizes their OWN Dropbox account against it with one click):

1. Go to [dropbox.com/developers/apps](https://www.dropbox.com/developers/apps)
   → **Create app** → _Scoped access_ → _Full Dropbox_ (or _App folder_ for a
   dedicated folder).
2. Under **Permissions**, enable `files.metadata.read` and
   `files.content.read`.
3. Under **Settings → OAuth 2 → Redirect URIs**, add
   `https://<your QUON domain>/connectors`.
4. Set the app's **App key** (a public OAuth client id, not a secret) as
   `DROPBOX_APP_KEY` in your `.env` (compose passes it to the scrubber).
   Users then just click "Connect" on the Dropbox card, sign in at Dropbox
   with their own account, and land back on the Connectors page.
   Note: new Dropbox apps start in development status (up to 500 connected
   users) — apply for production status in the Dropbox App Console when you
   outgrow that.

The Dropbox API endpoints (`api.dropboxapi.com`, `content.dropboxapi.com`)
are already part of QUON's production CSP — no `QUON_CSP_CONNECT_EXTRA`
needed.

## OneDrive connector

Same model as Dropbox: files are downloaded **directly by the browser** via
Microsoft Graph (bytes never touch the QUON server), OAuth 2.0 PKCE with no
client secret. **The operator registers ONE Azure app for the instance**;
every user then authorizes their own account with one click.

1. Azure Portal → **Microsoft Entra ID → App registrations → New registration**.
2. **Supported account types**: _Accounts in any organizational directory and
   personal Microsoft accounts_ (the `common` tenant). This is what makes one
   registration serve both consumer OneDrive and OneDrive for Business.
3. **Redirect URI**: platform **Single-page application** (NOT "Web" — the Web
   platform expects a client secret and rejects the PKCE-only flow), value
   `https://<your QUON domain>/connectors`.
4. **API permissions** → Microsoft Graph → _Delegated_: `Files.Read` and
   `offline_access`. QUON never writes to the drive, so `Files.ReadWrite` is
   deliberately not requested.
5. Set the **Application (client) ID** — public by design under PKCE, not a
   secret — as `MS_CLIENT_ID` in your `.env` (compose passes it to the
   scrubber). Without it the OneDrive card shows an honest "not enabled" note.

The Graph endpoints and the token endpoint are already part of QUON's
production CSP. The download hosts are wildcarded (`*.files.1drv.com`,
`*.sharepoint.com`) because `@microsoft.graph.downloadUrl` points at a
per-request CDN host that differs between personal and work accounts.

## Legal pages are templates

`/terms`, `/privacy` and `/imprint` ship as **German-language drafts written
for the original QUON instance**, with placeholder markers for the operator's
name and address. If you host QUON for anyone but yourself, replace their
content (`src/routes/terms.tsx`, `privacy.tsx`, `imprint.tsx`) with your own
legal texts before inviting users — they are templates, not legal advice.

## Backup & restore

All server-side state lives in the `quon-data` volume (`quon.db` +
`runtime_settings.json`). User content in it is end-to-end encrypted —
the backup is safe to store, but **without each user's password or recovery
phrase the content cannot be decrypted by anyone, including you.**

> **Get the volume name right, or you will back up nothing.** Compose prefixes
> volumes with the _project_ name, which defaults to the **directory name**. If
> you cloned into `quon/` the volume is `quon_quon-data`; clone into `qu0n/` and
> it is `qu0n_quon-data`. Naming a volume that does not exist does not fail —
> Docker creates a new empty one, `tar` succeeds, and you get a ~45-byte archive
> with exit code 0. Look it up instead of assuming:

```bash
VOL=$(docker volume ls -q | grep 'quon-data$' | head -1); echo "using: $VOL"

# Backup (consistent copy: sqlite3 .backup if present, else stop for a cold copy)
docker compose exec scrubber sh -c "sqlite3 /app/data/quon.db '.backup /app/data/backup.db'" 2>/dev/null \
  || docker compose stop scrubber
docker run --rm -v "$VOL":/data -v "$PWD":/out alpine \
  tar czf /out/quon-backup.tgz -C /data .
docker compose start scrubber

# VERIFY — a backup you have not listed is a hope, not a backup.
tar tzf quon-backup.tgz | head        # must list quon.db (and runtime_settings.json)
ls -lh quon-backup.tgz                # a few KB+ ; ~45 bytes means you archived an empty volume
```

```bash
# Restore — into a STOPPED stack, then start
docker compose down
docker run --rm -v "$VOL":/data -v "$PWD":/in alpine \
  sh -c "rm -rf /data/* && tar xzf /in/quon-backup.tgz -C /data"
docker compose up -d
curl -s https://<QUON_DOMAIN>/api/health   # {"status":"ok",...}
```

`deploy/backup-quon.sh` is a fuller, scheduled variant (online `sqlite3 .backup`,
integrity-check, encrypt, upload). It is **wired for one specific machine** —
container name, remote and paths are hard-coded at the top; read and adapt those
before using it.

**Never lose `QUON_SERVER_SECRET`** (back it up separately): it seals
per-user provider keys. Rotating or losing it means users must re-enter
their keys — user _content_ is not affected (that is protected by their own
Master Keys, never by the server).

## Upgrades

```bash
git pull
docker compose up -d --build
```

Database migrations apply automatically and forward-only at startup. Check
`docker compose logs scrubber` after an upgrade.

## Environment reference

The bundled `docker-compose.yml` **enumerates every variable it passes** — there
is no `env_file`. A key in `.env` alone therefore _never_ reaches a container: if
you add one, you must also add the passthrough line in `docker-compose.yml`. This
is the single most common self-hosting surprise.

The README covers the vars needed to boot. These are the ones that bite later:

| Var                                        | Default                               | Why you may need it                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------ | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RUNTIME_SETTINGS_PATH`                    | `<app dir>/runtime_settings.json`     | **Point this at your data volume.** Operator settings edited in the Settings UI (model catalog, PII backend, keys) live in this file. Inside the image, every `--build` recreates it and silently reverts those edits — including users' model selection. The bundled compose already sets `/app/data/…`; anyone running the backend outside it (bare Docker, systemd, k8s) must set it. Read via `os.environ`, so it is _not_ in `config.py`. |
| `ALLOW_PRIVATE_PROVIDER_URLS`              | `false`                               | Needed to point BYOK chat or PII extraction at a **private address** — a LAN Ollama or LM Studio. The SSRF guard blocks private IPs by default: right for a public instance, and exactly what blocks the home-lab setup.                                                                                                                                                                                                                       |
| `PII_CLOUD_BASE_URL` / `PII_CLOUD_API_KEY` | `""`                                  | Send PII **extraction** to any OpenAI-compatible endpoint instead of OpenRouter — a sovereign or self-hosted model. Empty = OpenRouter defaults.                                                                                                                                                                                                                                                                                               |
| `AGENT_MODEL`                              | `openai/gpt-4o-mini`                  | Model used by scheduled agents.                                                                                                                                                                                                                                                                                                                                                                                                                |
| `AGENT_MIN_INTERVAL_SECONDS`               | `72000` (~daily)                      | Floor between runs of one agent. **Agents call a paid LLM on a schedule** — this is your cost bound.                                                                                                                                                                                                                                                                                                                                           |
| `AGENT_RUN_TIMEOUT`                        | `90`                                  | Seconds per agent LLM call.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `RATE_LIMIT_ENABLED`                       | `true`                                | Keep on for any instance with untrusted signups.                                                                                                                                                                                                                                                                                                                                                                                               |
| `ORIGINALS_QUOTA_BYTES`                    | `209715200` (200 MB)                  | Per-user ceiling for stored original document bytes.                                                                                                                                                                                                                                                                                                                                                                                           |
| `SIGNUP_INVITE_CODE`                       | `""`                                  | Non-empty ⇒ `/auth/register` requires this code. The invite gate.                                                                                                                                                                                                                                                                                                                                                                              |
| `SESSION_TTL_HOURS`                        | `720` (30 d)                          | Session lifetime.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `COOKIE_SAMESITE` / `COOKIE_DOMAIN`        | `lax` / `""`                          | Only for unusual proxy/subdomain setups; host-only cookie by default.                                                                                                                                                                                                                                                                                                                                                                          |
| `SMTP_STARTTLS`                            | `true`                                | `false` for implicit TLS on port 465 (see `SMTP_SSL`).                                                                                                                                                                                                                                                                                                                                                                                         |
| `FEEDBACK_EMAIL`                           | `""`                                  | Destination for in-app beta feedback.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `OCR_CLOUD_MODEL` / `OCR_CLOUD_TIMEOUT`    | `google/gemini-3.1-flash-lite` / `60` | The **cloud OCR fallback** for scanned pages with no text layer — per-photo, consented in the UI, and an egress path worth knowing about.                                                                                                                                                                                                                                                                                                      |
| `SAFETY_NET_ADDRESSES`                     | `true`                                | Sibling of `SAFETY_NET` / `SAFETY_NET_AMOUNTS` — address regex in the deterministic layer.                                                                                                                                                                                                                                                                                                                                                     |
| `QUON_CSP_CONNECT_EXTRA`                   | `""`                                  | **Frontend service.** Extra origins for the page CSP's `connect-src` (e.g. a self-hosted Paperless the browser reaches directly).                                                                                                                                                                                                                                                                                                              |
| `QUON_CSP`                                 | —                                     | **Frontend service.** `off` disables the enforcing CSP — emergency escape hatch only.                                                                                                                                                                                                                                                                                                                                                          |

Every other backend knob (timeouts, context sizes, POS filters, NER toggles) is
documented inline in
[`quon-scrubber-service/config.py`](../quon-scrubber-service/config.py).

## Ports & topology

```
Internet ──▶ Caddy :443 (TLS, one origin) ─┬─ /api/* ─▶ scrubber :8000
                                            └─ /*     ─▶ frontend :8080
```

Only Caddy is exposed. If you prefer your own reverse proxy (nginx, Traefik),
replicate `deploy/Caddyfile.example`: strip the `/api` prefix, proxy SSE
without buffering (`flush` immediately), and keep everything on one origin.
The app sends its own per-request CSP — don't add a second one.

## Troubleshooting

| Symptom                                         | Check                                                                                                     |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Backend restarts on boot                        | `docker compose logs scrubber` — missing `QUON_SERVER_SECRET` / wildcard CORS fail fast with instructions |
| Registration mail never arrives                 | SMTP unset → links are in the scrubber log (`DEV EMAIL`)                                                  |
| Chat blocked, "privacy filter unreachable"      | `/api/health` — the app **fails closed** when the scrubber is down                                        |
| Streaming answers cut off behind your own proxy | proxy must not buffer SSE and must tolerate idle streams (the backend sends keep-alive pings every 20 s)  |
| Models missing in the picker                    | instance key unset and no per-user key → configure `OPENROUTER_API_KEY` or add a key in Settings          |

## Security

See [SECURITY.md](../SECURITY.md) for vulnerability reporting and
[docs/threat-model.md](threat-model.md) for what QUON does and does not
protect against — including the honest limits of any web-delivered
end-to-end-encrypted app.
