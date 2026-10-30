#!/usr/bin/env bash
# Measure time-to-first-token and streaming against the LIVE provider, and
# append the result to the ledger.
#
# This is CLAUDE.md's "measure before you ship anything on the answer path" rule
# lifted out of prose and made executable. It stayed prose for a reason that no
# longer holds: no unit test can catch this class (a mocked stream is always
# instant), so it was written as a rule. But a rule with no artefact is a rule
# that gets skipped — `openrouter:web_fetch` + `datetime` were added as
# "one-line adds under the same mechanism", cost ~9 s on EVERY message, killed
# streaming outright, and stayed live eleven days until a user compared QUON
# with ChatGPT. The same class recurred later with a blocking /mcp/servers fetch.
#
# Two things are measured, and BOTH matter: time to FIRST token, and whether the
# answer still arrives in several chunks. A change can leave the total untouched
# and still destroy streaming, which is most of what "feels slow" actually is.
#
# Usage:
#   scripts/measure-latency.sh --baseline "feature off"
#   scripts/measure-latency.sh --after    "web_fetch attached"
#
# Costs a few cents per run. Measures TWO models on purpose: they diverge —
# web_fetch stalled Gemini and not Sonnet.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
LEDGER="$ROOT/quon-scrubber-service/tests/reports/LATENCY.md"
# No default host: it would be the maintainer's device, which both leaks it into
# the public export and silently measures the wrong instance for anyone else.
HOST="${QUON_DEVICE_SSH:-}"
CONTAINER="${QUON_SCRUBBER_CONTAINER:-quon-scrubber-service_scrubber_1}"
if [[ -z "$HOST" ]]; then
  echo "Set QUON_DEVICE_SSH to the host running the scrubber, e.g." >&2
  echo "  QUON_DEVICE_SSH=user@host $0 --baseline \"feature off\"" >&2
  exit 1
fi
MODELS="${QUON_LATENCY_MODELS:-~google/gemini-flash-latest ~anthropic/claude-sonnet-latest}"

STATE="${1:-}"; NOTE="${2:-}"
case "$STATE" in
  --baseline) state="baseline" ;;
  --after)    state="after" ;;
  *) echo "usage: $0 --baseline|--after \"<what changed>\"" >&2; exit 1 ;;
esac
[[ -n "$NOTE" ]] || { echo "give a short note describing the state being measured" >&2; exit 1; }

sha="$(git -C "$ROOT" rev-parse --short HEAD)"
ts="$(date -u +%Y-%m-%dT%H:%MZ)"

echo "==> measuring on $HOST ($state: $NOTE)"
raw="$(ssh "$HOST" "docker exec -i $CONTAINER python -" <<PY
import asyncio, time, provider
from models import ChatTurn

async def run(model):
    t0 = time.perf_counter(); first = None; chunks = 0
    async for ev in provider.chat_stream(
        model,
        [ChatTurn(role="user", content="Erklaere kurz, wie eine Waermepumpe funktioniert.")],
        protected=False,
    ):
        if first is None:
            first = time.perf_counter() - t0
        if isinstance(ev, str):
            chunks += 1
    total = time.perf_counter() - t0
    print(f"{model}|{first:.2f}|{total:.2f}|{chunks}")

async def main():
    for m in "${MODELS}".split():
        try:
            await run(m)
        except Exception as e:
            print(f"{m}|ERR|ERR|0  # {e}")

asyncio.run(main())
PY
)"

[[ -f "$LEDGER" ]] || {
  mkdir -p "$(dirname "$LEDGER")"
  cat > "$LEDGER" <<'HDR'
# Latency ledger — time to first token, and whether streaming survived

Same shape as `HISTORY.md`: a curated series on top for decisions, a machine
appended auto-log below. Detection has had ratchet floors for months; latency
had none, and it is the class that regressed twice.

**A run without a BASELINE for comparison does not count.** The 2026-07 incident
was invisible precisely because nobody had the "feature off" number.

## Curated series

| date | change | model | first token | total | chunks | verdict |
| --- | --- | --- | --- | --- | --- | --- |

<!-- AUTO-LOG BELOW — appended by scripts/measure-latency.sh, do not edit -->

| ts | sha | state | note | model | first_s | total_s | chunks |
| --- | --- | --- | --- | --- | --- | --- | --- |
HDR
}

while IFS='|' read -r model first total chunks; do
  [[ -z "$model" ]] && continue
  printf '| %s | `%s` | %s | %s | %s | %s | %s | %s |\n' \
    "$ts" "$sha" "$state" "$NOTE" "$model" "$first" "$total" "${chunks%% *}" >> "$LEDGER"
  echo "    $model  first ${first}s  total ${total}s  chunks ${chunks%% *}"
done <<< "$raw"

echo "==> appended to ${LEDGER#$ROOT/}"
echo "    chunks == 1 means streaming is GONE, even if the total looks fine."
