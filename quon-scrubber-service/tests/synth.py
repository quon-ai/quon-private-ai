"""Synthetic PII evaluation corpus - value-based, exact ground truth, no real PII.

Each case inserts Faker-produced (or format-crafted) values into domain templates,
so the inserted value is the gold label - no manual annotation. A fixed seed makes
the corpus reproducible; German and English are generated balanced. Consumed by
``tests/test_corpus.py`` (opt-in) to measure leak-rate at scale against config 1
(NER + regex, the guaranteed floor).

Design notes:
  - Values are crafted with deliberate FORMAT VARIETY (the hard cases): spaced /
    unspaced / foreign IBANs, many phone formats, German + English amounts, etc.
  - Distractor slots carry public cities/companies, relative dates and capitalised
    nouns that must not be redacted (the over-redaction guard).
  - Every template names its PII slots (-> must_anonymize) and distractor slots
    (-> must_not_anonymize), so ground truth falls out of generation.
  - all of the above is FORMAL-register (business/invoice/steuer/medizin/
    scheduling/support/credentials templates). ``generate_casual_register_corpus``
    is a separate, hand-curated slice covering conversational chat register - 
    see its docstring for why this exists (three real production false
    positives that a formal-only corpus could never have caught) and the
    labeling rule for street/place compounds (tracked via ``street_terms``, not
    ``must_not_anonymize`` - that grading is type-blind, see ``grade_case``).
"""

from __future__ import annotations

import random

from faker import Faker

SEED = 20260628

# Foreign / compound names - NER's documented weak spot, tracked as their own slice.
FOREIGN_NAMES = [
    "Chinwe Adeyemi", "Nguyen Van Anh", "Aleksandra Kowalska", "Mehmet Yılmaz",
    "Olusegun Okonkwo", "Priya Subramanian", "Wei Zhang", "Fatima Al-Rashid",
    "Dmitri Volkov", "Sanjay Gupta", "Yuki Tanaka", "Ingrid Sørensen",
    "João Oliveira", "Lakshmi Narayan", "Kwame Mensah", "Soo-jin Park",
]
COMPOUND_NAMES = [
    "Müller-Lüdenscheidt", "von der Leyen", "van den Berg", "de la Cruz",
    "Schmidt-Bauer", "O'Brien", "Anna-Lena Hoffmann", "Karl-Heinz Weber",
]
FOREIGN_IBANS = [
    "GB29 NWBK 6016 1331 9268 19", "FR14 2004 1010 0505 0001 3M02 606",
    "ES91 2100 0418 4502 0005 1332", "IT60 X054 2811 1010 0000 0123 456",
    "NL91 ABNA 0417 1643 00", "CH93 0076 2011 6238 5295 7",
]

DISTRACTOR_CITIES = {
    "de": ["Berlin", "Hamburg", "München", "Köln", "Frankfurt", "Stuttgart", "Dresden"],
    "en": ["London", "Manchester", "Boston", "Chicago", "Seattle", "Toronto", "Dublin"],
}
DISTRACTOR_COMPANIES = ["Siemens", "Bosch", "SAP", "Microsoft", "Amazon", "Volkswagen", "Allianz"]
DISTRACTOR_RELDATES = {
    "de": ["nächste Woche", "in drei Wochen", "letzten Monat", "übermorgen", "seit zwei Tagen"],
    "en": ["next week", "in three weeks", "last month", "the day after tomorrow", "for two days"],
}
DISTRACTOR_NOUNS = {
    "de": ["Meeting", "Projekt", "Rechnung", "Vertrag", "Angebot", "Protokoll"],
    "en": ["Meeting", "Project", "Invoice", "Contract", "Proposal", "Report"],
}


