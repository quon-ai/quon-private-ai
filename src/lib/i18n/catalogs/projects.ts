/**
 * "projects" namespace UI strings. Keys are prefixed `projects.*`. Keep `en` and `de`
 * in sync — a missing German key is a compile error via catalog.ts's typing.
 * Covers ScreenProjects.tsx (list + Overview/Content/Settings tabs, delete dialog),
 * ProjectSharingCard.tsx (share/invite/members) and ProjectPickerBadge.tsx.
 */
export const projects = {
  en: {
    // List screen
    "projects.title": "Projects",
    "projects.newProject": "New project",
    "projects.subtitle":
      "Group chats by topic, give each its own memory, documents and instructions. Everything stays end-to-end encrypted.",
    "projects.namePlaceholder": "Project name (e.g. Tax 2026, Job search)",
    "projects.create": "Create",
    "projects.emptyState": "No projects yet. Create one to group related chats and knowledge.",
    "projects.chatCountOne": "{count} chat",
    "projects.chatCountOther": "{count} chats",
    "projects.memoryCountOne": "{count} memory",
    "projects.memoryCountOther": "{count} memories",
    "projects.docCountOne": "{count} doc",
    "projects.docCountOther": "{count} docs",

    // Detail screen — shared chrome
    "projects.backToProjects": "Back to projects",
    "projects.notFound": "This project doesn’t exist (or hasn’t synced yet).",
    "projects.accessRevokedBanner":
      "Your access to this shared project was revoked or the project was deleted by its owner. What you see here is your last local copy — it will no longer receive updates.",
    "projects.tabOverview": "Overview",
    "projects.tabContent": "Content",
    "projects.tabSettings": "Settings",

    // Overview tab
    "projects.whatThisProjectKnows": "What this project knows",
    "projects.instructionSet": "Instruction set",
    "projects.noInstruction": "No instruction",
    "projects.chatsHeading": "Chats",
    "projects.newChat": "New chat",
    "projects.noChatsYet": "No chats in this project yet.",

    // Content tab
    "projects.projectMemory": "Project memory",
    "projects.projectDocuments": "Project documents",
    "projects.projectAgents": "Project agents",

    // Settings tab — editor
    "projects.nameFieldPlaceholder": "Project name",
    "projects.colourLabel": "Colour {color}",
    "projects.colourIndigo": "Indigo",
    "projects.colourGreen": "Green",
    "projects.colourYellow": "Yellow",
    "projects.colourSky": "Sky",
    "projects.colourRose": "Rose",
    "projects.colourTeal": "Teal",
    "projects.colourPurple": "Purple",
    "projects.colourOrange": "Orange",
    "projects.instructionsLabel": "Instructions",
    "projects.instructionsPlaceholder":
      "How should the assistant behave in this project? (e.g. “You are my tax advisor for Germany; answer concisely and cite the relevant paragraph.”)",
    "projects.instructionsHelp":
      "Sent with every chat in this project — and scrubbed for personal data first, just like your messages.",

    // Settings tab — chat defaults disclosure
    "projects.chatDefaults": "Chat defaults",
    "projects.customOverridesCount": "{count} custom",
    "projects.usingGlobalDefaults": "Using global defaults",
    "projects.defaultsModelLabel": "Model",
    "projects.defaultsProtectionLabel": "Protection",
    "projects.defaultsReasoningLabel": "Reasoning",
    "projects.useGlobalDefault": "Use global default",
    "projects.protectionNone": "None — no filtering",
    "projects.protectionFilter": "Filter — redact automatically",
    "projects.protectionReview": "Review — approve before send",
    "projects.effortOff": "Off",
    "projects.effortLow": "Low",
    "projects.effortMedium": "Medium",
    "projects.effortHigh": "High",
    "projects.typesOverride": "Override which data types get redacted",
    "projects.chatDefaultsHelp":
      "Applied when a chat starts in this project — you can still change them in the chat.",
    "projects.saveChanges": "Save changes",
    "projects.saved": "Saved",

    // Settings tab — danger zone / delete dialog
    "projects.deleteThisProject": "Delete this project",
    "projects.deleteDescOwner":
      "Its chats, memory and documents are kept and moved to your global space. This also stops sharing it.",
    "projects.deleteDescMember":
      "Its chats, memory and documents are kept and moved to your global space.",
    "projects.deleteDialogTitle": "Delete “{name}”?",
    "projects.deleteDialogDescSimple":
      "The project is removed, but its chats, memory and documents are kept and moved to your global space — nothing is deleted.",
    "projects.deleteDialogDescOwnerUnknown":
      "This project is shared. Deleting it stops sharing — members lose access to it. Its chats, memory and documents are kept and moved to your global space.",
    "projects.deleteDialogDescOwnerZero":
      "This project is shared with {count} members. Deleting it stops sharing — no one else has joined yet, but any invite links stop working. Its chats, memory and documents are kept and moved to your global space.",
    "projects.deleteDialogDescOwnerMembersOne":
      "This project is shared with {count} member. Deleting it stops sharing — members lose access to it. Its chats, memory and documents are kept and moved to your global space.",
    "projects.deleteDialogDescOwnerMembersOther":
      "This project is shared with {count} members. Deleting it stops sharing — members lose access to it. Its chats, memory and documents are kept and moved to your global space.",
    "projects.deleteDialogConfirm": "Delete project",
    "projects.deleteDialogDeleting": "Deleting…",
    "projects.deleteDialogUnshareFailed":
      "Couldn't stop sharing ({reason}) — the project was NOT deleted. Try again.",

    // ProjectSharingCard
    "projects.sharingHeading": "Sharing",
    "projects.sharingNotSharedDesc":
      "Not shared — sharing is end-to-end encrypted, read-only for invitees; chats are never shared.",
    "projects.sharingShareButton": "Share this project",
    "projects.sharingBadge": "Shared · you are {role}",
    "projects.roleOwner": "owner",
    "projects.roleWriter": "writer",
    "projects.roleReader": "reader",
    "projects.sharingCreateInviteButton": "Create invite link",
    "projects.sharingInviteLinkHelp":
      "Single-use, valid 7 days. The link itself carries the project key — send it over a channel you trust; it never passes through the QUON server.",
    "projects.sharingCopyInviteLabel": "Copy invite link",
    "projects.sharingMembersHeading": "Members",
    "projects.sharingRemoveMemberLabel": "Remove {email}",
    "projects.sharingRemoveMemberHelp":
      "Removing a member blocks future access; copies they already downloaded stay on their device (no key rotation in v1).",
    "projects.sharingStopSharing": "Stop sharing",
    "projects.sharingLeave": "Leave",
    "projects.sharingKeyUnavailable": "Project key unavailable — unlock and retry.",

    // ProjectPickerBadge
    "projects.pickerMoveToProject": "Move to project",
    "projects.pickerGlobal": "Global",
    "projects.pickerUnknownProject": "Project",
    "projects.pickerGlobalOption": "Global (no project)",
  },
  de: {
    // List screen
    "projects.title": "Projekte",
    "projects.newProject": "Neues Projekt",
    "projects.subtitle":
      "Gruppiere Chats nach Thema — mit eigenem Gedächtnis, Dokumenten und Anweisungen. Alles bleibt Ende-zu-Ende-verschlüsselt.",
    "projects.namePlaceholder": "Projektname (z. B. Steuer 2026, Jobsuche)",
    "projects.create": "Erstellen",
    "projects.emptyState":
      "Noch keine Projekte. Erstell eins, um zusammengehörige Chats und Wissen zu bündeln.",
    "projects.chatCountOne": "{count} Chat",
    "projects.chatCountOther": "{count} Chats",
    "projects.memoryCountOne": "{count} Erinnerung",
    "projects.memoryCountOther": "{count} Erinnerungen",
    "projects.docCountOne": "{count} Dokument",
    "projects.docCountOther": "{count} Dokumente",

    // Detail screen — shared chrome
    "projects.backToProjects": "Zurück zu Projekten",
    "projects.notFound": "Dieses Projekt gibt es nicht (oder es ist noch nicht synchronisiert).",
    "projects.accessRevokedBanner":
      "Dein Zugriff auf dieses geteilte Projekt wurde entzogen, oder der Eigentümer hat es gelöscht. Du siehst hier deine letzte lokale Kopie — sie bekommt keine Updates mehr.",
    "projects.tabOverview": "Übersicht",
    "projects.tabContent": "Inhalt",
    "projects.tabSettings": "Einstellungen",

    // Overview tab
    "projects.whatThisProjectKnows": "Was dieses Projekt weiß",
    "projects.instructionSet": "Anweisung hinterlegt",
    "projects.noInstruction": "Keine Anweisung",
    "projects.chatsHeading": "Chats",
    "projects.newChat": "Neuer Chat",
    "projects.noChatsYet": "Noch keine Chats in diesem Projekt.",

    // Content tab
    "projects.projectMemory": "Projekt-Gedächtnis",
    "projects.projectDocuments": "Projektdokumente",
    "projects.projectAgents": "Projekt-Agenten",

    // Settings tab — editor
    "projects.nameFieldPlaceholder": "Projektname",
    "projects.colourLabel": "Farbe {color}",
    "projects.colourIndigo": "Indigo",
    "projects.colourGreen": "Grün",
    "projects.colourYellow": "Gelb",
    "projects.colourSky": "Himmelblau",
    "projects.colourRose": "Rosé",
    "projects.colourTeal": "Türkis",
    "projects.colourPurple": "Violett",
    "projects.colourOrange": "Orange",
    "projects.instructionsLabel": "Anweisungen",
    "projects.instructionsPlaceholder":
      "Wie soll sich der Assistent in diesem Projekt verhalten? (z. B. „Du bist mein Steuerberater für Deutschland; antworte knapp und nenne den passenden Paragrafen.“)",
    "projects.instructionsHelp":
      "Geht bei jedem Chat in diesem Projekt mit — und wird vorher von persönlichen Daten bereinigt, genau wie deine Nachrichten.",

    // Settings tab — chat defaults disclosure
    "projects.chatDefaults": "Chat-Voreinstellungen",
    "projects.customOverridesCount": "{count} angepasst",
    "projects.usingGlobalDefaults": "Nutzt globale Voreinstellungen",
    "projects.defaultsModelLabel": "Modell",
    "projects.defaultsProtectionLabel": "Schutz",
    "projects.defaultsReasoningLabel": "Reasoning",
    "projects.useGlobalDefault": "Globale Voreinstellung nutzen",
    "projects.protectionNone": "Kein Schutz — keine Filterung",
    "projects.protectionFilter": "Filter — automatisch schwärzen",
    "projects.protectionReview": "Review — vor dem Senden bestätigen",
    "projects.effortOff": "Aus",
    "projects.effortLow": "Niedrig",
    "projects.effortMedium": "Mittel",
    "projects.effortHigh": "Hoch",
    "projects.typesOverride": "Überschreiben, welche Datentypen geschwärzt werden",
    "projects.chatDefaultsHelp":
      "Gilt für neue Chats in diesem Projekt — im Chat kannst du sie jederzeit ändern.",
    "projects.saveChanges": "Änderungen speichern",
    "projects.saved": "Gespeichert",

    // Settings tab — danger zone / delete dialog
    "projects.deleteThisProject": "Dieses Projekt löschen",
    "projects.deleteDescOwner":
      "Chats, Gedächtnis und Dokumente bleiben erhalten und wandern in deinen globalen Bereich. Das beendet auch das Teilen.",
    "projects.deleteDescMember":
      "Chats, Gedächtnis und Dokumente bleiben erhalten und wandern in deinen globalen Bereich.",
    "projects.deleteDialogTitle": "„{name}“ löschen?",
    "projects.deleteDialogDescSimple":
      "Das Projekt wird entfernt, aber Chats, Gedächtnis und Dokumente bleiben erhalten und wandern in deinen globalen Bereich — nichts wird gelöscht.",
    "projects.deleteDialogDescOwnerUnknown":
      "Dieses Projekt ist geteilt. Beim Löschen wird das Teilen beendet — Mitglieder verlieren den Zugriff darauf. Chats, Gedächtnis und Dokumente bleiben erhalten und wandern in deinen globalen Bereich.",
    "projects.deleteDialogDescOwnerZero":
      "Dieses Projekt ist mit {count} Mitgliedern geteilt. Beim Löschen wird das Teilen beendet — es ist zwar noch niemand beigetreten, aber Einladungslinks funktionieren dann nicht mehr. Chats, Gedächtnis und Dokumente bleiben erhalten und wandern in deinen globalen Bereich.",
    "projects.deleteDialogDescOwnerMembersOne":
      "Dieses Projekt ist mit {count} Mitglied geteilt. Beim Löschen wird das Teilen beendet — Mitglieder verlieren den Zugriff darauf. Chats, Gedächtnis und Dokumente bleiben erhalten und wandern in deinen globalen Bereich.",
    "projects.deleteDialogDescOwnerMembersOther":
      "Dieses Projekt ist mit {count} Mitgliedern geteilt. Beim Löschen wird das Teilen beendet — Mitglieder verlieren den Zugriff darauf. Chats, Gedächtnis und Dokumente bleiben erhalten und wandern in deinen globalen Bereich.",
    "projects.deleteDialogConfirm": "Projekt löschen",
    "projects.deleteDialogDeleting": "Wird gelöscht…",
    "projects.deleteDialogUnshareFailed":
      "Das Teilen konnte nicht beendet werden ({reason}) — das Projekt wurde NICHT gelöscht. Versuche es erneut.",

    // ProjectSharingCard
    "projects.sharingHeading": "Teilen",
    "projects.sharingNotSharedDesc":
      "Nicht geteilt — Teilen ist Ende-zu-Ende-verschlüsselt und für Eingeladene nur lesend; Chats werden nie geteilt.",
    "projects.sharingShareButton": "Dieses Projekt teilen",
    "projects.sharingBadge": "Geteilt · du bist {role}",
    "projects.roleOwner": "Eigentümer",
    "projects.roleWriter": "Bearbeiter",
    "projects.roleReader": "Leser",
    "projects.sharingCreateInviteButton": "Einladungslink erstellen",
    "projects.sharingInviteLinkHelp":
      "Einmal verwendbar, 7 Tage gültig. Der Link selbst enthält den Projektschlüssel — sende ihn über einen Kanal, dem du vertraust; er läuft nie über den QUON-Server.",
    "projects.sharingCopyInviteLabel": "Einladungslink kopieren",
    "projects.sharingMembersHeading": "Mitglieder",
    "projects.sharingRemoveMemberLabel": "{email} entfernen",
    "projects.sharingRemoveMemberHelp":
      "Entfernst du ein Mitglied, sperrst du künftigen Zugriff; schon heruntergeladene Kopien bleiben auf dessen Gerät (keine Schlüsselrotation in v1).",
    "projects.sharingStopSharing": "Teilen beenden",
    "projects.sharingLeave": "Verlassen",
    "projects.sharingKeyUnavailable":
      "Projektschlüssel nicht verfügbar — entsperren und erneut versuchen.",

    // ProjectPickerBadge
    "projects.pickerMoveToProject": "Zu Projekt verschieben",
    "projects.pickerGlobal": "Global",
    "projects.pickerUnknownProject": "Projekt",
    "projects.pickerGlobalOption": "Global (kein Projekt)",
  },
} as const;
