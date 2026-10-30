/**
 * "chat" namespace UI strings. Keys are prefixed `chat.*`. Keep `en` and `de`
 * in sync — a missing German key is a compile error via catalog.ts's typing.
 *
 * Covers ScreenChat.tsx (composer, model/reasoning controls, attachments,
 * empty/onboarding states, redaction status lines, error bubbles, retry,
 * resend-without-filter), EntitySidebar.tsx (RedactionDetail — the per-message
 * expanded redaction list) and ReviewPanel.tsx (Review-before-send).
 *
 * Deliberately NOT localized here (out of this pass's file scope, or not
 * user-facing UI text):
 *  - The RAG/instruction/attachment system-prompt preambles in ScreenChat.tsx
 *    (RAG_PREAMBLE / INSTRUCTION_PREAMBLE / ATTACHMENT_PREAMBLE) — these are
 *    sent to the model as instructions, never rendered in the UI.
 *  - `enrichmentSkipReason()` (src/lib/quonApi.ts) returns English reason
 *    fragments ("the AI step timed out" etc.) that get spliced into the
 *    fallback-mode notices below; that file is outside this pass's scope.
 *  - Entity type labels (Person/Email/IBAN/…) from src/lib/quonEntityStyles.ts
 *    — also outside this pass's scope.
 */
