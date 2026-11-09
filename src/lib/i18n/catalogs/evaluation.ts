/**
 * evaluation.* - the public end-user page (/docs/detection) explaining how the
 * privacy filter is tested. Companion to the /demo page and written for the
 * same audience: strangers without an account. English by default with the
 * same local language switch as the demo; du-form in German, the app's own
 * words (schwärzen, freigeben). Plain language - the engineering detail lives
 * in docs/detection-whitepaper.md and docs/detection-experiments.md, not here.
 */
export const evaluation = {
  en: {
    "evaluation.metaTitle": "How we test the filter — QUON",
    "evaluation.title": "How we test the privacy filter",
    "evaluation.lead":
      "QUON removes personal data from a message before it leaves your device towards an AI provider. Whatever the filter misses, the provider gets to read — so this one step is measured like it carries the whole product, and the method is public.",
    "evaluation.card1Title": "Thousands of generated test messages",
    "evaluation.card1Text":
      "Every build runs against about 1,600 generated German and English messages with known names, IBANs, insurance numbers and more. Each kind of data has a fixed floor it must clear — a build below any floor never ships, and floors only ever move up.",
    "evaluation.card2Title": "Real paperwork, without real data",
    "evaluation.card2Text":
      "We plant made-up names, IBANs and numbers into real document layouts — including scanned ones with OCR damage — and check that every planted value is found. Real letters never leave the device; only the layout is borrowed.",
    "evaluation.card3Title": "A public benchmark",
    "evaluation.card3Text":
      "Person names are additionally measured on a published research corpus of court decisions — text we did not write and cannot optimise for.",
    "evaluation.card4Title": "Every mistake becomes a test",
    "evaluation.card4Text":
      "If the filter marks something as personal that is not, one tap in the app releases it. Reviewed mistakes are pinned as permanent tests, so a fixed error cannot quietly return.",
    "evaluation.limitsTitle": "What the filter cannot promise",
    "evaluation.limitsText":
      "No filter catches everything. A made-up identifier with no structure, no label and no context is undetectable in principle, and languages other than German and English are not covered yet. That is why QUON shows you every redaction before sending, lets you release single values — and refuses to send at all if the filter is unreachable.",
    "evaluation.methodTitle": "The method is public",
    "evaluation.methodText":
      "The full measurement method, the dated experiment record and the enforced thresholds are part of the source code. The numbers live in tests that fail the build — not in marketing copy.",
    "evaluation.ctaDemo": "Try the demo",
    "evaluation.ctaSource": "Method and record in the source code",
    "evaluation.ctaWhitepaper": "Read the whitepaper",
    "evaluation.backToOverview": "How we test the filter",
  },
  de: {
    "evaluation.metaTitle": "So testen wir den Filter — QUON",
    "evaluation.title": "So testen wir den Privatsphäre-Filter",
    "evaluation.lead":
      "QUON entfernt persönliche Daten aus einer Nachricht, bevor sie dein Gerät in Richtung KI-Anbieter verlässt. Was der Filter übersieht, bekommt der Anbieter im Klartext zu lesen — deshalb messen wir genau diesen Schritt am strengsten und legen offen, wie.",
    "evaluation.card1Title": "Tausende generierte Testnachrichten",
    "evaluation.card1Text":
      "Jeder Build läuft gegen rund 1.600 generierte deutsche und englische Nachrichten mit bekannten Namen, IBANs, Versichertennummern und mehr. Jede Datenart hat eine feste Untergrenze — ein Build darunter wird nie ausgeliefert, und die Grenzen bewegen sich nur nach oben.",
    "evaluation.card2Title": "Echte Dokumente, ohne echte Daten",
    "evaluation.card2Text":
      "Wir setzen erfundene Namen, IBANs und Nummern in echte Dokument-Layouts ein — auch in gescannte mit OCR-Fehlern — und prüfen, ob jeder eingesetzte Wert gefunden wird. Echte Briefe verlassen nie das Gerät; nur das Layout wird ausgeliehen.",
    "evaluation.card3Title": "Ein öffentlicher Benchmark",
    "evaluation.card3Text":
      "Personennamen messen wir zusätzlich an einem veröffentlichten Forschungskorpus aus Gerichtsentscheidungen — Text, den wir nicht selbst geschrieben haben und auf den wir nicht optimieren können.",
    "evaluation.card4Title": "Jeder Fehler wird zum Test",
    "evaluation.card4Text":
      "Markiert der Filter etwas als persönlich, das es nicht ist, gibst du es in der App mit einem Tipp wieder frei. Geprüfte Fehler halten wir als dauerhafte Tests fest — ein behobener Fehler kann nicht leise zurückkommen.",
    "evaluation.limitsTitle": "Was der Filter nicht versprechen kann",
    "evaluation.limitsText":
      "Kein Filter erkennt alles. Eine frei erfundene Kennung ohne Struktur, Beschriftung und Kontext ist grundsätzlich nicht erkennbar, und andere Sprachen als Deutsch und Englisch sind noch nicht abgedeckt. Deshalb zeigt dir QUON jede Schwärzung vor dem Senden, lässt dich einzelne Werte freigeben — und sendet gar nicht erst, wenn der Filter nicht erreichbar ist.",
    "evaluation.methodTitle": "Die Methode ist offen",
    "evaluation.methodText":
      "Die vollständige Messmethode, das datierte Versuchsprotokoll und die erzwungenen Grenzwerte sind Teil des Quellcodes. Die Zahlen stehen in Tests, die den Build scheitern lassen — nicht in Werbetexten.",
    "evaluation.ctaDemo": "Probier die Demo",
    "evaluation.ctaSource": "Methode und Protokoll im Quellcode",
    "evaluation.ctaWhitepaper": "Zum Whitepaper (englisch)",
    "evaluation.backToOverview": "So testen wir den Filter",
  },
} as const;