class Gen:
    """Seeded value generators with format variety. One instance per corpus build."""

    def __init__(self, seed: int = SEED):
        self.rng = random.Random(seed)
        self.fake = {"de": Faker("de_DE"), "en": Faker("en_US")}
        for f in self.fake.values():
            f.seed_instance(seed)
        self._foreign_iban_fakers = [Faker(loc) for loc in ("fr_FR", "en_GB", "it_IT", "es_ES")]
        for f in self._foreign_iban_fakers:
            f.seed_instance(seed)

    def person(self, lang: str, slice_: str = "normal") -> str:
        if slice_ == "foreign":
            return self.rng.choice(FOREIGN_NAMES)
        if slice_ == "compound":
            return self.rng.choice(COMPOUND_NAMES)
        f = self.fake[lang]
        return f"{f.first_name()} {f.last_name()}"

    def email(self, lang: str) -> str:
        f = self.fake[lang]
        style = self.rng.randint(0, 2)
        if style == 0:
            return f.ascii_free_email()
        first, last = f.first_name().lower(), f.last_name().lower()
        dom = self.rng.choice(["firma.de", "acme.com", "beispiel.de", "example.org", "kanzlei.de"])
        sep = self.rng.choice([".", "_", ""])
        local = f"{first}{sep}{last}" if style == 1 else f"{first[0]}.{last}"
        return f"{local}@{dom}".replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")

    def iban(self, lang: str) -> str:
        style = self.rng.randint(0, 2)
        if style == 2:
            return self.rng.choice(FOREIGN_IBANS)
        raw = self.fake[lang].iban() if lang == "de" else Faker("de_DE").iban()
        if style == 0:  # spaced in groups of 4
            return " ".join(raw[i : i + 4] for i in range(0, len(raw), 4))
        return raw  # unspaced

    def phone(self, lang: str) -> str:
        r = self.rng
        if lang == "de":
            area = r.choice(["30", "40", "89", "170", "151", "176"])
            num = "".join(str(r.randint(0, 9)) for _ in range(7))
            fmt = r.randint(0, 4)
            if fmt == 0:
                return f"+49 {area} {num}"
            if fmt == 1:
                return f"0049 {area} {num}"
            if fmt == 2:
                return f"0{area}/{num}"
            if fmt == 3:
                return f"+49 (0){area} {num[:3]} {num[3:]}"
            return f"0{area} {num}"
        npa = r.randint(200, 989)
        line = f"{r.randint(200, 999)}-{r.randint(1000, 9999)}"
        fmt = r.randint(0, 2)
        if fmt == 0:
            return f"+1 ({npa}) {line}"
        if fmt == 1:
            return f"({npa}) {line.replace('-', ' ')}"
        return f"{npa}-{line}"

    def amount(self, lang: str) -> str:
        r = self.rng
        if lang == "de":
            choices = [
                f"{r.randint(1, 9)},{r.randint(1, 9)} Mio. €",
                f"{r.randint(1, 999)}.{r.randint(100, 999)},{r.randint(10, 99)} €",
                f"EUR {r.randint(100, 9999)}",
                f"{r.randint(1, 50)}.{r.randint(100, 999)} Euro",
            ]
        else:
            choices = [
                f"${r.randint(1, 999)},{r.randint(100, 999)}.{r.randint(10, 99)}",
                f"USD {r.randint(100, 9999)}",
                f"£{r.randint(1, 99)},{r.randint(100, 999)}",
                f"{r.randint(1, 9)}.{r.randint(1, 9)} million USD",
            ]
        return r.choice(choices)

    def date(self, lang: str) -> str:
        r = self.rng
        d, y = r.randint(1, 28), r.randint(2023, 2026)
        if lang == "de":
            months = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli",
                      "August", "September", "Oktober", "November", "Dezember"]
            return r.choice([f"{d}. {r.choice(months)} {y}", f"{d:02d}.{r.randint(1,12):02d}.{y}"])
        months = ["January", "February", "March", "April", "May", "June", "July",
                  "August", "September", "October", "November", "December"]
        return r.choice([f"{r.choice(months)} {d}, {y}", f"{r.randint(1,12):02d}/{d:02d}/{y}"])

    def tax_id(self, lang: str) -> str:
        r = self.rng
        if lang == "de":
            digits = "".join(str(r.randint(0, 9)) for _ in range(11))
            return f"{digits[:2]} {digits[2:5]} {digits[5:8]} {digits[8:]}"
        return f"{r.randint(100,899)}-{r.randint(10,99)}-{r.randint(1000,9999)}"  # SSN

    def insurance_id(self, lang: str) -> str:
        r = self.rng
        return r.choice([
            f"VN-{r.randint(2020,2026)}-{r.randint(10000,99999)}",
            f"KV-{r.randint(10000,99999)}-A-{r.randint(1,9)}",
            self._bare_kvnr(),
            f"MRN {r.randint(1000000,9999999)}",
        ])

    def _bare_kvnr(self) -> str:
        """Bare KVNR with a valid check digit (GKV Anlage 1: letter as two
        digits A=01..Z=26, weights 1,2 alternating from the left, two-digit
        products digit-summed, sum mod 10). The old generator appended nine
        random digits - a value shape no real card carries, which let the
        corpus score a checksum-gated detector as a 90% miss on a class it
        catches 100% of in the real world. Synthetic values keep the real
        shape; the validator itself is anchored to the spec's own worked
        examples in test_fallback.py, so generator and detector cannot drift
        into agreeing by copying each other's bug."""
        r = self.rng
        letter = chr(r.randint(ord("A"), ord("Z")))
        digits8 = "".join(str(r.randint(0, 9)) for _ in range(8))
        ten = f"{ord(letter) - 64:02d}{digits8}"
        total = 0
        for i, ch in enumerate(ten):
            product = int(ch) * (1 if i % 2 == 0 else 2)
            total += product // 10 + product % 10
        return f"{letter}{digits8}{total % 10}"

    def pin(self, lang: str) -> str:
        return "".join(str(self.rng.randint(0, 9)) for _ in range(self.rng.choice([4, 5, 6])))

    def credential(self, lang: str) -> str:
        r = self.rng
        return r.choice([
            "sk-" + "".join(r.choice("abcdef0123456789") for _ in range(20)),
            "".join(r.choice("ABCXYZ") for _ in range(2)) + "#" + str(r.randint(1000, 9999)) + "mK!",
            f"P@ss{r.randint(1000,9999)}word",
            "API_KEY=" + "".join(r.choice("ABCDEF0123456789") for _ in range(16)),
        ])

    def address(self, lang: str) -> str:
        r = self.rng
        street = r.choice([
            "Bahnhofstraße", "Hauptstraße", "Lindenweg", "Gartenstraße", "Rosenweg",
            "Rehbergplatz", "Schulstraße", "Kirchgasse", "Ringallee", "Mühlenweg",
        ])
        num = f"{r.randint(1, 199)}{r.choice(['', '', 'a', 'b'])}"
        if r.random() < 0.4:
            city = r.choice(["Berlin", "München", "Hamburg", "Köln", "Freiburg", "Leipzig"])
            return f"{r.randint(10000, 99999)} {city}"
        return f"{street} {num}"

    def routing(self, lang: str) -> str:
        return "".join(str(self.rng.randint(0, 9)) for _ in range(9))

    def internal_url(self, lang: str) -> str:
        r = self.rng
        host = r.choice(["confluence.intern", "wiki.internal", "jira.intern", "git.internal"])
        comp = r.choice(["firma.de", "acme.local", "gs.com", "beispiel.de"])
        return f"https://{host}.{comp}/{r.choice(['pages','users','repo'])}/{r.randint(100,9999)}"

    def distractor(self, lang: str, kind: str) -> str:
        if kind == "city":
            return self.rng.choice(DISTRACTOR_CITIES[lang])
        if kind == "company":
            return self.rng.choice(DISTRACTOR_COMPANIES)
        if kind == "reldate":
            return self.rng.choice(DISTRACTOR_RELDATES[lang])
        return self.rng.choice(DISTRACTOR_NOUNS[lang])


