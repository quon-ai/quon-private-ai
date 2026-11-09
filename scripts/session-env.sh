#!/usr/bin/env bash
# Per-checkout ports and scratch paths, so two sessions can work at once.
#
# The problem this solves: git worktrees isolate the source, but not the test
# harness. playwright.config.ts hardcoded :8011/:8012 and /tmp/quon_e2e.db, and
# deleted those files at every run start - so a second run wiped the first run's
# live database mid-suite, silently. Ports and scratch paths must therefore be
# derived from which CHECKOUT you are in.
#
# The primary checkout keeps the historical numbers (8080 / 8011 / 8012) on
# purpose: the docs, launch.json and everyone's muscle memory refer to them, and
# a change there would be churn for no benefit. Only additional worktrees get
# derived slots.
#
# Usage:
#   eval "$(scripts/session-env.sh --export)"   # in a shell
#   scripts/session-env.sh                      # key=value, for other tools
#   scripts/session-env.sh --claim              # also assert ownership of the tmp dir
#
# Override the slot explicitly with QUON_SESSION_SLOT (e.g. to reproduce CI).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"

# The primary checkout is the one whose .git is a directory; in a linked worktree
# .git is a FILE pointing at the common dir. Cheap, and no git call needed.
is_primary=0
[[ -d "$ROOT/.git" ]] && is_primary=1

if [[ -n "${QUON_SESSION_SLOT:-}" ]]; then
  SLOT="$QUON_SESSION_SLOT"
elif (( is_primary )); then
  SLOT=0
else
  # Stable per path, so a worktree keeps its ports across runs. 39 slots + the
  # primary; a collision is possible and is caught by --claim below rather than
  # silently sharing a database.
  if command -v shasum >/dev/null 2>&1; then
    H="$(printf '%s' "$ROOT" | shasum -a 256 | cut -d' ' -f1)"
  else
    H="$(printf '%s' "$ROOT" | sha256sum | cut -d' ' -f1)"
  fi
  SLOT=$(( 1 + 16#${H:0:6} % 39 ))
fi

if (( SLOT == 0 )); then
  DEV_PORT=8080; API_PORT=8011; WEB_PORT=8012
else
  BASE=$(( 8100 + SLOT * 4 ))          # 8104 ... 8256, clear of 8000/8080/8085/8090/11434
  API_PORT=$BASE; WEB_PORT=$(( BASE + 1 )); DEV_PORT=$(( BASE + 2 ))
fi

# A DIRECTORY, not loose files: playwright's cleanup can then wipe its own
# scratch space without any chance of naming another run's database.
TMP_DIR="${TMPDIR:-/tmp}"
TMP_DIR="${TMP_DIR%/}/quon-e2e-$SLOT"

emit() {
  echo "QUON_SESSION_SLOT=$SLOT"
  echo "QUON_SESSION_ROOT=$ROOT"
  echo "QUON_DEV_PORT=$DEV_PORT"
  echo "QUON_E2E_API_PORT=$API_PORT"
  echo "QUON_E2E_WEB_PORT=$WEB_PORT"
  echo "QUON_E2E_TMP=$TMP_DIR"
  echo "QUON_E2E_DB=$TMP_DIR/quon_e2e.db"
  echo "QUON_E2E_BACKEND_LOG=$TMP_DIR/backend.log"
}

case "${1:-}" in
  # Values are quoted: this repo's own path contains a space, which made a bare
  # `export K=V` split into two words and fail as "not a valid identifier".
  --export) emit | sed "s/^\([A-Za-z_][A-Za-z0-9_]*\)=\(.*\)$/export \1='\2'/" ;;
  --claim)
    # Turn a hash collision into a refusal instead of a shared database.
    mkdir -p "$TMP_DIR"
    owner_file="$TMP_DIR/owner"
    if [[ -f "$owner_file" ]]; then
      owner="$(cat "$owner_file")"
      if [[ "$owner" != "$ROOT" && -d "$owner" ]]; then
        echo "ERROR: slot $SLOT is already owned by another checkout:" >&2
        echo "  $owner" >&2
        echo "Set QUON_SESSION_SLOT=<n> explicitly for this checkout." >&2
        exit 1
      fi
    fi
    printf '%s' "$ROOT" > "$owner_file"
    emit
    ;;
  *) emit ;;
esac
