# PII Detection in QUON — Architecture Selection and Quality Evidence

Frederic Koppenberg - QUON / Privacy Gateway

## Abstract

This document is both a problem statement and a solution proposal regarding
the **detection architecture of QUON's privacy filter** — the component that
finds personal data in a message and replaces it with typed placeholders
before anything reaches a model provider. It is written for contributors and
technically interested operators of the self-hosted edition, and it covers the
architectures we evaluated, the measurement instruments we built, the numbers
each candidate produced, and the decisions taken on them between June and
September 2026.

This document assumes the reader is familiar with the basic vocabulary of
information extraction (named-entity recognition, precision and recall) and
with QUON's product claim as stated in the repository's README. It is written
from the perspective of the team operating both the product and its
evaluation; the observations are a) first-hand, b) reproducible from the
repository's test suite and tracked ledgers, and c) obviously biased towards
the architecture we eventually shipped. Where the document is critical, it is
critical of structures and artefacts — above all of our own measurement
instruments — not of individuals.

The document focuses on the _what_ and _why_ rather than the specific _how_:
the implementation detail lives in the repository
([detection-evaluation.md](detection-evaluation.md) for the method,
[detection-experiments.md](detection-experiments.md) for the full dated
record), and this paper names those places rather than duplicating them.

**Document Status:** Draft
**Last Changed:** 2026-11-04
**Change log:** 2026-11-04: initial version, consolidated from the experiment
record.
**Correspondence:** via the public repository's issue tracker
(github.com/quon-ai/quon-private-ai).

## 1. Structure of the Document

In Section 2 we provide the terms the paper relies on. In Section 3 we
describe the current situation: the product claim, the measurement
instruments and their blind spots, and two methodological failures we walked
into. In Section 4 we state the problem. In Section 5 we define the
evaluation criteria, and in Section 6 we span the solution space: four
architectures, the models evaluated within each, and the measured evidence,
closing with an evaluation table. Section 7 is the management summary;
Section 8 gives our opinion and recommendation, including the conditions
under which the approach fails. Section 9 collects miscellaneous remarks and
open questions.

## 2. Preliminaries

The list is by no means exhaustive, but should cover the terms this paper
cannot do without:

- **Recall / leak rate** — the share of gold personal values that no longer
  appear in the scrubbed output; leak rate is its complement, reported per
  value and per entity type. A privacy filter's recall failure is a
  disclosure, which is why recall carries more weight than precision
  throughout.
- **Precision / false positive (FP)** — the share of values that must survive
  (public terms, product names, role nouns) and did. A false positive is not
  harmless: it destroys the user's trust in the redaction preview and, at
  scale, the product.
- **Detector / verifier** — a detector _proposes_ spans; a verifier may only
  _remove_ proposals. The asymmetry matters: a verifier can repair precision
  but, by construction, never recall (measured directly in Section 6.3.2).
- **Fail-open / fail-closed** — a guard that errs towards keeping a claim
  (redacting) fails open; the send path as a whole fails closed (no scrubber,
  no sending). Every guard that can drop a detection must fail open.
- **Ratchet** — a floor per entity type, asserted by the test suite and CI; a
  build below any floor does not ship. Floors move in one direction and only
  after a measurement.
- **Salting** — injecting synthetic gold values into _real_ document layouts
  at known offsets, inheriting each document's measured OCR-damage profile.
  It is the only instrument here that measures exact recall on real layouts
  without using real personal data.
- **Gold label** — a value known to be personal data because the generator
  placed it, a human annotated it (TAB), or the injector salted it. Real
  private text has no gold labels, which constrains what it can measure.

## 3. Current Situation

### 3.1 The product claim and the stack

QUON's central claim is that personal data is detected and replaced
**client-side, before any provider is involved**. Whatever detection misses
reaches the provider in clear text; the quality of this one step therefore
carries the product. Since 2026-08-23 detection runs fully in-process:
spaCy/Presidio NER and a GLiNER span scorer propose, a deterministic regex
net covers the structured types, a grammar-guard chain and a GLiNER
cross-check control false positives, and placeholders are applied by
position. There is no network call anywhere in detection.

### 3.2 The instruments, and what each cannot see

