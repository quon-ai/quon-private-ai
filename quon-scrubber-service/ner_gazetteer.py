"""Conservative gazetteer of capitalized terms that spaCy NER mislabels as PERSON
in documents — lab/report boilerplate and *unambiguous* foods.

Used to extend the PERSON denylist (see ``ner._get_denylist``). The driving case is
a food-sensitivity lab report (hundreds of capitalized food names + "IgG"/"FST"/
"LifeLabs"/"Patient Guidebook" → all tagged PERSON).

SAFETY (recall-first): over-redacting a food is a UX nuisance; dropping a real name
is a LEAK. So this list ONLY contains terms that are very unlikely to be a surname.
Food words that double as surnames — "Millet" (the painter), "Sweet", "Berry",
"Lamb", "Olive", "Bass", "Pike", "Carp", "Hering" — are deliberately LEFT OUT and
stay redacted; users can whitelist those via the per-user "Never redact" list.

Matched case-insensitively against the WHOLE detected value, so multi-word entries
(e.g. "bok choi", "patient guidebook") are listed in full.
"""

from __future__ import annotations

# --- Lab / report boilerplate (never a person) ----------------------------
_LAB_TERMS = {
    "igg", "ige", "igm", "iga", "fst", "lifelabs", "accession", "serum", "plasma",
    "antigen", "antigens", "antibody", "antibodies", "immunoglobulin", "sensitivity",
    "sensitivities", "borderline", "elevated", "reference", "ranges", "healthcare",
    "professional", "guidebook", "patient guidebook", "specimen", "analyte",
    "reactivity", "titre", "titer", "contractservices", "revista", "alergia",
    "revista alergia", "burnaby", "ancaster", "valridge",
}

# --- Unambiguous foods (compound / distinctly non-surname) -----------------
_FOODS = {
    # Fish & seafood
    "anchovy", "barnacle", "crayfish", "monkfish", "cuttlefish", "squid/cuttlefish",
    "pollock", "turbot", "zander", "swai", "swai fish", "octopus", "mussels", "scallop",
    "gilthead bream", "sea bass", "ocean perch",
    # Vegetables
    "bok choi", "bok choy", "mung bean", "kohlrabi", "zucchini", "aubergine",
    "broccoli", "cauliflower", "asparagus", "brussels sprouts", "butterhead",
    "butterhead lettuce", "arugula", "beetroot", "celeriac", "endive", "fennel",
    "leek", "parsnip", "radish", "rutabaga", "watercress", "chard", "lamb's lettuce",
    "iceberg lettuce", "red cabbage", "white cabbage", "savoy cabbage", "sweet potato",
    "sweet pepper",
    # Fruit
    "mulberry", "lychee", "papaya", "pomegranate", "persimmon", "guava", "rhubarb",
    "gooseberry", "cranberry", "elderberry", "tangerine", "clementine",
    # Grains / legumes (no surname collisions)
    "buckwheat", "quinoa", "amaranth", "chickpea", "chickpeas", "lentils", "spelt",
    "sorghum", "couscous", "bulgur",
    # Nuts / mushrooms
    "cashew", "pistachio", "macadamia", "hazelnut", "chanterelle", "porcini mushroom",
    "shiitake", "oyster mushrooms", "meadow mushrooms",
    # Dairy / misc
    "ricotta", "rennet", "goat dairy", "sheep dairy", "fermented dairy", "quail eggs",
}

# --- Allergen-panel vocabulary (IgG/IgE food-sensitivity reports) -----------
# Botanical/pollen/spice terms + grain proteins seen on FST panels. None of these
# is a personal surname, so they are safe tier-1 drops. (Words that ARE surnames —
# Sweet, Curry, Rose, Lily, Savoy, Mustard, Timothy, Fava… — stay in AMBIGUOUS_TERMS.)
_ALLERGEN_FOODS = {
    "gluten", "gliadin", "ragweed", "mugwort", "lambsquarters", "pigweed", "fescue",
    "romanesco", "romanesco broccoli", "rapini", "broccolini", "collard",
    "collard greens", "swiss chard", "kale chard", "okra", "artichoke",
    "globe artichoke", "jerusalem artichoke", "daikon", "jicama", "taro", "cassava",
    "plantain", "sumac", "turmeric", "cumin", "coriander", "fenugreek", "cardamom",
    "nutmeg", "allspice", "paprika", "oregano", "marjoram", "tarragon", "cilantro",
    "teff", "tapioca", "arrowroot", "sorghum", "edamame", "garbanzo", "goji",
    "goji berry", "jackfruit", "durian", "soursop", "kumquat", "loquat", "feijoa",
    "jujube", "breadfruit", "dragonfruit", "acai", "yuzu", "ugli", "pomelo",
}

