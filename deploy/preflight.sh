#!/usr/bin/env bash
#
# Local regression checks: the fast, deterministic stages only.
# Run from anywhere; it cd's to the repo root.
#
#   ./deploy/preflight.sh                 # frontend gates + backend pytest + ratchet
#   SKIP_BACKEND=1 ./deploy/preflight.sh  # frontend only (e.g. a frontend-only change)
#
# This is not the deploy gate. The cross-browser E2E suite is part of that
# gate and does not run here, on purpose: on a loaded laptop it fails on
# timeouts that never reproduce in isolation, and a gate that fails randomly
# is one people learn to route around. A deploy needs a green CI run of the
# same stages, including E2E, for exactly the commit being deployed.
#
# The stamp written at the end records skip_e2e=1, which the deploy guard
# refuses, so running this cannot arm a deploy by accident.
#
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# The gate must not change the tree it is measuring. It used to: the eval wrote
# Tracked report files, so every run dirtied the tree, changed the fingerprint
# below and invalidated its own stamp - which made the deploy gate's clean-tree
# requirement unsatisfiable while looking like a stamp bug. Snapshot now, compare
# at the end, fail loudly. Same shape as the FLOORS asserts: the rule is only
# real if something breaks when it is violated.
TREE_BEFORE="$(git status --porcelain=v1 -uall 2>/dev/null || true)"

echo "==> Frontend: typecheck + lint + unit tests + build"
npm run preflight

if [[ "${SKIP_BACKEND:-0}" == "1" ]]; then
  echo "==> Backend tests skipped (SKIP_BACKEND=1)"
else
  echo "==> Backend: pytest"
  if [[ -x quon-scrubber-service/.venv/bin/python ]]; then
    (cd quon-scrubber-service && ./.venv/bin/python -m pytest -q -n auto --dist loadfile)
    # Detection ratchet: enforce the recall/precision floors (config 1 = NER +
    # regex, no LLM -> no API key needed). The plain pytest above SKIPS the corpus
    # (QUON_RUN_CORPUS unset), so without this a recall regression below the floor
    # would deploy green. ~20s.
    echo "==> Backend: detection ratchet (corpus recall/precision floors)"
    (cd quon-scrubber-service && QUON_RUN_CORPUS=1 ./.venv/bin/python -m pytest tests/test_corpus.py -q)
  else
    echo "!! quon-scrubber-service/.venv not found." >&2
    echo "   Create it:  python -m venv quon-scrubber-service/.venv \\" >&2
    echo "               && quon-scrubber-service/.venv/bin/pip install -r quon-scrubber-service/requirements-dev.txt" >&2
    echo "   Or run frontend-only:  SKIP_BACKEND=1 ./deploy/preflight.sh" >&2
    exit 1
  fi
fi

TREE_AFTER="$(git status --porcelain=v1 -uall 2>/dev/null || true)"
if [[ "$TREE_BEFORE" != "$TREE_AFTER" ]]; then
  echo "!! The gate modified the working tree while running." >&2
  echo "   That invalidates the stamp written below and blocks the deploy gate," >&2
  echo "   which requires a clean tree. Diff of what changed:" >&2
  diff <(printf '%s\n' "$TREE_BEFORE") <(printf '%s\n' "$TREE_AFTER") >&2 || true
  echo "   Route generated output to a gitignored path — see" >&2
  echo "   quon-scrubber-service/tests/report_paths.py." >&2
  exit 1
fi

# Stamp the result for local bookkeeping. skip_e2e=1 always: the E2E stage does
# not run here, and the deploy guard refuses this stamp for device writes.
{
  echo "fingerprint=$("$ROOT/deploy/tree-fingerprint.sh")"
  echo "epoch=$(date +%s)"
  echo "skip_backend=${SKIP_BACKEND:-0}"
  echo "skip_e2e=1"
  echo "source=local-preflight"
} > "$ROOT/.preflight-ok"

echo "==> local checks passed (typecheck · lint · unit · build · backend · ratchet)"
echo "    The E2E suite is not part of this gate; run it separately:  npm run e2e"