Quality is measured by seven instruments: a seeded synthetic corpus
(~1,600–1,800 DE/EN cases) with per-type floors; 58 hand-written hard cases;
a hand-curated casual-register slice; salted real documents (204 gold spans
across 17 layouts); the operator's own exported prompts (1,951) and documents
(50, including OCR) reviewed for false positives against a two-tier ledger;
and the public TAB benchmark (ECHR judgments; the 60-document test split with
495 PERSON spans). Each instrument answers exactly one question; the record's
worst conclusions came from asking an instrument a question it cannot answer.

It is necessary to be self-critical here: **our primary instrument lied to us
first**. The synthetic corpus is prose — no camelCase, no OCR damage, no form
labels, no page furniture — and on 2026-08-22 it reported perfect recall and
zero false positives on a build that was redacting ordinary words
("Versicherungsnehmer", "person", "end user") in real documents. The
instrument, not the detector, was the first thing that had to be fixed, and
the fix was structural: false-positive hunting moved to real data (own
prompts, own documents, a reviewed ledger), recall measurement to salted
layouts and a public benchmark, and the corpus was demoted to what it is good
at — a reproducible recall ratchet.

### 3.3 A run must prove its configuration

Twice, a measurement silently ran a different configuration than intended: a
device-local settings file overrides environment variables, so a "local" run
went over a cloud extractor (caught only by counting local-model requests),
and a later re-run without the guard sent documents through the cloud tier
and inflated two public-set results (TAB +3, AI4Privacy +8) before being
caught and re-measured. The consequence is a standing rule, enforced in the
harnesses themselves: **a run that cannot prove its configuration does not
count**. Evaluation scripts assert the production configuration in-process
and refuse to start otherwise.

### 3.4 Private data stays private

The strongest evidence comes from the operator's own prompts and paperwork,
which must never leave the device. The method is public, the data is not:
reports with real values are written only to a private directory, stdout
carries aggregates, and the repository's export gate greps every public tree
for identifiers. Every value printed in the public record is synthetic, a
published court record, or a reviewed _non_-person string.

**Main takeaways.** Detection is in-process and carries the product claim;
seven instruments each answer one question; the synthetic corpus alone is a
proven liar about real-world false positives; configuration is asserted, not
remembered; real personal data never leaves the device.

## 4. Problem Statement

> **Problem Statement.** Select and evidence a PII-detection architecture
> that (a) runs without any external service on commodity hardware, (b)
> demonstrably reaches at least the quality of a cloud-LLM extractor on
> recall-critical types, (c) keeps false positives on real documents low
> enough that the redaction preview stays trustworthy, and (d) is enforceable
> — every quality number must be gated by a test that fails the build, not
> remembered in prose.

It is worth stressing what the problem is _not_: it is not a general
benchmark of extraction models (models are evaluated only as far as a
decision needs); it is not the anonymisation of stored corpora (QUON scrubs
messages in flight); and it is not a provider-side safety layer — the design
assumption is that nothing past the gateway can be trusted with clear text.

## 5. Evaluation Criteria

We evaluate options against six criteria (each on an arbitrary scale from 1
to 10, 1 being unfavourable, 10 being highly favourable):

- **Recall on gold sets** — synthetic corpus per-type recall, salted-layout
  recall, TAB PERSON recall.
- **False-positive behaviour on real text** — the reviewed ledger and the
  two real-data suites; the redaction preview must stay believable.
- **Enforceability** — how much of the behaviour is deterministic enough to
  ratchet; a stochastic tier can be measured but not tightly gated.
- **Latency on the send path** — scrub time is added to every message; p95
  matters more than the mean (measured per chunk size).
- **Footprint and operability** — memory, GPU requirement, cold start,
  self-host friendliness on a 2-vCPU box.
- **Privacy and supply-chain posture** — whether clear text leaves the
  process, and what third parties the detection path trusts.

## 6. Solution Space

Four architectures were evaluated. The paper is **biased towards Option C**
(the in-process ensemble): it is the one we shipped, and it is therefore
elaborated in more detail; elements shared by all options — the regex net,
the guard chain, the measurement harness — are described under Option C and
referenced from the others rather than repeated.

### 6.1 Option A — cloud LLM extractor

