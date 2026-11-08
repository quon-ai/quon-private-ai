/**
 * demo.* — the public scrub-only demo (/demo): a visitor pastes a text and
 * sees what a model would receive. No account, no model call, nothing stored.
 * The page is ENGLISH by default whatever the instance's language (it is
 * written for strangers), with its own German switch; du-form in German, the
 * app's own words (schwärzen, Platzhalter). Every line is plain: this is the
 * first thing a stranger reads.
 */
export const demo = {
  en: {
    "demo.metaTitle": "QUON demo: what the AI gets to see",
    "demo.title": "What the AI gets to see",
    "demo.lead":
      "Paste a text with personal data. QUON redacts it the way it does before every chat message: names, e-mail addresses, phone numbers, IBANs and more become placeholders. The model only ever sees the result.",
    "demo.language": "Language",
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
    "demo.howTitle": "How it works",
    "demo.how1Title": "You write",
    "demo.how1Text": "A message with names, numbers, addresses, like any other.",
    "demo.how2Title": "QUON redacts",
    "demo.how2Text": "On your side, before anything leaves: each value becomes a placeholder.",
    "demo.how3Title": "The model answers",
    "demo.how3Text": "It only ever sees the placeholders, never the values.",
    "demo.how4Title": "Restored for you",
    "demo.how4Text": "The answer comes back with your real values filled in, on your device.",
    "demo.ctaTitle": "Interested in the app?",
    "demo.ctaText": "QUON is in a closed beta. Ask for early access and we get back to you.",
    "demo.ctaWaitlist": "Get early access",
    "demo.ctaMail": "Write to {email}",
    "demo.ctaSignIn": "Sign in or create an account",
    "demo.ctaSource": "Source code and self-hosting",
    "demo.ctaHowTested": "How we test the filter",
  },
  de: {
    "demo.metaTitle": "QUON-Demo: Was die KI zu sehen bekommt",
    "demo.title": "Was die KI zu sehen bekommt",
    "demo.lead":
      "Füge einen Text mit persönlichen Daten ein. QUON schwärzt ihn so, wie es das vor jeder Chat-Nachricht tut: Namen, E-Mail-Adressen, Telefonnummern, IBANs und mehr werden zu Platzhaltern. Das Modell sieht nur das Ergebnis.",
    "demo.language": "Sprache",
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
    "demo.howTitle": "So funktioniert es",
    "demo.how1Title": "Du schreibst",
    "demo.how1Text": "Eine Nachricht mit Namen, Nummern, Adressen, wie jede andere.",
    "demo.how2Title": "QUON schwärzt",
    "demo.how2Text": "Auf deiner Seite, bevor etwas rausgeht: Jeder Wert wird zum Platzhalter.",
    "demo.how3Title": "Das Modell antwortet",
    "demo.how3Text": "Es sieht nur die Platzhalter, nie die Werte.",
    "demo.how4Title": "Für dich wiederhergestellt",
    "demo.how4Text": "Die Antwort kommt mit deinen echten Werten zurück, auf deinem Gerät.",
    "demo.ctaTitle": "Interesse an der App?",
    "demo.ctaText": "QUON ist in einer geschlossenen Beta. Frag nach einem Zugang, wir melden uns.",
    "demo.ctaWaitlist": "Zugang anfragen",
    "demo.ctaMail": "Schreib an {email}",
    "demo.ctaSignIn": "Anmelden oder Konto erstellen",
    "demo.ctaSource": "Quellcode und Selbst-Hosten",
    "demo.ctaHowTested": "So testen wir den Filter",
  },
} as const;