# Templates: {focal} = the stratified PII value, {person} = incidental name,
# {dX} = distractor. Each lists which PII types fill {focal}/{person} and which
# distractor kind fills each dX. One DE + one EN per focal type, several styles.
TEMPLATES: dict[str, list[dict]] = {
    "EMAIL": [
        {"lang": "de", "slice": "business", "person": "normal",
         "text": "Hallo {person}, bitte die Unterlagen zum {d0} an {focal} senden. Standort {d1}.",
         "d": ["reldate", "city"]},
        {"lang": "en", "slice": "business", "person": "normal",
         "text": "Hi {person}, please forward the {d0} files to {focal}. Office in {d1}.",
         "d": ["noun", "city"]},
    ],
    "IBAN": [
        {"lang": "de", "slice": "financial", "person": "normal",
         "text": "{person} bittet um Überweisung auf {focal}. Rückfragen {d0}.",
         "d": ["reldate"]},
        {"lang": "en", "slice": "financial", "person": "normal",
         "text": "Please wire the retainer to {person}'s account {focal}. {d0} reconciliation.",
         "d": ["noun"]},
    ],
    "PHONE": [
        {"lang": "de", "slice": "support", "person": "normal",
         "text": "{person} ist unter {focal} erreichbar, am besten {d0}. Büro {d1}.",
         "d": ["reldate", "city"]},
        {"lang": "en", "slice": "support", "person": "normal",
         "text": "Call {person} on {focal} about the {d0}; they're in {d1}.",
         "d": ["noun", "city"]},
    ],
    "FINANCIAL_AMOUNT": [
        {"lang": "de", "slice": "invoice", "person": "normal",
         "text": "Das Angebot von {person} beläuft sich auf {focal}, fällig {d0}.",
         "d": ["reldate"]},
        {"lang": "en", "slice": "invoice", "person": "normal",
         "text": "{person}'s quote totals {focal} for the {d0} in {d1}.",
         "d": ["noun", "city"]},
    ],
    "DATE": [
        {"lang": "de", "slice": "scheduling", "person": "normal",
         "text": "{person} schlägt den {focal} für das {d0} vor, nicht {d1}.",
         "d": ["noun", "reldate"]},
        {"lang": "en", "slice": "scheduling", "person": "normal",
         "text": "{person} proposes {focal} for the {d0}, not {d1}.",
         "d": ["noun", "reldate"]},
    ],
    "TAX_ID": [
        {"lang": "de", "slice": "steuer", "person": "normal",
         "text": "Steuer-ID von {person}: {focal}. Bescheid kommt {d0}.",
         "d": ["reldate"]},
        {"lang": "en", "slice": "steuer", "person": "normal",
         "text": "{person}'s SSN is {focal}; the {d0} was filed in {d1}.",
         "d": ["noun", "city"]},
    ],
    "INSURANCE_ID": [
        {"lang": "de", "slice": "medizin", "person": "normal",
         "text": "Versichertennummer {focal} für {person}, Termin {d0}.",
         "d": ["reldate"]},
        {"lang": "en", "slice": "medizin", "person": "normal",
         "text": "Patient {person}, member ID {focal}, follow-up {d0}.",
         "d": ["reldate"]},
        # Unlabelled: the two templates above put a label word next to the id,
        # so the labelled-ID rule alone scores 100% and the corpus is
        # structurally blind to a bare KVNR. These two carry no label adjacency
        # - only shape (checksum for the bare form, prefix for the others) can
        # catch them, which is exactly what the ratchet must exercise.
        {"lang": "de", "slice": "medizin", "person": "normal",
         "text": "Auf der Gesundheitskarte von {person} steht {focal}.",
         "d": []},
        {"lang": "de", "slice": "medizin", "person": "normal",
         "text": "{person} soll {focal} bei der Anmeldung angeben.",
         "d": []},
    ],
    "ADDRESS": [
        {"lang": "de", "slice": "alltag", "person": "normal",
         "text": "Bitte schick das Paket an {person}, {focal}.",
         "d": []},
        {"lang": "de", "slice": "formell", "person": "normal",
         "text": "Der Kunde {person} wohnt in der {focal} und ist selten da.",
         "d": []},
        {"lang": "en", "slice": "alltag", "person": "normal",
         "text": "Deliver to {person} at {focal}, ring twice.",
         "d": []},
    ],
    "PIN": [
        {"lang": "de", "slice": "credentials", "person": "normal",
         "text": "{person} hat die PIN {focal} zurückgesetzt, gültig ab {d0}.",
         "d": ["reldate"]},
        {"lang": "en", "slice": "credentials", "person": "normal",
         "text": "{person} reset the PIN to {focal} for the {d0} system.",
         "d": ["noun"]},
    ],
    "CREDENTIAL": [
        {"lang": "de", "slice": "credentials", "person": "normal",
         "text": "{person} legt den Key {focal} ins {d0}; bitte nicht teilen.",
         "d": ["noun"]},
        {"lang": "en", "slice": "credentials", "person": "normal",
         "text": "{person} rotated the token {focal} for the {d0} job.",
         "d": ["noun"]},
    ],
    "ROUTING": [
        {"lang": "de", "slice": "financial", "person": "normal",
         "text": "Bankleitzahl {focal} für {person}, Klärung {d0}.",
         "d": ["reldate"]},
        {"lang": "en", "slice": "financial", "person": "normal",
         "text": "{person}'s routing number is {focal}; ACH runs {d0}.",
         "d": ["reldate"]},
    ],
    "INTERNAL_URL": [
        {"lang": "de", "slice": "it_ticket", "person": "normal",
         "text": "{person} dokumentiert das {d0} unter {focal}.",
         "d": ["noun"]},
        {"lang": "en", "slice": "it_ticket", "person": "normal",
         "text": "{person} wrote up the {d0} at {focal}.",
         "d": ["noun"]},
    ],
    # PERSON focal also includes the hard name slices (foreign / compound).
    "PERSON": [
        {"lang": "de", "slice": "person_normal", "person": "skip",
         "text": "Bitte leiten Sie das an {focal} weiter; Kopie an {d0}-Team.",
         "d": ["noun"]},
        {"lang": "en", "slice": "person_normal", "person": "skip",
         "text": "Please loop in {focal} on the {d0}; they cover {d1}.",
         "d": ["noun", "city"]},
        {"lang": "de", "slice": "person_foreign", "person": "skip", "focal_slice": "foreign",
         "text": "Frau/Herr {focal} übernimmt das {d0} in {d1}.",
         "d": ["noun", "city"]},
        {"lang": "en", "slice": "person_foreign", "person": "skip", "focal_slice": "foreign",
         "text": "{focal} will lead the {d0} from {d1}.",
         "d": ["noun", "city"]},
        {"lang": "de", "slice": "person_compound", "person": "skip", "focal_slice": "compound",
         "text": "Die Unterschrift von {focal} fehlt noch auf dem {d0}.",
         "d": ["noun"]},
        {"lang": "en", "slice": "person_compound", "person": "skip", "focal_slice": "compound",
         "text": "We still need {focal}'s sign-off on the {d0}.",
         "d": ["noun"]},
    ],
}

