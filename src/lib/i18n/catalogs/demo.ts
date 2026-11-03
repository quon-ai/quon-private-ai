/**
 * demo.* — the public scrub-only demo (/demo): a visitor pastes a text and
 * sees what a model would receive. No account, no model call, nothing stored.
 * German first, du-form, the app's own words (schwärzen, Platzhalter); the
 * page is the first thing a stranger reads, so every line is plain.
 */
export const demo = {
  en: {
    "demo.metaTitle": "QUON demo: what the AI gets to see",
    "demo.title": "What the AI gets to see",
    "demo.lead":
      "Paste a text with personal data. QUON redacts it the way it does before every chat message: names, e-mail addresses, phone numbers, IBANs and more become placeholders. The model only ever sees the result.",
    "demo.textareaLabel": "Your text",
    "demo.textareaPlaceholder":
      "Paste or type a text with names, e-mail addresses, phone numbers ...",
    "demo.sample": "Insert an example",
    "demo.run": "Redact",
    "demo.running": "Redacting ...",
    "demo.counter": "{n} / {max} characters",
    "demo.resultTitle": "This is what the model receives",
    "demo.foundTitle": "Detected and replaced",
    "demo.nothingFound":
      "Nothing to redact in this text. Try a name, an e-mail address or a phone number.",
    "demo.privacy":
      "The text is processed only for this detection, on the QUON server, and is neither stored nor sent to an AI model.",
    "demo.disabled": "The demo is not enabled on this QUON instance.",
    "demo.errTooLong": "Please shorten the text to {max} characters.",
    "demo.errBusy": "The demo is busy right now. Please try again in a minute.",
    "demo.errRate": "Too many requests from your connection. Please wait a minute.",
    "demo.errGeneric": "That did not work. Please try again.",
    "demo.ctaTitle": "Like it?",
    "demo.ctaText":
      "In the full app the redaction runs before every message, and the answer comes back with your real values restored, on your device.",
    "demo.ctaSignIn": "Sign in or create an account",
    "demo.ctaSource": "Source code and self-hosting",
  },
  de: {
    "demo.metaTitle": "QUON-Demo: Was die KI zu sehen bekommt",
    "demo.title": "Was die KI zu sehen bekommt",
    "demo.lead":
      "Füge einen Text mit persönlichen Daten ein. QUON schwärzt ihn so, wie es das vor jeder Chat-Nachricht tut: Namen, E-Mail-Adressen, Telefonnummern, IBANs und mehr werden zu Platzhaltern. Das Modell sieht nur das Ergebnis.",
    "demo.textareaLabel": "Dein Text",
    "demo.textareaPlaceholder":
      "Text mit Namen, E-Mail-Adressen oder Telefonnummern einfügen oder tippen ...",
    "demo.sample": "Beispiel einfügen",
    "demo.run": "Schwärzen",
    "demo.running": "Wird geschwärzt ...",
    "demo.counter": "{n} / {max} Zeichen",
    "demo.resultTitle": "Das bekommt das Modell",
    "demo.foundTitle": "Erkannt und ersetzt",
    "demo.nothingFound":
      "In diesem Text gibt es nichts zu schwärzen. Probier es mit einem Namen, einer E-Mail-Adresse oder einer Telefonnummer.",
    "demo.privacy":
      "Der Text wird nur für diese Erkennung auf dem QUON-Server verarbeitet. Er wird weder gespeichert noch an ein KI-Modell geschickt.",
    "demo.disabled": "Auf dieser QUON-Instanz ist die Demo nicht freigeschaltet.",
    "demo.errTooLong": "Bitte kürze den Text auf {max} Zeichen.",
    "demo.errBusy":
      "Die Demo ist gerade ausgelastet. Bitte versuch es in einer Minute noch einmal.",
    "demo.errRate": "Zu viele Anfragen von deinem Anschluss. Bitte warte eine Minute.",
    "demo.errGeneric": "Das hat nicht geklappt. Bitte versuch es noch einmal.",
    "demo.ctaTitle": "Gefällt dir das?",
    "demo.ctaText":
      "In der App läuft die Schwärzung vor jeder Nachricht, und die Antwort kommt mit deinen echten Werten zurück, wiederhergestellt auf deinem Gerät.",
    "demo.ctaSignIn": "Anmelden oder Konto erstellen",
    "demo.ctaSource": "Quellcode und Selbst-Hosten",
  },
} as const;