# --- German interrogatives / short question-words (never a person's name) -----
# German capitalizes every noun, so a short chat fragment like "Ibuprofen Einnahme
# wann?" or "Wann einnehmen?" gives spaCy no lowercase contrast to lean on: a bare
# interrogative adverb/pronoun can survive as (or inside) a PERSON span, especially
# via _keep_person's documented POS-fail-open path (no doc available -> the PROPN
# guard is skipped entirely). Unlike the food/lab terms above, this is a CLOSED
# grammatical class — none of these is a plausible German or English given name or
# surname — so, like the sentence-initial imperative verbs already denylisted in
# ner.py, a bare match is an unconditional, safe drop (folded into NON_NAME_TERMS,
# which also makes an ALL-non-name multi-word span like "wann wieso" droppable via
# _is_non_name's existing AND-rule). Exported separately as INTERROGATIVES too: a
# real person's name never contains an interrogative as one of its tokens (nobody
# is named "Einnahme Wann"), so ner._is_non_name additionally drops any multi-token
# span containing ONE of these tokens even when the *other* tokens are ordinary
# capitalized nouns (e.g. "Einnahme wann") — see the ANY-token guard there. That
# guard is deliberately narrower in scope (interrogatives only, not arbitrary nouns)
# so it can't be tripped by real names that merely share a token with a food/lab term.
INTERROGATIVES = frozenset(
    {
        "wann", "wie", "was", "wo", "woher", "wohin", "warum", "wieso", "weshalb",
        "weswegen", "wieviel", "wieviele", "wie viel", "wie viele", "welche",
        "welcher", "welches", "welchen", "welchem", "inwiefern", "inwieweit",
    }
)

# --- Culinary-frame words (real-world FP review, 2026-07-08) -------------------
# From the user's real Gemini prompts: recipe-style noun queries ("Milchreis
# Rezept", "Topf Rezept", "Kalorien haloumi", "Zubereitung Lachs", "Airfryer
# Blumenkohl") get their capitalized food compound tagged PERSON. Like
# INTERROGATIVES this is a small CLOSED frame class: no real surname is
# "Rezept"/"Kalorien"/"Zubereitung"/"Airfryer", and no personal name contains one
# of these as a token — so a multi-token span containing ANY of them is a safe
# unconditional drop (ner._is_non_name ANY-token rule, same as INTERROGATIVES),
# and a bare match is a safe denylist hit (folded into NON_NAME_TERMS below).
CULINARY_FRAME = frozenset(
    {"rezept", "rezepte", "rezeptidee", "kalorien", "zubereitung", "airfryer"}
)

# --- Developer/tooling vocabulary (real-world FP report, 2026-08-04) ----------
# Reported: "…backlog item \"ReqDoc\", same for capabilities etc. We have access
# to the wiki and Repos via API with a PAT." -> PERSON "ReqDoc", PERSON "Repos".
# Reproduced deterministically under every language hint (NER only, LLM off).
#
# These are ordinary dev nouns that get capitalised mid-sentence as product or
# section names ("Repos" is Azure DevOps' own tab label), which is exactly the
# shape English NER reads as an unknown proper noun. Unlike TENTATIVE_TECH_
# EPONYMS these do NOT collide with real personal names — nobody is called
# "Repos" or "Backlog" — so they belong in the hard denylist rather than the
# tentative tier.
#
# Deliberately NOT in here: "mac" (already tentative — Mac is also a name),
# anything that is a plausible surname, and single letters. Kept to words whose
# ONLY reading is technical.
DEV_TERMS = frozenset(
    {
        "repo", "repos", "repository", "repositories",
        "backlog", "sprint", "epic", "commit", "commits", "branch", "branches",
        "merge", "rebase", "pipeline", "pipelines", "runner", "runners",
        "wiki", "wikis", "changelog", "readme", "issue", "issues",
        "endpoint", "endpoints", "webhook", "webhooks", "middleware",
        "frontend", "backend", "devops", "codebase", "deployment", "rollout",
        # --- Own-technical-documentation FP report (2026-08-08) ---------------
        # QUON's own architecture/handoff docs, pasted back into the scrubber,
        # produced PERSON "Tailwind" (the CSS framework named in this repo's own
        # stack, e.g. "Tailwind v4" in CLAUDE.md). Like "devops"/"wiki" above,
        # its only plausible reading in a technical document is the product —
        # unlike "Mac"/"Claude" (TENTATIVE_TECH_EPONYMS) it does not collide
        # with an attested personal given/surname, so a hard drop is safe.
        "tailwind",
    }
)