# CC-list slice: the documented email miss (an address buried in a long CC line).
_CC_TEMPLATES = [
    {"lang": "de", "text": "Verteiler: {p0} ({e0}), {p1} ({e1}), {p2} ({e2}). Betreff: {d0}."},
    {"lang": "en", "text": "CC: {p0} <{e0}>, {p1} <{e1}>, {p2} <{e2}>. Re: {d0}."},
]

# --- Casual-register slice ---------------------------------------------------
# Three real PERSON false positives share one cause (all
# casual-register German: "Wann einnehmen?", "Ibuprofen Einnahme wann?",
# "Welcher Supermarkt kommt an den Rehbergplatz in bad kleinfeld"): every
# template above is FORMAL-register (business/invoice/steuer/medizin/scheduling/
# support/credentials boilerplate), so casual chat - the actual production
# register - was invisible to the precision/recall ratchet. All three FPs
# shipped because no eval case looked like a real user question. This slice
# does not retest the specific fixed strings (those live as point regressions
# in test_ner.py / test_scrubber.py); it is a broader, scaled STRUCTURAL guard
# so a *class* of future casual-register regression is caught by the ratchet,
# not just the three reported instances.
#
# Two halves:
#   - "casual_negative": no PII at all -> must yield zero entities. This is the
#     FP guard and the majority of the slice.
#   - "casual_positive": the same casual shapes with a real embedded name ->
#     the name must still be caught (the recall guard, so a future precision
#     fix can't silently start dropping real names in this register too).
#
# German street/square compounds are deliberately included among the negatives
# (the exact class behind the third FP above). Labeling rule: these
# compounds are recorded in "street_terms", not folded into must_not_anonymize.
# must_not_anonymize is graded type-blind in grade_case (a value counts as a
# false positive if it is not found in the scrubbed text AT all, however it was
# redacted) - so putting a street name there would assert "must never be
# redacted at all," which would fight a future ADDRESS entity type wanting to
# redact exactly this kind of value. "street_terms" instead feeds a dedicated,
# TYPE-AWARE check (see tests/test_corpus.py's street-term assertion) that reads
# the real /scrub entity report and only fails if the value was tagged PERSON
# specifically - any other treatment (kept in clear, or redacted as some future
# non-PERSON type) is fine.
_CASUAL_NEG_INTERROGATIVE = {
    "de": [
        "Wann kommt der Bus heute",
        "Wie spät ist es gerade",
        "Was gibt es heute zu essen",
        "Wo ist der nächste Bäcker",
        "Warum ist die Ampel schon wieder rot",
        "Wieso dauert das immer so lange",
        "Welche Marke ist da am besten",
        "Wieviel kostet das ungefähr",
        "Woher weißt du das schon wieder",
        "Wohin fahren wir dieses Jahr im Urlaub",
        "Weshalb ist der Laden heute zu",
        "Welcher Zug fährt als nächstes ab",
        "Was machen wir heute Abend eigentlich",
        "Wie oft in der Woche gehst du laufen",
        "Wo hast du die Schlüssel hingelegt",
        "Wann fängt der Film heute Abend an",
    ],
    "en": [
        "When does the bus usually come",
        "What time does the pharmacy close",
        "Where can I get a coffee near here",
        "Why is this taking so long",
        "How much does that usually cost",
        "Which bus goes downtown from here",
        "Who else is coming to this thing",
        "How long until the next train",
        "What are we doing tonight anyway",
        "Where did you put the keys again",
        "How often do you go running each week",
        "Which movie are we watching later",
        "Why is the shop closed today",
        "What time does the film start tonight",
        "Where should we go for vacation this year",
        "How do I get downtown from here",
    ],
}
_CASUAL_NEG_IMPERATIVE = {
    "de": [
        "Erinnere mich morgen früh daran",
        "Zeig mir gute rezepte für pasta",
        "Erkläre mir kurz wie das funktioniert",
        "Schreib das bitte noch schnell auf",
        "Plane einen kurzen ausflug fürs wochenende",
        "Fasse das nochmal kurz zusammen bitte",
        "Übersetze das mal kurz ins englische",
        "Rechne mir aus wie viel das insgesamt kostet",
        "Suche mir ein gutes rezept für heute abend",
        "Gib mir mal drei ideen für das wochenende",
        "Hilf mir kurz beim packen für morgen",
        "Vergleiche die beiden angebote kurz für mich",
    ],
    "en": [
        "Remind me about that again tomorrow",
        "Show me some good pasta recipes",
        "Explain how that actually works please",
        "Plan a short trip for the weekend",
        "Summarize that again in two sentences",
        "Write that down before I forget it",
        "Translate that quickly into German please",
        "Help me pack for the trip tomorrow",
        "Compare those two options for me quickly",
        "Give me a few ideas for tonight",
        "Find me a good recipe for dinner",
        "Calculate roughly how much that will cost",
    ],
}
_CASUAL_NEG_MEDICAL_SHORTHAND = {
    "de": [
        "Wann einnehmen nach dem Essen",
        "Wie oft am Tag einnehmen",
        "Morgens oder abends einnehmen besser",
        "Tabletten wann genau einnehmen",
        "Dosis wie hoch am Anfang",
        "Wieviel Einnahme pro Woche normal",
        "Wann Kontrolle beim Arzt nochmal",
        "Wo einnehmen, vor oder nach dem Essen",
        "Was einnehmen bei Kopfschmerzen abends",
        "Warum diese Dosis so niedrig angesetzt",
        "Nüchtern oder mit Essen einnehmen besser",
        "Wie lange noch bis zur nächsten Kontrolle",
    ],
    "en": [
        "When should this be taken",
        "How often per day is normal",
        "Better to take this before or after food",
        "How long until it starts working",
        "What happens if a dose is missed",
        "Should this be taken with or without food",
        "How long before the next check-up",
        "Is it normal to feel tired on this",
        "What time of day works best for this",
        "How many days until the follow-up appointment",
    ],
}
_CASUAL_NEG_TOPIC = {
    "de": [
        "Welcher Supermarkt hat heute noch offen",
        "Kommst du morgen mit ins Kino",
        "Gibt es hier einen Bäcker in der Nähe",
        "Wir treffen uns dann später am Marktplatz",
        "Meine Schwester zieht nächste Woche um",
        "Der Flug morgen früh geht sehr zeitig",
        "Ich muss noch schnell einkaufen gehen",
        "Der Termin beim Zahnarzt wurde verschoben",
        "Ich fahre zur Bahnhofstraße rüber",
        "Triff mich einfach am Rosenweg vorne",
        "Wir wohnen jetzt ganz in der Nähe vom Alexanderplatz",
        "Der Laden am Marktplatz hat neu eröffnet",
        "Meine Eltern kommen übers Wochenende zu Besuch",
        "Der Zug hat heute wieder mal Verspätung",
        "Wir müssen noch Geschenke für die Feier besorgen",
        "Das Wetter soll morgen viel besser werden",
        "Ich hole dich später vom Bahnhof ab",
        "Unser Urlaub geht dieses Jahr an die Küste",
        "Die Reservierung fürs Restaurant steht schon",
        "Mein Onkel feiert nächsten Monat seinen Geburtstag",
        "Ich habe den Bus heute morgen verpasst",
        "Wir treffen die anderen direkt am Rathausplatz",
    ],
    "en": [
        "Which store is still open right now",
        "Can you come to the movies tomorrow",
        "My sister is moving next week",
        "The flight tomorrow leaves really early",
        "I still need to go grocery shopping",
        "The dentist appointment got moved again",
        "Let's meet by the market square later",
        "I'm heading over to the train station street",
        "We live pretty close to the main square now",
        "The shop on the market square just reopened",
        "My parents are visiting over the weekend",
        "The train is running late again today",
        "We still need to buy gifts for the party",
        "The weather should be much better tomorrow",
        "I'll pick you up from the station later",
        "Our vacation this year is at the coast",
        "The restaurant reservation is already booked",
        "My uncle's birthday is next month",
        "I missed the bus again this morning",
        "Let's meet the others right by town hall square",
    ],
}
# All-lowercase variants (the no-case-signal path - recall of the negative
# guard must hold even with zero casing signal, mirroring the reported
# screenshots which were themselves informally-cased).
_CASUAL_NEG_LOWERCASE = {
    "de": [
        "wann kommt der bus heute",
        "wie spät ist es gerade",
        "kannst du mir helfen einen ausflug zu planen",
        "was ist da los mit dir",
        "wann einnehmen nach dem essen",
        "wo ist der nächste bäcker in der nähe",
        "wir treffen uns später am marktplatz",
        "ich fahre gleich zur bahnhofstraße rüber",
        "welcher supermarkt hat heute noch offen",
        "erinnere mich morgen früh daran bitte",
        "wieviel kostet das ungefähr insgesamt",
        "zeig mir gute rezepte für pasta bitte",
    ],
    "en": [
        "when does the bus usually come",
        "what time does the pharmacy close",
        "can you help me plan a trip",
        "how much does that usually cost",
        "where can i get a coffee near here",
        "we are meeting later by the market square",
        "which store is still open right now",
        "remind me about that again tomorrow",
        "show me some good pasta recipes please",
        "my sister is moving next week actually",
    ],
}

