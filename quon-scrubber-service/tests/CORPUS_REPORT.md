# QUON Scrubber — Synthetic Corpus Report (config 1: NER + regex)

- Cases: 1663 (DE 853 / EN 810)
- Gold values: 2922
- **Leak rate: 23% per value · 39% of messages leak ≥1** (primary)
- Recall: 77% (95% CI 75.7–78.7%)
- Precision (must-not kept): 100% · FP: 5

## Per entity type

Leak rate = 1 − recall (primary). 95% CI is the Wilson interval on recall.

Type          | Recall     | Leak%  | 95% CI (recall)  | FP

--------------|------------|--------|------------------|----
ADDRESS       | 98/98      |  0.0% | 96–100%          | 0
CREDENTIAL    | 0/98       | 100.0% | 0–4%             | 0
DATE          | 0/98       | 100.0% | 0–4%             | 0
EMAIL         | 323/323    |  0.0% | 99–100%          | 0
FINANCIAL_AMOUNT | 98/98      |  0.0% | 96–100%          | 0
IBAN          | 98/98      |  0.0% | 96–100%          | 0
INSURANCE_ID  | 1/98       | 99.0% | 0–6%             | 0
INTERNAL_URL  | 0/98       | 100.0% | 0–4%             | 0
PERSON        | 1432/1521  |  5.9% | 93–95%           | 0
PHONE         | 98/98      |  0.0% | 96–100%          | 0
PIN           | 1/98       | 99.0% | 0–6%             | 0
ROUTING       | 51/98      | 48.0% | 42–62%           | 0
TAX_ID        | 57/98      | 41.8% | 48–67%           | 0
## Floors (config 1: NER + regex — ratchet)

Type          | Recall | Floor | Target | Status

--------------|--------|-------|--------|-------
ADDRESS       | 100.0% |   90% |    98% | ok
CREDENTIAL    |   0.0% |    0% |    95% | ok
DATE          |   0.0% |    0% |    95% | ok
EMAIL         | 100.0% |   99% |  99.9% | ok
FINANCIAL_AMOUNT | 100.0% |   98% |  99.9% | ok
IBAN          | 100.0% |   99% |  99.9% | ok
INSURANCE_ID  |   1.0% |    0% |    99% | ok
INTERNAL_URL  |   0.0% |    0% |    95% | ok
PERSON        |  94.1% |   90% |    95% | ok
PHONE         | 100.0% |   98% |  99.9% | ok
PIN           |   1.0% |    0% |    95% | ok
ROUTING       |  52.0% |    0% |    95% | ok
TAX_ID        |  58.2% |    0% |    99% | ok
## Casual-register slice (FP guard)

- Casual-negative cases: 142 · FP: 0 (ratchet floor: 0)
- Street/place-compound PERSON mistags: 0 (ratchet floor: 0)

## Per slice

Slice               | Recall     | Leak%  | FP

--------------------|------------|--------|----
alltag              |  109/130   |   16% | 0
business            |  196/196   |    0% | 0
casual_negative_imperative |    0/0     |    0% | 0
casual_negative_interrogative |    0/0     |    0% | 0
casual_negative_lowercase |    0/0     |    0% | 0
casual_negative_medical |    0/0     |    0% | 0
casual_negative_topic |    0/0     |    0% | 0
casual_positive     |   21/22    |    5% | 0
credentials         |  189/392   |   52% | 0
email_cc_list       |  445/450   |    1% | 0
financial           |  335/392   |   15% | 0
formell             |   62/66    |    6% | 0
invoice             |  193/196   |    2% | 0
it_ticket           |   95/196   |   52% | 0
medizin             |   97/196   |   51% | 0
negative            |    0/0     |    0% | 5
person_compound     |   18/32    |   44% | 0
person_foreign      |   31/32    |    3% | 0
person_normal       |   28/34    |   18% | 0
scheduling          |   95/196   |   52% | 0
steuer              |  152/196   |   22% | 0
support             |  191/196   |    3% | 0
## Leaks (first 25 of 644) — for triage

- SYN-ROUTING-de-0092 [financial]: 716372031
- SYN-INSURANCE_ID-de-0062 [medizin]: KV-89816-A-3, Hans-Hinrich Rörricht
- SYN-TAX_ID-de-0000 [steuer]: 26 200 466 673
- SYN-DATE-en-0061 [scheduling]: October 16, 2026
- SYN-PIN-en-0035 [credentials]: 74038
- SYN-TAX_ID-de-0010 [steuer]: 18 345 696 069
- SYN-INSURANCE_ID-de-0002 [medizin]: A626926066
- SYN-TAX_ID-de-0072 [steuer]: 57 980 039 649
- SYN-CREDENTIAL-en-0061 [credentials]: sk-5d37a6ff4c95f6a3a5b6
- SYN-INSURANCE_ID-de-0090 [medizin]: KV-36637-A-4
- SYN-DATE-en-0063 [scheduling]: 05/10/2025
- SYN-TAX_ID-de-0070 [steuer]: 42 818 303 256
- SYN-INTERNAL_URL-en-0053 [it_ticket]: https://wiki.internal.gs.com/users/6894
- SYN-INSURANCE_ID-en-0027 [medizin]: KV-57767-A-7
- SYN-INSURANCE_ID-de-0054 [medizin]: KV-58162-A-2
- SYN-DATE-en-0069 [scheduling]: August 17, 2026
- SYN-INSURANCE_ID-en-0005 [medizin]: VN-2020-40003
- SYN-PIN-de-0090 [credentials]: 0624
- SYN-CREDENTIAL-en-0055 [credentials]: CC#2828mK!
- SYN-INSURANCE_ID-en-0019 [medizin]: A484733563
- SYN-PERSON-en-0083 [person_compound]: Karl-Heinz Weber
- SYN-INTERNAL_URL-de-0034 [it_ticket]: https://confluence.intern.firma.de/pages/529
- SYN-INSURANCE_ID-de-0014 [medizin]: KV-30537-A-4
- SYN-PIN-en-0001 [credentials]: 2697
- SYN-ROUTING-de-0010 [financial]: 469622167