export const chat = {
  en: {
    // Entity type labels (src/lib/quonEntityStyles.ts)
    "chat.entity.person": "Person",
    "chat.entity.email": "Email",
    "chat.entity.phone": "Phone",
    "chat.entity.iban": "IBAN",
    "chat.entity.routing": "Routing",
    "chat.entity.amount": "Amount",
    "chat.entity.date": "Date",
    "chat.entity.pin": "PIN / Secret",
    "chat.entity.internalUrl": "Internal URL",
    "chat.entity.credential": "Credential",
    "chat.entity.taxId": "Tax ID",
    "chat.entity.insuranceId": "Insurance ID",
    "chat.entity.address": "Address",
    "chat.webLabel": "Web",
    "chat.artifact.badge": "{type} artifact",
    "chat.artifact.save": "Save to Documents",
    "chat.artifact.saved": "Saved to Documents",
    "chat.artifact.expand": "Expand",
    "chat.artifact.collapse": "Collapse",
    "chat.webOnTitle":
      "Web search on — the model searches the live web whenever it needs to. Only your filtered (redacted) text is used. Turn off for fully offline answers.",
    "chat.webOffTitle": "Web search off — the model answers from its training knowledge only.",
    "chat.entity.custom": "Always redact",
    "chat.entity.manual": "Manual",
    "chat.entity.redacted": "Redacted",
    // enrichmentSkipReason fragments (src/lib/quonApi.ts)
    "chat.skip.timeout": "the AI step timed out",
    "chat.skip.unreachable": "the AI service was unreachable",
    "chat.skip.auth": "the AI key was rejected",
    "chat.skip.rateLimit": "the AI service was rate-limited",
    "chat.skip.budget": "the AI usage limit was reached",
    "chat.skip.providerError": "the AI service returned an error",
    "chat.skip.parse": "the AI reply could not be read",
    "chat.skip.unconfigured": "no AI key is configured",
    "chat.skip.disabled": "AI enrichment is turned off",
    // Intro / composer defaults
    "chat.introMessage":
      "Hi! I'm your private AI gateway. Type a message and QUON removes personal " +
      "data locally before it ever reaches a model provider. The panel below each " +
      "message shows exactly what was redacted.",
    "chat.onboardingIntroMessage":
      "Try it: type your name and email below — I'll show you exactly what leaves your device.",
    "chat.onboardingPlaceholder": "e.g. Hi, I'm Anna Müller, reach me at anna@mail.com",
    "chat.placeholder": "Ask anything, keep your data personal",

    // Loading phases
    "chat.loadingScrubbing": "Removing your personal data…",
    // Shown instead of the plain label above when a multi-part attachment
    // scrub is tracked (feedback: the wait can be 50-60s for a 200k-char /
    // 10-document attachment, and the plain label alone read as "stuck").
    // {name} is the already-localized attachment label ("10 documents" /
    // "All documents (12 files)"), so this names the scale of what's protected.
    "chat.loadingScrubbingAttachment": "Protecting {name} — removing your personal data…",
    // "{time}" is a pre-formatted duration ("8s" / "1:05"), digits only so the
    // same string works in both languages.
    // ELAPSED, not remaining. Every predicted-duration variant wandered in both
    // directions (see formatElapsed) — a number that moves both ways is worse
    // than a clock that only counts up.
    "chat.loadingScrubbingElapsed": "{time} elapsed",
    "chat.openOriginalToRedact": "View original & redact",
    // "Hangs with no error" — a stalled piece was completely silent behind a
    // ticking clock. These two say what is actually happening.
    "chat.loadingScrubbingRetry":
      "One section didn't respond — retrying ({attempt} of {attempts}). You can stop and send less at once.",
    "chat.loadingScrubbingSlow":
      "This is taking longer than usual. A section may not be responding — you can stop at any time.",
    "chat.loadingScrubbingCount": "{done} of {total} parts",
    "chat.loadingSearching": "Searching your memory…",
    "chat.loadingGenerating": "Generating response…",
    "chat.thinkingLabel": "Thinking",
    "chat.thoughtLabel": "Thought process",
    "chat.answeredBy": "Answered by {model}",
    "chat.sources": "Sources ({count})",
    "chat.artifact.dismiss": "Dismiss",

    // Reasoning-effort picker
    "chat.reasoningOff": "Off",
    "chat.reasoningOffHint": "Provider default — no explicit reasoning budget",
    "chat.reasoningLow": "Low",
    "chat.reasoningLowHint": "Fast, minimal thinking",
    "chat.reasoningMedium": "Medium",
    "chat.reasoningMediumHint": "Balanced reasoning",
    "chat.reasoningHigh": "High",
    "chat.reasoningHighHint": "Deep reasoning (slower, more tokens)",
    "chat.reasoningEffortHeading": "Reasoning effort",
    "chat.reasoningEffortTitle": "Reasoning effort: {level}",
    "chat.reasoningEffortTitleThisChat": "Reasoning effort: {level} (this chat)",
    "chat.moreChatOptionsAria": "More chat options",
    // Shared with settings/ReasoningDefaultCard.tsx (same feature, same explainer).
    "chat.reasoningInfoHint":
      'Reasoning lets capable models "think" through a problem before answering — often ' +
      "better on hard questions, but slower and MORE expensive: the thinking itself is " +
      "billed as tokens. \"Off\" uses the provider's default. Models that don't support " +
      "reasoning ignore this setting entirely.",

    // Budget hint
    "chat.budgetHint":
      "Your included AI budget is ~{pct}% used — add your own OpenRouter key in Settings to keep " +
      "chatting without limits.",

    // Attach / send errors (component-local; session-expired/offline reuse errors.*)
    "chat.errorNoReadableText": "No readable text found in this file.",
    "chat.errorCouldntReadFile": "Couldn't read that file.",
    "chat.errorNoReadableTextInDoc": "That document has no readable text.",
    "chat.errorNoReadableDocs": "No readable documents to attach.",
    "chat.errorAttachmentScrubFailed":
      "Couldn't remove personal data from the attachment — nothing was sent. Try again.",

    // Protection status line (below composer)
    "chat.scrubberOffline": "Scrubber offline — sending paused",
    "chat.reducedDetectionActive":
      "Local detection active (names + patterns) — LLM enrichment offline",

    // Filter / Review / Context pills
    "chat.filterOnTitle": "Personal data filter is on",
    "chat.filterOffTitle": "Filter off — data sent unprotected",
    "chat.filterOnLabel": "Filter",
    "chat.filterOffLabel": "Filter off",
    "chat.reviewLabel": "Review",
    "chat.reviewOnTitle": "Review before send: on",
    "chat.reviewOffTitle": "Review before send: off",
    "chat.contextLabel": "Context",
    "chat.contextOnTitle": "Use your saved memory as context: on",
    "chat.contextOffTitle": "Use your saved memory as context: off",
    // Shared with settings/ContextDefaultCard.tsx (same feature, same explainer).
    "chat.contextInfoHint":
      "When on, QUON automatically pulls relevant entries from your encrypted Memory and " +
      "Documents into the prompt — scrubbed like everything else before anything is sent. " +
      'This adds a little extra scrubbing time. After sending, the "Context used" note ' +
      "under your message shows exactly what was pulled in — or that nothing matched.",

    // Attach menu + staged attachment
    "chat.attachDocumentAria": "Attach a document",
    "chat.uploadFromDevice": "Upload from device",
    "chat.takeAPhoto": "Take a photo",
    // The mic points at the KEYBOARD's dictation; QUON runs no speech engine.
    // See components/quon/DictationButton.tsx for why.
    "chat.dictationTitle": "Dictate — how it works on your device",
    "chat.dictationHintIos":
      "Dictation comes from your keyboard: tap into the text field, then the microphone key at the bottom right of the keyboard. It runs on your iPhone — QUON only ever receives the finished text.",
    "chat.dictationHintAndroid":
      "Dictation comes from your keyboard: tap into the text field, then the microphone key on your keyboard (top right on Gboard). QUON only ever receives the finished text.",
    "chat.dictationHintMacos":
      "Dictation comes from macOS: turn it on once under System Settings → Keyboard → Dictation, then start it with the dictation key (F5) or by pressing ⌃ Control twice. QUON only ever receives the finished text.",
    "chat.dictationHintWindows":
      "Dictation comes from Windows: click into the text field and press the Windows key + H. QUON only ever receives the finished text.",
    "chat.dictationHintOther":
      "Use your system's or keyboard's own dictation — QUON only ever receives the finished text.",
    "chat.scanFromGallery": "Scan from gallery",
    "chat.chooseFromDocuments": "Choose from Documents",
    "chat.fromPaperless": "From Paperless…",
    "chat.attachmentFromPaperless": "from Paperless · not stored in QUON",
    "chat.attachmentFromPaperlessTooltip":
      "Loaded live from your Paperless archive for this one message — QUON keeps no copy of the document.",
    "chat.attachAllDocuments": "Attach all documents ({count})",
    "chat.removeAttachmentAria": "Remove attachment",
    "chat.reading": "Reading…",
    "chat.truncatedBadge": "(truncated)",
    "chat.mermaidShowSource": "Source",
    "chat.mermaidShowDiagram": "Diagram",
    "chat.mermaidBroken": "This diagram couldn't be drawn — showing its source instead.",
    "chat.shortenedToFitBadge": "(shortened to fit)",
    "chat.attachmentTruncatedTooltip":
      "Only the first {n} characters were sent to the model — the rest was cut off.",
    "chat.attachmentTruncatedCombinedTooltip":
      "Together the files exceed the {n}-character sending budget. Short files were kept " +
      "in full; the longest were trimmed evenly so every document is still represented.",
    "chat.allDocumentsCombined": "All documents ({count} files)",
    "chat.selectedDocumentsCombined": "{count} documents",

    // Composer buttons
    "chat.stopGeneratingAria": "Stop generating",
    "chat.stopAndEditTitle": "Stop and edit your prompt",
    "chat.sendAria": "Send",

    // Inline PII highlight tooltip
    "chat.removedBeforeSending": "removed before sending",
    "chat.anonymizedTooltip": "anonymized",

    // UserBubble status line
    "chat.sentWithoutFilter": "Sent without filter",
    "chat.sentUnprotected": "Sent unprotected",
    "chat.noPersonalDataFound": "No personal data found",
    "chat.noPersonalDataFoundDegraded": "No personal data found · reduced detection",
    "chat.itemsRedactedOne": "1 item redacted",
    "chat.itemsRedactedOther": "{count} items redacted",
    "chat.itemsRedactedDegraded": "{items} · reduced detection",
    "chat.noResponse": "(no response)",
    // MCP tool consent
    "chat.toolConsentTitle": "Allow this tool call?",
    "chat.toolConsentIntro":
      "The model wants to use one of your tools. Nothing runs without your OK — check the arguments below (shown with real values, exactly as they would reach your tool).",
    "chat.toolConsentAlways": "Always allow these tools (this device)",
    "chat.toolConsentWriteBadge": "writes",
    "chat.toolConsentUntrusted":
      "This action follows content read from an external tool this turn — check carefully that it's what you want.",
    "chat.toolConsentPrivacy":
      "Tool results are filtered like your own messages before anything goes back to the model provider.",
    "chat.toolConsentAllow": "Allow",
    "chat.toolConsentDeny": "Deny",
    // Friendly names for the first-party tools (fallback: humanized id).
    "chat.tool.create_agent": "Create a search agent",
    "chat.tool.import_dropbox_document": "Import a document from Dropbox",
    "chat.tool.search_dropbox": "Search Dropbox",
    "chat.tool.search_documents": "Search your documents",
    "chat.tool.save_memory": "Save a memory",
    "chat.tool.save_document": "Save a document",
    "chat.tool.search_paperless": "Search Paperless",
    "chat.tool.read_paperless_document": "Read a Paperless document",
    "chat.tool.import_paperless_document": "Import a document from Paperless",
    "chat.tool.read_url": "Read a web page",
    "chat.tool.pick_folder": "Choose a folder",
    "chat.tool.list_folder_files": "List the folder's files",
    "chat.tool.read_folder_file": "Read a file from the folder",
    "chat.tool.import_folder_file": "Import a file from the folder",
    "chat.tool.create_folders": "Create folders",
    "chat.tool.move_folder_items": "Move within the folder",
    "chat.tool.write_folder_file": "Create a file in the folder",
    "chat.tool.search_mail": "Search your mail",
    "chat.tool.read_mail": "Read an email",
    "chat.tool.import_mail": "Import an email",

    // Context (RAG) chip
    "chat.memoriesOne": "1 memory",
    "chat.memoriesOther": "{count} memories",
    "chat.docSnippetsOne": "1 doc snippet",
    "chat.docSnippetsOther": "{count} doc snippets",
    "chat.contextUsed": "Context used · {parts}",
    "chat.contextNoneMatched": "No matching memory used",

    // Attachment chip (on the sent message bubble)
    "chat.attachmentUnprotected": "unprotected",
    "chat.itemsRemovedOne": "1 removed",
    "chat.itemsRemovedOther": "{count} removed",
    // Tool-result redactions: the inline count on the "⚙ …" marker, and the
    // expandable footer under the answer (ToolRedactionFooter in ScreenChat).
    "chat.toolRedactedInline": "{count} redacted",
    "chat.toolSourcesOne": "1 tool result",
    "chat.toolSourcesOther": "{count} tool results",
    "chat.toolRedactedSummary": "{items} from {sources}",
    "chat.attachmentClean": "clean",
    "chat.attachmentSentUnfiltered":
      "Sent without filtering — the document text left your device as-is.",
    "chat.attachmentNoPersonalData": "No personal data was detected in this document.",
    "chat.attachmentReplacedHeader": "Replaced with placeholders before sending:",

    // Assistant bubble
    "chat.connectionLost": "Connection lost — response incomplete.",

    // RedactionDetail (EntitySidebar.tsx)
    "chat.showAnonymized": "Show anonymized",
    "chat.showOriginal": "Show original",
    "chat.fallbackNoticeBase": "Local detection active (names + patterns)",
    "chat.fallbackNoticeDetailSuffix":
      ". AI enrichment was skipped, so context-dependent items may be missed.",
    "chat.fallbackNoticeLowCase":
      " Your message is all lower-case, so names were not auto-detected — capitalize names " +
      "or add them under “Always redact” in Settings.",
    "chat.nothingPersonalDetected": "Nothing personal detected.",
    "chat.resendWithoutFilter": "Resend without filter",
    "chat.resendWithoutFilterExplain": "Sends your original text — nothing will be redacted.",
    "chat.sendUnprotected": "Send unprotected",

    // ReviewPanel.tsx
    "chat.reviewHeader": "Review before sending to {model}",
    "chat.neverRedactAction": "don’t redact again",
    "chat.neverRedactDone": "released for future messages ✓",
    "chat.neverRedactHint":
      "This message is already sent as shown — from now on this exact value will no longer be redacted. Manage the list in Settings.",
    "chat.reviewTapToRelease": "click to de-anonymize",
    "chat.reviewTapToRedact": "click to redact",
    "chat.reviewListHint": "Click a row to de-anonymize it — click again to redact it again.",
    "chat.reviewCountRedactedOne": "1 redacted",
    "chat.reviewCountRedactedOther": "{count} redacted",
    "chat.fallbackNoticeReviewSuffix":
      ". AI enrichment was skipped — review carefully for any context-dependent items it " +
      "might have missed.",
    "chat.sentToProviderInstruction":
      "Sent to provider — select any missed text below, then “Redact selection”:",
    "chat.redactSelection": "Redact selection",
    "chat.redactHintEmpty": "Nothing was selected — select the text first, then click here.",
    "chat.redactHintPlaceholder":
      "The selection touches a placeholder — that part is already being redacted. Select only real text.",
    "chat.redactHintNotFound":
      "The selected text is not part of what would be sent here — select text inside this preview.",
    "chat.redactHintNeverRedact":
      "This text is on your never-redact list — remove it there first, or it would contradict itself.",
    "chat.redactHintInsideWord":
      "This text only occurs inside longer words here — redacting it would catch nothing. Select text that appears on its own.",
    // Generated images (#79)
    "chat.imageModelBadge": "Image",
    "chat.generatedImageAlt": "Image generated by the model",
    "chat.downloadImage": "Download image",
    "chat.imageLoading": "Loading image…",
    "chat.imageUnavailable":
      "This image is only on the device that generated it — it hasn't been synced yet.",
    "chat.alwaysRedactSelection": "Always redact",
    // Staged-attachment preview (#72): a fresh upload has no document to save
    // the term ON, so the button promises exactly what it delivers — this send.
    "chat.redactForSendSelection": "Redact in this message",
    "chat.redactForSendConfirmOne": "“{value}” will be redacted in this message — 1 place.",
    "chat.redactForSendConfirmOther":
      "“{value}” will be redacted in this message — {count} places.",
    "chat.previewAttachment": "Check & redact",
    "chat.previewAttachmentTitle":
      "Open the attachment to check what the filter finds and redact by hand",
    // Document-scoped, and the copy says so: the term is saved ON the document
    // and enforced whenever THIS document is sent — not a global rule.
    "chat.alwaysRedactConfirmOne":
      "“{value}” is saved on this document — 1 place, redacted every time this document is sent.",
    "chat.alwaysRedactConfirmOther":
      "“{value}” is saved on this document — {count} places, redacted every time this document is sent.",
    "chat.redactedLabel": "Redacted",
    "chat.sendingRealLabel": "Sending real",
    "chat.manualLabel": "Manual",
    "chat.showDocContentLabel": "Show document content to redact manually",
    "chat.showContextContentLabel": "Show context to redact manually",
    "chat.selectMissedTextInstruction": "Select any missed text below, then “Redact selection”:",
    "chat.noPersonalDataInDoc": "No personal data detected in this document.",
    "chat.noPersonalDataInContext": "No personal data detected in the retrieved context.",
    "chat.memoryDocumentsContext": "Memory & Documents context",
    "chat.fromSourcesOne": "(from 1 source)",
    "chat.fromSourcesOther": "(from {count} sources)",
    "chat.editMessage": "Edit message",
    "chat.sendTo": "Send to {model}",
  },
  de: {
    "chat.entity.person": "Person",
    "chat.entity.email": "E-Mail",
    "chat.entity.phone": "Telefon",
    "chat.entity.iban": "IBAN",
    "chat.entity.routing": "Bankleitzahl",
    "chat.entity.amount": "Betrag",
    "chat.entity.date": "Datum",
    "chat.entity.pin": "PIN / Geheimnis",
    "chat.entity.internalUrl": "Interne URL",
    "chat.entity.credential": "Zugangsdaten",
    "chat.entity.taxId": "Steuer-ID",
    "chat.entity.insuranceId": "Versicherungs-ID",
    "chat.entity.address": "Adresse",
    "chat.webLabel": "Web",
    "chat.artifact.badge": "{type}-Artefakt",
    "chat.artifact.save": "In Dokumente ablegen",
    "chat.artifact.saved": "In Dokumenten abgelegt",
    "chat.artifact.expand": "Ausklappen",
    "chat.artifact.collapse": "Einklappen",
    "chat.webOnTitle":
      "Websuche an — das Modell sucht bei Bedarf im Live-Web. Verwendet wird nur dein gefilterter (geschwärzter) Text. Ausschalten für rein Offline-Antworten.",
    "chat.webOffTitle": "Websuche aus — das Modell antwortet nur aus seinem Trainingswissen.",
    "chat.entity.custom": "Immer schwärzen",
    "chat.entity.manual": "Manuell",
    "chat.entity.redacted": "Geschwärzt",
    "chat.skip.timeout": "die KI-Verarbeitung hat das Zeitlimit überschritten",
    "chat.skip.unreachable": "der KI-Dienst war nicht erreichbar",
    "chat.skip.auth": "der KI-Schlüssel wurde abgelehnt",
    "chat.skip.rateLimit": "der KI-Dienst wurde gedrosselt",
    "chat.skip.budget": "das KI-Nutzungslimit wurde erreicht",
    "chat.skip.providerError": "der KI-Dienst hat einen Fehler zurückgegeben",
    "chat.skip.parse": "die KI-Antwort konnte nicht gelesen werden",
    "chat.skip.unconfigured": "es ist kein KI-Schlüssel konfiguriert",
    "chat.skip.disabled": "die KI-Anreicherung ist ausgeschaltet",
    "chat.introMessage":
      "Hallo! Ich bin dein privates KI-Gateway. Schreib einfach los — QUON entfernt " +
      "persönliche Daten direkt auf deinem Gerät, bevor sie überhaupt bei einem " +
      "Modellanbieter ankommen. Unter jeder Nachricht siehst du genau, was geschwärzt wurde.",
    "chat.onboardingIntroMessage":
      "Probier's aus: Schreib unten deinen Namen und deine E-Mail-Adresse — ich zeig dir " +
      "genau, was dein Gerät verlässt.",
    "chat.onboardingPlaceholder":
      "z. B. Hallo, ich bin Anna Müller, erreichbar unter anna@mail.com",
    "chat.placeholder": "Frag alles — deine Daten bleiben privat",

    "chat.loadingScrubbing": "Entferne deine persönlichen Daten…",
    "chat.loadingScrubbingAttachment": "Schützt {name} — entfernt deine persönlichen Daten…",
    "chat.loadingScrubbingElapsed": "seit {time}",
    "chat.openOriginalToRedact": "Original ansehen & schwärzen",
    "chat.loadingScrubbingRetry":
      "Ein Abschnitt antwortet nicht — neuer Versuch ({attempt} von {attempts}). Du kannst abbrechen und weniger auf einmal senden.",
    "chat.loadingScrubbingSlow":
      "Das dauert länger als üblich. Möglicherweise antwortet ein Abschnitt nicht — du kannst jederzeit abbrechen.",
    "chat.loadingScrubbingCount": "{done} von {total} Teilen",
    "chat.loadingSearching": "Durchsuche deine Erinnerungen…",
    "chat.loadingGenerating": "Antwort wird erstellt…",
    "chat.thinkingLabel": "Denkt nach",
    "chat.thoughtLabel": "Gedankengang",
    "chat.answeredBy": "Beantwortet von {model}",
    "chat.sources": "Quellen ({count})",
    "chat.artifact.dismiss": "Verwerfen",

    "chat.reasoningOff": "Aus",
    "chat.reasoningOffHint": "Anbieter-Standard — kein festes Reasoning-Budget",
    "chat.reasoningLow": "Niedrig",
    "chat.reasoningLowHint": "Schnell, wenig Reasoning",
    "chat.reasoningMedium": "Mittel",
    "chat.reasoningMediumHint": "Ausgewogenes Reasoning",
    "chat.reasoningHigh": "Hoch",
    "chat.reasoningHighHint": "Tiefes Reasoning (langsamer, mehr Tokens)",
    "chat.reasoningEffortHeading": "Reasoning",
    "chat.reasoningEffortTitle": "Reasoning: {level}",
    "chat.reasoningEffortTitleThisChat": "Reasoning: {level} (dieser Chat)",
    "chat.moreChatOptionsAria": "Weitere Chat-Optionen",
    "chat.reasoningInfoHint":
      "Reasoning lässt fähige Modelle vor der Antwort erst „nachdenken“ — oft besser bei " +
      "schwierigen Fragen, aber langsamer und teurer: Das Nachdenken selbst wird als " +
      "Tokens abgerechnet. „Aus“ nutzt den Standard des Anbieters. Modelle ohne " +
      "Reasoning-Unterstützung ignorieren diese Einstellung komplett.",

    "chat.budgetHint":
      "Dein inkludiertes KI-Budget ist zu ~{pct}% aufgebraucht — hinterleg deinen eigenen " +
      "OpenRouter-Schlüssel in den Einstellungen und chatte ohne Limit weiter.",

    "chat.errorNoReadableText": "In dieser Datei wurde kein lesbarer Text gefunden.",
    "chat.errorCouldntReadFile": "Diese Datei konnte nicht gelesen werden.",
    "chat.errorNoReadableTextInDoc": "Dieses Dokument enthält keinen lesbaren Text.",
    "chat.errorNoReadableDocs": "Keine lesbaren Dokumente zum Anhängen.",
    "chat.errorAttachmentScrubFailed":
      "Persönliche Daten im Anhang ließen sich nicht entfernen — es wurde nichts gesendet. " +
      "Versuch es noch mal.",

    "chat.scrubberOffline": "Scrubber offline — Senden pausiert",
    "chat.reducedDetectionActive":
      "Lokale Erkennung aktiv (Namen + Muster) — LLM-Anreicherung offline",

    "chat.filterOnTitle": "Filter für persönliche Daten ist an",
    "chat.filterOffTitle": "Filter aus — Daten werden ungeschützt gesendet",
    "chat.filterOnLabel": "Filter",
    "chat.filterOffLabel": "Filter aus",
    "chat.reviewLabel": "Review",
    "chat.reviewOnTitle": "Review vor dem Senden: an",
    "chat.reviewOffTitle": "Review vor dem Senden: aus",
    "chat.contextLabel": "Kontext",
    "chat.contextOnTitle": "Gespeicherte Erinnerungen als Kontext nutzen: an",
    "chat.contextOffTitle": "Gespeicherte Erinnerungen als Kontext nutzen: aus",
    "chat.contextInfoHint":
      "Wenn aktiv, holt QUON automatisch passende Einträge aus deiner verschlüsselten " +
      "Erinnerung und deinen Dokumenten in die Anfrage — geschwärzt wie alles andere vor " +
      "dem Senden. Das kostet etwas zusätzliche Zeit beim Schwärzen. Nach dem Senden zeigt " +
      "der Hinweis „Kontext genutzt“ unter deiner Nachricht genau, was verwendet wurde — " +
      "oder dass nichts gepasst hat.",

    "chat.attachDocumentAria": "Dokument anhängen",
    "chat.uploadFromDevice": "Vom Gerät hochladen",
    "chat.takeAPhoto": "Foto aufnehmen",
    "chat.dictationTitle": "Diktieren — so geht's auf deinem Gerät",
    "chat.dictationHintIos":
      "Diktieren läuft über deine Tastatur: Tipp ins Textfeld und dann auf die Mikrofon-Taste unten rechts auf der Tastatur. Das passiert auf deinem iPhone — QUON bekommt nur den fertigen Text.",
    "chat.dictationHintAndroid":
      "Diktieren läuft über deine Tastatur: Tipp ins Textfeld und dann auf die Mikrofon-Taste deiner Tastatur (bei Gboard oben rechts). QUON bekommt nur den fertigen Text.",
    "chat.dictationHintMacos":
      "Diktieren läuft über macOS: Schalt es einmalig unter Systemeinstellungen → Tastatur → Diktat ein und starte es dann mit der Diktat-Taste (F5) oder indem du zweimal ⌃ Control drückst. QUON bekommt nur den fertigen Text.",
    "chat.dictationHintWindows":
      "Diktieren läuft über Windows: Klick ins Textfeld und drück die Windows-Taste + H. QUON bekommt nur den fertigen Text.",
    "chat.dictationHintOther":
      "Nutz die Diktierfunktion deines Systems oder deiner Tastatur — QUON bekommt nur den fertigen Text.",
    "chat.scanFromGallery": "Aus Galerie scannen",
    "chat.chooseFromDocuments": "Aus Dokumenten wählen",
    "chat.fromPaperless": "Aus Paperless…",
    "chat.attachmentFromPaperless": "aus Paperless · nicht in QUON gespeichert",
    "chat.attachmentFromPaperlessTooltip":
      "Live aus deinem Paperless-Archiv geladen, nur für diese eine Nachricht — QUON behält keine Kopie des Dokuments.",
    "chat.attachAllDocuments": "Alle Dokumente anhängen ({count})",
    "chat.removeAttachmentAria": "Anhang entfernen",
    "chat.reading": "Wird gelesen…",
    "chat.truncatedBadge": "(gekürzt)",
    "chat.mermaidShowSource": "Quelltext",
    "chat.mermaidShowDiagram": "Diagramm",
    "chat.mermaidBroken":
      "Dieses Diagramm konnte nicht gezeichnet werden — hier ist der Quelltext.",
    "chat.shortenedToFitBadge": "(passend gekürzt)",
    "chat.attachmentTruncatedTooltip":
      "Nur die ersten {n} Zeichen gingen an das Modell — der Rest wurde abgeschnitten.",
    "chat.attachmentTruncatedCombinedTooltip":
      "Zusammen überschreiten die Dateien das Sende-Budget von {n} Zeichen. Kurze Dateien " +
      "bleiben vollständig; die längsten wurden gleichmäßig gekürzt, sodass jedes " +
      "Dokument weiterhin dabei ist.",
    "chat.allDocumentsCombined": "Alle Dokumente ({count} Dateien)",
    "chat.selectedDocumentsCombined": "{count} Dokumente",

    "chat.stopGeneratingAria": "Generierung stoppen",
    "chat.stopAndEditTitle": "Stoppen und Nachricht bearbeiten",
    "chat.sendAria": "Senden",

    "chat.removedBeforeSending": "vor dem Senden entfernt",
    "chat.anonymizedTooltip": "anonymisiert",

    "chat.sentWithoutFilter": "Ohne Filter gesendet",
    "chat.sentUnprotected": "Ungeschützt gesendet",
    "chat.noPersonalDataFound": "Keine persönlichen Daten gefunden",
    "chat.noPersonalDataFoundDegraded":
      "Keine persönlichen Daten gefunden · eingeschränkte Erkennung",
    "chat.itemsRedactedOne": "1 Angabe geschwärzt",
    "chat.itemsRedactedOther": "{count} Angaben geschwärzt",
    "chat.itemsRedactedDegraded": "{items} · eingeschränkte Erkennung",
    "chat.noResponse": "(keine Antwort)",
    "chat.toolConsentTitle": "Diesen Tool-Aufruf erlauben?",
    "chat.toolConsentIntro":
      "Das Modell möchte eines deiner Werkzeuge nutzen. Ohne dein OK läuft nichts — prüfe unten die Argumente (mit echten Werten, genau so würden sie dein Werkzeug erreichen).",
    "chat.toolConsentAlways": "Diese Werkzeuge immer erlauben (dieses Gerät)",
    "chat.toolConsentWriteBadge": "schreibt",
    "chat.toolConsentUntrusted":
      "Diese Aktion folgt auf Inhalte aus einem externen Werkzeug in diesem Zug — prüfe genau, ob sie stimmt.",
    "chat.toolConsentPrivacy":
      "Tool-Ergebnisse werden wie deine eigenen Nachrichten gefiltert, bevor etwas zurück an den Modell-Anbieter geht.",
    "chat.toolConsentAllow": "Erlauben",
    "chat.toolConsentDeny": "Ablehnen",
    "chat.tool.create_agent": "Such-Agent anlegen",
    "chat.tool.import_dropbox_document": "Dokument aus Dropbox importieren",
    "chat.tool.search_dropbox": "Dropbox durchsuchen",
    "chat.tool.search_documents": "Deine Dokumente durchsuchen",
    "chat.tool.save_memory": "Erinnerung speichern",
    "chat.tool.save_document": "Dokument speichern",
    "chat.tool.search_paperless": "Paperless durchsuchen",
    "chat.tool.read_paperless_document": "Paperless-Dokument lesen",
    "chat.tool.import_paperless_document": "Dokument aus Paperless importieren",
    "chat.tool.read_url": "Webseite lesen",
    "chat.tool.pick_folder": "Ordner auswählen",
    "chat.tool.list_folder_files": "Ordnerinhalt ansehen",
    "chat.tool.read_folder_file": "Datei aus dem Ordner lesen",
    "chat.tool.import_folder_file": "Datei aus dem Ordner importieren",
    "chat.tool.create_folders": "Ordner anlegen",
    "chat.tool.move_folder_items": "Im Ordner verschieben",
    "chat.tool.write_folder_file": "Datei im Ordner anlegen",
    "chat.tool.search_mail": "E-Mails durchsuchen",
    "chat.tool.read_mail": "E-Mail lesen",
    "chat.tool.import_mail": "E-Mail importieren",

    "chat.memoriesOne": "1 Erinnerung",
    "chat.memoriesOther": "{count} Erinnerungen",
    "chat.docSnippetsOne": "1 Dokumentauszug",
    "chat.docSnippetsOther": "{count} Dokumentauszüge",
    "chat.contextUsed": "Kontext genutzt · {parts}",
    "chat.contextNoneMatched": "Keine passende Erinnerung genutzt",

    "chat.attachmentUnprotected": "ungeschützt",
    "chat.itemsRemovedOne": "1 entfernt",
    "chat.itemsRemovedOther": "{count} entfernt",
    "chat.toolRedactedInline": "{count} geschwärzt",
    "chat.toolSourcesOne": "1 Werkzeug-Ergebnis",
    "chat.toolSourcesOther": "{count} Werkzeug-Ergebnissen",
    "chat.toolRedactedSummary": "{items} aus {sources}",
    "chat.attachmentClean": "sauber",
    "chat.attachmentSentUnfiltered":
      "Ohne Filterung gesendet — der Dokumenttext hat dein Gerät unverändert verlassen.",
    "chat.attachmentNoPersonalData": "In diesem Dokument wurden keine persönlichen Daten gefunden.",
    "chat.attachmentReplacedHeader": "Vor dem Senden durch Platzhalter ersetzt:",

    "chat.connectionLost": "Verbindung verloren — Antwort unvollständig.",

    "chat.showAnonymized": "Anonymisiert anzeigen",
    "chat.showOriginal": "Original anzeigen",
    "chat.fallbackNoticeBase": "Lokale Erkennung aktiv (Namen + Muster)",
    "chat.fallbackNoticeDetailSuffix":
      ". Die KI-Anreicherung wurde übersprungen, daher können kontextabhängige Angaben " +
      "übersehen worden sein.",
    "chat.fallbackNoticeLowCase":
      " Deine Nachricht ist komplett kleingeschrieben, daher wurden Namen nicht automatisch " +
      "erkannt — schreib Namen groß oder trag sie unter „Immer schwärzen“ in den " +
      "Einstellungen ein.",
    "chat.nothingPersonalDetected": "Nichts Persönliches erkannt.",
    "chat.resendWithoutFilter": "Ohne Filter erneut senden",
    "chat.resendWithoutFilterExplain": "Sendet deinen Originaltext — es wird nichts geschwärzt.",
    "chat.sendUnprotected": "Ungeschützt senden",

    "chat.reviewHeader": "Vor dem Senden an {model} prüfen",
    "chat.neverRedactAction": "nicht mehr schwärzen",
    "chat.neverRedactDone": "für künftige Nachrichten freigegeben ✓",
    "chat.neverRedactHint":
      "Diese Nachricht wurde bereits so gesendet. Ab jetzt wird dieser Wert nicht mehr geschwärzt — die Liste findest du in den Einstellungen.",
    "chat.reviewTapToRelease": "klicken zum De-anonymisieren",
    "chat.reviewTapToRedact": "klicken zum Schwärzen",
    "chat.reviewListHint":
      "Klicke in eine Zeile, um sie zu de-anonymisieren — oder erneut, um sie wieder zu schwärzen.",
    "chat.reviewCountRedactedOne": "1 geschwärzt",
    "chat.reviewCountRedactedOther": "{count} geschwärzt",
    "chat.fallbackNoticeReviewSuffix":
      ". Die KI-Anreicherung wurde übersprungen — prüfe sorgfältig auf kontextabhängige " +
      "Angaben, die übersehen worden sein könnten.",
    "chat.sentToProviderInstruction":
      "An den Anbieter gesendet — markier unten übersehenen Text und klick dann auf " +
      "„Auswahl schwärzen“:",
    "chat.redactSelection": "Auswahl schwärzen",
    "chat.redactHintEmpty": "Nichts markiert — markiere zuerst den Text und klick dann hier.",
    "chat.redactHintPlaceholder":
      "Die Markierung berührt einen Platzhalter — der Teil wird schon geschwärzt. Markiere nur echten Text.",
    "chat.redactHintNotFound":
      "Der markierte Text gehört nicht zu dem, was hier gesendet würde — markiere Text in dieser Vorschau.",
    "chat.redactHintNeverRedact":
      "Dieser Text steht auf deiner Nie-schwärzen-Liste — entferne ihn dort zuerst, sonst würde sich das widersprechen.",
    "chat.redactHintInsideWord":
      "Der Text kommt hier nur innerhalb längerer Wörter vor — das würde nichts schwärzen. Markiere Text, der für sich allein vorkommt.",
    "chat.imageModelBadge": "Bild",
    "chat.generatedImageAlt": "Vom Modell erzeugtes Bild",
    "chat.downloadImage": "Bild herunterladen",
    "chat.imageLoading": "Bild wird geladen…",
    "chat.imageUnavailable":
      "Dieses Bild liegt nur auf dem Gerät, das es erzeugt hat — es wurde noch nicht synchronisiert.",
    "chat.alwaysRedactSelection": "Immer schwärzen",
    "chat.redactForSendSelection": "In dieser Nachricht schwärzen",
    "chat.redactForSendConfirmOne": "»{value}« wird in dieser Nachricht geschwärzt — 1 Stelle.",
    "chat.redactForSendConfirmOther":
      "»{value}« wird in dieser Nachricht geschwärzt — {count} Stellen.",
    "chat.previewAttachment": "Prüfen & schwärzen",
    "chat.previewAttachmentTitle":
      "Anhang öffnen: sehen, was der Filter findet, und von Hand schwärzen",
    "chat.alwaysRedactConfirmOne":
      "»{value}« ist in diesem Dokument gespeichert — 1 Stelle, geschwärzt bei jedem Senden dieses Dokuments.",
    "chat.alwaysRedactConfirmOther":
      "»{value}« ist in diesem Dokument gespeichert — {count} Stellen, geschwärzt bei jedem Senden dieses Dokuments.",
    "chat.redactedLabel": "Geschwärzt",
    "chat.sendingRealLabel": "Ungeschwärzt",
    "chat.manualLabel": "Manuell",
    "chat.showDocContentLabel": "Dokumentinhalt zum manuellen Schwärzen anzeigen",
    "chat.showContextContentLabel": "Kontext zum manuellen Schwärzen anzeigen",
    "chat.selectMissedTextInstruction":
      "Markier unten übersehenen Text und klick dann auf „Auswahl schwärzen“:",
    "chat.noPersonalDataInDoc": "Keine persönlichen Daten in diesem Dokument gefunden.",
    "chat.noPersonalDataInContext": "Keine persönlichen Daten im abgerufenen Kontext gefunden.",
    "chat.memoryDocumentsContext": "Kontext aus Erinnerungen & Dokumenten",
    "chat.fromSourcesOne": "(aus 1 Quelle)",
    "chat.fromSourcesOther": "(aus {count} Quellen)",
    "chat.editMessage": "Nachricht bearbeiten",
    "chat.sendTo": "An {model} senden",
  },
} as const;