# Real names embedded in the same casual shapes (the recall guard). Only
# formats that keep the name CAPITALIZED are used for config 1 (no LLM): on
# all-lowercase input NER defers PERSON detection to the LLM by design (see
# ner.detect_ner's case-signal gate), so a lowercase name here would be
# undetectable in config 1 not because of a regression but because of that
# documented, intentional behaviour - gating a corpus assertion on it would
# fail the ratchet for the wrong reason. Noted, not included, per the task.
_CASUAL_POS = [
    {"lang": "de", "text": "Kannst du Anna Müller schnell anrufen", "name": "Anna Müller"},
    {"lang": "de", "text": "Wann hat Dr. Weber heute Sprechstunde", "name": "Weber"},
    {"lang": "de", "text": "Erinnere mich Frau Hoffmann morgen zurückzurufen", "name": "Hoffmann"},
    {"lang": "de", "text": "Triff Herrn Kowalski einfach am Marktplatz", "name": "Kowalski"},
    {"lang": "de", "text": "Wie erreiche ich am besten Stefan Bauer", "name": "Stefan Bauer"},
    {"lang": "de", "text": "Welcher Kollege ist das, Thomas Fischer oder Peter Klein", "name": "Thomas Fischer"},
    {"lang": "de", "text": "Wo wohnt eigentlich Herr Sandberg genau", "name": "Sandberg"},
    {"lang": "de", "text": "Wieso ruft Nadine Neumann schon wieder an", "name": "Nadine Neumann"},
    {"lang": "de", "text": "Warum kommt Michael Schwarz erst später", "name": "Michael Schwarz"},
    {"lang": "de", "text": "Erkläre Frau Vogel kurz wie das funktioniert", "name": "Vogel"},
    {"lang": "de", "text": "Wann kommt eigentlich Sandra Krüger vorbei", "name": "Sandra Krüger"},
    {"lang": "de", "text": "Schreib bitte kurz an Markus Lehmann zurück", "name": "Markus Lehmann"},
    {"lang": "en", "text": "Can you give Anna Müller a quick call", "name": "Anna Müller"},
    {"lang": "en", "text": "When is Dr. Weber's office open today", "name": "Weber"},
    {"lang": "en", "text": "Kim and Dann met at noon for coffee", "name": "Dann"},
    {"lang": "en", "text": "Remind me to text Sarah Johnson tomorrow", "name": "Sarah Johnson"},
    {"lang": "en", "text": "Which one is closer, Mark Thompson or Lisa Chen", "name": "Mark Thompson"},
    {"lang": "en", "text": "How do I usually reach Stefan Bauer these days", "name": "Stefan Bauer"},
    {"lang": "en", "text": "Why does Michael Brooks keep calling so late", "name": "Michael Brooks"},
    {"lang": "en", "text": "Where does Jennifer Adams actually live now", "name": "Jennifer Adams"},
    {"lang": "en", "text": "Can you remind Laura Bennett about the meeting", "name": "Laura Bennett"},
    {"lang": "en", "text": "When does Robert Nguyen usually get in", "name": "Robert Nguyen"},
]