An LLM behind an API extracts entities from each chunk
(`google/gemma-3-12b-it` in the June–July series, then
`mistralai/mistral-small-3.2-24b-instruct`). Measured on the full corpus on
2026-08-14: **99% recall / 1% leak per value**, 97% precision (80 FPs);
golden-58 at 98%/2%. Weak types remained INSURANCE_ID (35% leak) and
CREDENTIAL (4.6%).

Strengths: best headline recall of the LLM era; no local resources.
Weaknesses: clear text of every message transits a third party — for a
privacy gateway an inversion of the product claim, acceptable only as an
explicit opt-in; p95 latency on the send path measured at 38s on
document-sized chunks (the wait users actually complained about);
per-message cost; behaviour is model-version-dependent and cannot be
ratcheted; and the type that was weak stayed weak regardless of scale,
because the failure was in the type definition, not the model (see
Section 6.5).

### 6.2 Option B — local or self-hosted LLM extractor

The same extraction prompt against local weights. Two sub-variants were
measured:

**B1, Ollama on end-user hardware** (M1, 16 GB, 2026-08-14): `qwen2.5:7b`
reached **98% recall / 2% leak** (golden-58 96%/4%) — full-local was real at
7B scale; `qwen2.5:3b` at 85%/15% was dropped (too close to the 77% floor to
justify its cost); the ternary 27B candidate (Bonsai/PrismML) was rejected
unmeasured — its GGUF uses a tensor type that exists only in the vendor's
fork, and third-party repacks were ruled out on supply-chain grounds.

**B2, vLLM endpoint on a T4** (g4dn.xlarge, same availability zone,
2026-08-19): `qwen2.5-7b-awq` won the five-candidate bake-off — 5.2s/6.1s/7.2s
across 1k/4k/12k-character probes (p95 collapsing from the cloud's 38s to
~6s), golden-58 recall 100%, 0 leaks. `mistral-nemo-12b-awq` and
`qwen2.5-14b-awq` were slower at equal or worse quality; `qwen3-8b-awq`
disqualified itself (thinking mode on by default, ~26s/request).

Strengths: clear text stays within our infrastructure (B2) or on the device
(B1); quality at 7B scale genuinely closes the gap. Weaknesses: B1 binds
detection quality to the end user's hardware and model management; B2 buys a
GPU host, an endpoint to operate and secure, and a second failure surface —
and both remain stochastic tiers that can be measured but not tightly gated.
B2 was abandoned the same day it won its bake-off, for the reason in 6.3.

### 6.3 Option C — in-process ensemble (shipped)

The measurement that ended the GPU detour: **GLiNER
(`urchade/gliner_multi_pii-v1`, ~300 MB) on the production box itself** —
t3.large, 2 vCPU, no GPU — scored 0.45s / 0.88s / 3.11s on the same probe
sizes, with corpus recall 99.6% and golden-58 at 100%. A model running inside
the existing process beat the entire endpoint plan on latency, cost and
failure surface at once. Option C is this model joined with what already
existed: spaCy/Presidio NER as a second proposer, the deterministic regex net
for structured types (IBAN, e-mail, phone, dates, addresses in both German
street shapes, labelled identifiers, and since 2026-09-04 the bare German
health-insurance number gated on its official § 290 SGB V check digit), and
replacement by position.

#### 6.3.1 Keeping a zero-shot detector honest

GLiNER labels role nouns and pronouns as people, confidently — measured on a
real notarial contract: "Der Notar" 0.93, "Käufer" 0.87, "du" 0.97, against a
real given name at 0.97. No threshold separates those, so the control is a
**structural post-filter**: grammatical evidence only (plural morphology,
determiner children in the parse, name-hostile punctuation, code-identifier
shape, attributive-adjective openers), every guard failing open, with a
majority vote across a value's occurrences ("any occurrence keeps" was
measured and rejected: on ECHR judgments the word "applicant" occurs 372
times and always finds one lenient context). Word lists were rejected as a
class; the record shows why: enriching the contrast-veto label set — the
nearest thing to a vocabulary we tried — _raised_ false positives from 153 to
178, because richer labels raise person scores elsewhere.

#### 6.3.2 The verifier question, settled by a pre-registered trial

