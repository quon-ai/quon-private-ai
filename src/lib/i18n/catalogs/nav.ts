/**
 * "nav" namespace UI strings. Keys are prefixed `nav.*`. Keep `en` and `de`
 * in sync - a missing German key is a compile error via catalog.ts's typing.
 *
 * Covers: AppSidebar, AppShell (chrome around the routed screens), the
 * BottomTabBar, StatusIndicator (the "QUON Active/Offline" pill) and the
 * ReleaseNotesModal chrome (the release CONTENT itself lives in
 * src/lib/releases.ts, outside this namespace). Also the Dashboard screen's
 * own copy (CTA, protection row, private-data cluster, recent chats).
 */
export const nav = {
  en: {
    // Primary nav items (sidebar + bottom tab bar + AppShell page titles)
    "nav.dashboard": "Dashboard",
    "nav.chat": "Chat",
    "nav.memory": "Memory",
    "nav.documents": "Documents",
    "nav.projects": "Projects",
    "nav.settings": "Settings",
    "nav.connectors": "Connectors",
    "nav.agents": "Agents",
    "nav.signOut": "Sign out",
    "nav.comingSoon": "Coming soon",
    "nav.comingSoonTooltip": "{title} — coming soon",
    "nav.soon": "Soon",
    "nav.protected": "Protected",

    // AppSidebar - search
    "nav.searchChats": "Search chats",
    "nav.clearSearch": "Clear search",
    "nav.results": "Results",
    "nav.noMatches": "No matches.",

    // AppSidebar - chat rows / menu
    "nav.chatOptions": "Chat options",
    "nav.rename": "Rename",
    "nav.pin": "Pin",
    "nav.unpin": "Unpin",
    "nav.moveToProject": "Move to project",
    "nav.noProjectsYet": "No projects yet",
    "nav.removeFromProject": "Remove from project",
    "nav.newChatInProject": "New chat in {name}",
    "nav.expandProject": "Show chats in {name}",
    "nav.collapseProject": "Hide chats in {name}",
    "nav.noChatsYet": "No chats yet.",
    "nav.recents": "Recents",
    "nav.newChat": "New chat",
    "nav.noRecentChatsYet": "No recent chats yet.",
    "nav.deleteChatTitle": "Delete this chat?",
    "nav.deleteChatDesc":
      "“{title}” will be permanently removed from all your devices. This can’t be undone.",
    "nav.thisChat": "This chat",

    // AppShell
    "nav.openMenu": "Open menu",
    "nav.cantReachTitle": "Can’t reach QUON",
    "nav.cantReachBody":
      "The service isn’t responding. Your session and data are untouched — this is just a connection problem.",

    // StatusIndicator
    "nav.statusActive": "QUON Active",
    "nav.statusFallback": "QUON Fallback",
    "nav.statusOffline": "QUON Offline",
    "nav.statusLoading": "QUON …",
    "nav.statusActiveDetail":
      "Protecting your data — personal info is removed before anything is sent to a provider.",
    "nav.statusFallbackDetail":
      "Local detection active — names and patterns (emails, phones, IBANs, amounts) are removed via on-device NER. LLM enrichment is offline, so some context-dependent items may be missed.",
    "nav.statusOfflineDetail":
      "Scrubber unreachable — sending is paused so nothing leaves your device unprotected. Start quon-scrubber-service to re-enable.",
    "nav.statusLoadingDetail": "Checking protection status…",
    "nav.statusVersion": "v{version}",

    // ReleaseNotesModal (chrome only - release content stays in releases.ts)
    "nav.releaseAriaLabel": "What's new — {title}",
    "nav.releaseWhatsNew": "What's new · {date}",

    // ScreenDashboard - primary CTA
    "nav.startChat": "Start Chat",
    "nav.askPlaceholder": "Ask something — it stays private",
    "nav.askSend": "Send and open the chat",
    "nav.continueChat": "or continue “{title}” →",
    "nav.firstChatHint":
      "Your first private chat — personal data is filtered on your device before anything is sent.",

    // ScreenDashboard - biometric offer card
    "nav.bioOfferTitle": "Unlock faster next time",
    "nav.bioOfferBody":
      "Turn on Face ID, Touch ID, or your fingerprint to unlock QUON on this device instead of typing your password. The key stays in your device's secure hardware — it never reaches our servers.",
    "nav.bioEnabledNotice":
      "Biometric unlock is on for this device — next time you'll unlock with Face ID or your fingerprint.",
    "nav.bioPrfUnavailable":
      "This browser can't protect the unlock key the way QUON needs, so biometric unlock isn't available here. You can remove the unused QUON passkey in your device's password settings.",
    "nav.bioGenericError":
      "Couldn't enable biometric unlock. You can try later from Settings → Account.",
    "nav.bioSettingUp": "Setting up…",
    "nav.bioRepairTitle": "Your passkey seems to be gone",
    "nav.bioRepairBody":
      "The last biometric unlocks on this device failed. On some devices a system update removes the passkey. Create a new one now — it takes one confirmation. Your data is unaffected.",
    "nav.bioRepairAction": "Create a new passkey",
    "nav.bioRepairedNotice": "Done — the new passkey unlocks QUON on this device.",
    "nav.offlineBanner":
      "Offline — your saved data is readable. Sending and sync resume automatically.",
    // Sync status. Only shown for a push big enough to be felt - a routine
    // one-item push finishes before a banner could inform anyone.
    // No fraction: a single-batch push can't advance one, and "(0/29)" told the
    // user nothing about what was syncing. Name the thing and the amount.
    "nav.syncBusy": "Backing up {count} entries — encrypted, in the background",
    "nav.syncBusyProgress": "Backing up your encrypted data… ({done}/{total} entries)",
    "nav.syncBlockedOne":
      "1 entry is too large to sync. It stays on this device, but won't reach your other devices.",
    "nav.syncBlockedMany":
      "{count} entries are too large to sync. They stay on this device, but won't reach your other devices.",
    "nav.notNow": "Not now",
    "nav.dismiss": "Dismiss",

    // ScreenDashboard - protection row
    "nav.protectionLevelLabel": "Protection Level",
    "nav.change": "Change",
    "nav.protectionOff": "Protection is off — messages are sent exactly as written.",
    "nav.nothingFilteredYet": "Nothing filtered yet — send a message to see it work.",
    "nav.itemsKeptPrivateOne": "1 personal item kept private so far.",
    "nav.itemsKeptPrivateOther": "{count} personal items kept private so far.",

    // ScreenDashboard - private data cluster
    "nav.yourPrivateData": "Your private data",
    "nav.endToEndEncrypted": "End-to-end encrypted",
    "nav.memoryCountLabelOne": "Memory",
    "nav.memoryCountLabelOther": "Memories",
    "nav.documentCountLabelOne": "Document",
    "nav.documentCountLabelOther": "Documents",
    "nav.projectCountLabelOne": "Project",
    "nav.projectCountLabelOther": "Projects",
    "nav.privateDataEmpty":
      "Nothing saved yet — add memories or upload documents and QUON can use them as private context in chats.",

    // ScreenDashboard - recent chats
    "nav.recentChats": "Recent chats",

    // ScreenDashboard - daily briefing card ("on-open" agentic v1)
    "briefing.title": "Welcome back",
    "briefing.since": "New since your last visit: {parts}",
    "briefing.dismiss": "Dismiss briefing",
    "briefing.memOne": "{count} memory",
    "briefing.memOther": "{count} memories",
    "briefing.docOne": "{count} document",
    "briefing.docOther": "{count} documents",
    "briefing.upcoming": "Upcoming",

    // Agents - two kinds, one screen: a server-run web watch (Option C) and a
    // client-run "device agent" over the user's own Memory/Documents (Phase 2).
    // Long explanations live behind InfoHint (tap/hover), not always-on text -
    // see agents.*.infoAria and the *Hint/*Subtitle/*Note keys below.
    "agents.title": "Agents",
    "agents.subtitle":
      "Automated agents for web searches or your own documents — results stay end-to-end encrypted for you.",
    "agents.infoAria": "More info",

    // "+ New agent" disclosure (kind picker + the two field sets)
    "agents.newAgent": "New agent",
    "agents.kindPickerLabel": "Agent type",
    "agents.kindWeb": "Web search",
    "agents.kindWebDesc": "Watches the web on a schedule and reports what's new.",
    "agents.kindDevice": "My documents",
    "agents.kindDeviceDesc": "Asks your own notes & documents — the server can't read them.",
    "agents.namePlaceholder": "Name (optional), e.g. Plots Oberhavel",
    "agents.queryPlaceholder": "What to watch for, e.g. plots in Oberhavel up to €50,000",
    "agents.promptPlaceholder": "What should it do? e.g. Summarize what's new across my documents",
    "agents.dailyAt": "Daily at",
    "agents.timeOptional": "(optional)",
    "agents.create": "Create agent",
    "agents.createDevice": "Create device agent",
    "agents.error": "Couldn't save the agent — please try again.",
    // Behind the InfoHint next to the kind picker (item 4/1/3 of the redesign):
    "agents.privacyNote":
      "QUON's server runs the search daily and sees your search terms (like any web search here), but never the results — those are sealed to your key and decrypted only on your devices.",
    "agents.deviceSubtitle":
      "Agents that read your own notes & documents — which the server can't. They run only while QUON is open and unlocked, on a device you mark as a runner below.",
    "agents.privacyNoteDevice":
      "The prompt, your documents and the result never leave your device in the clear — only the same scrubbed text a chat would send reaches the model.",
    "agents.costNote": "Runs use your own API budget, like a chat message.",

    // Agent list (one card per agent, collapsed by default - like Connectors)
    "agents.emptyAll": "No agents yet. Create one above.",
    "agents.badgeServer": "Server",
    "agents.badgeDevice": "Device",
    "agents.newDeviceAgent": "New device agent",
    "agents.projectEmpty": "No agents in this project yet.",
    "agents.projectAgentsHint":
      "A device agent for this project: it reads THIS project's memory & documents (which the server can't) and answers on a schedule or on demand. It runs only while QUON is open and unlocked on a device you enable as a runner in the Agents screen.",
    "agents.runmodeServer": "runs on the server",
    "agents.runmodeDevice": "runs on your device · we can't read it",
    "agents.runNow": "Run now",
    "agents.pause": "Pause",
    "agents.resume": "Resume",
    "agents.resultsCount": "{count} result(s)",
    "agents.noNewResults": "No new results yet.",
    "agents.pending": "Waiting for the first run…",
    "agents.noRuns": "Not run yet.",
    "agents.runResult": "Result",
    "agents.running": "Running…",
    "agents.runError": "Run failed",
    "agents.device.waitingNoRunner": "Waiting for a ready device…",
    "agents.device.queued": "Queued…",

    // "Device for your agents" - the reworked runner card (was a bare checkbox)
    "agents.runner.title": "Device for your agents",
    "agents.runner.toggle": "Use this device",
    "agents.runner.statusThis": "✓ This device is ready",
    "agents.runner.statusOtherOne": "1 other device is ready",
    "agents.runner.statusOtherOther": "{count} other devices are ready",
    "agents.runner.statusNone": "No device ready — device agents are waiting",
    // Behind the InfoHint on the runner card title - the deep "why":
    "agents.runnerHint":
      "Device agents can't run on QUON's server — they read your own notes and documents, so nothing about them may leave your device unfiltered. Turning this on lets THIS device run them in the background, but only while QUON is open and unlocked here. Turn it on on any device you want your agents to run on — your phone, your laptop, or both.",

    // Beta feedback dialog (opened from the sidebar footer)
    "feedback.navLabel": "Feedback",
    "feedback.title": "Send feedback",
    "feedback.subtitle": "QUON is in beta — tell us what's broken or what you'd love to see.",
    "feedback.catBug": "Bug",
    "feedback.catIdea": "Idea",
    "feedback.catOther": "Other",
    "feedback.placeholder": "What happened, or what would you like?",
    "feedback.addShot": "Add a screenshot",
    "feedback.removeShot": "Remove screenshot",
    "feedback.shotNotImage": "Please choose an image file.",
    "feedback.shotTooBig": "That image is too large (max 6 MB).",
    "feedback.contactBack": "I'd like a reply by email",
    "feedback.attachDiag": "Attach technical log (errors on this device)",
    "feedback.diagPreview": "Show exactly what would be sent",
    "feedback.noDiag":
      "No technical log recorded on this device — if errors or crashes occur, an attachable log appears here automatically.",
    "feedback.privacyNote":
      "Unlike your chats, feedback isn't end-to-end encrypted — your message and any screenshot go to the QUON team so we can act on it. Your message is also filed as a ticket in our private issue tracker (GitHub) so it doesn't get lost; your email address is not.",
    "feedback.send": "Send feedback",
    "feedback.thanks": "Thanks! Your feedback is on its way. 🙌",
    "feedback.error": "Couldn't send feedback right now — please try again.",
  },
  de: {
    "nav.dashboard": "Dashboard",
    "nav.chat": "Chat",
    "nav.memory": "Erinnerungen",
    "nav.documents": "Dokumente",
    "nav.projects": "Projekte",
    "nav.settings": "Einstellungen",
    "nav.connectors": "Connectors",
    "nav.agents": "Agenten",
    "nav.signOut": "Abmelden",
    "nav.comingSoon": "Demnächst",
    "nav.comingSoonTooltip": "{title} — demnächst",
    "nav.soon": "Bald",
    "nav.protected": "Geschützt",

    "nav.searchChats": "Chats durchsuchen",
    "nav.clearSearch": "Suche löschen",
    "nav.results": "Ergebnisse",
    "nav.noMatches": "Keine Treffer.",

    "nav.chatOptions": "Chat-Optionen",
    "nav.rename": "Umbenennen",
    "nav.pin": "Anheften",
    "nav.unpin": "Lösen",
    "nav.moveToProject": "In Projekt verschieben",
    "nav.noProjectsYet": "Noch keine Projekte",
    "nav.removeFromProject": "Aus Projekt entfernen",
    "nav.newChatInProject": "Neuer Chat in {name}",
    "nav.expandProject": "Chats in {name} anzeigen",
    "nav.collapseProject": "Chats in {name} ausblenden",
    "nav.noChatsYet": "Noch keine Chats.",
    "nav.recents": "Letzte Chats",
    "nav.newChat": "Neuer Chat",
    "nav.noRecentChatsYet": "Noch keine letzten Chats.",
    "nav.deleteChatTitle": "Diesen Chat löschen?",
    "nav.deleteChatDesc":
      "„{title}“ wird dauerhaft von all deinen Geräten entfernt. Das lässt sich nicht rückgängig machen.",
    "nav.thisChat": "Dieser Chat",

    "nav.openMenu": "Menü öffnen",
    "nav.cantReachTitle": "QUON nicht erreichbar",
    "nav.cantReachBody":
      "Der Dienst antwortet gerade nicht. Deine Sitzung und deine Daten bleiben unberührt — das ist nur ein Verbindungsproblem.",

    "nav.statusActive": "QUON aktiv",
    "nav.statusFallback": "QUON eingeschränkt",
    "nav.statusOffline": "QUON offline",
    "nav.statusLoading": "QUON …",
    "nav.statusActiveDetail":
      "Deine Daten sind geschützt — persönliche Infos werden entfernt, bevor irgendetwas an einen Anbieter geht.",
    "nav.statusFallbackDetail":
      "Lokale Erkennung aktiv — Namen und Muster (E-Mails, Telefonnummern, IBANs, Beträge) werden direkt auf dem Gerät erkannt und entfernt. Die LLM-Anreicherung ist offline, daher werden manche kontextabhängigen Angaben womöglich übersehen.",
    "nav.statusOfflineDetail":
      "Der Scrubber ist nicht erreichbar — das Senden ist pausiert, damit nichts ungeschützt dein Gerät verlässt. Starte quon-scrubber-service, um ihn wieder zu aktivieren.",
    "nav.statusLoadingDetail": "Schutzstatus wird geprüft …",
    "nav.statusVersion": "v{version}",

    "nav.releaseAriaLabel": "Neu — {title}",
    "nav.releaseWhatsNew": "Neu · {date}",

    "nav.startChat": "Chat starten",
    "nav.askPlaceholder": "Frag etwas — es bleibt privat",
    "nav.askSend": "Senden und Chat öffnen",
    "nav.continueChat": "oder „{title}“ fortsetzen →",
    "nav.firstChatHint":
      "Dein erster privater Chat — persönliche Daten werden auf deinem Gerät gefiltert, bevor etwas gesendet wird.",

    "nav.bioOfferTitle": "Beim nächsten Mal schneller entsperren",
    "nav.bioOfferBody":
      "Aktiviere Face ID, Touch ID oder deinen Fingerabdruck und entsperre QUON auf diesem Gerät, statt jedes Mal dein Passwort einzugeben. Der Schlüssel bleibt in der sicheren Hardware deines Geräts — er erreicht unsere Server nie.",
    "nav.bioEnabledNotice":
      "Biometrische Entsperrung ist für dieses Gerät aktiv — beim nächsten Mal entsperrst du mit Face ID oder deinem Fingerabdruck.",
    "nav.bioPrfUnavailable":
      "Dieser Browser kann den Entsperr-Schlüssel nicht so schützen, wie QUON es braucht — deshalb ist die biometrische Entsperrung hier nicht verfügbar. Den ungenutzten QUON-Passkey kannst du in den Passwort-Einstellungen deines Geräts entfernen.",
    "nav.bioGenericError":
      "Biometrische Entsperrung ließ sich nicht aktivieren. Versuch es später noch mal unter Einstellungen → Konto.",
    "nav.bioSettingUp": "Wird eingerichtet …",
    "nav.bioRepairTitle": "Dein Passkey scheint zu fehlen",
    "nav.bioRepairBody":
      "Die letzten biometrischen Entsperrungen auf diesem Gerät sind fehlgeschlagen. Auf manchen Geräten entfernt ein System-Update den Passkey. Lege jetzt einen neuen an — eine Bestätigung genügt. Deine Daten sind nicht betroffen.",
    "nav.bioRepairAction": "Neuen Passkey anlegen",
    "nav.bioRepairedNotice": "Erledigt — der neue Passkey entsperrt QUON auf diesem Gerät.",
    "nav.offlineBanner":
      "Offline — deine gespeicherten Daten sind lesbar. Senden & Sync starten automatisch wieder.",
    "nav.syncBusy": "Sichere {count} Einträge — verschlüsselt, im Hintergrund",
    "nav.syncBusyProgress": "Sichere deine verschlüsselten Daten… ({done} von {total} Einträgen)",
    "nav.syncBlockedOne":
      "1 Eintrag ist zu groß zum Synchronisieren. Er bleibt auf diesem Gerät, erreicht aber deine anderen Geräte nicht.",
    "nav.syncBlockedMany":
      "{count} Einträge sind zu groß zum Synchronisieren. Sie bleiben auf diesem Gerät, erreichen aber deine anderen Geräte nicht.",
    "nav.notNow": "Nicht jetzt",
    "nav.dismiss": "Verwerfen",

    "nav.protectionLevelLabel": "Protection Level",
    "nav.change": "Ändern",
    "nav.protectionOff": "Schutz ist aus — Nachrichten gehen genau so raus, wie du sie schreibst.",
    "nav.nothingFilteredYet":
      "Noch nichts gefiltert — schick eine Nachricht und sieh es in Aktion.",
    "nav.itemsKeptPrivateOne": "Bisher 1 persönliche Angabe geschützt.",
    "nav.itemsKeptPrivateOther": "Bisher {count} persönliche Angaben geschützt.",

    "nav.yourPrivateData": "Deine privaten Daten",
    "nav.endToEndEncrypted": "Ende-zu-Ende-verschlüsselt",
    "nav.memoryCountLabelOne": "Erinnerung",
    "nav.memoryCountLabelOther": "Erinnerungen",
    "nav.documentCountLabelOne": "Dokument",
    "nav.documentCountLabelOther": "Dokumente",
    "nav.projectCountLabelOne": "Projekt",
    "nav.projectCountLabelOther": "Projekte",
    "nav.privateDataEmpty":
      "Noch nichts gespeichert — füg Erinnerungen hinzu oder lade Dokumente hoch, dann nutzt QUON sie als privaten Kontext in deinen Chats.",

    "nav.recentChats": "Letzte Chats",

    "briefing.title": "Willkommen zurück",
    "briefing.since": "Neu seit deinem letzten Besuch: {parts}",
    "briefing.dismiss": "Briefing schließen",
    "briefing.memOne": "{count} Erinnerung",
    "briefing.memOther": "{count} Erinnerungen",
    "briefing.docOne": "{count} Dokument",
    "briefing.docOther": "{count} Dokumente",
    "briefing.upcoming": "Anstehend",

    "agents.title": "Agenten",
    "agents.subtitle":
      "Automatisierte Agenten für Web-Suchen oder deine eigenen Dokumente — Ergebnisse bleiben für dich Ende-zu-Ende verschlüsselt.",
    "agents.infoAria": "Mehr Info",

    "agents.newAgent": "Neuer Agent",
    "agents.kindPickerLabel": "Art des Agenten",
    "agents.kindWeb": "Web-Suche",
    "agents.kindWebDesc": "Durchsucht das Web regelmäßig und meldet dir, was neu ist.",
    "agents.kindDevice": "Meine Dokumente",
    "agents.kindDeviceDesc":
      "Fragt deine eigenen Notizen & Dokumente — der Server kann sie nicht lesen.",
    "agents.namePlaceholder": "Name (optional), z. B. Grundstücke Oberhavel",
    "agents.queryPlaceholder": "Wonach suchen, z. B. Grundstücke in Oberhavel bis 50.000 €",
    "agents.promptPlaceholder":
      "Was soll er tun? z. B. Fasse zusammen, was in meinen Dokumenten neu ist",
    "agents.dailyAt": "Täglich um",
    "agents.timeOptional": "(optional)",
    "agents.create": "Agent anlegen",
    "agents.createDevice": "Geräte-Agent anlegen",
    "agents.error": "Der Agent konnte nicht gespeichert werden — bitte erneut versuchen.",
    "agents.privacyNote":
      "QUONs Server führt die Suche täglich aus und sieht deine Suchbegriffe (wie bei jeder Websuche hier), aber nie die Ergebnisse — die sind an deinen Schlüssel versiegelt und werden nur auf deinen Geräten entschlüsselt.",
    "agents.deviceSubtitle":
      "Agenten, die deine eigenen Notizen & Dokumente lesen — was der Server nicht kann. Sie laufen nur, solange QUON geöffnet und entsperrt ist, auf einem Gerät, das du unten als Ausführungsgerät markierst.",
    "agents.privacyNoteDevice":
      "Prompt, deine Dokumente und das Ergebnis verlassen dein Gerät nie im Klartext — nur derselbe gefilterte Text wie bei einem Chat erreicht das Modell.",
    "agents.costNote": "Läufe nutzen dein eigenes API-Guthaben, wie eine Chat-Nachricht.",

    "agents.emptyAll": "Noch keine Agenten. Leg oben einen an.",
    "agents.badgeServer": "Server",
    "agents.badgeDevice": "Gerät",
    "agents.newDeviceAgent": "Neuer Geräte-Agent",
    "agents.projectEmpty": "Noch keine Agenten in diesem Projekt.",
    "agents.projectAgentsHint":
      "Ein Geräte-Agent für dieses Projekt: Er liest die Notizen & Dokumente DIESES Projekts (was der Server nicht kann) und antwortet nach Zeitplan oder auf Abruf. Er läuft nur, solange QUON auf einem im Agenten-Bereich aktivierten Gerät geöffnet und entsperrt ist.",
    "agents.runmodeServer": "läuft auf dem Server",
    "agents.runmodeDevice": "läuft auf deinem Gerät · wir können es nicht lesen",
    "agents.runNow": "Jetzt ausführen",
    "agents.pause": "Pausieren",
    "agents.resume": "Fortsetzen",
    "agents.resultsCount": "{count} Ergebnis(se)",
    "agents.noNewResults": "Noch keine neuen Ergebnisse.",
    "agents.pending": "Wartet auf den ersten Lauf…",
    "agents.noRuns": "Noch nicht ausgeführt.",
    "agents.runResult": "Ergebnis",
    "agents.running": "Läuft…",
    "agents.runError": "Lauf fehlgeschlagen",
    "agents.device.waitingNoRunner": "Wartet auf ein bereites Gerät…",
    "agents.device.queued": "In Warteschlange…",

    "agents.runner.title": "Gerät für deine Agenten",
    "agents.runner.toggle": "Dieses Gerät nutzen",
    "agents.runner.statusThis": "✓ Dieses Gerät ist bereit",
    "agents.runner.statusOtherOne": "1 anderes Gerät ist bereit",
    "agents.runner.statusOtherOther": "{count} andere Geräte sind bereit",
    "agents.runner.statusNone": "Kein Gerät bereit — Geräte-Agenten warten",
    "agents.runnerHint":
      "Geräte-Agenten können nicht auf dem QUON-Server laufen — sie lesen deine eigenen Notizen und Dokumente, deshalb darf davon nichts ungefiltert dein Gerät verlassen. Wenn du das hier aktivierst, führt DIESES Gerät deine Geräte-Agenten im Hintergrund aus — aber nur, solange QUON hier geöffnet und entsperrt ist. Aktiviere es auf jedem Gerät, auf dem sie laufen sollen — Handy, Laptop, oder beides.",

    "feedback.navLabel": "Feedback",
    "feedback.title": "Feedback senden",
    "feedback.subtitle": "QUON ist in der Beta — sag uns, was hakt oder was du dir wünschst.",
    "feedback.catBug": "Fehler",
    "feedback.catIdea": "Idee",
    "feedback.catOther": "Sonstiges",
    "feedback.placeholder": "Was ist passiert, oder was wünschst du dir?",
    "feedback.addShot": "Screenshot hinzufügen",
    "feedback.removeShot": "Screenshot entfernen",
    "feedback.shotNotImage": "Bitte wähle eine Bilddatei.",
    "feedback.shotTooBig": "Das Bild ist zu groß (max. 6 MB).",
    "feedback.contactBack": "Ich möchte eine Antwort per E-Mail",
    "feedback.attachDiag": "Technisches Protokoll anhängen (Fehler auf diesem Gerät)",
    "feedback.diagPreview": "Genau ansehen, was gesendet würde",
    "feedback.noDiag":
      "Auf diesem Gerät ist kein technisches Protokoll aufgezeichnet — treten Fehler oder Abstürze auf, erscheint hier automatisch ein anhängbares Protokoll.",
    "feedback.privacyNote":
      "Anders als deine Chats ist Feedback nicht Ende-zu-Ende-verschlüsselt — deine Nachricht und ein etwaiger Screenshot gehen an das QUON-Team, damit wir handeln können. Deine Nachricht wird zusätzlich als Ticket in unserem privaten Issue-Tracker (GitHub) abgelegt, damit sie nicht untergeht; deine E-Mail-Adresse nicht.",
    "feedback.send": "Feedback senden",
    "feedback.thanks": "Danke! Dein Feedback ist unterwegs. 🙌",
    "feedback.error": "Feedback konnte gerade nicht gesendet werden — bitte versuch es erneut.",
  },
} as const;