# Known street/square compounds seeded into the casual-negative topic sentences
# above, tracked separately from must_not_anonymize (see the labeling-rule note
# above _CASUAL_NEG_INTERROGATIVE).
_CASUAL_STREET_TERMS = {
    "Rehbergplatz", "Marktplatz", "Bahnhofstraße", "Rosenweg", "Alexanderplatz",
    "Rathausplatz",
}


def _casual_negative_cases(lang: str, bucket: dict[str, list[str]], subslice: str) -> list[dict]:
    out = []
    for i, text in enumerate(bucket[lang]):
        street = sorted(t for t in _CASUAL_STREET_TERMS if t.lower() in text.lower())
        out.append({
            "id": f"SYN-CASUALNEG-{subslice}-{lang}-{i:04d}", "language": lang,
            "category": "casual_negative", "slice": f"casual_negative_{subslice}",
            "input": text, "policy": "public_ok",
            "must_anonymize": [], "must_not_anonymize": [],
            "street_terms": street,
        })
    return out


def _casual_positive_cases() -> list[dict]:
    out = []
    for i, spec in enumerate(_CASUAL_POS):
        out.append({
            "id": f"SYN-CASUALPOS-{spec['lang']}-{i:04d}", "language": spec["lang"],
            "category": "casual_positive", "slice": "casual_positive",
            "input": spec["text"], "policy": "strict_private",
            "must_anonymize": [{"value": spec["name"], "type": "PERSON"}],
            "must_not_anonymize": [], "street_terms": [],
        })
    return out