The remaining false positives clustered on PERSON claims, so the question
became whether a second opinion helps, and whose. A pre-registered 16-run
trial (fixed metrics, fixed gate, run unattended on the asserted production
configuration, night of 2026-08-22→23) compared three detectors and six
verifier settings on salted recall, the reviewed FP ledger (103 values), and
TAB. Table 1 summarises the decisive rows; the full matrix is in the
experiment record.

_Table 1 — detector–verifier trial, decisive rows (salted /204, ledger /103,
TAB /495)._

| run                                      | salted | ledger FPs | TAB recall | TAB FPs |
| ---------------------------------------- | ------ | ---------- | ---------- | ------- |
| shipped control (guards on)              | 182    | 18         | 485        | 214     |
| same, guards OFF                         | 186    | 18         | 485        | 1,972   |
| **+ GLiNER cross-check @0.05 (adopted)** | 182    | **1**      | 483        | **88**  |
| + local-LLM verifier (3B)                | 180    | 17         | 448        | 183     |
| + NLI verifier (~500 MB)                 | 182    | 15         | 485        | 171     |
| + StarPII as hard veto                   | 177    | 1          | 444        | 13      |
| knowledgator-large as detector           | 177    | 18         | 476        | 135     |

Three findings carry the section. First, **the guard chain earns its keep**:
switching it off multiplies TAB false positives by nine for four salted spans
of recall. Second, **verifiers cannot repair recall** — the 22 salted misses
are byte-identical across verifier settings, as the definition in Section 2
predicts; recall improvements must come from the detector or the repair
layer. Third, the winning verifier is the one that costs nothing: re-asking
the already-loaded GLiNER about each surviving PERSON claim in ±120
characters of context, any person score ≥ 0.05 keeps, no verdict keeps
(fail-open). It took the reviewed ledger from 18 firing values to one (the
single letter "L"), at +0 MB and ~0.5s per scrub.

