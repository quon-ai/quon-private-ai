#!/usr/bin/env bash
#
# Print a stable fingerprint of the working tree AS IT WOULD BE DEPLOYED:
# HEAD + every tracked modification + the list of untracked, non-ignored files.
#
# preflight.sh stamps this into .preflight-ok when the gate goes green; the
# deploy guard re-computes it before any write to a device and refuses the
# deploy if the two differ, i.e. code changed after the gate passed.
#
# Known limit: an edit to an *untracked* file changes its content but not the
# porcelain line, so it is not caught. Everything that git tracks is.
#
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if command -v shasum >/dev/null 2>&1; then
  HASH=(shasum -a 256)
else
  HASH=(sha256sum)
fi

{
  git rev-parse HEAD 2>/dev/null || echo "no-head"
  git status --porcelain=v1 -uall 2>/dev/null
  git diff HEAD 2>/dev/null
} | "${HASH[@]}" | cut -d' ' -f1