# --- Hyphenated technical/doc compounds (own-documentation FP, 2026-08-08) ----
# The same real-world paste produced PERSON "Per-request" and PERSON "Vendor
# Lock-in". A genuine hyphenated PERSONAL name capitalizes BOTH halves ("Anne-
# Marie", "Müller-Lüdenscheidt", "Karl-Heinz") — including names where that is
# easy to get wrong, so this must NOT become "any lowercase half is dropped":
# the synthetic corpus (tests/synth.py) legitimately contains "Soo-jin Park",
# a real Korean given name conventionally spelled with a lowercase second
# syllable after the hyphen. Blanket-dropping any hyphenated token whose
# second half starts lowercase would silently start dropping "Soo-jin" too —
# a leak, not a UX nuisance.
#
# So this is deliberately a SMALL CLOSED VOCABULARY, the same discipline as
# INTERROGATIVES/CULINARY_FRAME above, not a shape-based regex: a token only
# counts as a technical compound when its FIRST half is a common doc/tech
# prefix ("Per-request", "Multi-tenant", "Cross-origin") OR its SECOND half is
# a common English particle/suffix used in that role ("Lock-in", "Built-in",
# "Follow-up", "Opt-in") — neither list contains anything that is also an
# attested given-name syllable, so "Soo-jin" (second half "jin", not a
# particle) and any real capitalized-capitalized name never match either way.
HYPHEN_COMPOUND_PREFIXES = frozenset(
    {
        "per", "pre", "post", "non", "multi", "self", "co", "re", "sub", "un",
        "cross", "auto", "semi", "anti", "pseudo", "quasi", "ultra", "over",
        "under", "well", "high", "low", "long", "short", "full", "half",
        "vendor", "user", "server", "client",
    }
)
HYPHEN_COMPOUND_SUFFIXES = frozenset(
    {
        "in", "up", "out", "off", "on", "back", "through", "around", "away",
        "over", "under", "based", "driven", "friendly", "ready", "aware",
        "less", "wise", "proof",
    }
)

NON_NAME_TERMS = frozenset(
    t.lower()
    for t in (_LAB_TERMS | _FOODS | _ALLERGEN_FOODS | INTERROGATIVES | CULINARY_FRAME | DEV_TERMS)
)

