/** trust.* — the "what runs where" surface: the clickable protection pill and
 *  the /trust page. Written because a beta user could not find QUON's own
 *  privacy story at the moment he doubted it (feedback #50/51/52/56): the
 *  answer lived in ARCHITECTURE.md, not in the product. Every claim here must
 *  stay TRUE — when the architecture changes, this file is part of the change.
 *
 *  Redesigned (feedback: "das ist klar als KI-Text erkennbar … der PII-Filter
 *  kommt zu kurz … das Cloud-Modell wird gar nicht erwähnt … cooler, grafischer
 *  mit einer Ameisenstraße der Datenflüsse"): natural German, the filter as the
 *  hero of an animated data-flow diagram, the model named, and the
 *  zero-knowledge point made unmissable — the server never SEES stored data,
 *  the one read is the momentary filter pass. Inline `*…*` marks a bold span and
 *  `{model}` is filled from the PII_MODEL constant in ScreenTrust (single source
 *  of truth for the model's display name). */
export const trust = {
  en: {
    "trust.pillAria": "Protection status — what is protecting you right now",
    "trust.pillUnprotected": "Not protected",
    "trust.pillLevel": "Protection: {level}",
    "trust.pillEngineLocal": "Detection engine: local —",
    "trust.pillEngineReady": "ready",
    "trust.pillEngineDegraded": "degraded (names + patterns only)",
    "trust.pillEngineOffline": "unreachable — sending is blocked",
    "trust.pillLink": "How your data flows",

    // Live status pill at the top of the page — mirrors the health probe so the
    // page never reassures you of something the status indicator contradicts.
    "trust.heroPillActive": "Protected · filter active",
    "trust.heroPillDegraded": "Protected · limited mode",
    "trust.heroPillOffline": "Filter unreachable",

    "trust.heroTitle": "Where your data goes — and where it doesn’t.",
    "trust.heroLede":
      "Before your message reaches an AI, QUON removes your personal details and replaces them with placeholders. *Only you* ever see the full picture. Here’s the path:",

    // The animated pipeline (the "ant trail").
    "trust.flowCap": "The path of a message",
    "trust.flowDeviceTitle": "Your device",
    "trust.flowDeviceBody": "Everything is encrypted here. The key stays with you.",
    "trust.flowFilterTitle": "QUON filter",
    "trust.flowFilterBody": "The core: it finds names, numbers and addresses and redacts them.",
    "trust.flowFilterBadge": "redacts before sending",
    "trust.flowFilterModel":
      "Detection runs *entirely in-house* — no AI provider is involved in finding your data",
    "trust.flowProviderTitle": "AI provider",
    "trust.flowProviderBody": "Sees only placeholders — never your real data.",
    "trust.flowProviderEu": "Processed in the EU only — the request never leaves Europe.",
    "trust.flowLaneReal": "encrypted in transit",
    "trust.flowLaneSafe": "placeholders only",
    "trust.flowReturn": "Answer comes back · your device restores the real values",

    // The two things to remember: zero-knowledge storage vs. the one read.
    "trust.pledgeSafeTitle": "Only encrypted data is stored",
    "trust.pledgeSafeBody":
      "Your chats, memories and documents are *end-to-end encrypted* — with a key only you hold. The QUON server stores nothing but the unreadable ciphertext.",
    "trust.pledgeSafePunch": "It can never see them in the clear.",
    "trust.pledgeSafeTail": "That’s zero-knowledge: provable, not just promised.",
    "trust.pledgeReadTitle": "Read only to redact",
    "trust.pledgeReadBody":
      "The one message you’re sending is seen by the server *for the moment of filtering* — only to take out names and numbers.",
    "trust.pledgeReadPunch": "In memory, never stored.",
    "trust.pledgeReadTail":
      "Only the redacted version travels on. (Or pick the local engine — then nothing leaves your device at all.)",

    // Detail cards under the diagram.
    "trust.cardDeviceTitle": "On your device",
    "trust.cardDeviceBody1": "Encryption happens here — *before* anything is synced.",
    "trust.cardDeviceBody2":
      "Document search runs fully on-device too: your files don’t even leave to be searched.",
    "trust.cardFilterKicker": "Core",
    "trust.cardFilterTitle": "The filter",
    "trust.cardFilterBody":
      "It spots personal details with *patterns*, *name recognition* and an *AI model* — and swaps them for placeholders:",
    "trust.cardFilterExCall": "“Call ",
    "trust.cardFilterExMid": ", ",
    "trust.cardFilterExEnd": "”",
    "trust.cardFilterNote":
      "The AI model is *{model}*. “Open” means: freely available and self-hostable rather than a black box — in time runnable on our own, European infrastructure.",
    "trust.cardProviderTitle": "At the AI",
    "trust.cardProviderBody1":
      "The model receives only the redacted version. QUON routes exclusively to providers that *don’t store* prompts and don’t train on them.",
    "trust.cardProviderBody2":
      "The answer comes back with placeholders — your device restores the real values.",

    "trust.statusTitle": "Right now",
    "trust.statusEngine": "Detection engine",
    "trust.statusEngineLocal": "Local (on your server / device)",
    "trust.statusReachable": "reachable",
    "trust.statusDegraded": "degraded — names + patterns still work, AI detection is off",
    "trust.statusOffline": "unreachable — QUON blocks sending instead of sending unfiltered",
    "trust.statusConfigure": "Configure the engine in Settings",

    "trust.legalTitle": "The formal part",
    "trust.legalBody": "Privacy policy and imprint:",
    "trust.legalPrivacy": "Privacy (GDPR)",
    "trust.legalImprint": "Imprint",
  },
  de: {
    "trust.pillAria": "Schutzstatus — was dich gerade schützt",
    "trust.pillUnprotected": "Nicht geschützt",
    "trust.pillLevel": "Schutz: {level}",
    "trust.pillEngineLocal": "Erkennungs-Engine: lokal —",
    "trust.pillEngineReady": "bereit",
    "trust.pillEngineDegraded": "eingeschränkt (nur Namen + Muster)",
    "trust.pillEngineOffline": "nicht erreichbar — Senden ist blockiert",
    "trust.pillLink": "Wie deine Daten fließen",

    "trust.heroPillActive": "Geschützt · Filter aktiv",
    "trust.heroPillDegraded": "Geschützt · eingeschränkt",
    "trust.heroPillOffline": "Filter nicht erreichbar",

    "trust.heroTitle": "Wohin deine Daten gehen — und wohin nicht.",
    "trust.heroLede":
      "Bevor deine Nachricht bei einer KI landet, entfernt QUON deine persönlichen Angaben und ersetzt sie durch Platzhalter. *Nur du* siehst am Ende das vollständige Bild. So läuft der Weg:",

    "trust.flowCap": "Der Weg einer Nachricht",
    "trust.flowDeviceTitle": "Dein Gerät",
    "trust.flowDeviceBody": "Alles wird hier verschlüsselt. Der Schlüssel bleibt bei dir.",
    "trust.flowFilterTitle": "QUON-Filter",
    "trust.flowFilterBody": "Das Herzstück: erkennt Namen, Nummern und Adressen und schwärzt sie.",
    "trust.flowFilterBadge": "schwärzt vor dem Versand",
    "trust.flowFilterModel":
      "Die Erkennung läuft *komplett bei QUON* — kein KI-Anbieter ist daran beteiligt, deine Daten zu finden",
    "trust.flowProviderTitle": "KI-Anbieter",
    "trust.flowProviderBody": "Sieht nur Platzhalter — nie deine echten Daten.",
    "trust.flowProviderEu": "Wird nur in der EU verarbeitet — die Anfrage verlässt Europa nicht.",
    "trust.flowLaneReal": "verschlüsselt unterwegs",
    "trust.flowLaneSafe": "nur Platzhalter",
    "trust.flowReturn": "Antwort zurück · dein Gerät setzt die echten Werte wieder ein",

    "trust.pledgeSafeTitle": "Gespeichert wird nur Verschlüsseltes",
    "trust.pledgeSafeBody":
      "Deine Chats, Erinnerungen und Dokumente liegen *Ende-zu-Ende verschlüsselt* — mit einem Schlüssel, den nur du hast. Der QUON-Server speichert nur den unlesbaren Chiffretext.",
    "trust.pledgeSafePunch": "Er kann sie nie im Klartext sehen.",
    "trust.pledgeSafeTail": "Das ist „Zero-Knowledge“: nachweisbar, nicht bloß versprochen.",
    "trust.pledgeReadTitle": "Gelesen wird nur zum Schwärzen",
    "trust.pledgeReadBody":
      "Die eine Nachricht, die du gerade abschickst, sieht der Server *für den Moment des Filterns* — nur um Namen und Nummern rauszunehmen.",
    "trust.pledgeReadPunch": "Im Arbeitsspeicher, nie gespeichert.",
    "trust.pledgeReadTail":
      "Weiter geht ausschließlich die geschwärzte Version. (Oder du wählst die lokale Engine — dann verlässt gar nichts dein Gerät.)",

    "trust.cardDeviceTitle": "Auf deinem Gerät",
    "trust.cardDeviceBody1":
      "Die Verschlüsselung passiert hier — *bevor* irgendetwas synchronisiert wird.",
    "trust.cardDeviceBody2":
      "Auch die Dokumentensuche läuft komplett lokal: deine Dateien verlassen das Gerät nicht einmal fürs Suchen.",
    "trust.cardFilterKicker": "Kern",
    "trust.cardFilterTitle": "Der Filter",
    "trust.cardFilterBody":
      "Erkennt persönliche Angaben mit *Mustern*, *Namenserkennung* und einem *KI-Modell* — und ersetzt sie durch Platzhalter:",
    "trust.cardFilterExCall": "„Ruf ",
    "trust.cardFilterExMid": " an, ",
    "trust.cardFilterExEnd": "“",
    "trust.cardFilterNote":
      "Das KI-Modell ist *{model}*. „Offen“ heißt: frei verfügbar und selbst betreibbar statt Blackbox — perspektivisch auch auf eigener, europäischer Infrastruktur.",
    "trust.cardProviderTitle": "Bei der KI",
    "trust.cardProviderBody1":
      "Das Modell bekommt nur die geschwärzte Version. QUON wählt ausschließlich Anbieter, die Prompts *nicht speichern* und nicht zum Training nutzen.",
    "trust.cardProviderBody2":
      "Die Antwort kommt mit Platzhaltern zurück — dein Gerät setzt die echten Werte wieder ein.",

    "trust.statusTitle": "Gerade jetzt",
    "trust.statusEngine": "Erkennungs-Engine",
    "trust.statusEngineLocal": "Lokal (auf deinem Server / Gerät)",
    "trust.statusReachable": "erreichbar",
    "trust.statusDegraded": "eingeschränkt — Namen + Muster laufen weiter, KI-Erkennung ist aus",
    "trust.statusOffline":
      "nicht erreichbar — QUON blockiert das Senden, statt ungefiltert zu senden",
    "trust.statusConfigure": "Engine in den Einstellungen konfigurieren",

    "trust.legalTitle": "Das Formale",
    "trust.legalBody": "Datenschutzerklärung und Impressum:",
    "trust.legalPrivacy": "Datenschutz (DSGVO)",
    "trust.legalImprint": "Impressum",
  },
} as const;