def generate_casual_register_corpus() -> list[dict]:
    """The full casual-register slice (~150-200 cases, DE/EN balanced),
    independent of ``target`` - this is a fixed structural guard, not something
    that should shrink when a caller asks for a smaller sample via
    ``generate_corpus(target=...)``. Returned separately so ``generate_corpus``
    can fold it in at a stable size regardless of the overall corpus target."""
    cases: list[dict] = []
    for lang in ("de", "en"):
        cases += _casual_negative_cases(lang, _CASUAL_NEG_INTERROGATIVE, "interrogative")
        cases += _casual_negative_cases(lang, _CASUAL_NEG_IMPERATIVE, "imperative")
        cases += _casual_negative_cases(lang, _CASUAL_NEG_MEDICAL_SHORTHAND, "medical")
        cases += _casual_negative_cases(lang, _CASUAL_NEG_TOPIC, "topic")
        cases += _casual_negative_cases(lang, _CASUAL_NEG_LOWERCASE, "lowercase")
    cases += _casual_positive_cases()
    return cases


def _negative_case(g: Gen, lang: str, i: int) -> dict:
    """A message with no redactable PII - only public places/companies, a relative
    date and capitalised nouns. Expectation: nothing redacted (over-redaction guard)."""
    city, comp = g.distractor(lang, "city"), g.distractor(lang, "company")
    rel, noun = g.distractor(lang, "reldate"), g.distractor(lang, "noun")
    if lang == "de":
        text = f"Das {noun} mit {comp} findet {rel} in {city} statt. Tolle Stadt!"
    else:
        text = f"The {noun} with {comp} happens {rel} in {city}. Great city!"
    return {
        "id": f"SYN-NEG-{lang}-{i:04d}", "language": lang, "category": "negative",
        "slice": "negative", "input": text, "policy": "public_ok",
        "must_anonymize": [], "must_not_anonymize": [city, comp, rel, noun],
    }


def _cc_case(g: Gen, lang: str, i: int) -> dict:
    tmpl = next(t for t in _CC_TEMPLATES if t["lang"] == lang)
    people = [g.person(lang) for _ in range(3)]
    emails = [g.email(lang) for _ in range(3)]
    noun = g.distractor(lang, "noun")
    text = tmpl["text"].format(
        p0=people[0], p1=people[1], p2=people[2],
        e0=emails[0], e1=emails[1], e2=emails[2], d0=noun,
    )
    must = [{"value": v, "type": "PERSON"} for v in people] + [
        {"value": v, "type": "EMAIL"} for v in emails
    ]
    return {
        "id": f"SYN-CC-{lang}-{i:04d}", "language": lang, "category": "cc_list",
        "slice": "email_cc_list", "input": text, "policy": "strict_private",
        "must_anonymize": must, "must_not_anonymize": [noun],
    }


