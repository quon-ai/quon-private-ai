# QUON Quality History

Ein Dokument, zwei Teile: oben die **kuratierte Messreihe** (von Hand gepflegt,
eine Zeile pro Erkenntnis), unten das **Auto-Log der Golden-58-Läufe** (der
Harness hängt jede Zeile ans Dateiende an — deshalb steht die Tabelle zuletzt;
nichts darunter einfügen).

## Messreihe: Lokale Anonymisierung

Kuratierte Ergebnisse der Frage: **Wie gut ist QUONs PII-Erkennung ohne Cloud?**
Angestoßen 2026-08-14 (Feedback-User lief auf lokalem Modus ohne erreichbares
Modell — also auf dem nackten Floor — bei statisch-grüner "Geschützt"-Anzeige).

**Messaufbau:** synthetischer Corpus (`tests/synth.py`, ~1.700–1.800 Fälle
DE/EN, Wilson-CIs) via `QUON_RUN_CORPUS=1 QUON_CORPUS_LLM=local|cloud`;
Golden-58 (`tests/expectations.py`, handverlesene harte Fälle) via
`pytest -m integration`. Lokale Läufe: Ollama auf Apple M1 / 16 GB.

⚠️ **Falle, einmal hineingelaufen (2026-08-14):** `runtime_settings.json`
**überstimmt** Env-Variablen (`pii_backend: cloud` gewinnt gegen
`PII_BACKEND=local`). Ein vermeintlicher Lokal-Lauf lief dadurch über die
Cloud — aufgeflogen nur am Ollama-Request-Log. Für echte Lokal-Läufe:
`RUNTIME_SETTINGS_PATH=<datei mit {"pii_backend":"local"}>` setzen und die
Ollama-Requests mitzählen. Ein Lauf ohne diesen Beweis zählt nicht.

## Voller synthetischer Corpus

| Konfiguration                             | Recall   | Leak/Wert | Nachrichten ≥1 Leak | Precision (must-not) | Anmerkungen                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------- | -------- | --------- | ------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| config 1: NER + Regex (Floor)             | 77 %     | 23 %      | 39 %                | 100 %                | Stand 2026-08-14, 1.663 Fälle. CREDENTIAL/DATE/INTERNAL_URL 0 %, PIN/INSURANCE_ID ~1 %, TAX_ID 58 %, ROUTING 52 % — die kontextabhängigen Typen sind ohne LLM blind.                                                                                                                                                                                          |
| cloud: mistral-small-3.2-24b (OpenRouter) | **99 %** | **1 %**   | **2 %**             | 97 % (80 FP)         | 2026-08-14, 1.817 Fälle, 57 min. Erster Cloud-Anker auf dem vollen Corpus. PERSON 1675/1675. Schwächen: INSURANCE_ID 35 % Leak, CREDENTIAL 4,6 %, ROUTING 1,9 %. 12 Fälle fielen auf den Floor zurück (Transient).                                                                                                                                            |
| lokal: qwen2.5:3b (Ollama, M1)            | **85 %** | **15 %**  | **26 %**            | 98 % (55 FP)         | 2026-08-14, 1.817 Fälle, 36 min (~1,2 s/Fall), 1.839 Ollama-Requests verifiziert, 0 Fallbacks. Gewinn ggü. Floor: PERSON 94→97 %, PIN/TAX_ID ~100 %, ROUTING 52→71 %. **Blindstellen bleiben:** CREDENTIAL 83 % Leak, DATE 96 %, INSURANCE_ID 98 %, INTERNAL_URL 99 % — das 3b-Modell erkennt diese kontextabhängigen Typen schlicht nicht.                   |
| lokal: qwen2.5:7b (Ollama, M1)            | **98 %** | **2 %**   | **4 %**             | 98 % (46 FP)         | 2026-08-14, 1.817 Fälle, 0 Fallbacks (Guard scharf). Schließt die 3b-Blindstellen fast vollständig: DATE 96→1 % Leak, PIN/TAX_ID/ROUTING 100 % Recall, PERSON 99 %, INTERNAL_URL 6,5 % Leak. Verbleibend: CREDENTIAL 17,6 %, **INSURANCE_ID 33,3 % — dasselbe Loch wie in der CLOUD (35 %)**: kein Modellgrößen-, sondern ein Prompt-/Typdefinitions-Problem. |

