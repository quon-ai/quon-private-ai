# License compliance

How QUON's third-party dependencies are licensed, what's allowed, the reviewed
exceptions, and how to keep the attribution up to date. It pairs with the
automated supply-chain checks in `.github/workflows/supply-chain.yml`.

## Policy

This is the policy for **third-party dependencies**; QUON's own licence is
the `LICENSE` file at the repository root and is not what this gate checks.
Dependencies must be **permissive** (MIT, ISC, BSD-2/3, Apache-2.0, 0BSD,
Unlicense, Python-2.0/PSF, Boost, or the weak-copyleft MPL-2.0). **Strong and
network copyleft dependencies (GPL, AGPL, SSPL) are not allowed** in anything
we distribute, so that QUON stays redistributable whatever licence it ships
under; the CI license gate fails the build if one appears:

- Frontend: `npm run licenses:check` (also runs in the `licenses` CI job).
- Backend: `pip-licenses --fail-on 'GPL;AGPL;SSPL'` (in the `licenses` CI job).

Each run uploads the full inventory as a CI artifact, and the `sbom` job produces
a machine-readable **CycloneDX SBOM**.

## Current state (reviewed 2026-07-17, notices regenerated 2026-08-14)

Both ecosystems are clean against the policy: **no GPL/AGPL/SSPL**. The frontend
is overwhelmingly MIT (~393) plus ISC/BSD/Apache; the backend is
Apache/MIT/BSD/ISC/PSF plus one MPL-2.0 (weak copyleft, permitted). Four items
were reviewed and accepted; each is compliant:

| Dependency                           | Declared license             | Pulled in by                     | Why it's fine                                                                                                                                                                                                                          |
| ------------------------------------ | ---------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@img/sharp-libvips-*` (via `sharp`) | LGPL-3.0-or-later            | `@huggingface/transformers`      | The **Node.js** image path of Transformers.js. QUON runs Transformers.js **in the browser** (client-side embeddings), so this native libvips binary is never bundled, shipped or executed, and there is no LGPL conveyance obligation. |
| `clipper-lib`                        | "Custom" (unrecognized SPDX) | `@paddleocr/paddleocr-js`        | The JS Clipper port, licensed **Boost Software License 1.0**, which is permissive. Shipped (on-device OCR); the notices file carries the attribution.                                                                                  |
| `jszip`                              | `MIT OR GPL-3.0-or-later`    | `mammoth`                        | Dual-licensed; we **elect MIT**. No GPL obligation.                                                                                                                                                                                    |
| `caniuse-lite`                       | CC-BY-4.0                    | `browserslist` (build toolchain) | Build-time data only, **not shipped** in the bundle, so the attribution requirement is not triggered.                                                                                                                                  |

## Attribution (THIRD-PARTY NOTICES)

Permissive licenses (MIT/BSD/Apache/ISC/Boost/...) require preserving their
copyright/permission notices when the software is distributed. QUON carries them
in generated notices files, committed to the repo:

- **`THIRD_PARTY_NOTICES.txt`**: frontend production dependencies and the full license texts.
- **`quon-scrubber-service/THIRD_PARTY_NOTICES.txt`**: backend dependencies and license texts.

### Regenerate (after changing dependencies)

```bash
# Frontend
npm run licenses:notices

# Backend (from quon-scrubber-service/): a throwaway venv that holds ONLY the
# runtime requirements and no bytecode. pip-licenses takes any file named
# license* in a package's RECORD for its licence text, so a venv installed with
# pip would hand it __pycache__/license.*.pyc, and the compiled module (local
# paths included) would land in the notices verbatim. uv does not compile.
uv venv --python 3.11 /tmp/quon-notices-venv
uv pip install --python /tmp/quon-notices-venv/bin/python \
  --index-strategy unsafe-best-match --extra-index-url https://download.pytorch.org/whl/cpu \
  -r requirements.txt pip-licenses
/tmp/quon-notices-venv/bin/python -m piplicenses --with-urls --with-license-file \
  --no-license-path --format=plain-vertical \
  --ignore-packages pip-licenses prettytable wcwidth \
  --output-file THIRD_PARTY_NOTICES.txt
# must print "clean": no NUL byte and no developer path in the result
perl -ne 'exit 1 if /\x00|\/Users\/|\/home\//' THIRD_PARTY_NOTICES.txt && echo clean
```

Regenerate whenever dependencies change (e.g. when merging a Dependabot PR) so the
attribution stays accurate; `npm run licenses:notices` covers the frontend half.
Use the runtime requirements, never the development venv: the latter also lists
test and tooling packages that are not part of what ships.

> This has drifted before: the 2026-08-14 regeneration picked up **`mermaid`** and
> **`@tauri-apps/plugin-http`**, two production dependencies that had shipped
> without attribution. The notices file is part of what you distribute, so treat a dependency change without regeneration as an
> incomplete change.

## SBOM (Bill of Materials)

**No SBOM is committed to this repository**; it is generated, because a
checked-in one is stale the moment a dependency changes (exactly how the
attribution file drifted, see above). Three ways to get a current one:

```bash
# 1. Frontend only, no tooling to install (npm ≥ 9):
npm sbom --sbom-format cyclonedx --omit dev > quon-sbom.cyclonedx.json

# 2. Both ecosystems (npm + pip), requires Syft:
#    install: https://github.com/anchore/syft
syft dir:. -o cyclonedx-json=quon-sbom.cyclonedx.json

# 3. From CI: the `sbom` job in .github/workflows/supply-chain.yml runs on every
#    push to main, on PRs and weekly, and uploads `sbom-cyclonedx`
#    (CycloneDX JSON, 90-day retention).
```

Option 1 needs a `version` in `package.json`: `npm sbom` refuses to build purls
without one, which is why that field is not optional here even though the package
is never published.

This is the machine-readable inventory an EU-CRA / NIS2 procurement or security
review expects (it satisfies the NTIA minimum-elements checklist). If you
distribute a build to third parties, generate the SBOM **for that build** and ship
it alongside; don't point at this repo.
