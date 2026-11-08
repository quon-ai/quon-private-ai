# Detection experiments — the dated record

[detection-evaluation.md](detection-evaluation.md) explains the method: what
each measurement can and cannot see, and how to run the same checks. This page
is the other half — the record of what was actually tried: every setup, every
model, every data set, with the numbers each experiment produced and what was
decided on them.

Numbers here are historical facts, pinned to a date and where possible a
commit. They do not go stale, because they describe a measurement, not the
present build; the numbers the build must meet **today** live in one place
only, the ratchet in
[tests/test_corpus.py](../quon-scrubber-service/tests/test_corpus.py). The raw
ledgers behind this page are
[tests/reports/HISTORY.md](../quon-scrubber-service/tests/reports/HISTORY.md)
(corpus and golden-58 series, auto-log) and
[tests/reports/SCRUB_LATENCY.md](../quon-scrubber-service/tests/reports/SCRUB_LATENCY.md)
(scrub-path latency by chunk size).

Two rules shaped everything below. **Negative results are recorded with the
same care as wins** — a rejected idea without its numbers gets re-proposed
every few weeks. And **a run that cannot prove its configuration does not
count** — the section on traps explains why that rule exists.

---

## The system under test, by era

Detection ran through three architectures. Results only compare within an era
unless a row says otherwise.

| era                                                       | detection stack                                                                                                                                   | ended because                                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **LLM extraction** (until 2026-08-23)                     | spaCy/Presidio NER + regex net as the floor; an LLM extractor as the quality tier (cloud via OpenRouter, or local via Ollama)                     | the measured gap to in-process closed, while cost, latency variance and a cloud dependency remained              |
| **Self-hosted GPU** (evaluated 2026-08-19, never shipped) | same floor + a vLLM endpoint on a T4 as the extractor                                                                                             | in-process GLiNER on the production CPU matched the quality at a fraction of the latency and zero infrastructure |
| **In-process** (since 2026-08-23, current)                | spaCy/Presidio NER + GLiNER + deterministic regex net, grammar-guard chain, GLiNER cross-check — all in one process, no network call in detection | —                                                                                                                |

Models that appear in the record:

| model                                                                                  | role                                                                                 | status                                                                                                       |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| spaCy `de_core_news_md` / `en_core_web_md`                                             | NER proposer (with Presidio pattern recognizers; Presidio replaces, never detects)   | shipped, current                                                                                             |
| GLiNER `urchade/gliner_multi_pii-v1`                                                   | zero-shot span scorer, threshold 0.65 — second proposer and the cross-check verifier | shipped, current                                                                                             |
| `mistralai/mistral-small-3.2-24b-instruct` (OpenRouter)                                | LLM extractor, cloud tier                                                            | removed 2026-08-23                                                                                           |
| `google/gemma-3-12b-it` (OpenRouter)                                                   | earlier cloud extractor (June–July series)                                           | replaced, then tier removed                                                                                  |
| `qwen2.5:7b`, `qwen2.5:3b` (Ollama, M1)                                                | local extractor candidates                                                           | measured 2026-08-14, tier removed                                                                            |
| `qwen2.5-7b-awq`, `mistral-nemo-12b-awq`, `qwen2.5-14b-awq`, `qwen3-8b-awq` (vLLM, T4) | self-hosted extractor candidates                                                     | measured 2026-08-19, path abandoned                                                                          |
| Bonsai 27B (PrismML ternary)                                                           | local extractor candidate                                                            | unloadable: its GGUF uses a tensor type that exists only in PrismML's fork — rejected before any quality run |
| `knowledgator/gliner-pii-large-v1.0`                                                   | challenger detector                                                                  | rejected 2026-08-23 (worse recall on both real-data axes)                                                    |
| fastino GLiNER2 privacy filter                                                         | challenger detector                                                                  | not run: different architecture, needs its own package — not risked in an unattended trial                   |
| `bigcode/starpii`                                                                      | verifier candidate                                                                   | rejected as hard veto, usable as soft signal only                                                            |
| MiniLM `paraphrase-multilingual-MiniLM-L12-v2`                                         | verifier candidate (prototype scoring)                                               | rejected — catastrophic                                                                                      |
| mDeBERTa `xnli-multilingual-nli-2mil7`                                                 | verifier candidate (zero-shot NLI)                                                   | rejected — 500 MB for three false positives                                                                  |