### 2026-09-04 — Re-Derivation INSURANCE_ID/CREDENTIAL + der Finca-Befund

Der Roadmap-Eintrag vom 2026-08-14 („INSURANCE_ID leakt 33–35 % auf jeder
Stufe, Ursache llm_client.py“) war dreifach überholt: Datei gelöscht, Tier
gelöscht, Leak geschlossen. **Neu gemessen auf der heutigen Pipeline
(spaCy → GLiNER → Regex-Netz → V1-Kreuzcheck):**

| Messung (1620 Fälle, 2836 Goldwerte) | GLiNER an | GLiNER aus (Floor) |
| --- | --- | --- |
| INSURANCE_ID Leak | **0,0 %** (98/98) | **0,0 %** (98/98) |
| CREDENTIAL Leak | **0,0 %** (55/55) | **0,0 %** (55/55) |
| PERSON Recall | 99,8 % (1475/1478) | 91 % gesamt-Floor unverändert |

Was der Corpus NICHT sehen konnte (beide Templates trugen ein Label neben der
Nummer): die **nackte, unbeschriftete KVNR** ([A-Z]+9 Ziffern) leakte in
deutscher Prosa — die alte Begründung fürs Weglassen („das Modell fängt sie“)
starb mit dem LLM-Tier. Fix: **amtliche Prüfziffer** (§ 290 SGB V, an beiden
Spec-Beispielen verifiziert) als strukturelles Gate im Regex-Netz — eine
zufällige Bestellnummer passiert zu 10 %, eine echte KVNR immer. Corpus um
unbeschriftete Templates + prüfziffernvalide Werte erweitert; **Floors
INSURANCE_ID und CREDENTIAL 95 → 98** (GLiNER-unabhängig gemessen).

Im selben Zug der read_url-FP „Ruhige Finca“ (E2E 2026-09-04) strukturell
zerlegt: (a) `detect_language` schickte umlaut-transliteriertes Deutsch
(„Suedwesten“, „fuer“) mangels Hint-Treffern ans ENGLISCHE Modell, das aus
kapitalisierten Nominalphrasen Personen machte — Hint-Liste um transliterierte
und Kalender-/Mengenwörter erweitert (jedes einzeln gegen Englisch-Kollision
geprüft); (b) `_keep_person` Guard 5: deklinierte, vokabelbekannte ADJ am
Spananfang mit Kopf im Span = Nominalphrase, kein Name (Case-Morphologie
scopet auf Deutsch — „Big John“, „Lieber Klaus Meier“, „Ernst Weber“
überleben, gemessen). Wirkt auch OHNE GLiNER (E2E/Self-Host-Lücke).

**Real-Daten-Beweis (alle Diffs gegen Vortags-Baselines archiviert):**
1951 Prompts: 0 neue FP-Werte, 1 FP weg („Parteien“). 50 Dokumente,
gleicher Ingest, A/B mit gestashten Änderungen: **666 = 666 identisch**.
Salted 182/204 vorher = nachher (alle Misses = bekannte OCR-/Trennstrich-
Lücke, keiner durch Guard 5). Ledger bereinigt: 2 Datums-Einträge waren
seit dem Dotted-Date-Netz KORREKTE Detektionen (raus, mit Begründung),
„Ja riftborn“ ehrlich zurück auf open (feuert seit GLiNER wieder).

## Golden-58 (handverlesene harte Fälle)

