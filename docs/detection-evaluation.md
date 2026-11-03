# Detection evaluation

QUON replaces personal data with typed placeholders before a prompt leaves the
device. Detection runs in-process in the backend (`quon-scrubber-service/`):
spaCy/Presidio NER, GLiNER span scoring when enabled, a deterministic regex
safety net, a guard chain, and position-based replacement through the Presidio
Anonymizer. No model provider takes part in detection. Whatever detection misses reaches the provider in clear text, so
the quality of this step is the product's central claim.

This document explains how that quality is measured, what each measurement can
and cannot see, and how a contributor runs the same checks. It states no
current numbers: every enforced number lives in a test constant or a tracked
ledger, and this page names the place, so it stays true when a floor moves.

## The pipeline

`scrub()` in `scrubber.py` runs the layers in a fixed order. It collects claims
from spaCy/Presidio NER, from GLiNER (when `gliner_enabled` is set) and from
the safety net in `fallback.detect_safety_net`; the user's always-redact terms
join as type CUSTOM. The merged claims pass the guard chain: the GLiNER
contrast veto for PERSON, the structural validators
(`_drop_label_only_identifiers`, `_drop_structurally_impossible`), the GLiNER
cross-check on every surviving PERSON, the relative-duration drop for DATE, and
the user's never-redact list. `pseudonymize()` replaces spans by position.
Every guard errs toward redaction: a guard that cannot decide keeps the claim.

Entity types and placeholders are defined once in `entities.py`. The GLiNER
labels are `LABEL_MAP` in `gliner_detect.py`; the score threshold is
`gliner_threshold` in `config.py`. Section 5 of
[ARCHITECTURE.md](../ARCHITECTURE.md) has the detail.

## What is measured

The grading helpers live in
[tests/test_api.py](../quon-scrubber-service/tests/test_api.py). Every case
carries values that must disappear (`must_anonymize`, each with a type) and
values that must survive (`must_not_anonymize`). `grade_case` compares the
scrubbed text against both.

- **Recall** is the share of gold values that no longer appear in the output.
  A name leaks when any distinctive word of it survives on a word boundary; an
  atomic value such as an IBAN leaks on a substring match.
- **Leak rate** is one minus recall, per value, reported per entity type.
- **Sample leak rate** is the share of messages that leak at least one value.
  The corpus report treats it as the primary number.
- **Precision** is the share of must-not values that survived. It measures
  over-redaction.
- **Confidence interval**: `_wilson` computes a 95% Wilson score interval on
  recall, so a type with few samples shows a range instead of a point.

## The synthetic corpus

[tests/synth.py](../quon-scrubber-service/tests/synth.py) builds the corpus
from templates. Faker or a format generator produces a value, the template
inserts it, and that value is the gold label: no manual annotation, no real
personal data. A fixed seed (`SEED`) makes every run reproducible, and German
and English are generated in balance. The default target in `generate_corpus`
is 1,500 cases; with the fixed casual-register slice folded in, the generator
yields a little over 1,600.

Cases fall into slices. The formal-register slices (business, invoice, support,
tax, medical, credentials and similar) each carry a focal entity type plus
distractor slots: public cities, companies, relative dates and capitalised
nouns that must survive. `person_foreign` and `person_compound` isolate name
shapes NER is weak on; `negative` cases contain no PII. The casual-register
slice (`casual_negative_*`, `casual_positive`) is hand-curated and fixed in
size: short conversational questions, imperatives, medical shorthand and
all-lowercase text. Its street and square compounds are listed in
`street_terms` so the ratchet can check that none is tagged PERSON. Secrets
with no marker at all are graded under the policy `unmarked_secret` and
reported separately;
[tests/expectations.py](../quon-scrubber-service/tests/expectations.py)
documents that decision.

What the corpus cannot see matters as much: it is prose. It contains no
camelCase identifiers, no OCR damage, no form-field labels and no page
furniture. It once reported perfect recall and zero false positives on a build
that redacted common words and labels in real documents, because nothing in the
corpus looked like a document. The corpus measures recall on synthetic prose,
plus a bounded precision check on its own distractors, and nothing about real
layouts.

## The golden cases

[tests/test_texts.py](../quon-scrubber-service/tests/test_texts.py) holds 58
hand-written cases: German and English business email, HR, medical, legal,
support and credential scenarios, plus regressions from fixed bugs. Each
must-not list is curated so that a company name occurring only
inside an email address does not count as a false positive. The suite is marked `integration` and runs the real pipeline.
It writes `REPORT.md` and appends one row to the auto-log in
[tests/reports/HISTORY.md](../quon-scrubber-service/tests/reports/HISTORY.md).

## Real prompts and real documents