_GEN_METHOD = {
    "EMAIL": "email", "IBAN": "iban", "PHONE": "phone", "FINANCIAL_AMOUNT": "amount",
    "DATE": "date", "TAX_ID": "tax_id", "INSURANCE_ID": "insurance_id", "PIN": "pin",
    "CREDENTIAL": "credential", "ROUTING": "routing", "INTERNAL_URL": "internal_url",
    "ADDRESS": "address",
}


#: Vendor-defined credential prefixes - published, stable formats. A string
#: carrying one of these announces itself as a secret wherever it appears.
_MARKED_SECRET_PREFIXES = ("sk-", "pk-", "ghp_", "gho_", "ghu_", "ghs_", "ghr_",
                          "xox", "AKIA", "eyJ")


def _secret_is_marked(value: str) -> bool:
    """Does this secret announce itself - vendor prefix, or NAME=value assignment?

    The scope line for CREDENTIAL (see expectations.Policy). Deliberately a
    property of the value, not a question about what our detectors manage to
    find: an unmarked high-entropy string is undiscoverable by anyone, so
    promising to catch it would be promising to guess.
    """
    v = value.strip()
    if any(v.startswith(p) for p in _MARKED_SECRET_PREFIXES):
        return True
    head, sep, tail = v.partition("=")
    return bool(sep and tail.strip() and head.strip().replace("_", "").isalnum())


def _fill_template(g: Gen, focal_type: str, tmpl: dict, idx: int) -> dict:
    lang = tmpl["lang"]
    focal_slice = tmpl.get("focal_slice", "normal")
    focal_val = (
        g.person(lang, focal_slice)
        if focal_type == "PERSON"
        else getattr(g, _GEN_METHOD[focal_type])(lang)
    )
    must = [{"value": focal_val, "type": focal_type}]
    fmt = {"focal": focal_val}
    if tmpl.get("person") not in (None, "skip"):
        pv = g.person(lang, tmpl["person"])
        fmt["person"] = pv
        must.append({"value": pv, "type": "PERSON"})
    must_not = []
    for n, kind in enumerate(tmpl.get("d", [])):
        dv = g.distractor(lang, kind)
        fmt[f"d{n}"] = dv
        must_not.append(dv)
    text = tmpl["text"].format(**fmt)
    return {
        "id": f"SYN-{focal_type}-{lang}-{idx:04d}", "language": lang,
        "category": tmpl["slice"], "slice": tmpl["slice"], "input": text,
        "policy": (
            "unmarked_secret"
            if focal_type == "CREDENTIAL" and not _secret_is_marked(focal_val)
            else "strict_private"
        ),
        "must_anonymize": must, "must_not_anonymize": must_not,
    }


def generate_corpus(target: int = 1500, seed: int = SEED) -> list[dict]:
    """Reproducible synthetic corpus of ~``target`` cases, balanced DE/EN, stratified
    so every entity type gets enough instances for tight confidence intervals.

    Always includes the fixed-size casual-register slice (~164 cases - 
    ``generate_casual_register_corpus``), a structural guard for the
    conversational register that the formal-template slices below don't touch
    (see its module docstring for the motivating false positives). It is fixed
    rather than scaled by ``target`` - this is a small, hand-curated battery,
    not something meant to grow with the corpus - but on a small
    ``QUON_CORPUS_N`` sample (e.g. the N=300 LLM run) it is capped at ~40% of
    the total so it can't dominate a tiny sample's per-type recall stats.
    """
    g = Gen(seed)
    cases: list[dict] = []
    focal_types = list(TEMPLATES)
    # ~10% negatives + ~5% CC-list; the rest stratified across focal types.
    n_neg = max(2, target // 10)
    n_cc = max(2, target // 20)
    per_type = max(1, (target - n_neg - n_cc) // len(focal_types))

    for ftype in focal_types:
        tmpls = TEMPLATES[ftype]
        for i in range(per_type):
            tmpl = tmpls[i % len(tmpls)]
            cases.append(_fill_template(g, ftype, tmpl, i))
    for i in range(n_cc):
        cases.append(_cc_case(g, "de" if i % 2 == 0 else "en", i))
    for i in range(n_neg):
        cases.append(_negative_case(g, "de" if i % 2 == 0 else "en", i))

    casual = generate_casual_register_corpus()
    cap = min(len(casual), max(1, int(target * 0.4)))
    cases += casual[:cap]

    g.rng.shuffle(cases)
    return cases


if __name__ == "__main__":
    corpus = generate_corpus()
    from collections import Counter

    langs = Counter(c["language"] for c in corpus)
    types = Counter(t["type"] for c in corpus for t in c["must_anonymize"])
    print(f"{len(corpus)} cases · langs={dict(langs)}")
    for t, n in sorted(types.items()):
        print(f"  {t:<18} {n}")