| Konfiguration                | Recall     | Leak/Wert | Precision | Anmerkungen                                                                                                                                                                                                                |
| ---------------------------- | ---------- | --------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cloud: mistral-small-3.2-24b | 98 %       | 2 %       | 81 %      | Laufende Referenz, s. Auto-Log unten.                                                                                                                                                                                      |
| lokal: qwen2.5:7b            | **96 %**   | **4 %**   | 79 %      | 2026-08-14, Pipeline-Header verifiziert `local:qwen2.5:7b`, 7:38 min. 237/246 Werte; 16 % der Nachrichten mit ≥1 Leak (Cloud: 9–10 %). Bestätigt den Corpus-Befund: ~2 Punkte hinter der Cloud auch auf den harten Fällen. |
| lokal: qwen2.5:3b            | _entfällt_ |           |           | Nach dem Corpus-Ergebnis (15 % Leak) als Full-Local-Kandidat ausgeschieden — Golden-Messung lohnt nicht.                                                                                                                   |

## Kandidaten geprüft und verworfen (Stand 2026-08-14)

- **Bonsai 27B (PrismML, 1-Bit/Ternary von Qwen3.6-27B):** in **allen**
  GGUF-Varianten mit Standard-Tooling unladbar. Ollama 0.31.1 und upstream
  llama.cpp b9850 scheitern identisch; die g64-Variante nutzt
  **ggml-Tensortyp 42**, upstream kennt nur 0–41 — der Ternary-Typ existiert
  nur in PrismMLs Fork. Watch-Kriterium für Neubewertung: Typ 42 landet in
  llama.cpp upstream (deren "Upstream Status"-Doku im Bonsai-demo-Repo).
  Third-Party-Ollama-Repacks (MobiusDevelopment) aus Supply-Chain-Gründen
  nicht für eine PII-Engine verwenden.
- **Nächster "großer lokaler" Kandidat, falls gewünscht:** Qwen3.6-27B als
  regulärer IQ2-Quant (~9,4 GB, lädt überall; laut PrismML schlechter als ihr
  Ternary, aber messbar statt theoretisch).

## Einordnung

Stand nach der Reihe: **Full Local ist mit der 7b-Stufe real.** 3b (85 %)
liegt zu nah am Floor; 7b erreicht mit 98 %/2 % fast die Cloud (99 %/1 %) —
auf einem 4,7-GB-Modell auf einem M1/16 GB. Das Muster über alle Stufen:
Regex/NER-Typen immer perfekt; die kontextabhängigen Typen skalieren mit der
Modellgröße — mit einer Ausnahme: **INSURANCE_ID leakt überall ~33–35 %**,
auch in der Cloud. Das ist ein Prompt-/Typdefinitions-Problem im Extraktor,
kein Kapazitätsproblem, und damit der lohnendste nächste Detection-Fix (hilft
allen Konfigurationen gleichzeitig). CREDENTIAL (17,6 % bei 7b vs 4,6 % Cloud)
bleibt der echte Restabstand. Der synthetische Corpus ist leichter als die
Golden-58; lokale Zahlen hier sind obere Schranken.

---

## Golden-58 Auto-Log

Each row is one `test_quality_suite` run. Newest entries are appended; prior results are never overwritten so setup changes can be compared.