# --- German possessive pronoun + kinship noun (real-world FP report, 2026-07-28) --
# Reported live: "... zu meinem bruder nach kanada fliegen" -> PERSON "meinem
# bruder"; user also reports "meine Mutter" doing the same. Casual all-lowercase
# German ("meinem bruder", no sentence-initial capital to lean on) is exactly the
# register where NER defers PERSON detection to the LLM
# (ner.detect_ner's low-case-signal deferral) -- and confirmed live: NER's OWN
# detect_ner already drops this shape (the per-span capitalisation guard in
# _keep_person kills an all-lowercase span even when the wider message has caps
# elsewhere), so the leak is specifically the LLM-merge gate in scrubber.py, which
# runs with require_capitalization=False by design (LLM output is the one path
# that must accept legitimate lowercase names) and therefore has no capitalisation
# signal at all to reject "meinem bruder" with.
#
# A possessive pronoun ("mein", "meine", "meinem"...) immediately followed by a
# kinship noun ("Bruder", "Mutter", "Schwester"...) is a closed, unambiguous
# grammatical construction -- nobody's name is "meinem Bruder". Deliberately NOT
# folded into NON_NAME_TERMS/the denylist as bare single words, for two reasons:
#   1. A bare kinship noun alone ("Vater", "Bruder", "Koch"-adjacent) is, rarely,
#      also a real German surname -- unconditionally denylisting the word would
#      risk dropping a genuine capitalized surname (_is_non_name lowercases before
#      comparing, so "Vater" the surname and "vater" the noun are indistinguishable
#      to a single-word check). Recall-first: leave bare kinship nouns alone.
#   2. A bare possessive pronoun ("meine", "seine"...) is itself an ordinary
#      function word and never denotes PII either way.
# Instead ner._is_non_name requires BOTH a possessive-pronoun token AND a
# kinship-noun token to be present, AND every token in the span to be one or the
# other (same ALL-token discipline as the existing NON_NAME_TERMS rule) --
# structurally this can only ever match the possessive+kinship combination itself,
# never a real name that happens to be adjacent to one: "mein bruder Thomas" has a
# third token ("thomas") outside both sets, so the ALL-token check fails and the
# whole span (Thomas included) stays redacted -- recall-safe.
POSSESSIVE_PRONOUNS = frozenset(
    {
        "mein", "meine", "meiner", "meinem", "meinen",
        "dein", "deine", "deiner", "deinem", "deinen",
        "sein", "seine", "seiner", "seinem", "seinen",
        "ihr", "ihre", "ihrer", "ihrem", "ihren",
        "unser", "unsere", "unserer", "unserem", "unseren",
        "euer", "eure", "eurer", "eurem", "euren",
    }
)

KINSHIP_TERMS = frozenset(
    {
        "mutter", "vater", "bruder", "schwester",
        "oma", "opa", "großmutter", "grossmutter", "großvater", "grossvater",
        "uroma", "uropa",
        "onkel", "tante", "cousin", "cousine", "kusine",
        "sohn", "tochter", "enkel", "enkelin", "enkelkind", "enkelkinder",
        "neffe", "nichte",
        "schwager", "schwägerin", "schwaegerin",
        "schwiegermutter", "schwiegervater", "schwiegersohn", "schwiegertochter",
        "stiefvater", "stiefmutter", "stiefbruder", "stiefschwester",
        "halbbruder", "halbschwester",
        "ehemann", "ehefrau", "ehepartner", "ehepartnerin",
        "lebensgefährte", "lebensgefaehrte", "lebensgefährtin", "lebensgefaehrtin",
        "freundin", "freund",
        "eltern", "großeltern", "grosseltern", "geschwister",
        "papa", "mama", "mami", "papi", "vati", "mutti",
    }
)

# Taxonomic family / sub-family endings (Latin). No personal surname ends this way,
# so a token of length >= 6 ending in one of these is dropped (Rosaceae, Bovideae,
# Asparagaceae, Solanoideae). Checked per-token in ner._is_non_name.
NON_NAME_SUFFIXES = ("aceae", "oideae", "ideae", "idae", "inae")

# Component-resolved allergen proteins on IgG/IgE panels — never a personal name. A
# PERSON span containing any of these tokens (e.g. "Mugwort Profilin") is dropped.
ALLERGEN_COMPONENTS = frozenset(
    {
        "profilin", "profilins", "tropomyosin", "parvalbumin", "polcalcin", "ltp",
        "ovomucoid", "ovalbumin", "ovotransferrin", "lactalbumin", "lactoglobulin",
        "lipocalin", "serpin", "expansin", "glycinin", "conglycinin", "vicilin",
    }
)

# Food/plant words that ARE also real surnames ("Millet" the painter, "Sweet",
# "Berry", "Lamb", "Olive"…). We must NOT drop these outright (→ leak risk). They are
# "tentative": only suppressed when there is a non-name signal — a directly-following
# number (a table row like "Millet 16", heuristic B) or an explicit LLM veto (A).
AMBIGUOUS_TERMS = frozenset(
    {
        "millet", "sweet", "berry", "lamb", "olive", "rice", "curry", "basil",
        "sage", "mint", "dill", "pepper", "honey", "plum", "cherry", "hazel",
        "rose", "reed", "pike", "carp", "cod", "bass", "sole", "ray", "date",
        "bean", "fig", "kale", "chard", "leek", "lime", "lemon", "mango", "peach",
        "pear", "fennel", "parsley", "thyme", "clove", "currant", "quince",
        "strawberry", "blackberry", "raspberry", "cranberry",
        # also-a-given-name / also-a-surname herbs, plants & foods
        "fava", "lily", "savoy", "mustard", "timothy", "ginger", "juniper",
        "jasmine", "holly", "ivy", "rosemary", "clementine", "saffron", "hazelnut",
        "marigold", "angelica", "rue", "sorrel", "borage", "chicory",
        # --- Own-technical-documentation FP report (2026-08-08) ---------------
        # "Dev" fired as PERSON on plain tech-doc prose ("the Dev environment").
        # Unlike "Repos"/"Backlog" (DEV_TERMS, hard drop) this collides with a
        # real, common given name (Dev Patel, Dev Anand) — recall-first, so it
        # is tentative rather than an unconditional drop. Same reasoning for
        # "Legacy" (used as a real given name in English-language records) and
        # "Ver" (a short form of attested given names, e.g. "Vera"/"Verena");
        # neither is unambiguous enough for the hard denylist.
        "dev", "legacy", "ver",
    }
)