---

## The data sets

Each instrument measures one thing. The column that matters most is the last
one — every bad conclusion in this record came from asking a set a question it
cannot answer.

| set                                     | size                                                                                | where                                      | measures                                                                                                                             | blind to                                                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Synthetic corpus (Faker, seeded)        | ~1,600–1,800 cases, DE/EN, ~2,800 gold values                                       | `tests/synth.py`                           | recall per type, ratcheted; bounded precision on its own distractors                                                                 | false positives in the wild: it is prose — no camelCase, no OCR damage, no form labels, no page furniture |
| Golden-58                               | 58 hand-written hard cases                                                          | `tests/test_texts.py`                      | regressions on known-hard shapes; the long-running comparison series                                                                 | breadth — it is 58 cases                                                                                  |
| Casual-register slice                   | fixed, hand-curated                                                                 | in `tests/synth.py`                        | the FP class formal corpora hide (short questions, imperatives, lowercase)                                                           | everything formal                                                                                         |
| Salted documents                        | 17 real layouts, 204 synthetic gold spans                                           | private (`~/.quon/realworld/salted.jsonl`) | **exact recall on real layouts**: synthetic values injected at known offsets, inheriting each document's measured OCR-damage profile | nothing by construction — but see the injector bug below                                                  |
| Real prompts                            | 1,951 exported chat prompts                                                         | private (`QUON_REALWORLD_DIR`)             | false positives on real casual text                                                                                                  | recall — no gold labels                                                                                   |
| Real documents                          | 45→50 documents, 527k→609k chars incl. OCR                                          | private                                    | false positives on real paperwork                                                                                                    | recall — no gold labels                                                                                   |
| Reviewed-FP ledger                      | 103 values at trial time; two tiers (open / fixed-and-asserted)                     | private (`labels.json`)                    | exact regression on every human-confirmed false positive                                                                             | anything not yet reviewed                                                                                 |
| TAB (text anonymisation benchmark, MIT) | 127 ECHR judgments; the 60-doc test split (495 PERSON spans) is what the trial used | public                                     | honest PERSON recall on unseen, formal, English real text                                                                            | German, casual register, layouts                                                                          |
| AI4Privacy (sample)                     | sampled once, 2026-08-22                                                            | public                                     | guard calibration examples (role nouns, mislabeled credentials)                                                                      | was never a standing eval — treated as a probe, not a gate                                                |

Two facts about the salted set that bound what its numbers mean. Its absolute
recall **understates** the detector: the injector had a glue bug (no trailing
space after an injected sentence, producing damage beyond the intended
profile), so between-setup comparisons are valid — every run saw identical
salt — but the headline number is a floor. And 22 of its spans are missed by
_every_ setup (hyphen-line-break damage the repair layer does not rejoin, plus
six genuinely hard names): those misses are a detector/repair finding, not a
verifier question — measured directly, the missed set is byte-identical across
verifier settings, because a verifier can only remove claims.

---

## E1 — 2026-08-14: how good is detection without the cloud?

Trigger: a beta user ran local mode with no reachable model — the bare floor —
under a green "protected" indicator. The question became: what does each tier
actually deliver? Full corpus (~1,700–1,800 cases), golden-58, Ollama on an
M1/16 GB for the local rows.

| configuration                | recall  | leak/value | messages ≥1 leak | precision   |
| ---------------------------- | ------- | ---------- | ---------------- | ----------- |
| floor: NER + regex only      | 77%     | 23%        | 39%              | 100%        |
| cloud: mistral-small-3.2-24b | **99%** | **1%**     | **2%**           | 97% (80 FP) |
| local: qwen2.5:3b            | 85%     | 15%        | 26%              | 98% (55 FP) |
| local: qwen2.5:7b            | **98%** | **2%**     | **4%**           | 98% (46 FP) |

