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
| 2026-11-03T21:15Z | `73e72ca` | baseline | global routing, before OPENROUTER_REGION=eu (live box) | ~google/gemini-flash-latest | 1.95 | 7.51 | 17 |
| 2026-11-03T21:15Z | `73e72ca` | baseline | global routing, before OPENROUTER_REGION=eu (live box) | ~anthropic/claude-sonnet-latest | 0.72 | 4.85 | 126 |
| 2026-11-03T21:15Z | `73e72ca` | baseline | global routing, before OPENROUTER_REGION=eu (live box) | ~openai/gpt-latest | 1.67 | 4.70 | 148 |