# --- German street/square suffixes (PERSON-mistag defense-in-depth) -----------
# Regression for a real reported FP: "Welcher Supermarkt kommt an den
# Rehbergplatz in bad kleinfeld" -> PERSON "Rehbergplatz" (fixed at the
# language-detection layer in 4aaac34, since the root cause there was the wrong
# spaCy model running on the sentence). This is defense-in-depth for the SAME
# shape of token surviving even under correct language detection — either spaCy
# model, or the LLM, can still mistag an unfamiliar capitalized German street/
# square compound as a person's name.
#
# A token ending in one of these suffixes is made TENTATIVE (routed through the
# existing AMBIGUOUS_TERMS/LLM-veto machinery — see ner.detect_ner and
# scrubber._merge's heuristic A/B), never a hard drop: recall-first, the same
# policy as AMBIGUOUS_TERMS above. Unlike NON_NAME_SUFFIXES (taxonomic Latin
# family names — never a real word at all), a street suffix IS a real, common
# German word ("Platz", "Gasse", "Allee", "Straße") glued onto another word, so
# treating it as an unconditional hard-drop would be too strong for a class this
# productive; tentative is the correct amount of caution.
#
# SAFETY (vetted deliberately narrow — surname-collision risk is the whole
# ballgame here): each suffix below was checked against German onomastics and
# NONE is a plausible ending for a real German surname (Nachname), only for
# street/square/avenue/lane NAMES. Suffixes that ARE real surname endings are
# explicitly, deliberately EXCLUDED even though they are also common in place
# names — a hard/tentative rule there would risk suppressing an actual person's
# name, which is unacceptable for a privacy tool:
#   -berg   (surnames: Berg, Rosenberg, Goldberg, Sandberg — incl. a real
#            person's own surname)
#   -burg   (surnames: Homburg, Duisburg-style family names, Luxemburg-derived)
#   -feld   (surnames: Feld, Rosenfeld, Neufeld, Hirschfeld)
#   -dorf   (surnames: Dorfmann-style, Bamberger-adjacent -dorf family names)
#   -weg    (surname: Steinweg)
#   -hausen (common surname-suffix family, e.g. many attested "-hausen" surnames)
#   -heim   (surnames: Mannheim-derived family names, Sondheim)
#   -stein  (surnames: Einstein, Goldstein, Bernstein, Feuerstein — extremely
#            common surname ending, definitely NOT includable)
# "-weg" is also why a plain "Rosenweg"-style street is NOT covered by this list
# (recall-first: better to leave it to the existing tentative-food/LLM path or
# accept it as an over-redaction than risk "Steinweg" the surname).
#
# Length floor (>= 7 chars total) applied at the call site avoids matching a
# short unrelated word that happens to end in "-gasse"/"-allee" etc.
#
# RESIDUAL RISK, surfaced deliberately rather than smoothed over: independent
# onomastic research for this change found "-straße"/"-strasse" is a genuine,
# if narrow, gray area — a rare fossilized Wohnstättenname compound
# ("Aufderstraße"/"Aufderstrasse", from "auf der Straße", single/low-double-
# digit bearer count in Germany) is attested. "-platz", "-allee", "-gasse" have
# no comparable counter-example. Kept in anyway because the mechanism is
# TENTATIVE, not a hard drop: the recall-first fail-safe (no LLM veto -> stays
# redacted, see AMBIGUOUS_TERMS above) already bounds the residual leak risk to
# the narrow compound case of (a) this specific rare surname appearing AND (b)
# an LLM actively misreading it as a street and emitting NOT_NAME for it. "-ring"
# and "-damm" were also considered and explicitly REJECTED (both are common,
# well-documented German surnames — "Ring" ranks ~#188 nationally).
STREET_SUFFIXES = ("straße", "strasse", "platz", "allee", "gasse")