The pre-registered gate said PERSON recall may not fall _at all_; it fell by
exactly two named values, both English-court-register shapes ("Lichfield
Reynolds", "Mrs Åkerblom"), with German and salted recall untouched. Per
protocol that judgement belonged to the product owner, who accepted the trade
on 2026-08-23; the cross-check shipped the same day, and the LLM extraction
tier was removed outright — config, code and API surface.

#### 6.3.3 What the ensemble still cannot do

The honest residuals, each with its mitigation: values broken across a line
end by hyphenation are not yet rejoined by the repair layer (found by
salting; the known cause of most salted misses); lowercase names on
all-lowercase input are a floor-configuration gap (GLiNER off); languages
other than German and English are out of scope; and an identifier format
with no structure and no label is undetectable in principle — which is why
the product keeps a reviewable redaction preview, per-value release, and a
fail-closed send path rather than claiming completeness.

Strengths: no clear text leaves the process; deterministic enough to
ratchet (floors per type, enforced in CI); runs on 2 vCPUs; one failure
surface. Weaknesses: recall on context-dependent prose types depends on a
300-MB zero-shot model and its guards; two languages; the floor
configuration (GLiNER off) is measurably weaker and is what a minimal
self-host runs.

### 6.4 Option D — hybrid: in-process ensemble plus an LLM verifier

The recurring instinct once Option C shipped: add a small LLM as a second
opinion. It was measured in the same trial (Table 1, "local-LLM verifier"):
`qwen2.5:3b`, batched, temperature 0 — ledger 18→17, TAB recall −37 names,
salted −2, slowest verifier of the night. Worse than the free cross-check on
every axis. A larger model or per-candidate prompting might do better, but
the free option had already taken the ledger to one, so the burden of proof
moved. Strengths: none demonstrated at this scale. Weaknesses: everything
Option B carries, for no measured gain.

### 6.5 A note on the anomaly that outlived its architecture

The one type that resisted every LLM tier — INSURANCE_ID at ~33–35% leak in
cloud and local alike — was re-derived on 2026-09-04 against the shipped
Option C, after its original diagnosis (an extractor-prompt defect) had been
deleted along with the extractor. The leak was gone (0.0% both
configurations); what remained was narrower and real: the _unlabelled_ bare
German health-insurance number, which the corpus could not see because every
template placed a label next to the value. The fix was structural (the
official check digit), the corpus gained the missing class, and the floors
rose 95 → 98. The episode is the paper's strongest argument for dated,
re-derivable records: **a diagnosis without its date and architecture
attached becomes wrong silently**.

### 6.6 Evaluation against the criteria

_Table 2 — options against the criteria of Section 5 (1 unfavourable … 10
highly favourable). Scores are our judgement on the measurements cited
above._

| criterion                 | A cloud LLM | B local/self-hosted LLM | C in-process (shipped) | D hybrid |
| ------------------------- | ----------- | ----------------------- | ---------------------- | -------- |
| Recall on gold sets       | 9           | 8                       | 8                      | 7        |
| FP behaviour on real text | 5           | 5                       | 8                      | 5        |
| Enforceability            | 3           | 4                       | 9                      | 4        |
| Send-path latency         | 3           | 6                       | 9                      | 4        |
| Footprint and operability | 8           | 4                       | 8                      | 4        |
| Privacy / supply chain    | 2           | 6                       | 10                     | 6        |
| **Sum**                   | **30**      | **33**                  | **52**                 | **30**   |

## 7. Management Summary

The following summary is obviously biased by our opinion, but should provide
a concise overview. Three decisions were taken, in dependency order: **first**,
detection moved in-process (Option C) after a single measurement — the
shipped zero-shot model on the production CPU — beat the self-hosted GPU
plan on latency, cost and failure surface at once; **second**, on that
foundation the GLiNER cross-check was adopted from a pre-registered trial,
accepting a named two-value recall cost for a 18→1 reduction of reviewed
false positives; **third**, the LLM extraction tier was removed entirely,
which the first two decisions made safe. Everything downstream — the check
digit gate, the language-routing fix, the floor raises — presupposes the
first decision. One decision remains open and is ours to put to the operator:
whether this paper and the experiment record join the public repository
export (the content is already leak-gate clean).

## 8. Opinion and Recommendation

In the present section we give our personal opinion and recommendation on the
topic. We recommend keeping Option C and investing next in the two residuals
the instruments agree on: the hyphenation repair gap (every salted miss class
traces to it) and deterministic rules for the two unfloored types (PIN,
ROUTING). We recommend against re-opening the verifier question without new
evidence; the record's negative results exist precisely so that the
local-LLM instinct is answered with Table 1 instead of a new week of runs.

The approach is **not a silver bullet**. It fails where personal data carries
no structure, no label and no grammatical trace — a bare novel identifier in
free text, a nickname that is also a common word, a language we do not model;
it degrades in the floor configuration (GLiNER off), on heavily damaged OCR,
and on registers neither instrument set covers. Under those conditions it
will most likely fail – but so will any other approach, since detection
without structure, context or prior knowledge is not a solvable problem; the
product's answer is layered for exactly that reason — a reviewable preview,
per-value release and a send path that fails closed rather than open.

## 9. Miscellaneous Remarks

1. **Adjacent artefacts.** The method documentation
   ([detection-evaluation.md](detection-evaluation.md)) explains how to run
   every check; the experiment record
   ([detection-experiments.md](detection-experiments.md)) carries the full
   dated numbers including all sixteen trial runs; the enforced floors live
   in the ratchet (`tests/test_corpus.py`); latency series in
   `tests/reports/SCRUB_LATENCY.md`.
2. **Benchmark provenance.** TAB is the Text Anonymisation Benchmark (MIT
   licence; ECHR judgments — public court records). AI4Privacy was sampled
   once for guard calibration and is not a standing gate. The
   health-insurance check digit implements § 290 SGB V as published by the
   GKV-Spitzenverband, verified against both worked examples of the
   specification.
3. **The public demo.** A scrub-only demo of the shipped pipeline runs at
   app.quon-ai.com/demo; the end-user explanation of this paper's content is
   the companion page next to it.

Open questions:

- Should this paper and the experiment record be added to the public
  repository export (one manifest line each; both pass the leak gate)?
- PIN and ROUTING remain unfloored: is a deterministic rule per type worth
  the false-positive risk, or does the labelled-identifier rule already cover
  the realistic shapes?
- The salted set's injector glue bug understates absolute recall: rebuild the
  set and re-baseline, or keep comparability with the trial-era numbers?
- A third language would multiply the guard work (the grammar guards are
  language-scoped by construction): is there demand that justifies it?