Two opt-in evaluations exist because synthetic text misses whole classes of
error. [tests/test_realworld.py](../quon-scrubber-service/tests/test_realworld.py)
runs a person's own exported chat prompts;
[tests/test_realworld_docs.py](../quon-scrubber-service/tests/test_realworld_docs.py)
runs their own paperwork, including OCR output. Both read from a directory
outside the repository (`QUON_REALWORLD_DIR`), skip cleanly when no data is
present, and write every detection with context to a private report for human
review. Only aggregate counts are printed; nothing is committed.

Real text has no gold labels, so these runs cannot measure recall. They hunt
false positives. A reviewer confirms each one in a labels file with two tiers:
an open tier for confirmed false positives that still fire, and a fixed tier
that asserts the value is never detected again. Prompt keys and document keys
stay separate so one cannot mask the other. The method is public; the data
stays private.

## The ratchet

[tests/test_corpus.py](../quon-scrubber-service/tests/test_corpus.py) turns the
corpus into a gate. `FLOORS` maps each entity type to a pair `(floor, target)`:
the floor is the recall the build must reach, the target is where the type
should end up. Three more constants guard precision: `PRECISION_FLOOR`
(must-not values kept), `CASUAL_NEG_FP_FLOOR` (false positives on the
casual-negative slice) and `STREET_MISTAG_FLOOR` (street compounds tagged
PERSON). Any breach fails the test. CI runs it in `.github/workflows/ci.yml`,
and so does `deploy/preflight.sh`.

Floors move in one direction. A floor is raised after a run shows the new
level, with GLiNER off and on, and never lowered to make a change pass. To
raise one: run the ratchet, edit the pair in `FLOORS`, and leave a comment
saying which measurement earned it.

The default ratchet runs with GLiNER off: the floor every deployment has.
`GLINER_ENABLED=1` runs the same corpus with GLiNER on. A detection change is
measured both ways.

## Running it

```bash
cd quon-scrubber-service
python -m venv .venv && ./.venv/bin/pip install -r requirements-dev.txt   # first time

# the ratchet (GLiNER off: the floor)
QUON_RUN_CORPUS=1 ./.venv/bin/python -m pytest tests/test_corpus.py -q

# quick subset while iterating
QUON_RUN_CORPUS=1 QUON_CORPUS_N=300 ./.venv/bin/python -m pytest tests/test_corpus.py -q -s

# GLiNER on
QUON_RUN_CORPUS=1 GLINER_ENABLED=1 ./.venv/bin/python -m pytest tests/test_corpus.py -q

# the golden cases
./.venv/bin/python -m pytest -m integration -s
```

The corpus report lands in `tests/reports/local/CORPUS_REPORT.md`, a
git-ignored directory (`QUON_REPORT_DIR` moves it): headline numbers, per-type
and per-slice tables, floor status and a triage list of leaked values. Only
`QUON_WRITE_BASELINE=1` rewrites the tracked
baselines. An ordinary run must leave the git tree clean;
[tests/report_paths.py](../quon-scrubber-service/tests/report_paths.py)
explains why: a dirty tree changes the tree fingerprint and invalidates the
deploy gate's own stamp.

## Latency

Detection time is added to every message, so it is tracked like recall:
`scripts/measure-latency.sh` appends a row to `tests/reports/LATENCY.md`, a
ledger that the first measurement on a machine creates (it is not in the
repository), and
[tests/test_latency_ledger.py](../quon-scrubber-service/tests/test_latency_ledger.py)
asserts that every recorded row sits inside `BUDGET` and that a change to the
send path comes with a fresh row. The scrub-path series by message size lives in
[tests/reports/SCRUB_LATENCY.md](../quon-scrubber-service/tests/reports/SCRUB_LATENCY.md).

## Known limits

- **Recall is synthetic.** The only recall numbers come from generated prose
  and the 58 hand-written cases. Real documents are evaluated for false
  positives only.
- **Precision is bounded by the distractor lists.** The corpus counts a false
  positive only on a value a template marked as must-not.
- **Two languages.** Generators, NER models and the language heuristic cover
  German and English.
- **Unmarked secrets are out of scope.** A high-entropy string with no prefix,
  label or assignment is reported and never gated.
- **Lowercase names.** NER defers PERSON detection on all-lowercase input, so
  the casual slice keeps names capitalised. With GLiNER off, a lowercase name
  is a known gap.
- **The default ratchet describes the floor.** A run without
  `GLINER_ENABLED=1` says nothing about a deployment that has GLiNER on.
- **Nothing here measures a model provider.** The evaluation stops at the
  scrubbed text. What a provider does with placeholders, and whether an answer
  re-hydrates correctly, are tested elsewhere.

## Contributing a case

A false positive or a leak you found belongs in the tree as a synthetic case:
keep the linguistic shape, replace the value. Short conversational shapes go
into the casual-register lists in `tests/synth.py`; a new formal shape is a
template in `TEMPLATES` with its PII and distractor slots named; a hard single
case goes into `tests/test_texts.py` with both lists filled. Run the ratchet
before and after, and raise a floor only when the report shows it.
[extending.md](extending.md) describes the three tiers for the detector side
of the fix.
