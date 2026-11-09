/**
 * "connectors" namespace UI strings. Keys are prefixed `connectors.*`. Keep
 * `en` and `de` in sync - a missing German key is a compile error via
 * catalog.ts's typing.
 *
 * Covers: ScreenConnectors (generic card chrome) + per-connector strings.
 * A contributed connector adds its `connectors.<id>.*` keys here (see
 * docs/extending.md); the generic keys are the fallbacks used when a connector
 * doesn't override them via Connector.ui.
 */
export const connectors = {
  en: {
    // Screen chrome
    "connectors.title": "Connectors",
    "connectors.intro":
      "Bring outside data into QUON as searchable context — read, embedded and encrypted on your device, never sent to the cloud in the clear.",
    "connectors.moreTitle": "Other connections",
    "connectors.moreIntro":
      "Not document sources: a calendar feeds your daily briefing, and your own tool servers add tools to the chat.",

    // Generic card strings (fallbacks - connectors may override via ui keys)
    "connectors.connect": "Connect",
    "connectors.reimport": "Re-import",
    "connectors.disconnect": "Disconnect",
    "connectors.unsupportedGeneric": "This connector isn't available in this browser.",
    "connectors.footnoteGeneric":
      "Content is read locally, embedded and encrypted on your device — same as uploaded documents. Read-only.",
    "connectors.scanning": "Scanning… {total} items",
    "connectors.indexing": "Indexing {done}/{total}",
    "connectors.unchangedSuffix": " · {skipped} unchanged",
    "connectors.resultLine": "{imported} imported · {skipped} unchanged",
    "connectors.resultFailedSuffix": " · {failed} failed",
    "connectors.failReasonUnknown": "unknown error",
    "connectors.browse.searchPlaceholder": "Search Dropbox…",
    "connectors.browse.search": "Search",
    "connectors.browse.noHits": "No matching documents found.",
    "connectors.browse.importSelected": "Import selected ({count})",
    "connectors.browse.importing": "Importing…",

    // Remote document picker (chat paperclip -> live source, e.g. Paperless)
    "connectors.picker.title": "Attach from {name}",
    "connectors.picker.searchPlaceholder": "Search documents…",
    "connectors.picker.hint":
      "The document is fetched live and attached to this message only — it is not saved in QUON.",
    "connectors.picker.loading": "Loading document…",
    "connectors.disconnectTitle": "Disconnect {name}?",
    "connectors.disconnectDesc":
      "The connection to {name} will be removed. Choose whether to keep the documents you already imported or remove them too. The source itself is untouched.",
    "connectors.disconnectConfirm": "Remove imported items",
    "connectors.disconnectKeep": "Disconnect, keep documents",
    "connectors.disconnectRemove": "Disconnect & remove all documents",

    // Local folder
    "connectors.folder.name": "Local folder",
    "connectors.folder.description":
      "Import any folder — case files, scans, notes, an Obsidian vault (PDF, DOCX, Markdown, text …) — as on-device, encrypted context.",
    "connectors.folder.connect": "Choose folder",
    "connectors.folder.reimport": "Re-import folder",
    "connectors.folder.unsupported":
      "Folder import needs a desktop browser. Open QUON there to import a folder.",

    // Generic config form (network connectors)
    "connectors.configSave": "Save",
    "connectors.configSaving": "Saving…",
    "connectors.configChange": "Change",
    "connectors.configForget": "Forget settings",
    "connectors.configLocalNote":
      "Synced end-to-end encrypted across your devices — QUON's servers only ever see ciphertext.",

    // Paperless-ngx
    "connectors.paperless.description":
      "Import the OCRed text of your Paperless-ngx documents — fetched directly from your instance by this browser, never through a server.",
    "connectors.paperless.connect": "Import documents",
    "connectors.paperless.reimport": "Re-import documents",
    "connectors.paperless.footnote":
      "Your browser talks directly to your Paperless instance. The connection (URL + API token) syncs end-to-end encrypted across your devices — the server only ever sees ciphertext. Paperless must allow this origin via PAPERLESS_CORS_ALLOWED_HOSTS — see the self-hosting guide.",
    "connectors.paperless.fieldUrl": "Paperless URL",
    "connectors.paperless.fieldToken": "API token",
    "connectors.paperless.browsePlaceholder": "Search Paperless…",
    "connectors.paperless.alreadyImported": "already in QUON",

    // Dropbox
    "connectors.dropbox.description":
      "Import files from your own Dropbox — downloaded directly by this browser via the Dropbox API, never through a server. You sign in at Dropbox; the access stays on this device.",
    "connectors.dropbox.connect": "Import files",
    "connectors.dropbox.reimport": "Re-import files",
    "connectors.dropbox.footnote":
      "Connecting opens the official Dropbox sign-in — you authorize YOUR Dropbox account there. The access token syncs end-to-end encrypted across your devices — the server only ever sees ciphertext.",
    "connectors.dropbox.fieldPath": "Folder (empty = whole Dropbox)",
    "connectors.dropbox.notEnabled":
      "Dropbox is not enabled on this instance yet — the operator needs to register a Dropbox app (see the self-hosting guide).",

    "connectors.onedrive.description":
      "Import files from your own OneDrive — downloaded directly by this browser via Microsoft Graph, never through a server. Works with personal and work/school accounts.",
    "connectors.onedrive.connect": "Import files",
    "connectors.onedrive.reimport": "Re-import files",
    "connectors.onedrive.footnote":
      "Connecting opens the official Microsoft sign-in — you authorize YOUR account there, read-only. The access token syncs end-to-end encrypted across your devices — the server only ever sees ciphertext.",
    "connectors.onedrive.fieldPath": "Folder (empty = whole OneDrive)",
    "connectors.onedrive.searchPlaceholder": "Search OneDrive…",
    "connectors.onedrive.notEnabled":
      "OneDrive is not enabled on this instance yet — the operator needs to register an Azure app (see the self-hosting guide).",

    // Email export
    "connectors.emailExport.name": "Email export",
    "connectors.emailExport.description":
      "Import exported emails (.eml, .mbox) — one encrypted document per message, parsed entirely on your device.",
    "connectors.emailExport.connect": "Choose export files",
    "connectors.emailExport.reimport": "Import more emails",
    "connectors.emailExport.footnote":
      "Every desktop mail client can export .eml/.mbox (drag a mail to the desktop, or use Save as / Export). Nothing is fetched from your mail server — the files are parsed and encrypted on this device.",

    // IMAP (native-only)
    "connectors.imap.description":
      "Search your mailbox from QUON and pick what to import — fetched by the desktop app, never by a server.",
    "connectors.imap.unsupported":
      "Available in the QUON desktop app — a browser cannot open a mail connection.",
    "connectors.imap.footnote":
      "IMAP with TLS (port 993) and an app password; the password is stored in your device's keychain, never in QUON. Read-only: nothing in your mailbox is marked, moved or deleted. Your mailbox stays where it is — QUON searches it on demand and imports only the messages you pick.",
    "connectors.imap.server": "IMAP server",
    "connectors.imap.username": "Username / email",
    "connectors.imap.password": "App password",
    "connectors.imap.folders": "Folders (comma-separated)",
    "connectors.imap.browsePlaceholder": "Search your mailbox…",

    // Obsidian
  },
  de: {
    "connectors.title": "Connectors",
    "connectors.intro":
      "Hol externe Daten als durchsuchbaren Kontext in QUON — gelesen, eingebettet und verschlüsselt auf deinem Gerät, nie unverschlüsselt in die Cloud.",
    "connectors.moreTitle": "Weitere Verbindungen",
    "connectors.moreIntro":
      "Keine Dokumentquellen: Der Kalender speist dein Tagesbriefing, eigene Werkzeug-Server bringen zusätzliche Werkzeuge in den Chat.",

    "connectors.connect": "Verbinden",
    "connectors.reimport": "Neu importieren",
    "connectors.disconnect": "Trennen",
    "connectors.unsupportedGeneric": "Dieser Connector ist in diesem Browser nicht verfügbar.",
    "connectors.footnoteGeneric":
      "Inhalte werden lokal gelesen, auf deinem Gerät eingebettet und verschlüsselt — wie hochgeladene Dokumente. Nur Lesezugriff.",
    "connectors.scanning": "Wird gescannt … {total} Einträge",
    "connectors.indexing": "Wird indexiert {done}/{total}",
    "connectors.unchangedSuffix": " · {skipped} unverändert",
    "connectors.resultLine": "{imported} importiert · {skipped} unverändert",
    "connectors.resultFailedSuffix": " · {failed} fehlgeschlagen",
    "connectors.failReasonUnknown": "unbekannter Fehler",
    "connectors.browse.searchPlaceholder": "Dropbox durchsuchen…",
    "connectors.browse.search": "Suchen",
    "connectors.browse.noHits": "Keine passenden Dokumente gefunden.",
    "connectors.browse.importSelected": "Auswahl importieren ({count})",
    "connectors.browse.importing": "Wird importiert…",

    "connectors.picker.title": "Aus {name} anhängen",
    "connectors.picker.searchPlaceholder": "Dokumente durchsuchen…",
    "connectors.picker.hint":
      "Das Dokument wird live geladen und nur an diese Nachricht angehängt — es wird nicht in QUON gespeichert.",
    "connectors.picker.loading": "Dokument wird geladen…",
    "connectors.disconnectTitle": "{name} trennen?",
    "connectors.disconnectDesc":
      "Die Verbindung zu {name} wird entfernt. Wähle, ob die bereits importierten Dokumente erhalten bleiben oder ebenfalls entfernt werden. Die Quelle selbst bleibt unberührt.",
    "connectors.disconnectConfirm": "Importierte Einträge entfernen",
    "connectors.disconnectKeep": "Trennen, Dokumente behalten",
    "connectors.disconnectRemove": "Trennen & alle Dokumente entfernen",

    "connectors.folder.name": "Lokaler Ordner",
    "connectors.folder.description":
      "Importiere einen beliebigen Ordner — Akten, Scans, Notizen, auch einen Obsidian-Vault (PDF, DOCX, Markdown, Text …) — als verschlüsselten Kontext auf deinem Gerät.",
    "connectors.folder.connect": "Ordner wählen",
    "connectors.folder.reimport": "Ordner neu importieren",
    "connectors.folder.unsupported":
      "Der Ordner-Import braucht einen Desktop-Browser. Öffne QUON dort, um einen Ordner zu importieren.",

    "connectors.configSave": "Speichern",
    "connectors.configSaving": "Wird gespeichert …",
    "connectors.configChange": "Ändern",
    "connectors.configForget": "Zugangsdaten vergessen",
    "connectors.configLocalNote":
      "Ende-zu-Ende-verschlüsselt zwischen deinen Geräten synchronisiert — QUON-Server sehen nur Ciphertext.",

    "connectors.paperless.description":
      "Importiere den OCR-Text deiner Paperless-ngx-Dokumente — direkt von deiner Instanz durch diesen Browser abgerufen, nie über einen Server.",
    "connectors.paperless.connect": "Dokumente importieren",
    "connectors.paperless.reimport": "Dokumente neu importieren",
    "connectors.paperless.footnote":
      "Dein Browser spricht direkt mit deiner Paperless-Instanz. Die Verbindung (URL + API-Token) synchronisiert Ende-zu-Ende-verschlüsselt zwischen deinen Geräten — der Server sieht nur Ciphertext. Paperless muss diese Origin per PAPERLESS_CORS_ALLOWED_HOSTS erlauben — siehe Self-Hosting-Guide.",
    "connectors.paperless.fieldUrl": "Paperless-URL",
    "connectors.paperless.fieldToken": "API-Token",
    "connectors.paperless.browsePlaceholder": "Paperless durchsuchen…",
    "connectors.paperless.alreadyImported": "bereits in QUON",

    "connectors.dropbox.description":
      "Importiere Dateien aus deiner eigenen Dropbox — direkt von diesem Browser über die Dropbox-API geladen, nie über einen Server. Du meldest dich bei Dropbox an; der Zugriff bleibt auf diesem Gerät.",
    "connectors.dropbox.connect": "Dateien importieren",
    "connectors.dropbox.reimport": "Dateien erneut importieren",
    "connectors.dropbox.footnote":
      "Beim Verbinden öffnet sich die offizielle Dropbox-Anmeldung — dort autorisierst du DEIN Dropbox-Konto. Der Zugriffs-Token synchronisiert Ende-zu-Ende-verschlüsselt zwischen deinen Geräten — der Server sieht nur Ciphertext.",
    "connectors.dropbox.fieldPath": "Ordner (leer = ganze Dropbox)",
    "connectors.dropbox.notEnabled":
      "Dropbox ist auf dieser Instanz noch nicht aktiviert — der Betreiber muss eine Dropbox-App registrieren (siehe Self-Hosting-Anleitung).",

    "connectors.onedrive.description":
      "Importiere Dateien aus deinem eigenen OneDrive — direkt von diesem Browser über Microsoft Graph geladen, nie über einen Server. Funktioniert mit privaten und Geschäfts-/Schulkonten.",
    "connectors.onedrive.connect": "Dateien importieren",
    "connectors.onedrive.reimport": "Dateien erneut importieren",
    "connectors.onedrive.footnote":
      "Beim Verbinden öffnet sich die offizielle Microsoft-Anmeldung — dort autorisierst du DEIN Konto, nur lesend. Der Zugriffs-Token synchronisiert Ende-zu-Ende-verschlüsselt zwischen deinen Geräten — der Server sieht nur Ciphertext.",
    "connectors.onedrive.fieldPath": "Ordner (leer = ganzes OneDrive)",
    "connectors.onedrive.searchPlaceholder": "OneDrive durchsuchen…",
    "connectors.onedrive.notEnabled":
      "OneDrive ist auf dieser Instanz noch nicht aktiviert — der Betreiber muss eine Azure-App registrieren (siehe Self-Hosting-Anleitung).",

    "connectors.emailExport.name": "E-Mail-Export",
    "connectors.emailExport.description":
      "Importiere exportierte E-Mails (.eml, .mbox) — ein verschlüsseltes Dokument pro Nachricht, komplett auf deinem Gerät geparst.",
    "connectors.emailExport.connect": "Export-Dateien wählen",
    "connectors.emailExport.reimport": "Weitere E-Mails importieren",
    "connectors.emailExport.footnote":
      "Jedes Desktop-Mailprogramm kann .eml/.mbox exportieren (Mail auf den Desktop ziehen oder Speichern unter / Exportieren). Es wird nichts von deinem Mailserver abgerufen — die Dateien werden auf diesem Gerät geparst und verschlüsselt.",

    "connectors.imap.description":
      "Durchsuche dein Postfach aus QUON heraus und wähle aus, was importiert wird — abgerufen von der Desktop-App, nie von einem Server.",
    "connectors.imap.unsupported":
      "Verfügbar in der QUON-Desktop-App — ein Browser kann keine Mail-Verbindung öffnen.",
    "connectors.imap.footnote":
      "IMAP mit TLS (Port 993) und App-Passwort; das Passwort liegt im Schlüsselbund deines Geräts, nie in QUON. Nur Lesen: In deinem Postfach wird nichts markiert, verschoben oder gelöscht. Dein Postfach bleibt, wo es ist — QUON durchsucht es bei Bedarf und importiert nur die Nachrichten, die du auswählst.",
    "connectors.imap.server": "IMAP-Server",
    "connectors.imap.username": "Benutzername / E-Mail",
    "connectors.imap.password": "App-Passwort",
    "connectors.imap.folders": "Ordner (kommagetrennt)",
    "connectors.imap.browsePlaceholder": "Postfach durchsuchen …",
  },
} as const;