# --- Tech / eponym homographs (tentative, never hard-dropped) ------------------
# From the real-world FP review (2026-07-08, the user's own Gemini prompts).
# These ARE (or collide with) real personal names — Franz Kafka, Claude Monet,
# Spike Lee, the researchers behind the Dunning-Kruger effect, Dr. Hashimoto —
# but in casual chat they are far more often software/products ("Kafka-
# Pipelines" ×14 in the real corpus, "Claude Code", "Matrix Multiplikation") or
# medical/psychological eponyms ("Hashimoto Werte", "Dunning Krüger effect").
# Same treatment as AMBIGUOUS_TERMS/STREET_SUFFIXES: the PERSON candidate
# becomes TENTATIVE — the LLM veto (NOT_NAME) may clear it in the full
# pipeline, and without a veto it stays redacted (recall-first; config 1
# behaviour is unchanged). NOTE "krüger" alone is deliberately NOT here (a very
# common German surname) — the eponym is caught via its "dunning" token in the
# multi-token span.
TENTATIVE_TECH_EPONYMS = frozenset(
    {
        # tech/products seen repeatedly in the real corpus
        "kafka", "historian", "matrix", "spike", "claude", "mac",
        # medical/psychological eponyms (named after real people, used as terms)
        "dunning", "alzheimer", "parkinson", "asperger", "hashimoto",
        "crohn", "bechterew", "raynaud",
    }
)

# --- Intercapped identifiers (real-world FP report, 2026-08-04) ---------------
# "ReqDoc" -> PERSON. A capital INSIDE a word is the CamelCase shape of code and
# product identifiers (ReqDoc, DevOps, GitHub, JavaScript, OneDrive) and is
# vanishingly rare in a written personal name — with one important family of
# exceptions that this rule must not break:
#
#   McCarthy, MacDonald   -> Mc/Mac patronymic prefix
#   O'Brien, D'Angelo     -> apostrophe (not intercapped by this definition)
#   DeVries, DiCaprio,    -> particle prefixes fused into the surname
#   LaSalle, LeBlanc, Van…
#
# So the rule fires ONLY when no known name particle prefixes the word. Getting
# this wrong leaks a real surname, which is the failure direction that actually
# matters, hence the allowlist rather than a bare "has an inner capital" test.
NAME_PARTICLE_PREFIXES = (
    "mc", "mac", "de", "di", "da", "du", "la", "le", "van", "von", "st",
    "fitz", "o", "al", "el", "san", "ten", "ter",
)

# --- PERSON span edge-trim tokens (real-world FP review) -----------------------
# Detected spans glue non-name tokens onto real names: "bin Timo",
# "CEO Kapferer", "Ja Preis", "Max because he ha". Dropping such a span outright
# would LEAK the contained name ("Danke Anna" must keep redacting Anna!), so
# ner._trim_person_edges TRIMS these from the span's edges instead and keeps the
# core. Only ever applied at the edges, and only in the NER path (where the
# capitalization guard exists) — never in the LLM merge path, where legitimate
# all-lowercase names would be shredded. Affirmations/greetings, copulas,
# pronouns, conjunctions, and org-role acronyms; fully-lowercase edge tokens are
# additionally trimmed by rule in ner._trim_person_edges (a German name's core
# tokens are capitalized; lowercase particles like "von" are only ever INSIDE a
# span, and even if an edge trim removes one, the name core stays redacted).
EDGE_TRIM_TOKENS = frozenset(
    {
        "ja", "nein", "ok", "okay", "danke", "bitte", "hallo", "moin", "servus",
        "bin", "ist", "war", "sind", "bist",
        "ich", "du", "er", "sie", "es", "wir", "ihr",
        "und", "oder", "aber", "denn", "weil",
        "he", "she", "it", "is", "was", "and", "or", "because",
        "ceo", "cto", "cfo", "coo", "cio", "vp",
    }
)
