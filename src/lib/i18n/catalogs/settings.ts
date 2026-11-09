/**
 * "settings" namespace UI strings. Keys are prefixed `settings.*`. Keep `en`
 * and `de` in sync - a missing German key is a compile error via catalog.ts.
 * (The bulk is filled by the string-externalization pass; the language-card
 * keys below are pre-seeded because the switcher ships with the i18n core.)
 */
export const settings = {
  en: {
    "settings.pageTitle": "Settings",
    "settings.pageSubtitle": "Your privacy. Your control.",
    "settings.languageTitle": "Language",
    "settings.languageHint":
      "Choose the language for QUON's interface. Applies to all your devices.",

    // FontSizeCard (AccountSettings.tsx)
    "settings.fontSizeTitle": "Text size",
    "settings.fontSizeHint":
      "Applies everywhere in QUON. This device only — not synced to your other devices.",
    "settings.fontSizeStandard": "Standard",
    "settings.fontSizeLarger": "Larger",
    "settings.fontSizeLarge": "Large",

    // Tabs (SettingsTabs.tsx)
    "settings.tabDetection": "Detection",
    "settings.tabProviders": "Providers",
    "settings.tabAccount": "Account",
    "settings.comingSoon": "Coming soon.",
    "settings.typesTitle": "What to redact",
    "settings.typesDesc": "Choose which kinds of personal data QUON removes. All on by default.",
    "settings.typesLoading": "Loading types…",
    "settings.typesDisabledWarning":
      "{count} type(s) turned off — data of those kinds is sent to the model unredacted.",
    // "would a link to the docs and a status indicator not make sense here? In
    // the chat it is a bit late." Both, right under the types.
    "settings.detectStatusOk":
      "Detection runs on this server, in-process: names via spaCy, patterns via the regex net, GLiNER {gliner}.",
    "settings.detectStatusGlinerOn": "loaded",
    "settings.detectStatusGlinerOff": "off",
    "settings.detectStatusDegraded":
      "Detection is only partly available right now — the header badge shows the same. Messages are not sent unfiltered; sending waits.",
    "settings.detectStatusOffline":
      "The detection service is unreachable — the header badge shows the same. Sending is blocked until it is back; nothing goes out unfiltered.",
    "settings.detectStatusLink": "How detection works →",
    // Calendar subscription (.ics)
    "settings.calendarTitle": "Calendar (.ics)",
    "settings.calendarHint":
      "Subscribe to a read-only calendar link. Upcoming events show in your daily briefing on the dashboard.",
    "settings.calendarPlaceholder": "https://…/calendar.ics or webcal://…",
    "settings.calendarSave": "Save",
    "settings.calendarSaved": "Saved",
    "settings.calendarDisconnect": "Remove calendar",
    "settings.calendarPrivacy":
      "The calendar link is stored end-to-end encrypted. QUON's server fetches the file (it sees the link, like importing a URL); events are parsed on your device.",
    "settings.calendarHowToHint":
      "Where to get a link — Google Calendar: Settings → pick a calendar → " +
      '"Secret address in iCal format". Apple/iCloud Calendar: right-click the calendar → ' +
      "Share Calendar → Public Calendar → copy the webcal:// link. Outlook.com: Calendar → " +
      "Share → Publish a calendar → copy the ICS link.",
    // MCP tool servers
    "settings.mcpTitle": "Tools (MCP)",
    "settings.mcpDesc":
      "Connect your own Model-Context-Protocol servers — their tools become available in chats, each call behind your explicit consent.",
    "settings.mcpEmpty": "No tool servers yet.",
    "settings.mcpAdd": "Add server",
    "settings.mcpTest": "Test",
    "settings.mcpTestOk": "OK — {count} tools: {tools}",
    "settings.mcpEnabled": "On",
    "settings.mcpDisabled": "Off",
    "settings.mcpRemoveAria": "Remove server",
    "settings.mcpFieldLabel": "Name",
    "settings.mcpFieldUrl": "Server URL (https)",
    "settings.mcpFieldAuth": "Auth header (optional, stored sealed)",
    "settings.mcpHonesty":
      "Tool calls run only after your consent; arguments are shown with real values first, and results are privacy-filtered before reaching the model provider. Tool traffic passes your QUON server.",

    // Shared across cards
    "settings.saved": "Saved",
    "settings.saving": "Saving…",
    "settings.showKey": "Show key",
    "settings.hideKey": "Hide key",

    // AccountSettings.tsx
    "settings.emailTitle": "Email address",
    "settings.emailDescCurrently":
      "Currently {email}. We send a confirmation link to the new address.",
    "settings.fieldNewEmail": "New email",
    "settings.emailPlaceholder": "you@example.com",
    "settings.emailChangeSuccess":
      "Check your new inbox — the change takes effect once you confirm the link.",
    "settings.sendConfirmation": "Send confirmation",
    "settings.sending": "Sending…",

    "settings.passwordTitle": "Password",
    "settings.passwordDesc":
      "Your data stays encrypted and your recovery phrase keeps working. Other devices are signed out.",
    "settings.fieldCurrentPassword": "Current password",
    "settings.fieldNewPassword": "New password",
    "settings.fieldConfirmNewPassword": "Confirm new password",
    "settings.passwordsDontMatch": "Passwords don’t match.",
    "settings.passwordChanged": "Password changed.",
    "settings.changePassword": "Change password",
    "settings.changing": "Changing…",

    "settings.biometricTitle": "Biometric unlock (this device)",
    "settings.biometricEnrolledDesc":
      "Enabled on this device. Anyone whose biometrics unlock this device can unlock QUON. Stays enabled when you change your password.",
    "settings.turnOff": "Turn off",
    "settings.turningOff": "Turning off…",
    "settings.biometricRemoveHint":
      "You can also remove the QUON passkey in your device's password settings.",
    "settings.biometricNotEnrolledDesc":
      "Unlock QUON with Face ID, Touch ID, or your fingerprint instead of your password — on this device only. The unlock key is protected by your device's secure hardware and never reaches QUON's servers. You may be asked to confirm twice while setting up.",
    "settings.enableOnThisDevice": "Enable on this device",
    "settings.settingUp": "Setting up…",
    "settings.bioPrfUnavailable":
      "Your device created a passkey but doesn't support the key-protection feature QUON needs (PRF), so biometric unlock isn't available in this browser. Nothing was enabled — you can remove the unused QUON passkey in your device's password settings.",

    "settings.recoveryTitle": "Recovery phrase",
    "settings.recoveryDesc":
      "Your 12-word recovery phrase was shown once when you created your account. For security it cannot be displayed again — it was never stored anywhere.",
    "settings.recoveryRotateHint":
      "Lost your written copy? Generate a NEW phrase here. The old one stops working immediately; the new one is shown exactly once.",
    "settings.recoveryRotate": "Generate new phrase",
    "settings.recoveryRotating": "Generating…",
    "settings.recoveryNewPhraseNote":
      "This is your new recovery phrase — shown only this once. Write it down now; the old phrase is no longer valid.",
    "settings.recoveryCopy": "Copy phrase",
    "settings.recoveryCopied": "Copied",
    "settings.recoverySavedConfirm": "I have stored my new recovery phrase safely.",
    "settings.recoveryDone": "Done",

    "settings.deleteAccountTitle": "Delete account",
    "settings.deleteAccountDesc":
      "Permanently removes your account and all encrypted data. This cannot be undone.",
    "settings.deleteAccountShareWarningOne":
      "You own {count} shared project shared with other people. Deleting your account permanently removes it for every member.",
    "settings.deleteAccountShareWarningOther":
      "You own {count} shared projects shared with other people. Deleting your account permanently removes them for every member.",
    "settings.deleteConfirmPrefix": "Type",
    "settings.deleteConfirmSuffix": "to confirm",
    "settings.deleteMyAccount": "Delete my account",
    "settings.deleting": "Deleting…",

    // OpenRouterKeyCard.tsx
    "settings.scrubberOffline": "Scrubber offline",
    "settings.connected": "Connected",
    "settings.notConfigured": "Not configured",
    "settings.openRouterTitle": "Model Provider · OpenRouter",
    "settings.openRouterDesc":
      "Used for all cloud models. The key is stored on the gateway, never in the browser.",
    "settings.openRouterKeyLabel": "OpenRouter API key",
    "settings.openRouterKeyPlaceholderConfigured": "•••••••••• (set — enter a new key to replace)",
    "settings.openRouterKeyPlaceholderEmpty": "sk-or-v1-…",
    "settings.saveKey": "Save key",
    "settings.ownKeyInUse": "Your own key is in use",
    "settings.euRoutingBadge": "EU routing",
    "settings.euRoutingHint":
      "Your requests are processed in the EU only (OpenRouter EU routing). Models without an EU endpoint are not offered; web search and image generation are not available.",
    "settings.removeKey": "Remove key",
    "settings.removingKey": "Removing…",
    "settings.keyRemoved": "Key removed — your included credit is used again.",
    "settings.openRouterGetKeyHint":
      "Get a key at openrouter.ai → Keys. Only an OpenRouter key (sk-or-…) works here — not one from OpenAI or Anthropic.",

    // ProvidersSettings.tsx
    "settings.providersTitle": "Providers & models",
    "settings.providersDesc":
      "Pick which models appear in chat, or add your own OpenAI-compatible provider.",
    "settings.scrubberNotReachable": "Scrubber not reachable — start quon-scrubber-service.",
    "settings.addProvider": "Add provider",
    "settings.builtinOpenRouter": "OpenRouter",
    "settings.openAiCompatible": "OpenAI-compatible",
    "settings.ownBadge": "Own",
    "settings.sharedBadge": "Shared",
    "settings.keySet": "Key set",
    "settings.noKey": "No key",
    "settings.deleteProviderAria": "Delete provider",
    "settings.modelsInChatOne": "{count} model in chat",
    "settings.modelsInChatOther": "{count} models in chat",
    "settings.loadCatalog": "Load catalog",
    "settings.filterModelsPlaceholder": "Filter {count} models…",
    "settings.saveModelSelection": "Save model selection",
    "settings.addProviderHeader": "Add your own provider (private to you)",
    "settings.addProviderValidationError": "Label, base URL and API key are required.",
    "settings.labelPlaceholder": "Label (e.g. My OpenAI)",
    "settings.baseUrlPlaceholder": "Base URL (e.g. https://api.openai.com/v1)",
    "settings.apiKeyPlaceholder": "API key",
    "settings.addProviderSubmit": "Add — then pick its models",
    "settings.presetOllamaLocal": "Ollama (local)",

    // RedactionListsCard.tsx
    // Not "on this device": the list rides the E2E-encrypted `prefs` blob and
    // follows the account across devices. Saying otherwise was doubly wrong once
    // the document viewer began writing into it.
    "settings.alwaysRedactTitle": "Always redact",
    "settings.termCountOne": "{count} term",
    "settings.termCountOther": "{count} terms",
    "settings.nothingYet": "Nothing yet",
    "settings.alwaysRedactDescPre": "Words or values you list here are",
    "settings.alwaysRedactDescAlways": "always",
    "settings.alwaysRedactDescPost":
      "replaced before a message leaves this device — even when automatic detection misses them. Good for your own name, address, customer or account numbers. One entry per line. End-to-end encrypted and synced across your devices.",
    "settings.alwaysRedactPlaceholder": "Jakob\nMusterstraße 5, 10115 Berlin\nKundennummer 48213",
    "settings.savedAutoCaseInsensitive": "Saved automatically. Matching is case-insensitive.",
    "settings.redactListsHonesty":
      "How these lists are handled: they are stored end-to-end encrypted, and included in each filter request so the engine can match them (TLS in transit, not stored server-side). With a LOCAL detection engine they never leave your machine.",
    "settings.redactListsHonestyLink": "Details under data flows →",

    "settings.neverRedactTitle": "Never redact",
    "settings.neverRedactDescPre":
      "Words the detector keeps flagging by mistake — a product, ingredient or term that",
    "settings.neverRedactDescLooks": "looks",
    "settings.neverRedactDescMid1": "like a name but isn't (e.g.",
    "settings.neverRedactDescExample": "Xantan",
    "settings.neverRedactDescMid2": "). Listed values are",
    "settings.neverRedactDescNever": "never",
    "settings.neverRedactDescPost":
      "treated as personal data, from any detector. One entry per line. End-to-end encrypted and synced across your devices.",
    "settings.neverRedactPlaceholder": "Xantan\nGuarkernmehl\nThermomix",
    "settings.neverRedactHelperPre":
      "Saved automatically. Whole-word, case-insensitive. (Don't add anything you",
    "settings.neverRedactHelperDo": "do",
    "settings.neverRedactHelperPost": "want kept private.)",

    // ReasoningDefaultCard.tsx
    "settings.reasoningEffortTitle": "Reasoning effort",
    "settings.reasoningEffortDesc":
      "Default thinking budget for new chats. Override per chat from the composer.",
    "settings.reasoningOff": "Off",
    "settings.reasoningOffHint": "No explicit reasoning budget",
    "settings.reasoningLow": "Low",
    "settings.reasoningLowHint": "Fast, minimal thinking",
    "settings.reasoningMedium": "Medium",
    "settings.reasoningMediumHint": "Balanced",
    "settings.reasoningHigh": "High",
    "settings.reasoningHighHint": "Deep reasoning, slower",

    // ContextDefaultCard.tsx - explainer text is shared with the chat
    // composer's Context pill (chat.contextInfoHint), same feature.
    "settings.contextDefaultTitle": "Context (Memory & Documents)",
    "settings.contextDefaultDesc":
      "Automatically bring in relevant Memory & Documents when you chat. Applies everywhere immediately.",

    // UsageCard.tsx
    "settings.usageTitle": "Included AI budget",
    "settings.usageDesc":
      "Every account includes a capped AI budget. Add your own provider key to chat without limits.",
    "settings.usageUsedOf": "{used} of {limit} used",
    "settings.usageAriaLabel": "Included AI budget used",
    "settings.usageDisabledNotice":
      "This budget is currently disabled — chat runs on your own provider keys only.",

    // ProtectionLevelCard.tsx
    "settings.protectionLevelTitle": "Protection Level",
    "settings.protectionLevelDesc":
      "Applies everywhere immediately — chat, dashboard and projects.",

    // ProtectionSlider.tsx
    "settings.protectionBasicShort": "Basic",
    "settings.protectionBasicDesc":
      "No filtering, but requests still go through QUON — the provider never sees your account or name, unlike using ChatGPT or Gemini directly.",
    "settings.protectionFilterShort": "Filter",
    "settings.protectionFilterDesc":
      "Remove personal data such as emails, names, IDs before anything is sent",
    "settings.protectionReviewShort": "Review",
    "settings.protectionReviewDesc":
      "Make sure that no personal data is in your prompt, by reviewing and manually redacting your data",
  },
  de: {
    "settings.pageTitle": "Einstellungen",
    "settings.pageSubtitle": "Deine Privatsphäre. Deine Kontrolle.",
    "settings.languageTitle": "Sprache",
    "settings.languageHint":
      "Wähle die Sprache für die QUON-Oberfläche. Gilt für alle deine Geräte.",

    // FontSizeCard (AccountSettings.tsx)
    "settings.fontSizeTitle": "Schriftgröße",
    "settings.fontSizeHint":
      "Gilt überall in QUON. Nur auf diesem Gerät — wird nicht mit deinen anderen Geräten synchronisiert.",
    "settings.fontSizeStandard": "Standard",
    "settings.fontSizeLarger": "Größer",
    "settings.fontSizeLarge": "Groß",

    // Tabs (SettingsTabs.tsx)
    "settings.tabDetection": "Erkennung",
    "settings.tabProviders": "Anbieter",
    "settings.tabAccount": "Konto",
    "settings.comingSoon": "Kommt bald.",
    "settings.typesTitle": "Was geschwärzt wird",
    "settings.typesDesc":
      "Wähle, welche Arten persönlicher Daten QUON entfernt. Standardmäßig alle an.",
    "settings.typesLoading": "Typen werden geladen…",
    "settings.typesDisabledWarning":
      "{count} Typ(en) deaktiviert — Daten dieser Art gehen ungeschwärzt an das Modell.",
    "settings.detectStatusOk":
      "Die Erkennung läuft auf diesem Server, direkt im Prozess: Namen über spaCy, Muster über das Regex-Netz, GLiNER {gliner}.",
    "settings.detectStatusGlinerOn": "geladen",
    "settings.detectStatusGlinerOff": "aus",
    "settings.detectStatusDegraded":
      "Die Erkennung ist gerade nur teilweise verfügbar — das Symbol oben zeigt dasselbe. Nachrichten gehen nicht ungefiltert raus; das Senden wartet.",
    "settings.detectStatusOffline":
      "Der Erkennungsdienst ist nicht erreichbar — das Symbol oben zeigt dasselbe. Senden ist blockiert, bis er wieder da ist; nichts geht ungefiltert raus.",
    "settings.detectStatusLink": "So funktioniert die Erkennung →",
    // Kalender-Abo (.ics)
    "settings.calendarTitle": "Kalender (.ics)",
    "settings.calendarHint":
      "Abonniere einen schreibgeschützten Kalender-Link. Anstehende Termine erscheinen in deinem täglichen Briefing auf dem Dashboard.",
    "settings.calendarPlaceholder": "https://…/kalender.ics oder webcal://…",
    "settings.calendarSave": "Speichern",
    "settings.calendarSaved": "Gespeichert",
    "settings.calendarDisconnect": "Kalender entfernen",
    "settings.calendarPrivacy":
      "Der Kalender-Link wird Ende-zu-Ende-verschlüsselt gespeichert. Der QUON-Server ruft die Datei ab (er sieht den Link, wie beim Import einer URL); die Termine werden auf deinem Gerät ausgewertet.",
    "settings.calendarHowToHint":
      "So kommst du an einen Link — Google Kalender: Einstellungen → Kalender auswählen → " +
      "„Geheime Adresse im iCal-Format“. Apple/iCloud-Kalender: Rechtsklick auf den " +
      "Kalender → Kalender freigeben → Öffentlicher Kalender → webcal://-Link kopieren. " +
      "Outlook.com: Kalender → Freigeben → Kalender veröffentlichen → ICS-Link kopieren.",
    "settings.mcpTitle": "Werkzeuge (MCP)",
    "settings.mcpDesc":
      "Verbinde eigene Model-Context-Protocol-Server — ihre Werkzeuge stehen im Chat zur Verfügung, jeder Aufruf erst nach deiner Zustimmung.",
    "settings.mcpEmpty": "Noch keine Werkzeug-Server.",
    "settings.mcpAdd": "Server hinzufügen",
    "settings.mcpTest": "Testen",
    "settings.mcpTestOk": "OK — {count} Werkzeuge: {tools}",
    "settings.mcpEnabled": "An",
    "settings.mcpDisabled": "Aus",
    "settings.mcpRemoveAria": "Server entfernen",
    "settings.mcpFieldLabel": "Name",
    "settings.mcpFieldUrl": "Server-URL (https)",
    "settings.mcpFieldAuth": "Auth-Header (optional, versiegelt gespeichert)",
    "settings.mcpHonesty":
      "Tool-Aufrufe laufen erst nach deiner Zustimmung; Argumente siehst du vorher mit echten Werten, Ergebnisse werden vor dem Modell-Anbieter privatsphäre-gefiltert. Tool-Verkehr läuft über deinen QUON-Server.",

    // Shared across cards
    "settings.saved": "Gespeichert",
    "settings.saving": "Speichern…",
    "settings.showKey": "Schlüssel anzeigen",
    "settings.hideKey": "Schlüssel verbergen",

    // AccountSettings.tsx
    "settings.emailTitle": "E-Mail-Adresse",
    "settings.emailDescCurrently":
      "Aktuell {email}. Wir senden einen Bestätigungslink an die neue Adresse.",
    "settings.fieldNewEmail": "Neue E-Mail-Adresse",
    "settings.emailPlaceholder": "du@beispiel.de",
    "settings.emailChangeSuccess":
      "Sieh in deinem neuen Postfach nach — die Änderung wird wirksam, sobald du den Link bestätigst.",
    "settings.sendConfirmation": "Bestätigung senden",
    "settings.sending": "Senden…",

    "settings.passwordTitle": "Passwort",
    "settings.passwordDesc":
      "Deine Daten bleiben verschlüsselt und deine Wiederherstellungsphrase funktioniert weiterhin. Andere Geräte werden abgemeldet.",
    "settings.fieldCurrentPassword": "Aktuelles Passwort",
    "settings.fieldNewPassword": "Neues Passwort",
    "settings.fieldConfirmNewPassword": "Neues Passwort bestätigen",
    "settings.passwordsDontMatch": "Passwörter stimmen nicht überein.",
    "settings.passwordChanged": "Passwort geändert.",
    "settings.changePassword": "Passwort ändern",
    "settings.changing": "Ändern…",

    "settings.biometricTitle": "Biometrische Entsperrung (dieses Gerät)",
    "settings.biometricEnrolledDesc":
      "Auf diesem Gerät aktiv. Wer dieses Gerät biometrisch entsperren kann, kann auch QUON entsperren. Bleibt aktiv, wenn du dein Passwort änderst.",
    "settings.turnOff": "Deaktivieren",
    "settings.turningOff": "Deaktivieren…",
    "settings.biometricRemoveHint":
      "Den QUON-Passkey kannst du auch in den Passwort-Einstellungen deines Geräts entfernen.",
    "settings.biometricNotEnrolledDesc":
      "Entsperre QUON mit Face ID, Touch ID oder deinem Fingerabdruck statt mit dem Passwort — nur auf diesem Gerät. Der Entsperr-Schlüssel steckt in der sicheren Hardware deines Geräts und erreicht die QUON-Server nie. Beim Einrichten wirst du eventuell zweimal um Bestätigung gebeten.",
    "settings.enableOnThisDevice": "Auf diesem Gerät aktivieren",
    "settings.settingUp": "Einrichten…",
    "settings.bioPrfUnavailable":
      "Dein Gerät hat einen Passkey erstellt, unterstützt aber die Schlüsselschutz-Funktion nicht, die QUON braucht (PRF). Deshalb ist die biometrische Entsperrung in diesem Browser nicht möglich. Aktiviert wurde nichts — den ungenutzten QUON-Passkey kannst du in den Passwort-Einstellungen deines Geräts entfernen.",

    "settings.recoveryTitle": "Wiederherstellungsphrase",
    "settings.recoveryDesc":
      "Deine 12-Wort-Wiederherstellungsphrase haben wir dir einmal bei der Konto-Erstellung gezeigt. Aus Sicherheitsgründen lässt sie sich nicht noch einmal anzeigen — sie wurde nirgends gespeichert.",
    "settings.recoveryRotateHint":
      "Notiz verloren? Erzeuge hier eine NEUE Phrase. Die alte wird sofort ungültig; die neue siehst du genau einmal.",
    "settings.recoveryRotate": "Neue Phrase erzeugen",
    "settings.recoveryRotating": "Wird erzeugt…",
    "settings.recoveryNewPhraseNote":
      "Das ist deine neue Wiederherstellungsphrase — sie wird nur dieses eine Mal angezeigt. Schreib sie jetzt auf; die alte Phrase ist ab sofort ungültig.",
    "settings.recoveryCopy": "Phrase kopieren",
    "settings.recoveryCopied": "Kopiert",
    "settings.recoverySavedConfirm":
      "Ich habe meine neue Wiederherstellungsphrase sicher aufbewahrt.",
    "settings.recoveryDone": "Fertig",

    "settings.deleteAccountTitle": "Konto löschen",
    "settings.deleteAccountDesc":
      "Löscht dein Konto und alle verschlüsselten Daten dauerhaft. Das lässt sich nicht rückgängig machen.",
    "settings.deleteAccountShareWarningOne":
      "Dir gehört {count} Projekt, das du mit anderen teilst. Löschst du dein Konto, verschwindet es dauerhaft für alle Mitglieder.",
    "settings.deleteAccountShareWarningOther":
      "Dir gehören {count} Projekte, die du mit anderen teilst. Löschst du dein Konto, verschwinden sie dauerhaft für alle Mitglieder.",
    "settings.deleteConfirmPrefix": "Gib",
    "settings.deleteConfirmSuffix": "ein, um zu bestätigen",
    "settings.deleteMyAccount": "Mein Konto löschen",
    "settings.deleting": "Löschen…",

    // OpenRouterKeyCard.tsx
    "settings.scrubberOffline": "Scrubber offline",
    "settings.connected": "Verbunden",
    "settings.notConfigured": "Nicht eingerichtet",
    "settings.openRouterTitle": "Modellanbieter · OpenRouter",
    "settings.openRouterDesc":
      "Wird für alle Cloud-Modelle genutzt. Der Schlüssel liegt auf dem Gateway, nie im Browser.",
    "settings.openRouterKeyLabel": "OpenRouter-API-Schlüssel",
    "settings.openRouterKeyPlaceholderConfigured":
      "•••••••••• (hinterlegt — zum Ersetzen neuen Schlüssel eingeben)",
    "settings.openRouterKeyPlaceholderEmpty": "sk-or-v1-…",
    "settings.saveKey": "Schlüssel speichern",
    "settings.ownKeyInUse": "Dein eigener Schlüssel ist aktiv",
    "settings.euRoutingBadge": "EU-Routing",
    "settings.euRoutingHint":
      "Deine Anfragen werden nur in der EU verarbeitet (OpenRouter EU-Routing). Modelle ohne EU-Standort werden nicht angeboten; Websuche und Bildgenerierung gibt es dabei nicht.",
    "settings.removeKey": "Schlüssel entfernen",
    "settings.removingKey": "Wird entfernt…",
    "settings.keyRemoved": "Schlüssel entfernt — dein inkludiertes Guthaben wird wieder genutzt.",
    "settings.openRouterGetKeyHint":
      "Hol dir einen Schlüssel auf openrouter.ai → Keys. Hier funktioniert nur ein OpenRouter-Schlüssel (sk-or-…) — keiner von OpenAI oder Anthropic.",

    // ProvidersSettings.tsx
    "settings.providersTitle": "Anbieter & Modelle",
    "settings.providersDesc":
      "Wähle, welche Modelle im Chat erscheinen, oder füge deinen eigenen OpenAI-kompatiblen Anbieter hinzu.",
    "settings.scrubberNotReachable": "Scrubber nicht erreichbar — starte quon-scrubber-service.",
    "settings.addProvider": "Anbieter hinzufügen",
    "settings.builtinOpenRouter": "OpenRouter",
    "settings.openAiCompatible": "OpenAI-kompatibel",
    "settings.ownBadge": "Eigen",
    "settings.sharedBadge": "Geteilt",
    "settings.keySet": "Schlüssel hinterlegt",
    "settings.noKey": "Kein Schlüssel",
    "settings.deleteProviderAria": "Anbieter löschen",
    "settings.modelsInChatOne": "{count} Modell im Chat",
    "settings.modelsInChatOther": "{count} Modelle im Chat",
    "settings.loadCatalog": "Katalog laden",
    "settings.filterModelsPlaceholder": "{count} Modelle filtern…",
    "settings.saveModelSelection": "Modellauswahl speichern",
    "settings.addProviderHeader": "Eigenen Anbieter hinzufügen (nur für dich sichtbar)",
    "settings.addProviderValidationError":
      "Bezeichnung, Basis-URL und API-Schlüssel sind erforderlich.",
    "settings.labelPlaceholder": "Bezeichnung (z. B. Mein OpenAI)",
    "settings.baseUrlPlaceholder": "Basis-URL (z. B. https://api.openai.com/v1)",
    "settings.apiKeyPlaceholder": "API-Schlüssel",
    "settings.addProviderSubmit": "Hinzufügen — dann Modelle auswählen",
    "settings.presetOllamaLocal": "Ollama (lokal)",

    // RedactionListsCard.tsx
    "settings.alwaysRedactTitle": "Immer schwärzen",
    "settings.termCountOne": "{count} Begriff",
    "settings.termCountOther": "{count} Begriffe",
    "settings.nothingYet": "Noch nichts",
    "settings.alwaysRedactDescPre": "Wörter oder Werte, die du hier einträgst, werden",
    "settings.alwaysRedactDescAlways": "immer",
    "settings.alwaysRedactDescPost":
      "ersetzt, bevor eine Nachricht dieses Gerät verlässt — selbst wenn die automatische Erkennung sie übersieht. Ideal für deinen eigenen Namen, deine Adresse, Kunden- oder Kontonummern. Ein Eintrag pro Zeile. Ende-zu-Ende-verschlüsselt und mit deinen Geräten synchronisiert.",
    "settings.alwaysRedactPlaceholder": "Jakob\nMusterstraße 5, 10115 Berlin\nKundennummer 48213",
    "settings.savedAutoCaseInsensitive":
      "Automatisch gespeichert. Groß-/Kleinschreibung wird ignoriert.",
    "settings.redactListsHonesty":
      "So werden diese Listen behandelt: Sie liegen Ende-zu-Ende-verschlüsselt und werden bei jeder Filter-Anfrage mitgeschickt, damit die Engine sie anwenden kann (TLS unterwegs, serverseitig nicht gespeichert). Mit einer LOKALEN Erkennungs-Engine verlassen sie deine Maschine nie.",
    "settings.redactListsHonestyLink": "Details unter Datenflüsse →",

    "settings.neverRedactTitle": "Nie schwärzen",
    "settings.neverRedactDescPre":
      "Wörter, die der Filter immer wieder fälschlich markiert — ein Produkt, eine Zutat oder ein Begriff, der",
    "settings.neverRedactDescLooks": "aussieht",
    "settings.neverRedactDescMid1": "wie ein Name, aber keiner ist (z. B.",
    "settings.neverRedactDescExample": "Xantan",
    "settings.neverRedactDescMid2": "). Eingetragene Werte gelten",
    "settings.neverRedactDescNever": "nie",
    "settings.neverRedactDescPost":
      "als persönliche Daten — von keinem Erkennungsverfahren. Ein Eintrag pro Zeile. Ende-zu-Ende-verschlüsselt und mit deinen Geräten synchronisiert.",
    "settings.neverRedactPlaceholder": "Xantan\nGuarkernmehl\nThermomix",
    "settings.neverRedactHelperPre":
      "Automatisch gespeichert. Ganzes Wort, Groß-/Kleinschreibung egal. (Trag hier nichts ein, das du",
    "settings.neverRedactHelperDo": "wirklich",
    "settings.neverRedactHelperPost": "geheim halten willst.)",

    // ReasoningDefaultCard.tsx
    "settings.reasoningEffortTitle": "Reasoning",
    "settings.reasoningEffortDesc":
      "Standard-Reasoning für neue Chats. Kannst du pro Chat im Eingabefeld überschreiben.",
    "settings.reasoningOff": "Aus",
    "settings.reasoningOffHint": "Kein festes Reasoning-Budget",
    "settings.reasoningLow": "Niedrig",
    "settings.reasoningLowHint": "Schnell, minimales Reasoning",
    "settings.reasoningMedium": "Mittel",
    "settings.reasoningMediumHint": "Ausgewogen",
    "settings.reasoningHigh": "Hoch",
    "settings.reasoningHighHint": "Tiefes Reasoning, langsamer",

    // ContextDefaultCard.tsx - Erklärtext wird mit dem Kontext-Pill im
    // Chat-Eingabefeld geteilt (chat.contextInfoHint), gleiches Feature.
    "settings.contextDefaultTitle": "Kontext (Erinnerung & Dokumente)",
    "settings.contextDefaultDesc":
      "Bindet beim Chatten automatisch passende Erinnerungen & Dokumente ein. Gilt sofort überall.",

    // UsageCard.tsx
    "settings.usageTitle": "Enthaltenes KI-Budget",
    "settings.usageDesc":
      "Jedes Konto bringt ein gedeckeltes KI-Budget mit. Hinterlege deinen eigenen Anbieter-Schlüssel, um ohne Limit zu chatten.",
    "settings.usageUsedOf": "{used} von {limit} verwendet",
    "settings.usageAriaLabel": "Verwendetes, enthaltenes KI-Budget",
    "settings.usageDisabledNotice":
      "Dieses Budget ist derzeit deaktiviert — der Chat läuft nur über deine eigenen Anbieter-Schlüssel.",

    // ProtectionLevelCard.tsx
    "settings.protectionLevelTitle": "Protection Level",
    "settings.protectionLevelDesc": "Gilt sofort überall — Chat, Dashboard und Projekte.",

    // ProtectionSlider.tsx
    "settings.protectionBasicShort": "Basic",
    "settings.protectionBasicDesc":
      "Keine Filterung — aber deine Anfrage läuft trotzdem über QUON: Der Anbieter sieht weder dein Konto noch deinen Namen, anders als bei ChatGPT oder Gemini direkt.",
    "settings.protectionFilterShort": "Filter",
    "settings.protectionFilterDesc":
      "Entfernt persönliche Daten wie E-Mail-Adressen, Namen oder Ausweisnummern, bevor etwas gesendet wird",
    "settings.protectionReviewShort": "Review",
    "settings.protectionReviewDesc":
      "Du prüfst jede Nachricht selbst und schwärzt persönliche Daten von Hand, bevor sie rausgeht",
  },
} as const;