Golden-58: cloud 98%/2%, local 7b 96%/4% (237/246 values); the 3b was dropped
from the golden run after the corpus verdict. Read at the time as: full-local
is real at 7b scale; the context-dependent types (CREDENTIAL, DATE,
INTERNAL_URL, INSURANCE_ID) scale with model size; and one anomaly —
INSURANCE_ID leaked ~33–35% at _every_ tier including the cloud, so it was a
type-definition problem, not capacity. (That diagnosis aged badly — see E6.)

Also in this round: **Bonsai 27B rejected unmeasured** — every GGUF variant
unloadable in standard tooling (a ternary tensor type that only exists in the
vendor's fork), and third-party repacks were ruled out on supply-chain grounds
for a PII engine.

**Methodology trap, walked into here:** `runtime_settings.json` silently
overrides environment variables, so a "local" run went over the cloud and was
caught only by counting Ollama requests. Since then: a run must _prove_ its
configuration (pin `RUNTIME_SETTINGS_PATH`, assert the settings in-process) or
it does not count. The same class bit once more on 2026-08-22, when a re-run
without the assertion sent documents through the cloud extractor and inflated
two public-set results (TAB +3, AI4Privacy +8) before being caught and
re-measured — the eval harnesses have refused to start misconfigured since.

---

## E2 — 2026-08-19: the self-hosted GPU detour, and the measurement that ended it

If the 7b closes the gap, a self-hosted endpoint should too, without a per-token
bill. Five candidates on a vLLM T4 (g4dn.xlarge, same AZ as production),
golden-58 quality through the real path, latency probed across chunk sizes
(the scrub is prefill-dominated, so a model fine on one-liners can be unusable
on document chunks):

| extractor                                       | 1k               | 4k               | 12k              | quality                                                 |
| ----------------------------------------------- | ---------------- | ---------------- | ---------------- | ------------------------------------------------------- |
| cloud mistral-small-3.2-24b (prod default then) | 22.2s (p95 38.3) | 20.6s (p95 38.8) | 13.8s            | the wait users complained about                         |
| **qwen2.5-7b-awq (T4)**                         | 5.2s (p95 5.2)   | 6.1s (p95 6.0)   | 7.2s             | recall 100%, 0 leaks, FP 33                             |
| mistral-nemo-12b-awq (T4)                       | 5.5s             | 6.8s             | 11.2s (p95 26.5) | 99.6%, 1 leak                                           |
| qwen2.5-14b-awq (T4)                            | 6.4s             | 7.9s             | 14.1s (p95 36.8) | 99.2%, 2 leaks                                          |
| qwen3-8b-awq (T4)                               | —                | —                | —                | disqualified: thinking mode on by default, ~26s/request |

The winner never shipped, because the same ledger's next row made it moot:
**GLiNER on the production box itself** — t3.large, 2 vCPU, no GPU — measured
0.45s / 0.88s / 3.11s on the same probe sizes, with corpus recall 99.6% and
golden-58 at 100%. A 300-MB in-process model beat the entire endpoint plan on
latency, cost and failure surface at once. This is the measurement that set
the in-process course.

---

## E3 — 2026-08-18→22: building the guard chain (what it took to keep GLiNER honest)

GLiNER labels role nouns and pronouns as people, confidently — measured on a
real notarial contract: "Der Notar" 0.93, "Käufer" 0.87, "du" 0.97, against a
real given name at 0.97. No threshold separates those, so the fix is a
structural post-filter. Findings from this phase, each with its number:

- **Grammar guards over word lists.** The person guard asks for grammatical
  evidence (plural morphology, determiner children in the parse, name-hostile
  punctuation, code-identifier shape, OOV-as-evidence), fails open, and takes a
  majority vote across a value's occurrences. "Any occurrence keeps" was
  measured first and rejected: on ECHR judgments the word "applicant" occurs
  372 times and always finds one lenient context.
- **Contrast veto at 0.80 score / 0.40 margin** — a PERSON claim loses to a
  company/software/product/job-title reading. Enriching the contrast label set
  ("substance", "generic term") was measured and **backfired: FP 153→178** — a
  richer label set raises person scores elsewhere. The two-label set stayed.
- **int8 quantisation of GLiNER: negative.** 3% _more_ memory on this
  architecture, zero detection change.
- **AI4Privacy probe findings** became guard tests: "Zugangscode" mislabeled
  as CREDENTIAL (a label is the pointer, not the secret), plural role nouns
  (Studierende, Rentner, Kunden) as PERSON — both are regression-pinned in
  `tests/test_ner.py`.
- **A rendering bug masqueraded as detection FPs.** The frontend highlighter
  used ASCII word boundaries, so a two-letter detection ("Re") painted nine
  German words on a real financial report while the backend produced zero.
  Boundary-fixed with Unicode classes; recorded here because it moved a whole
  complaint class out of detection scope.

---

## E4 — 2026-08-22→23: the detector–verifier trial (16 runs, pre-registered)

The remaining false positives clustered on spaCy PERSON claims. Question: does
a second opinion help, and whose? Pre-registered protocol (fixed metrics,
fixed gate, no peeking), run unattended overnight on the production
configuration, asserted per run. Three detectors (D0 = shipped GLiNER, D1 =
knowledgator-large, D2 = fastino — not run, see models table), verifier
settings V0–V6, guards on/off. Scored on: salted recall (/204), the reviewed
FP ledger (/103), TAB PERSON recall (/495 on the 60-doc test split), TAB FPs,
wall time.

| run            | what it is                           | salted | FP ledger /103 | TAB /495 | TAB FP | wall |
| -------------- | ------------------------------------ | ------ | -------------- | -------- | ------ | ---- |
| D0-V0-G0       | control, guards OFF                  | 186    | 18             | 485      | 1,972  | 366s |
| D0-V0-G1       | **control — as shipped**             | 182    | 18             | 485      | 214    | 338s |
| D1-V0-G0       | knowledgator, guards off             | 179    | 18             | 476      | 658    | 689s |
| D1-V0-G1       | knowledgator, guards on              | 177    | 18             | 476      | 135    | 650s |
| D3-V0-G1       | StarPII ensemble on D0               | 182    | 18             | 485      | 214    | 588s |
| D0-V1@0.02     | GLiNER cross-check, floor 0.02       | 182    | **1**          | 483      | 88     | 436s |
| **D0-V1@0.05** | **cross-check, floor 0.05 — winner** | 182    | **1**          | 483      | **88** | 409s |
| D0-V1@0.10     | cross-check, floor 0.10              | 182    | 1              | 476      | 88     | 436s |
| D0-V1@0.20     | cross-check, floor 0.20              | 182    | 1              | 469      | 78     | 419s |
| D0-V1@0.30     | cross-check, floor 0.30              | 182    | 1              | 469      | 75     | 413s |
| D0-V2-G1       | MiniLM prototype scoring             | 178    | 0              | **331**  | 80     | 368s |
| D0-V3-G1       | zero-shot NLI (~500 MB)              | 182    | 15             | 485      | 171    | 421s |
| D0-V5-G1       | local LLM verifier (qwen2.5:3b)      | 180    | 17             | 448      | 183    | 624s |
| D0-V6-G1       | StarPII as hard veto                 | 177    | 1              | 444      | **13** | 388s |

What the table established, beyond the winner:

- **The guards earn their keep**: guards-off multiplies TAB FPs by nine
  (214 → 1,972) for four salted spans of recall.
- **Verifiers cannot fix detector misses** — the 22 salted misses are
  byte-identical across V0, V1 and V3. A verifier only removes.
- **The cross-check floor bottomed out**: 0.02 and 0.05 are identical; the
  next lever is the detector, not the verifier.
- **Every alternative verifier is a measured negative.** The local-LLM
  instinct (V5): ledger 18→17, TAB −37 names, slowest of the night — worse
  than a free model query on every axis. NLI (V3): recall-perfect but 500 MB
  for three ledger FPs; an entailment model finds "Gesamtbrutto ist der Name
  einer Person" plausible. MiniLM prototypes (V2): destroyed 154 of 495 TAB
  names. StarPII as veto (V6): best precision of the trial (TAB FP 13) but
  kills titled and OCR-broken names ("Lord Justice Nourse", "Mrs G.") — a
  model trained on source code has never seen a legal register; soft signal
  at most. knowledgator-large (D1): worse recall on both real-data axes.

**The gate verdict and the adoption.** Pre-registered criterion "PERSON recall
may not fall at all" failed by exactly two named values — "Lichfield
Reynolds" and "Mrs Åkerblom", both English-court-register shapes; German and
salted recall untouched. Per protocol that call belonged to the operator, who
accepted the trade on 2026-08-23. D0-V1@0.05 shipped the same day: every
surviving PERSON claim is re-asked against GLiNER in ±120 chars of context,
any person score ≥ 0.05 keeps, no verdict keeps (fail-open), one tap in the
review UI releases a surviving false positive everywhere. Cost: +0 MB,
roughly +0.4–0.6s per scrub. The reviewed-FP ledger went from 18 firing
values to one (the single letter "L").

The LLM extraction tier was removed outright the same day — config, code and
API surface — after the trial showed the in-process stack plus cross-check at
or above the tier's measured quality on every axis that had justified it.

---

## E5 — 2026-08-23→24: false-positive classes from real use

Beta screenshots drove a series of structural guards, each measured against
the real sets before shipping (numbers in HISTORY.md and the test comments):

technical-document identifiers (camelCase, path segments, "PersonOnSite"),
article-led noun phrases ("A Lamp"), plural role nouns, legal term pairs
("Good Leaver"), role compounds ("Risikoperson"), hyphen-chain street names
("Bertha-von-Suttner-Str. 1"), and structural type validators (an EMAIL needs
an @, a ROUTING number at least eight digits, a PIN/CREDENTIAL claim may not
be a digitless short phrase — that last rule phrased as length, not digits,
because a digit requirement measurably leaked recovery phrases; the backend
suite caught it before it shipped).

One negative worth its line: **cross-check majority-of-windows** (require
most context windows to agree, not any) was measured and rejected — it killed
the legitimate "user"+"L" dismissals _and seven real court names_, because one
surname repeating 50 times in a judgment always finds lenient windows. The
knob exists, default off, with the numbers documented at the knob.

---

## E6 — 2026-09-04: the re-derivation (why stale diagnoses get re-measured)

A roadmap entry still said "INSURANCE_ID leaks 33–35% at every tier; fix the
extractor prompt" — but the blamed file and the whole tier had been deleted
two weeks earlier. Re-measured on the then-current pipeline (corpus of 1,620
cases / 2,836 gold values):

| measurement       | GLiNER on           | GLiNER off (floor) |
| ----------------- | ------------------- | ------------------ |
| INSURANCE_ID leak | **0.0%** (98/98)    | **0.0%** (98/98)   |
| CREDENTIAL leak   | **0.0%** (55/55)    | **0.0%** (55/55)   |
| PERSON recall     | 99.8% (1,475/1,478) | floor unchanged    |

The labelled-identifier rule and the regex net had already closed both gaps —
the 2026-08-14 numbers described a deleted architecture. What the corpus could
**not** see (every INSURANCE_ID template put a label next to the number): a
bare, unlabelled German health-insurance number ([A-Z] + 9 digits) leaked in
prose. It had been left out of the net because "the model already catches it"
— true once, false since the tier's removal. Fixed structurally with the
official check digit (§ 290 SGB V, verified against both worked examples in
the GKV spec): a random letter+9-digit order number passes 1 in 10, a real
KVNR always. The corpus gained unlabelled templates and checksum-valid
synthetic values — the ratchet now exercises the class it was blind to — and
the INSURANCE_ID and CREDENTIAL floors rose 95 → 98.

The same session decomposed one false positive from an end-to-end test —
"Ruhige Finca", a holiday-listing phrase from a fetched web page, redacted as
PERSON — into two structural causes, each now guarded and regression-pinned:

1. **Language mis-routing.** Umlaut-transliterated German ("Suedwesten",
   "fuer") carried zero hint-word evidence, fell to the English default, and
   the English tagger invented persons out of capitalised German noun phrases.
   The hint lexicon gained the transliterated register and casual
   calendar/quantity vocabulary — every added word individually vetted against
   English collisions (the lesson of "was"/"hat"/"also", applied forward).
2. **A missing grammar guard.** A span _opening_ with a declined,
   in-vocabulary German adjective whose syntactic head follows inside the span
   is a noun phrase, not a name. The Case-morphology requirement scopes the
   veto to German attributive declension, so "Big John", "Lieber Klaus
   Meier", "Ernst Weber" and "Frau Junge" survive — measured, not assumed.
   This guard works with GLiNER off, which is the self-host floor
   configuration.

Proof against the real sets, with same-ingest A/B runs (the changes stashed
in and out on identical inputs): 1,951 real prompts — zero new flagged
values, one false positive gone; 50 real documents — 666 distinct detections
before = 666 after, byte-identical; salted 182/204 before = after, every miss
the known hyphenation-repair gap.

---

## Since then

No detection-affecting change has shipped between 2026-09-06 and the date at
the top of this page. Dependency rounds (including a Presidio upgrade) are
re-validated by the same ratchet in CI — a floor breach fails the build, which
is the standing definition of "nothing changed".

Current configuration, for orientation (the enforced source of truth is the
code and the ratchet, not this snapshot): GLiNER `urchade/gliner_multi_pii-v1`
at threshold 0.65, person cross-check on at floor 0.05 (majority-of-windows
off), floors per type in `FLOORS` — EMAIL/IBAN 99, PHONE/FINANCIAL_AMOUNT/
INSURANCE_ID/CREDENTIAL 98, DATE/INTERNAL_URL 95, PERSON/ADDRESS 90, TAX_ID
55, PIN/ROUTING unfloored pending a deterministic rule.

## The standing negative results

Measured once, written down so they stay rejected until new evidence:

| idea                                  | measured outcome                                                    |
| ------------------------------------- | ------------------------------------------------------------------- |
| int8-quantised GLiNER                 | 3% more memory, zero detections changed                             |
| richer contrast-label set             | FP 153 → 178                                                        |
| cross-check majority vote             | kills 2 legitimate dismissals + 7 real court names                  |
| local LLM as verifier (3b, batched)   | ledger −1, TAB −37, slowest                                         |
| NLI verifier (mDeBERTa)               | 3 ledger FPs for ~500 MB                                            |
| embedding-prototype verifier (MiniLM) | 331/495 TAB names — catastrophic                                    |
| StarPII as hard veto                  | TAB FP 13, but kills titled + OCR-broken names                      |
| knowledgator-large as detector        | −6 salted, −9 TAB vs shipped GLiNER                                 |
| digit requirement on PIN              | leaks recovery phrases                                              |
| bare KVNR shape without checksum      | 1-in-10 collision with order numbers (why the check digit gates it) |
| Bonsai 27B ternary                    | unloadable outside vendor fork; repacks rejected (supply chain)     |

## What this record does not contain

Real personal data. The private sets (own prompts, own documents, the
reviewed-FP ledger) are described by size and role only; their values never
appear in reports' stdout, in commits, or here. Every value printed on this
page is synthetic (Faker), public court record (TAB), or a reviewed
_non_-person string from the ledger. The method for running the private
evaluations against your own data is in
[detection-evaluation.md](detection-evaluation.md).
