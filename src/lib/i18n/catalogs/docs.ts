/**
 * "docs" namespace UI strings. Keys are prefixed `docs.*`. Keep `en` and `de`
 * in sync - a missing German key is a compile error via catalog.ts's typing.
 * (Populated by the i18n string-externalization pass.)
 */
export const docs = {
  en: {
    // On-device OCR errors (src/lib/documents/ocr.ts, module-level)
    "docs.ocrReadImageError":
      "Couldn't read this image on this device ({detail}). Try a JPEG or PNG.",
    "docs.ocrBlobUnreadable":
      "the photo could not be read from the gallery — if it lives in the Google Photos cloud, open it once in Photos so it downloads, then retry",
    "docs.ocrBlobEmpty":
      "the picker delivered an empty file — if the photo is cloud-only, open it once in Google Photos, then retry",
    "docs.ocrEncodeError": "Couldn't encode this image for upload.",
    "docs.ocrLoadReaderError":
      "Couldn't load the on-device text reader ({detail}). Check your connection and retry — the photo has not left this device.",
    "docs.ocrNoText": "No readable text found in this photo. Try better light or a closer shot.",
    // ScreenDocuments - page chrome
    "docs.title": "Documents",
    "docs.subtitle":
      "Chat with your files. Extracted and embedded on-device, then stored as ciphertext — never sent to the cloud in the clear.",
    "docs.uploadDropBrowse": "Drop files or browse",
    "docs.uploadFormats": "Processed on-device · PDF, DOCX, TXT, MD, CSV, JSON, HTML",
    "docs.zkHint":
      "Documents are read and indexed on your device and stored end-to-end encrypted — the server only holds ciphertext it cannot read. Content is filtered before it ever reaches an AI model.",
    "docs.zkHintLink": "How your data flows →",
    "docs.detectToggle": "Show detection — mark everything the filter would redact, in place",
    // A scan has no text layer, so there is nowhere to place a mark. Saying this
    // is the difference between "nothing found" and "cannot show it here".
    "docs.detectScannedPage": "Scanned page — marks visible in Text view",
    "docs.detectRunning": "Running your filter over the document…",
    "docs.detectSlow": "still working — long documents take a while",
    "docs.detectDone": "{count} distinct values marked — everything unmarked would be sent as-is.",
    // The marks are interactive, and without this line nothing says so (users
    // "found it more by accident"). The toggle also needs a visible label - an
    // icon with only a `title` is a hover tooltip, which a touch device can
    // never show.
    "docs.detectLabel": "Detection",
    "docs.detectHowto":
      "Select any text to redact it yourself · tap a mark to keep that value after all",
    "docs.detectNone": "The filter found nothing to redact in this document.",
    "docs.previewForSendHint":
      "Preview of your attachment. Anything you redact here applies to this message only.",
    "docs.detectFailed":
      "The filter engine is unreachable — no preview. (Sending would be blocked the same way.)",
    "docs.preparingModel": "preparing on-device model…",
    "docs.scanAPhoto": "Scan a photo",
    "docs.scanPhotoHint": "Text read on-device",
    "docs.scanFromGallery": "Choose from gallery",
    "docs.urlPlaceholder": "Paste a web page URL…",
    "docs.urlImport": "Import",
    "docs.urlHint":
      "The page's text is imported as a document. Note: QUON's server fetches the URL — it sees the address and the public page content (not your private data).",
    "docs.urlError": "Couldn't import that page.",
    // ScreenDocuments - originals-sync quota banner (non-blocking; indexing/search
    // unaffected). Title is bold, body continues the sentence.
    "docs.quotaTitle.one": "One original couldn't be synced",
    "docs.quotaTitle.other": "{count} originals couldn't be synced",
    "docs.quotaBody.one":
      "— storage quota reached (200 MB). The document itself is synced and searchable; the original file stays on this device. Delete old documents to free space.",
    "docs.quotaBody.other":
      "— storage quota reached (200 MB). The documents themselves are synced and searchable; the original files stay on this device. Delete old documents to free space.",
    // ScreenDocuments - over-cap originals (never synced) + storage line
    "docs.tooBigTitle": "Too large to sync:",
    "docs.tooBigBody":
      "files over 50 MB keep their original only on this device. The text is synced and searchable everywhere.",
    "docs.storageLine": "Originals: {used} of {quota} MB used — encrypted, only you can read them.",
    // Originals larger than this device can push (memory-constrained phones)
    "docs.deviceLocalTitle": "Original kept on this device:",
    "docs.deviceLocalBody":
      "this phone hasn't enough memory to upload a file this large safely. The text is synced and searchable everywhere; open the document on a computer once to sync the original.",
    // ScreenDocuments - search
    "docs.searchPlaceholder": "Search all your documents…",
    "docs.clearSearchAria": "Clear search",
    "docs.resultCount.one": "{count} result",
    "docs.resultCount.other": "{count} results",
    "docs.matchPercent": "match {percent}%",
    "docs.noMatches": "No matches.",
    // ScreenDocuments - document list
    "docs.yourDocuments": "Your Documents",
    "docs.emptyState": "No documents yet. Upload one to get started.",
    "docs.viewDocumentTitle": "View document",
    "docs.statusIndexed": "Indexed",
    "docs.statusFailed": "Failed",
    "docs.failedChip": "{count} failed",
    "docs.download": "Download",
    "docs.statusIndexingPct": "Indexing… {percent}%",
    "docs.statusIndexing": "Indexing…",
    "docs.deleteDocumentAria": "Delete document",
    "docs.rename": "Rename",
    "docs.renameLabel": "Document name",
    "docs.pin": "Always use as context",
    "docs.unpin": "Don't always use as context",
    "docs.pinnedBadge": "always in context",

    // DocumentViewer
    "docs.viewOriginal": "Original",
    "docs.viewText": "Text",
    "docs.showTextInstead": "Show text view instead",
    "docs.fetchingOriginalPct": "Fetching original… {percent}%",
    "docs.fetchFailedFallback":
      "Couldn't fetch the original file — showing the extracted text. Check your connection.",
    "docs.retryFetchOriginal": "Retry",
    "docs.textOnlyFallback":
      "Showing extracted text — the original file hasn't been synced from the device it was uploaded on yet. Open QUON there once, or re-upload the file to make the original available everywhere.",
    "docs.noReadableText": "No readable text in this document.",
    "docs.dismissHit": "Recognised as {type} — click to stop redacting this value",
    "docs.pdfPageAria": "Page {page}",

    // DocumentPicker
    "docs.attachTitle": "Attach from your documents",
    "docs.attachSelected": "Attach",
    "docs.attachSelectedMany": "Attach {count} documents",
    "docs.attachEmpty": "No indexed documents yet. Upload one in the Documents tab first.",

    // PhotoScanDialog
    "docs.scanDialogTitle": "Scan photo",
    "docs.scanStaleBuild":
      "QUON was updated in the meantime — reload the app (button at the top), then scan again.",
    "docs.scanQueuePosition": "Photo {index} of {total}",
    "docs.acceptAllRemaining": "Take all {count}",
    "docs.acceptAllHint":
      "Takes this and every remaining photo without stopping for review — quick for a batch of screenshots, but the text is not checked.",
    "docs.chipCloud": "Read by a cloud model — photo not stored",
    "docs.chipDevice": "Read on this device — the photo never leaves it",
    "docs.phaseModel": "Preparing the on-device text reader (≈6 MB, first time only)…",
    "docs.phaseRecognize": "Reading the photo on this device…",
    "docs.scanGenericError": "Couldn't read this photo.",
    "docs.cloudEscalationPrompt": "Hard to read or handwriting? Try the cloud model",
    "docs.cloudConsentText":
      "This one photo is sent via your QUON server to a cloud model that reads handwriting well. Zero-data-retention routing — the photo is never stored and is discarded after reading. Costs a fraction of a cent from your AI budget.",
    "docs.cloudSendButton": "Send this photo",
    "docs.cloudKeepDeviceButton": "Keep on-device only",
    "docs.cloudBusyText": "Reading in the cloud…",
    "docs.reviewLabel": "Recognized text — check & correct before saving",
    "docs.lowConfidenceWarning":
      "Low confidence — this photo was hard to read. Please proof-read the text.",
    "docs.cloudModelDefault": "the cloud model",
    "docs.cloudReadCaption":
      "Read by {model} — unreadable passages are marked [?]; please check the transcript.",
    "docs.deviceReadCaption":
      "Printed text is read well on-device; handwriting is often unreliable — correct the transcript where needed.",
    "docs.attachModeCaption":
      "Only the text is attached, and it is filtered for personal data before sending — the photo itself is discarded.",
    "docs.keepOriginalCaption": "The photo is kept (encrypted) as the original.",
    "docs.documentNamePlaceholder": "Document name",
    "docs.attachToMessageButton": "Attach to message",
    "docs.saveToDocumentsButton": "Save to Documents",
    "docs.photoAlt": "Photo to scan",
  },
  de: {
    "docs.ocrReadImageError":
      "Dieses Bild konnte auf diesem Gerät nicht gelesen werden ({detail}). Versuche ein JPEG oder PNG.",
    "docs.ocrBlobUnreadable":
      "das Foto konnte nicht aus der Galerie gelesen werden — liegt es nur in der Google-Fotos-Cloud, öffne es dort einmal (damit es heruntergeladen wird) und versuch es erneut",
    "docs.ocrBlobEmpty":
      "die Auswahl lieferte eine leere Datei — liegt das Foto nur in der Cloud, öffne es einmal in Google Fotos und versuch es erneut",
    "docs.ocrEncodeError": "Dieses Bild konnte nicht für den Upload kodiert werden.",
    "docs.ocrLoadReaderError":
      "Die geräteinterne Texterkennung konnte nicht geladen werden ({detail}). Prüfe deine Verbindung und versuche es erneut — das Foto hat dieses Gerät nicht verlassen.",
    "docs.ocrNoText": "Kein lesbarer Text in diesem Foto. Versuch mehr Licht oder geh näher ran.",
    // ScreenDocuments - page chrome
    "docs.title": "Dokumente",
    "docs.subtitle":
      "Chatte mit deinen Dateien. Alles wird auf deinem Gerät ausgelesen und eingebettet, dann verschlüsselt gespeichert — nie unverschlüsselt in die Cloud.",
    "docs.uploadDropBrowse": "Dateien ablegen oder auswählen",
    "docs.uploadFormats": "Auf diesem Gerät verarbeitet · PDF, DOCX, TXT, MD, CSV, JSON, HTML",
    "docs.zkHint":
      "Dokumente werden auf deinem Gerät gelesen und indexiert und Ende-zu-Ende-verschlüsselt gespeichert — der Server hält nur Ciphertext, den er nicht lesen kann. Inhalte werden gefiltert, bevor sie je ein KI-Modell erreichen.",
    "docs.zkHintLink": "Wie deine Daten fließen →",
    "docs.detectToggle":
      "Erkennung anzeigen — alles markieren, was der Filter schwärzen würde, direkt im Dokument",
    "docs.detectRunning": "Dein Filter läuft über das Dokument…",
    "docs.detectSlow": "läuft noch — bei langen Dokumenten dauert das etwas",
    "docs.detectScannedPage": "Gescannte Seite — Markierungen in der Textansicht",
    "docs.detectDone":
      "{count} verschiedene Werte markiert — alles Unmarkierte würde unverändert gesendet.",
    "docs.detectLabel": "Erkennung",
    "docs.detectHowto":
      "Markier eine Stelle, um sie selbst zu schwärzen · tipp auf eine Markierung, wenn sie doch bleiben soll",
    "docs.detectNone": "Der Filter hat in diesem Dokument nichts zu schwärzen gefunden.",
    "docs.previewForSendHint":
      "Vorschau deines Anhangs. Was du hier schwärzt, gilt nur für diese Nachricht.",
    "docs.detectFailed":
      "Die Filter-Engine ist nicht erreichbar — keine Vorschau. (Senden wäre genauso blockiert.)",
    "docs.preparingModel": "Modell wird auf diesem Gerät vorbereitet…",
    "docs.scanAPhoto": "Foto scannen",
    "docs.scanPhotoHint": "Text wird auf diesem Gerät gelesen",
    "docs.scanFromGallery": "Aus der Galerie wählen",
    "docs.urlPlaceholder": "URL einer Webseite einfügen…",
    "docs.urlImport": "Importieren",
    "docs.urlHint":
      "Der Text der Seite wird als Dokument importiert. Hinweis: QUONs Server ruft die URL ab — er sieht die Adresse und den öffentlichen Seiteninhalt (nicht deine privaten Daten).",
    "docs.urlError": "Seite konnte nicht importiert werden.",
    // ScreenDocuments - originals-sync quota banner
    "docs.quotaTitle.one": "Ein Original konnte nicht synchronisiert werden",
    "docs.quotaTitle.other": "{count} Originale konnten nicht synchronisiert werden",
    "docs.quotaBody.one":
      "— Speicherlimit erreicht (200 MB). Das Dokument selbst ist synchronisiert und durchsuchbar; die Originaldatei bleibt auf diesem Gerät. Lösch alte Dokumente, um Platz zu schaffen.",
    "docs.quotaBody.other":
      "— Speicherlimit erreicht (200 MB). Die Dokumente selbst sind synchronisiert und durchsuchbar; die Originaldateien bleiben auf diesem Gerät. Lösch alte Dokumente, um Platz zu schaffen.",
    // ScreenDocuments - over-cap originals (never synced) + storage line
    "docs.tooBigTitle": "Zu groß zum Synchronisieren:",
    "docs.tooBigBody":
      "Dateien über 50 MB behalten ihr Original nur auf diesem Gerät. Der Text ist überall synchronisiert und durchsuchbar.",
    "docs.storageLine":
      "Originale: {used} von {quota} MB belegt — verschlüsselt, nur du kannst sie lesen.",
    "docs.deviceLocalTitle": "Original bleibt auf diesem Gerät:",
    "docs.deviceLocalBody":
      "dieses Handy hat zu wenig Speicher, um eine so große Datei sicher hochzuladen. Der Text ist überall synchronisiert und durchsuchbar; öffne das Dokument einmal am Computer, dann wird das Original synchronisiert.",
    // ScreenDocuments - search
    "docs.searchPlaceholder": "Alle deine Dokumente durchsuchen…",
    "docs.clearSearchAria": "Suche löschen",
    "docs.resultCount.one": "{count} Ergebnis",
    "docs.resultCount.other": "{count} Ergebnisse",
    "docs.matchPercent": "{percent} % Übereinstimmung",
    "docs.noMatches": "Keine Treffer.",
    // ScreenDocuments - document list
    "docs.yourDocuments": "Deine Dokumente",
    "docs.emptyState": "Noch keine Dokumente. Lad eins hoch, um loszulegen.",
    "docs.viewDocumentTitle": "Dokument ansehen",
    "docs.statusIndexed": "Indexiert",
    "docs.statusFailed": "Fehlgeschlagen",
    "docs.failedChip": "{count} fehlgeschlagen",
    "docs.download": "Herunterladen",
    "docs.statusIndexingPct": "Wird indexiert… {percent}%",
    "docs.statusIndexing": "Wird indexiert…",
    "docs.deleteDocumentAria": "Dokument löschen",
    "docs.rename": "Umbenennen",
    "docs.renameLabel": "Dokumentname",
    "docs.pin": "Immer als Kontext nutzen",
    "docs.unpin": "Nicht mehr immer als Kontext nutzen",
    "docs.pinnedBadge": "immer im Kontext",

    // DocumentViewer
    "docs.viewOriginal": "Original",
    "docs.viewText": "Text",
    "docs.showTextInstead": "Stattdessen Text-Ansicht zeigen",
    "docs.fetchingOriginalPct": "Original wird geladen… {percent}%",
    "docs.fetchFailedFallback":
      "Die Originaldatei konnte nicht geladen werden — wir zeigen den extrahierten Text. Prüf deine Verbindung.",
    "docs.retryFetchOriginal": "Noch mal versuchen",
    "docs.textOnlyFallback":
      "Wir zeigen den extrahierten Text — das Original wurde vom Hochlade-Gerät noch nicht synchronisiert. Öffne QUON dort einmal, oder lade die Datei neu hoch, damit das Original überall verfügbar ist.",
    "docs.noReadableText": "Kein lesbarer Text in diesem Dokument.",
    "docs.dismissHit": "Als {type} erkannt — klicken, um diesen Wert nicht mehr zu schwärzen",
    "docs.pdfPageAria": "Seite {page}",

    // DocumentPicker
    "docs.attachTitle": "Aus deinen Dokumenten anhängen",
    "docs.attachSelected": "Anhängen",
    "docs.attachSelectedMany": "{count} Dokumente anhängen",
    "docs.attachEmpty":
      "Noch keine indexierten Dokumente. Lad zuerst eins im Tab „Dokumente“ hoch.",

    // PhotoScanDialog
    "docs.scanDialogTitle": "Foto scannen",
    "docs.scanStaleBuild":
      "QUON wurde zwischenzeitlich aktualisiert — lade die App neu (Knopf oben) und scanne dann erneut.",
    "docs.scanQueuePosition": "Foto {index} von {total}",
    "docs.acceptAllRemaining": "Alle {count} übernehmen",
    "docs.acceptAllHint":
      "Übernimmt dieses und alle weiteren Fotos ohne Prüfung — schnell bei mehreren Screenshots, der Text wird dabei aber nicht kontrolliert.",
    "docs.chipCloud": "Von einem Cloud-Modell gelesen — Foto nicht gespeichert",
    "docs.chipDevice": "Auf diesem Gerät gelesen — das Foto verlässt es nie",
    "docs.phaseModel": "Texterkennung wird vorbereitet (≈6 MB, nur beim ersten Mal)…",
    "docs.phaseRecognize": "Foto wird auf diesem Gerät gelesen…",
    "docs.scanGenericError": "Dieses Foto konnte nicht gelesen werden.",
    "docs.cloudEscalationPrompt": "Schwer lesbar oder Handschrift? Cloud-Modell versuchen",
    "docs.cloudConsentText":
      "Dieses eine Foto geht über deinen QUON-Server an ein Cloud-Modell, das Handschrift gut liest. Zero-Data-Retention-Routing — das Foto wird nie gespeichert und nach dem Lesen sofort verworfen. Kostet einen Bruchteil eines Cents aus deinem KI-Budget.",
    "docs.cloudSendButton": "Dieses Foto senden",
    "docs.cloudKeepDeviceButton": "Nur auf dem Gerät behalten",
    "docs.cloudBusyText": "Wird in der Cloud gelesen…",
    "docs.reviewLabel": "Erkannter Text — vor dem Speichern prüfen & korrigieren",
    "docs.lowConfidenceWarning":
      "Unsichere Erkennung — dieses Foto war schwer zu lesen. Bitte lies den Text sorgfältig gegen.",
    "docs.cloudModelDefault": "das Cloud-Modell",
    "docs.cloudReadCaption":
      "Von {model} gelesen — unlesbare Stellen sind mit [?] markiert; bitte prüf die Abschrift.",
    "docs.deviceReadCaption":
      "Gedruckten Text liest das Gerät gut; Handschrift oft nicht zuverlässig — korrigier die Abschrift, wo nötig.",
    "docs.attachModeCaption":
      "Nur der Text wird angehängt und vor dem Senden auf persönliche Daten gefiltert — das Foto selbst wird verworfen.",
    "docs.keepOriginalCaption": "Das Foto wird (verschlüsselt) als Original aufbewahrt.",
    "docs.documentNamePlaceholder": "Dokumentname",
    "docs.attachToMessageButton": "An Nachricht anhängen",
    "docs.saveToDocumentsButton": "In Dokumenten speichern",
    "docs.photoAlt": "Zu scannendes Foto",
  },
} as const;
