# Scrub-path latency — how long the PII filter keeps a message waiting

The scrub runs BEFORE the provider is called, so this time is added to every
message the user sends. It is prefill-dominated (up to `llm_cloud_chunk_chars`
in, a short JSON array out), which is why it is measured across chunk SIZES: a
model that looks fine on a one-liner can be unusable on a document chunk.

Same shape as `LATENCY.md` and `HISTORY.md`: a curated series for decisions, an
appended auto-log below. **A run with no baseline to compare against decides
nothing.**

## Curated series

| date | endpoint | model | 1k | 4k | 12k | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-08-19 | **PHASE 2** — all 5 candidates, one frozen net, guards armed. recall/leak/FP from golden-58 via the REAL path; p95 from a direct probe. | | | | | |
| 2026-08-19 | cloud (OpenRouter, prefs on) | mistral-small-3.2-24b | 5.2s p95 8.4 | 5.5s p95 6.1 | 5.4s p95 8.5 | recall 100.0% · 0 leaks · FP 26 · 3.9s/case |
| 2026-08-19 | self-hosted T4 | **qwen2.5-7b-awq** | 2.8s p95 3.2 | 3.3s p95 5.3 | 6.2s p95 16.4 | recall 100.0% · 0 leaks · FP 33 · **2.3s/case** |
| 2026-08-19 | self-hosted T4 | mistral-nemo-12b-awq | 5.5s p95 6.2 | 6.8s p95 9.9 | 11.2s p95 26.5 | recall 99.6% · 1 leak · FP 29 · 3.8s/case |
| 2026-08-19 | self-hosted T4 | qwen2.5-14b-awq | 6.4s p95 7.3 | 7.9s p95 12.3 | 14.1s p95 36.8 | recall 99.2% · 2 leaks · FP 30 · 4.4s/case |
| 2026-08-19 | self-hosted T4 | qwen3-8b-awq | — | — | — | **DISQUALIFIED**: default thinking mode, ~26s/req (~10x). Re-test owed with enable_thinking=false |
| 2026-08-19 | OpenRouter (prod default, prefs on) | mistral-small-3.2-24b | 22.2s (p95 38.3) | 20.6s (p95 38.8) | 13.8s | baseline — the wait users complained about (#57) |
| 2026-08-19 | self-hosted vLLM, g4dn.xlarge T4, same AZ | qwen2.5-7b-awq | **5.2s** (p95 5.2) | **6.1s** (p95 6.0) | **7.2s** | 3-4x faster, and p95 collapses from 38s to 5s |
| 2026-08-19 | **GLiNER on the PRODUCTION box** (t3.large, 2 vCPU), no GPU, no endpoint | gliner_multi_pii-v1 @0.65 | **0.45s** (69 ch) | **0.88s** (481 ch) | **3.11s** (1924 ch) | recall 99.6% corpus / 100% golden-58 · 12 leaks · FP 5 corpus / 37 golden |
| | ^ measured in an isolated container on the live host; median of 5 after warm-up. Model load 23.9s (cold start, once per process). Cost is SUPERLINEAR in length (~1.0 ms/char to 500 ch, ~1.6 ms/char beyond) — attention is quadratic, so a 1200-char chunk is ~1.9s and a 10k-char paste ~9 chunks ~17s. **Decisive win for ordinary chat messages (0.5-0.9s vs 22.2s), narrowing to roughly par on very long pastes.** ONNX int8 is the untried lever there. | | | | | |
| 2026-08-19 | self-hosted vLLM, same T4 | **qwen2.5-14b-awq** | 6.3s | 7.7s | 13.0s (max 36.8) | REJECTED — slower AND lower recall (98.4% vs the 7B's 99.2%) |

## Instance sizing — SEVEN types measured, then resized (2026-08-21)

Same GLiNER harness on every machine: score N chunks of 1200 chars, N = 1/4/9/42
(the chunk counts a 1k/4k/10k/50k document produces). 42 chunks, wall clock:

| instance | arch | vCPU | 1 chunk | 42 seq | 42 parallel |
| --- | --- | --- | --- | --- | --- |
| t3.large (was) | x86 | 2 = **1 core** | 1.49s | 62.4s | 57.9s |
| m7i.large | x86 | 2 | 1.10s | 46.1s | 43.2s |
| z1d.large | x86 | 2 | 1.09s | 45.4s | 41.2s |
| m7g.large | ARM | 2 | — | **73.0s** | 61.0s |
| c7g.xlarge | ARM | 4 | — | 45.8s | 31.7s |
| c8g.xlarge | ARM | 4 | 0.93s | 40.5s | 27.9s |
| c7a.xlarge | x86 AMD | 4 | 1.26s | 53.1s | **14.8s** |
| **c7i.xlarge** (now) | x86 | 4 | **0.82s** | 34.8s | 16.6s |

Three results that no spec sheet predicts, all worth keeping:

- **m7g.large is SLOWER than the t3.large it would replace** — 73.0s vs 62.4s
  sequential, 17% worse per core. It was the obvious "same size, newer, cheaper"
  upgrade and it is a downgrade.
- **z1d, sold on a 4.0 GHz sustained clock, is unremarkable** (1.09s) — clock did
  not predict this workload.
- **c7a wins on 42 chunks but LOSES on one** (1.26s vs c7i 0.82s): its 4 vCPU are
  4 real cores, so it scales 3.6x, while c7i is 2 cores + SMT scaling 2.1x. The
  COMMON case is a chat message, which is ONE chunk and does not parallelise —
  so the single-chunk column is the one that decides, not the headline.

c7i.xlarge also has the property that decided it: **x86, so a stop/change-type/
start resize** — same EBS volume, same Elastic IP, same tunnel, reversible by
changing the type back. Every ARM option needed a full migration.

### Deployed scrub path, before and after the resize

| size | t3.large | **c7i.xlarge** | gain |
| --- | --- | --- | --- |
| 1 000 | 1.86s | **1.34s** | 1.4x |
| 4 000 | 7.27s | **2.91s** | 2.5x |
| 10 000 | 17.43s | **6.96s** | 2.5x |
| 50 000 | 85.77s | **33.96s** | 2.5x |

Whole arc for a 50k document today: 124.45s -> 33.96s (3.7x), from the veto fix,
parallel chunks and this resize. A chat message: 6.98s -> 1.34s (5.2x).

## DEPLOYED — production, both perf fixes live (2026-08-21, image 8626d5d)

Measured INSIDE the running container, after verifying the code is actually in it
(`docker exec … python -c "import gliner_detect; hasattr(…, 'verdict_from_spans')"`).
An earlier reading of this same table measured the OLD image: `--force-recreate`
without `--build` recreates the container from the existing image, and the code
lives in the image, so a host-side rsync changes nothing. `verify-live.sh` did not
catch it because it compares ROUTES, and the routes were unchanged.

| size | before (deployed) | after (deployed) | gain |
| --- | --- | --- | --- |
| 1 000 | 6.98s | **1.86s** | 3.8x |
| 4 000 | 25.21s | **7.27s** | 3.5x |
| 10 000 | 42.60s | **17.43s** | 2.4x |
| 50 000 | 124.45s | **85.77s** | 1.45x |

Matches the overlay prediction (1.82 / 7.07 / 16.5 / 83.5), which is the check
that the right code is running.

Image and disk, same deploy: CUDA runtime out of a CPU-only image and the Ollama
service retired — image 2.47 GB, build 7m48s -> 2m44s, disk 9.2 GB -> 26 GB free.

Remaining gap to a dev Mac (M1, 4 performance cores): 1.86s vs 0.55s at 1000
chars. At that size the text is ONE chunk, so no parallelism is involved and the
3.4x is pure per-core speed. t3.large's "2 vCPU" is two hyperthreads of a SINGLE
physical core (lscpu: Thread(s) per core 2, Core(s) per socket 1).

## Scrub path by message size — production box, GLiNER only (2026-08-21)

t3.large (2 vCPU), `llm_enrichment=false`, `gliner_enabled=true`, veto reusing one
pass (8218e74), `gliner_chunk_chars=1200`. Times the REAL `scrubber.scrub()`, not
`extract_pii()` — see the warning below for why that distinction matters.

| size | chunks | mean | per 1000 chars |
| --- | --- | --- | --- |
| 1 000 | 1 | 1.82s | 1.82s |
| 4 000 | 4 | 8.05s | 2.01s |
| 10 000 | 9 | 19.82s | 1.98s |
| 50 000 | 42 | 100.03s | 2.00s |

**It is LINEAR at ~2.0s per 1000 characters**, and that is the useful fact: cost
is proportional to chunk COUNT, because chunking caps the quadratic attention term
inside each chunk. So any size can be predicted from one number, and the earlier
"superlinear" reading (1.0 ms/char to 500 chars, 1.6 ms/char beyond) was measuring
UNCHUNKED single passes, which the real path never does.

Two consequences:

- A chat message (<500 chars) costs about a second. That is the common case and it
  is fine.
- `max_text_length` is 50 000, so the worst case a user can submit is **100
  seconds**. That is a product problem, not a tuning one.

The obvious lever is that `_chunks()` is consumed by a plain sequential `for`
loop, while one chunk barely uses one core (measured: 1579ms on one thread vs
1506ms on two — GLiNER does not thread-scale within a chunk). Two chunks in
parallel on 2 vCPU should therefore near-halve the large-document case. Untried.

> ⚠️ **2026-08-21 — this script measures the WRONG THING for a tier switch.**
> `bench-scrub.sh` calls `llm_client.extract_pii()` DIRECTLY, so it times the LLM
> extraction endpoint and is blind to `LLM_ENRICHMENT`. Switching the tier off and
> re-running it produced an "after" of 32s — the same cloud call, unaffected. It
> answers "how fast is the LLM endpoint", never "how long does a scrub take".
>
> For a tier/architecture change, time `scrubber.scrub()` instead. Measured on the
> production box that way, cloud tier OFF and GLiNER on:
>
> | | veto per-candidate (as deployed 08-21) | veto reusing one pass (fixed) |
> | --- | --- | --- |
> | 1000 chars | 8.41s | **1.90s** |
> | 4000 chars | 23.46s | **8.23s** |
>
> Identical detections either way; the difference was `gliner_verdict()` running a
> full forward pass per PERSON candidate.

<!-- AUTO-LOG BELOW — appended by scripts/bench-scrub.sh, do not edit -->

| ts | sha | state | note | model | endpoint | chars | mean_s | p50_s | p95_s | entities | fails |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-08-18T20:39Z | `d706fcc` | baseline | openrouter mistral-small-3.2-24b (production default) | `mistralai/mistral-small-3.2-24b-instruct` | openrouter-default+prefs | 1000 | 22.20 | 17.30 | 38.33 | 13.0 | 0 |
| 2026-08-18T20:39Z | `d706fcc` | baseline | openrouter mistral-small-3.2-24b (production default) | `mistralai/mistral-small-3.2-24b-instruct` | openrouter-default+prefs | 4000 | 20.57 | 17.12 | 38.75 | 13.0 | 0 |
| 2026-08-18T20:39Z | `d706fcc` | baseline | openrouter mistral-small-3.2-24b (production default) | `mistralai/mistral-small-3.2-24b-instruct` | openrouter-default+prefs | 12000 | 13.80 | 14.40 | 14.53 | 12.0 | 0 |
| 2026-08-19T09:02Z | `aead33d` | after | self-hosted qwen2.5-7b-awq, vLLM on g4dn.xlarge (T4), same VPC/AZ | `qwen2.5-7b-awq` | self-hosted+vllm | 1000 | 5.15 | 5.14 | 5.16 | 11.0 | 0 |
| 2026-08-19T09:02Z | `aead33d` | after | self-hosted qwen2.5-7b-awq, vLLM on g4dn.xlarge (T4), same VPC/AZ | `qwen2.5-7b-awq` | self-hosted+vllm | 4000 | 6.09 | 5.99 | 6.00 | 12.0 | 0 |
| 2026-08-19T09:02Z | `aead33d` | after | self-hosted qwen2.5-7b-awq, vLLM on g4dn.xlarge (T4), same VPC/AZ | `qwen2.5-7b-awq` | self-hosted+vllm | 12000 | 7.16 | 6.70 | 6.71 | 11.0 | 0 |
| 2026-08-19T10:53Z | `199c58e` | after | qwen2.5-14b-awq, vLLM on the same g4dn.xlarge (T4) | `qwen2.5-14b-awq` | self-hosted+vllm | 1000 | 6.33 | 6.20 | 7.29 | — | 0 |
| 2026-08-19T10:53Z | `199c58e` | after | qwen2.5-14b-awq, vLLM on the same g4dn.xlarge (T4) | `qwen2.5-14b-awq` | self-hosted+vllm | 4000 | 7.67 | 7.01 | 12.28 | — | 0 |
| 2026-08-19T10:53Z | `199c58e` | after | qwen2.5-14b-awq, vLLM on the same g4dn.xlarge (T4) | `qwen2.5-14b-awq` | self-hosted+vllm | 12000 | 12.99 | 9.59 | 36.78 | — | 0 |
| 2026-08-21T07:48Z | `e319d50` | baseline | cloud mistral-small-3.2-24b + GLiNER (BOTH tiers on) | `mistralai/mistral-small-3.2-24b-instruct` | openrouter-default+prefs | 1000 | 28.66 | 31.34 | 38.39 | 13.0 | 0 |
| 2026-08-21T07:48Z | `e319d50` | baseline | cloud mistral-small-3.2-24b + GLiNER (BOTH tiers on) | `mistralai/mistral-small-3.2-24b-instruct` | openrouter-default+prefs | 4000 | 8.55 | 6.89 | 13.46 | 13.0 | 0 |
| 2026-08-21T08:20Z | `e319d50` | after | GLiNER only, in-process (cloud extraction OFF) | `mistralai/mistral-small-3.2-24b-instruct` | openrouter-default+prefs | 1000 | 32.09 | 33.15 | 35.36 | 13.0 | 0 |
| 2026-08-21T08:20Z | `e319d50` | after | GLiNER only, in-process (cloud extraction OFF) | `mistralai/mistral-small-3.2-24b-instruct` | openrouter-default+prefs | 4000 | 5.31 | 5.29 | 5.49 | 13.0 | 0 |