| Date                 | Commit  | Pipeline                                                                              | Recall | Precision | FP  | Fallback | Grades                 |
| -------------------- | ------- | ------------------------------------------------------------------------------------- | ------ | --------- | --- | -------- | ---------------------- |
| 2026-06-06T17:56:02Z | c4dfb29 | NER(de_core_news_md, en_core_web_md) + cloud:google/gemma-3-12b-it                    | 98%    | 91%       | 14  | 16/58    | A=43 B=9 C=2 D=3 F=1   |
| 2026-06-12T18:24:58Z | c4dfb29 | NER(de_core_news_md, en_core_web_md) + cloud:google/gemma-3-12b-it                    | 98%    | 91%       | 14  | 16/58    | A=43 B=9 C=2 D=3 F=1   |
| 2026-06-12T18:34:09Z | c4dfb29 | NER(de_core_news_md, en_core_web_md) + cloud:google/gemma-3-12b-it                    | 97%    | 91%       | 14  | 18/58    | A=41 B=9 C=2 D=3 F=3   |
| 2026-06-12T19:29:31Z | c4dfb29 | NER(de_core_news_md, en_core_web_md) + cloud:google/gemma-3-12b-it                    | 98%    | 91%       | 14  | 16/58    | A=43 B=9 C=2 D=3 F=1   |
| 2026-06-14T13:26:39Z | d6c1a77 | NER(de_core_news_md, en_core_web_md) + cloud:google/gemma-3-12b-it                    | 98%    | 91%       | 14  | 16/58    | A=43 B=9 C=2 D=3 F=1   |
| 2026-06-14T13:28:01Z | d6c1a77 | NER(de_core_news_md, en_core_web_md) + cloud:google/gemma-3-12b-it                    | 98%    | 91%       | 14  | 16/58    | A=43 B=9 C=2 D=3 F=1   |
| 2026-06-14T13:48:12Z | bc91365 | NER(de_core_news_md, en_core_web_md) + cloud:google/gemma-3-12b-it                    | 98%    | 91%       | 14  | 16/58    | A=43 B=9 C=2 D=3 F=1   |
| 2026-06-14T14:40:49Z | bc91365 | NER(de_core_news_md, en_core_web_md) + cloud:google/gemma-3-12b-it                    | 98%    | 91%       | 14  | 16/58    | A=43 B=9 C=2 D=3 F=1   |
| 2026-06-14T14:46:55Z | bc91365 | NER(de_core_news_md, en_core_web_md) + cloud:google/gemma-3-12b-it                    | 98%    | 91%       | 14  | 16/58    | A=43 B=9 C=2 D=3 F=1   |
| 2026-06-14T22:08:56Z | baeaa32 | NER(de_core_news_md, en_core_web_md) + cloud:google/gemma-3-12b-it                    | 93%    | 91%       | 14  | 22/58    | A=39 B=7 C=3 D=4 F=5   |
| 2026-06-20T18:41:02Z | f81b878 | NER(de_core_news_md, en_core_web_md) + cloud:google/gemma-3-12b-it                    | 98%    | 91%       | 14  | 16/58    | A=43 B=9 C=2 D=3 F=1   |
| 2026-06-20T18:58:56Z | 6220aa4 | NER(de_core_news_md, en_core_web_md) + cloud:google/gemma-3-12b-it                    | 98%    | 91%       | 14  | 16/58    | A=43 B=9 C=2 D=3 F=1   |
| 2026-06-20T19:26:18Z | ba35b01 | NER(de_core_news_md, en_core_web_md) + cloud:google/gemma-3-12b-it                    | 98%    | 91%       | 14  | 16/58    | A=43 B=9 C=2 D=3 F=1   |
| 2026-07-21T11:28:29Z | ae5dc89 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 80%       | 31  | 0/58     | A=34 B=10 C=3 D=10 F=1 |
| 2026-07-21T12:02:54Z | c3944db | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 80%       | 31  | 0/58     | A=34 B=10 C=3 D=10 F=1 |
| 2026-07-21T15:16:18Z | 07c0d1c | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 33  | 0/58     | A=32 B=10 C=4 D=11 F=1 |
| 2026-07-21T16:10:53Z | dd65ed1 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 33  | 0/58     | A=32 B=10 C=4 D=11 F=1 |
| 2026-07-21T18:23:05Z | 097e038 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 33  | 0/58     | A=33 B=10 C=3 D=11 F=1 |
| 2026-07-22T17:09:50Z | ec2e9b2 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 33  | 0/58     | A=33 B=10 C=3 D=11 F=1 |
| 2026-07-22T19:03:46Z | f11a37f | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 80%       | 31  | 0/58     | A=35 B=10 C=2 D=10 F=1 |
| 2026-07-22T20:01:31Z | 2ec329c | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 32  | 0/58     | A=34 B=10 C=3 D=10 F=1 |
| 2026-07-23T06:41:27Z | 9510cfb | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 80%       | 31  | 0/58     | A=33 B=10 C=4 D=10 F=1 |
| 2026-07-23T07:09:50Z | 9510cfb | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 80%       | 31  | 0/58     | A=34 B=10 C=3 D=10 F=1 |
| 2026-07-23T12:04:47Z | 9510cfb | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 80%       | 31  | 0/58     | A=34 B=10 C=3 D=10 F=1 |
| 2026-07-23T17:34:08Z | c37e04a | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 76%       | 37  | 0/58     | A=31 B=12 C=2 D=12 F=1 |
| 2026-07-23T17:59:36Z | 124e549 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 33  | 0/58     | A=31 B=12 C=4 D=10 F=1 |
| 2026-07-23T18:21:36Z | 257e401 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 33  | 0/58     | A=33 B=10 C=3 D=11 F=1 |
| 2026-07-23T18:45:01Z | 1b0a0f3 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 32  | 0/58     | A=33 B=11 C=3 D=10 F=1 |
| 2026-07-23T19:14:40Z | 569eb90 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 80%       | 31  | 0/58     | A=34 B=10 C=3 D=10 F=1 |
| 2026-07-23T20:10:00Z | d4141f8 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 33  | 0/58     | A=34 B=10 C=2 D=11 F=1 |
| 2026-07-24T07:24:37Z | 10f83e8 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 32  | 0/58     | A=33 B=11 C=2 D=11 F=1 |
| 2026-07-24T07:32:33Z | 8e53e2b | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 32  | 0/58     | A=33 B=11 C=3 D=10 F=1 |
| 2026-07-24T09:48:08Z | 8928338 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 32  | 0/58     | A=33 B=11 C=3 D=10 F=1 |
| 2026-07-24T10:30:12Z | f717235 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 80%       | 31  | 0/58     | A=34 B=10 C=3 D=10 F=1 |
| 2026-07-24T11:13:31Z | ef8153f | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 78%       | 34  | 0/58     | A=32 B=11 C=3 D=11 F=1 |
| 2026-07-24T15:04:09Z | 9cd542f | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 32  | 1/58     | A=33 B=11 C=2 D=11 F=1 |
| 2026-07-24T16:55:45Z | a7b4bf3 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 80%       | 31  | 0/58     | A=34 B=10 C=3 D=10 F=1 |
| 2026-07-24T18:29:01Z | 0059b9b | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 32  | 1/58     | A=33 B=11 C=3 D=10 F=1 |
| 2026-07-24T20:40:26Z | 92e362a | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 81%       | 29  | 0/58     | A=34 B=10 C=3 D=10 F=1 |
| 2026-07-24T21:07:54Z | 92e362a | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 33  | 1/58     | A=34 B=10 C=2 D=11 F=1 |
| 2026-07-24T22:07:53Z | 0bf1e18 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 33  | 0/58     | A=33 B=10 C=3 D=11 F=1 |
| 2026-07-24T22:39:35Z | d8f85e3 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 33  | 0/58     | A=32 B=12 C=3 D=10 F=1 |
| 2026-07-25T06:17:04Z | 2f86d52 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 32  | 1/58     | A=33 B=11 C=3 D=10 F=1 |
| 2026-07-25T06:45:21Z | d6901d8 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 32  | 0/58     | A=34 B=9 C=3 D=11 F=1  |
| 2026-07-25T07:29:33Z | 0a10fef | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 80%       | 31  | 0/58     | A=34 B=10 C=3 D=10 F=1 |
| 2026-07-25T07:54:07Z | 0a10fef | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 33  | 0/58     | A=33 B=10 C=3 D=11 F=1 |
| 2026-07-25T08:53:49Z | 3f4b0a8 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 80%       | 31  | 0/58     | A=34 B=10 C=3 D=10 F=1 |
| 2026-07-25T18:38:24Z | 939c498 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 80%       | 31  | 0/58     | A=34 B=10 C=3 D=10 F=1 |
| 2026-07-27T11:37:50Z | bb65657 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 33  | 0/58     | A=33 B=10 C=3 D=11 F=1 |
| 2026-07-27T19:31:31Z | b06a483 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 80%       | 31  | 0/58     | A=34 B=10 C=3 D=10 F=1 |
| 2026-07-28T12:33:43Z | b06a483 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 33  | 0/58     | A=32 B=12 C=2 D=11 F=1 |
| 2026-07-28T12:39:58Z | 3baeada | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 33  | 0/58     | A=33 B=10 C=3 D=11 F=1 |
| 2026-07-28T20:33:36Z | dd1f2cc | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 32  | 0/58     | A=34 B=10 C=3 D=10 F=1 |
| 2026-07-28T20:36:09Z | dd1f2cc | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 32  | 1/58     | A=33 B=11 C=3 D=10 F=1 |
| 2026-07-28T20:45:41Z | 1c604a1 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 80%       | 31  | 0/58     | A=34 B=10 C=3 D=10 F=1 |
| 2026-07-29T06:42:32Z | f52b6c4 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 33  | 1/58     | A=33 B=10 C=3 D=11 F=1 |
| 2026-07-29T11:24:50Z | beb5f7b | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 77%       | 36  | 0/58     | A=30 B=11 C=4 D=12 F=1 |
| 2026-07-29T21:03:13Z | 3632d92 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 80%       | 31  | 0/58     | A=33 B=10 C=4 D=10 F=1 |
| 2026-07-29T21:24:19Z | 2e0af63 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 80%       | 31  | 0/58     | A=33 B=10 C=3 D=11 F=1 |
| 2026-07-30T06:34:12Z | 9a2f0b4 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 80%       | 31  | 1/58     | A=34 B=10 C=3 D=10 F=1 |
| 2026-07-31T18:55:07Z | d76dae2 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 77%       | 35  | 0/58     | A=33 B=10 C=2 D=12 F=1 |
| 2026-07-31T19:26:15Z | 70089f3 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 78%       | 34  | 0/58     | A=33 B=10 C=3 D=11 F=1 |
| 2026-08-01T09:18:21Z | 0e60c44 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 78%       | 34  | 0/58     | A=33 B=10 C=3 D=11 F=1 |
| 2026-08-01T09:22:55Z | ec3572d | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 80%       | 31  | 0/58     | A=33 B=10 C=3 D=11 F=1 |
| 2026-08-01T09:44:12Z | 26b9b3c | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 80%       | 31  | 0/58     | A=34 B=10 C=3 D=10 F=1 |
| 2026-08-01T10:33:30Z | 510c004 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 32  | 0/58     | A=33 B=11 C=3 D=10 F=1 |
| 2026-08-01T13:42:24Z | 561c80a | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 77%       | 35  | 0/58     | A=32 B=10 C=3 D=12 F=1 |
| 2026-08-01T13:50:50Z | c86b00f | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 33  | 0/58     | A=33 B=10 C=3 D=11 F=1 |
| 2026-08-01T14:11:24Z | c86b00f | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 80%       | 31  | 0/58     | A=34 B=10 C=3 D=10 F=1 |
| 2026-08-01T14:18:49Z | 335bb1a | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 33  | 0/58     | A=33 B=10 C=3 D=11 F=1 |
| 2026-08-01T17:15:47Z | 7d061a3 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 80%       | 31  | 0/58     | A=33 B=10 C=4 D=10 F=1 |
| 2026-08-01T17:43:42Z | 88b0b5b | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 78%       | 34  | 0/58     | A=33 B=10 C=3 D=11 F=1 |
| 2026-08-01T18:11:51Z | 9e8c265 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 77%       | 35  | 0/58     | A=32 B=10 C=3 D=12 F=1 |
| 2026-08-01T18:53:43Z | 78b18a5 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 33  | 0/58     | A=33 B=10 C=3 D=11 F=1 |
| 2026-08-01T19:47:47Z | 8c7b585 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 78%       | 34  | 0/58     | A=32 B=11 C=3 D=11 F=1 |
| 2026-08-01T20:12:11Z | 3f544e0 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 80%       | 31  | 0/58     | A=33 B=10 C=3 D=11 F=1 |
| 2026-08-02T16:28:01Z | 1d0018f | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 33  | 0/58     | A=33 B=10 C=3 D=11 F=1 |
| 2026-08-02T17:27:10Z | 8f2d06d | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 80%       | 31  | 0/58     | A=34 B=10 C=3 D=10 F=1 |
| 2026-08-02T19:48:04Z | 0dab9d9 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 33  | 0/58     | A=33 B=10 C=3 D=11 F=1 |
| 2026-08-02T21:29:12Z | bc792b8 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 80%       | 31  | 0/58     | A=34 B=10 C=3 D=10 F=1 |
| 2026-08-03T12:16:05Z | 727709e | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 97%    | 79%       | 33  | 6/58     | A=31 B=10 C=4 D=10 F=3 |
| 2026-08-03T13:03:54Z | bb6f9f6 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 96%    | 79%       | 33  | 5/58     | A=32 B=11 C=2 D=9 F=4  |
| 2026-08-03T15:41:54Z | 3bfc9bb | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 33  | 0/58     | A=32 B=10 C=4 D=11 F=1 |
| 2026-08-03T16:09:06Z | 3bfc9bb | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 96%    | 80%       | 31  | 5/58     | A=32 B=9 C=5 D=9 F=3   |
| 2026-08-04T07:40:32Z | 9a305f9 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 80%       | 31  | 0/58     | A=34 B=10 C=3 D=10 F=1 |
| 2026-08-04T07:55:21Z | 4a1a890 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 33  | 0/58     | A=33 B=10 C=3 D=11 F=1 |
| 2026-08-04T08:27:08Z | 564a1eb | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 97%    | 80%       | 31  | 1/58     | A=34 B=10 C=3 D=9 F=2  |
| 2026-08-04T09:08:18Z | 564a1eb | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 96%    | 81%       | 30  | 4/58     | A=33 B=9 C=4 D=10 F=2  |
| 2026-08-04T12:18:13Z | 7c9e49d | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 95%    | 80%       | 31  | 10/58    | A=29 B=9 C=7 D=10 F=3  |
| 2026-08-04T19:26:38Z | a1f109e | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 95%    | 80%       | 31  | 5/58     | A=32 B=10 C=3 D=11 F=2 |
| 2026-08-05T06:38:52Z | 69f0533 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 33  | 0/58     | A=33 B=10 C=3 D=11 F=1 |
| 2026-08-05T07:39:43Z | 89e9d3c | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 79%    | 80%       | 31  | 35/58    | A=16 B=6 C=9 D=9 F=18  |
| 2026-08-05T07:46:42Z | 7e4d7d6 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 85%    | 84%       | 25  | 31/58    | A=23 B=11 C=5 D=6 F=13 |
| 2026-08-05T08:12:40Z | 7e4d7d6 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 33  | 0/58     | A=33 B=10 C=3 D=11 F=1 |
| 2026-08-05T08:44:05Z | fdea2b2 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 90%    | 81%       | 30  | 17/58    | A=25 B=10 C=4 D=8 F=11 |
| 2026-08-08T18:25:24Z | db7419f | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 33  | 0/58     | A=33 B=10 C=3 D=11 F=1 |
| 2026-08-08T19:47:36Z | c4f9dce | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 95%    | 81%       | 29  | 4/58     | A=32 B=9 C=4 D=9 F=4   |
| 2026-08-08T20:23:57Z | c4f9dce | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 33  | 0/58     | A=33 B=11 C=3 D=10 F=1 |
| 2026-08-08T20:33:08Z | c4f9dce | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 78%       | 34  | 0/58     | A=33 B=11 C=2 D=11 F=1 |
| 2026-08-08T20:52:26Z | c4f9dce | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 81%       | 30  | 0/58     | A=33 B=11 C=4 D=9 F=1  |
| 2026-08-08T20:58:37Z | c4f9dce | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 32  | 0/58     | A=33 B=11 C=3 D=10 F=1 |
| 2026-08-09T19:14:54Z | 991449b | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 81%       | 30  | 0/58     | A=34 B=11 C=3 D=9 F=1  |
| 2026-08-11T07:05:19Z | edc8a70 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 32  | 0/58     | A=33 B=11 C=3 D=10 F=1 |
| 2026-08-11T07:32:22Z | fbc0b50 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 95%    | 81%       | 30  | 3/58     | A=30 B=11 C=5 D=9 F=3  |
| 2026-08-12T08:11:58Z | 9effe94 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 32  | 0/58     | A=33 B=11 C=3 D=10 F=1 |
| 2026-08-12T08:38:24Z | e98efaa | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 33  | 0/58     | A=31 B=12 C=3 D=11 F=1 |
| 2026-08-12T19:04:45Z | e98efaa | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 32  | 0/58     | A=34 B=11 C=2 D=10 F=1 |
| 2026-08-13T20:04:35Z | 09b9f6a | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 95%    | 81%       | 30  | 5/58     | A=32 B=11 C=3 D=9 F=3  |
| 2026-08-13T21:47:41Z | 09b9f6a | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 93%    | 81%       | 29  | 5/58     | A=34 B=8 C=3 D=10 F=3  |
| 2026-08-14T09:42:50Z | 5eb303a | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 32  | 0/58     | A=33 B=11 C=3 D=10 F=1 |
| 2026-08-14T09:50:53Z | 5eb303a | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 80%       | 31  | 0/58     | A=34 B=11 C=3 D=9 F=1  |
| 2026-08-14T10:18:57Z | 9c84b8a | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 81%       | 30  | 0/58     | A=33 B=11 C=4 D=9 F=1  |
| 2026-08-14T14:38:05Z | 57dbe98 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 79%       | 32  | 0/58     | A=33 B=11 C=3 D=10 F=1 |
| 2026-08-14T18:19:40Z | dd5db38 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 81%       | 30  | 0/58     | A=34 B=11 C=3 D=9 F=1  |
| 2026-08-14T19:04:12Z | 2b47210 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 80%       | 31  | 0/58     | A=34 B=11 C=3 D=9 F=1  |
| 2026-08-14T20:09:39Z | edd02dd | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 71%    | 86%       | 21  | 58/58    | A=13 B=5 C=11 D=5 F=24 |
| 2026-08-14T21:42:59Z | 39548dc | NER(de_core_news_md, en_core_web_md) + local:qwen2.5:7b                               | 96%    | 79%       | 33  | 0/58     | A=32 B=9 C=4 D=11 F=2  |
| 2026-08-15T05:54:12Z | 0e5f704 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98%    | 82%       | 28  | 0/58     | A=34 B=11 C=3 D=9 F=1  |
| 2026-08-15T06:14:48Z | e160894 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98% | 82% | 28 | 0/58 | A=34 B=11 C=3 D=9 F=1 |
| 2026-08-15T08:50:38Z | 11dfab0 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98% | 82% | 28 | 0/58 | A=34 B=11 C=3 D=9 F=1 |
| 2026-08-15T17:59:53Z | 6fd72b2 | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98% | 82% | 28 | 0/58 | A=34 B=11 C=3 D=9 F=1 |
| 2026-08-15T18:46:47Z | 13d273c | NER(de_core_news_md, en_core_web_md) + cloud:mistralai/mistral-small-3.2-24b-instruct | 98% | 82% | 28 | 0/58 | A=34 B=11 C=3 D=9 F=1 |
