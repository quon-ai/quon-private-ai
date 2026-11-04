> **Note.** This document also covers features that are not part of this repository yet: connectors, chat tools and MCP, agents, shared projects, the desktop and Android apps. They follow once they are ready.

# Self-hosting QUON

QUON is a zero-knowledge privacy gateway for chatting with frontier LLMs:
personal data is detected and replaced with typed placeholders **in the
browser and on your own server** before anything reaches a model provider.
Self-hosting means the server you trust is your own.

This guide covers the supported path: **Docker Compose behind Caddy** with
automatic HTTPS. Everything runs on one origin (the frontend at `/`, the
backend at `/api/*`), which is what the frontend build and the production
Content-Security-Policy expect.

## Requirements

- A Linux host with Docker and Docker Compose v2 (`docker compose version`
  must answer; on Debian and Ubuntu that is the `docker-compose-plugin`
  package, the old `docker-compose` v1 binary is not enough), x86-64 (ARM64
  should work, since the base images are multi-arch, but is untested).
- **RAM:** ~2 GB for the backend at runtime (spaCy German+English NER models +
  Presidio), ~3 GB more with GLiNER on (the third detector, see below; you
  almost certainly want it). **Note the build needs more than the runtime:** `docker compose up
--build` compiles the SSR frontend bundle on the host. Budget ~4 GB and
  10-20 minutes on a small VPS, or build elsewhere and ship the image.
- **Disk:** a few GB (images + the `quon-data` volume). The GLiNER model adds
  ~1.5 GB, downloaded once.
- **HTTPS**, one way or another: the browser only exposes the encryption
  APIs QUON is built on (WebCrypto, passkeys) to a secure origin. A public
  domain with ports 80/443 open lets Caddy fetch certificates on its own; on a
  private network use Caddy's internal CA or Tailscale instead (see
  [Where it runs](#where-it-runs)). `http://localhost` also counts as secure.
- An [OpenRouter](https://openrouter.ai) API key: either one shared key for
  the instance, or none at all (then every user brings their own key under
  Settings > Connections).

## Quick start

```bash
git clone <this repo> quon && cd quon
cp .env.example .env
# Edit .env — at minimum:
#   QUON_DOMAIN          your domain, e.g. quon.example.com
#   QUON_SERVER_SECRET   openssl rand -base64 32   (keep it stable forever!)
#   OPENROUTER_API_KEY   or leave empty for BYOK-only
#   SMTP_*               only if you want e-mail verification (see below)
#   SIGNUP_INVITE_CODE   SET THIS before the host is reachable — see below
docker compose up -d --build
```

First build takes a few minutes (frontend bundle + spaCy models). Then open
`https://<QUON_DOMAIN>` and register the first account.

> ### Register the first account before anyone else can
>
> Three defaults combine badly on a public host, and the window opens the moment
> DNS resolves, which is _before_ the build finishes:
>
> - **`SIGNUP_INVITE_CODE` is empty by default, so registration is open.**
> - **The first account created on a fresh instance becomes the admin.**
> - **Every user's chat bills your single shared `OPENROUTER_API_KEY`**,
>   capped only by the limit you set on it at OpenRouter.
>
> So a stranger who finds the host first becomes your admin and spends your
> money. Do one of these _before_ the instance is reachable:
>
> - set `SIGNUP_INVITE_CODE` in `.env` (the simplest option; registration then requires it), or
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
are on. Check `docker compose logs scrubber` if it restarts.

## E-mail verification (optional)

`EMAIL_VERIFICATION=auto` (the default) means: **if `SMTP_HOST` is set,
addresses are verified by mail; if not, an account is active the moment it is
created.** A home server needs no mail relay at all. Set `required` to insist
on verification (without SMTP the link is then only written to the scrubber
log, as `[DEV EMAIL]`, which is fine for a test and useless for real users), or
`off` to never verify, even with SMTP.

Two things change without verification: anyone who can reach the sign-up page
can create an account under any address (combine with `SIGNUP_INVITE_CODE` on
a host that is reachable from outside; the backend logs a warning on every
boot while both are open), and a second registration with an existing address
is refused with a plain 409 instead of the anti-enumeration answer the mail
flow gives. A still-pending account from an earlier verified setup is never
handed to a new registration; it keeps waiting for its own link.

To send mail, set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`,
`SMTP_FROM` (and `SMTP_SSL=true` for implicit TLS on 465). Any plain SMTP
relay works; the provider must offer SMTP. Password resets go the same way.

## Access control

- `SIGNUP_INVITE_CODE`: when set, registration requires this code. Leave
  empty for open registration.
- `ADMIN_TOKEN`: guards the `/admin/*` key-lifecycle endpoints. Set it even
  if you don't use them.

## Turn GLiNER on (you almost certainly want it)

Detection has three in-process layers, and the third one ships **off**:

```bash
# in your .env
GLINER_ENABLED=true
```

`GLINER_ENABLED` defaults to `false` so that a first `docker compose up` on a
small box does not spend a minute downloading a 1.5 GB model before it answers
anything. That default is a cold-start courtesy, not a recommendation:
the reference deployment runs with it on, and the detection numbers quoted in
this repo are measured with it on. With it off you get spaCy/Presidio plus the
regex net and materially weaker coverage of names, credentials and IDs.

Cost of turning it on: ~1.5 GB of model downloaded once into the `quon-data`
volume (`HF_HOME`), a few hundred MB of RSS, and roughly +0.5 s per scrub on
CPU. It needs no GPU and no extra service, and it makes no network calls at
detection time.

Confirm it actually loaded; the flag being set is not proof:

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
`quon-data` volume**, so they survive rebuilds and upgrades. Inspect with:

```bash
docker compose exec scrubber cat /app/data/runtime_settings.json
```

## Legal pages are templates

`/terms`, `/privacy` and `/imprint` ship as **German-language drafts written
for the original QUON instance**, with placeholder markers for the operator's
name and address. If you host QUON for anyone but yourself, replace their
content (`src/routes/terms.tsx`, `privacy.tsx`, `imprint.tsx`) with your own
legal texts before inviting users. They are templates, not legal advice.

## Backup & restore

All server-side state lives in the `quon-data` volume (`quon.db` +
`runtime_settings.json`). User content in it is end-to-end encrypted, so
the backup is safe to store, but **without each user's password or recovery
phrase nobody can decrypt the content, including you.**

> **Get the volume name right, or you will back up nothing.** Compose prefixes
> volumes with the _project_ name, which defaults to the **directory name**. If
> you cloned into `quon/` the volume is `quon_quon-data`; clone into `qu0n/` and
> it is `qu0n_quon-data`. Naming a volume that does not exist does not fail:
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

**Never lose `QUON_SERVER_SECRET`** (back it up separately): it seals
per-user provider keys. Rotating or losing it means users must re-enter
their keys; user _content_ is not affected (their own Master Keys protect it,
never the server).

## Upgrades

```bash
git pull
docker compose up -d --build
```

Database migrations apply automatically and forward-only at startup. Check
`docker compose logs scrubber` after an upgrade.

## Environment reference

The bundled `docker-compose.yml` **enumerates every variable it passes**; there
is no `env_file`. A key in `.env` alone therefore _never_ reaches a container: if
you add one, you must also add the passthrough line in `docker-compose.yml`. This
is the single most common self-hosting surprise.

The README covers the vars needed to boot. These are the ones that bite later:

| Var                                     | Default                               | Why you may need it                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RUNTIME_SETTINGS_PATH`                 | `<app dir>/runtime_settings.json`     | **Point this at your data volume.** Operator settings edited in the Settings UI (model catalog, provider keys) live in this file. Inside the image, every `--build` recreates it and silently reverts those edits, including users' model selection. The bundled compose already sets `/app/data/...`; anyone running the backend outside it (bare Docker, systemd, k8s) must set it. Read via `os.environ`, so it is _not_ in `config.py`. |
| `ALLOW_PRIVATE_PROVIDER_URLS`           | `false`                               | Needed to point a BYOK chat provider at a **private address**, such as a LAN Ollama or LM Studio (OpenAI-compatible). The SSRF guard blocks private IPs by default: right for a public instance, and exactly what blocks the home-lab setup.                                                                                                                                                                                                |
| `RATE_LIMIT_ENABLED`                    | `true`                                | Keep on for any instance with untrusted signups.                                                                                                                                                                                                                                                                                                                                                                                            |
| `ORIGINALS_QUOTA_BYTES`                 | `209715200` (200 MB)                  | Per-user ceiling for stored original document bytes.                                                                                                                                                                                                                                                                                                                                                                                        |
| `SIGNUP_INVITE_CODE`                    | `""`                                  | Non-empty means `/auth/register` requires this code; this is the invite gate.                                                                                                                                                                                                                                                                                                                                                               |
| `DEMO_SCRUB_ENABLED`                    | `false`                               | The scrub-only demo at `/demo`: a visitor pastes a text and sees the placeholders, no account, no model call, nothing stored. Off by default. `DEMO_SCRUB_MAX_CHARS` (2000) caps one text, `DEMO_SCRUB_GLOBAL_PER_MINUTE` (300) caps all visitors together; the per-IP limit is 30 a minute. `DEMO_CONTACT_URL` and `DEMO_CONTACT_EMAIL` (both optional) are where the page sends an interested visitor; empty, it offers the sign-in.      |
| `EMAIL_VERIFICATION`                    | `auto`                                | `auto` = verify by mail when `SMTP_HOST` is set, otherwise accounts are active on creation; `required`; `off`. See [E-mail verification](#e-mail-verification-optional).                                                                                                                                                                                                                                                                    |
| `TRUST_CF_CONNECTING_IP`                | `false`                               | Only behind Cloudflare: lets the rate limiter key on `CF-Connecting-IP`. Elsewhere the rate limiter uses the hop Caddy appends to `X-Forwarded-For` and ignores a client-sent header.                                                                                                                                                                                                                                                       |
| `SESSION_TTL_HOURS`                     | `720` (30 d)                          | Session lifetime.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `COOKIE_SAMESITE` / `COOKIE_DOMAIN`     | `lax` / `""`                          | Only for unusual proxy/subdomain setups; host-only cookie by default.                                                                                                                                                                                                                                                                                                                                                                       |
| `SMTP_STARTTLS`                         | `true`                                | `false` for implicit TLS on port 465 (see `SMTP_SSL`).                                                                                                                                                                                                                                                                                                                                                                                      |
| `OCR_CLOUD_MODEL` / `OCR_CLOUD_TIMEOUT` | `google/gemini-3.1-flash-lite` / `60` | The **cloud OCR fallback** for scanned pages with no text layer: per-photo, consented in the UI, and an egress path worth knowing about.                                                                                                                                                                                                                                                                                                    |
| `SAFETY_NET_ADDRESSES`                  | `true`                                | Sibling of `SAFETY_NET` / `SAFETY_NET_AMOUNTS`: the address regex in the deterministic layer.                                                                                                                                                                                                                                                                                                                                               |
| `QUON_CSP_CONNECT_EXTRA`                | `""`                                  | **Frontend service.** Extra origins for the page CSP's `connect-src` (e.g. a self-hosted Paperless the browser reaches directly).                                                                                                                                                                                                                                                                                                           |
| `QUON_CSP`                              | —                                     | **Frontend service.** `off` disables the enforcing CSP; emergency escape hatch only.                                                                                                                                                                                                                                                                                                                                                        |

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
The app sends its own per-request CSP, so don't add a second one.

### Where it runs

- **Public domain** (the diagram above): DNS points at the host, 80/443 are
  reachable, Caddy obtains and renews certificates by itself.
- **Private network / home server**: the browser still needs HTTPS. Two
  paths that need no public exposure:
  - _Caddy's internal CA:_ add `tls internal` to the site block in
    `deploy/Caddyfile.example` (it is mounted as the Caddyfile), set
    `QUON_DOMAIN` to the name your devices use (`quon.lan`, the host's name)
    and trust Caddy's root certificate on each device once
    (`docker compose exec caddy cat /data/caddy/pki/authorities/local/root.crt`).
  - _Tailscale:_ `tailscale cert <machine>.<tailnet>.ts.net` on the host and
    point Caddy at the certificate. Every device on the tailnet then reaches
    QUON over a valid HTTPS name, with nothing on the public internet.
- **This machine only:** `http://localhost` is a secure origin; the
  development setup in [CONTRIBUTING.md](../CONTRIBUTING.md) runs without
  TLS for exactly that reason. Other machines on the LAN cannot use that URL.

The insistence on HTTPS has a concrete reason: the end-to-end encryption, the
key wrapping and passkeys all run in the browser on `crypto.subtle`, which
browsers only expose on a secure origin. On plain `http://192.168...` the app
cannot even unlock an account.

## Troubleshooting

| Symptom                                         | Check                                                                                                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Backend restarts on boot                        | `docker compose logs scrubber`; a missing `QUON_SERVER_SECRET` or wildcard CORS fails fast with instructions                                                       |
| Registration mail never arrives                 | no `SMTP_HOST` + `EMAIL_VERIFICATION=auto` means there is no mail and the account is already active; with `required` the link is in the scrubber log (`DEV EMAIL`) |
| Chat blocked, "privacy filter unreachable"      | `/api/health`; the app **fails closed** when the scrubber is down                                                                                                  |
| Streaming answers cut off behind your own proxy | the proxy must not buffer SSE and must tolerate idle streams (the backend sends keep-alive pings every 20 s)                                                       |
| Models missing in the picker                    | no instance key; configure `OPENROUTER_API_KEY`, or add your own key in Settings                                                                                   |

## Security

See [SECURITY.md](../SECURITY.md) for vulnerability reporting and
[docs/threat-model.md](threat-model.md) for what QUON does and does not
protect against, including the honest limits of any web-delivered
end-to-end-encrypted app.
