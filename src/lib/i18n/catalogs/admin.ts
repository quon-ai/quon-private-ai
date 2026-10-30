/**
 * "admin" namespace UI strings (operator screen, /admin). Keys `admin.*` plus
 * the nav entry. Keep en/de in sync — missing German = compile error.
 */
export const admin = {
  en: {
    "nav.admin": "Admin",
    "admin.title": "Administration",
    "admin.subtitle":
      "Manage accounts and invites on this instance. You see metadata only — content stays end-to-end encrypted, for admins too.",

    // Stats
    "admin.statsUsers": "Accounts",
    "admin.statsActive": "active",
    "admin.statsPending": "pending",
    "admin.statsSuspended": "suspended",
    "admin.statsStorage": "Storage used",
    "admin.statsInvites": "Open invites",

    // User table
    "admin.usersTitle": "Accounts",
    "admin.colEmail": "Email",
    "admin.colStatus": "Status",
    "admin.colLastSeen": "Last seen",
    "admin.colStorage": "Storage",
    "admin.colBudget": "AI budget",
    "admin.budgetUsedOf": "${used} of ${limit}",
    "admin.never": "never",
    "admin.roleAdmin": "Admin",
    "admin.statusActive": "Active",
    "admin.statusPending": "Pending",
    "admin.statusSuspended": "Suspended",
    "admin.overrideBadge": "custom",
    "admin.actionSuspend": "Suspend",
    "admin.actionReactivate": "Reactivate",
    "admin.actionResend": "Resend verification email",
    "admin.actionLimits": "Limits…",
    "admin.actionMakeAdmin": "Make admin",
    "admin.actionRemoveAdmin": "Remove admin role",
    "admin.suspendConfirm":
      "Suspend {email}? They are logged out immediately and cannot sign in until reactivated. All data is kept.",
    "admin.actionDelete": "Delete account…",
    "admin.deleteConfirm":
      "Permanently delete {email}? ALL their data is removed and cannot be recovered — it is encrypted with keys only this user holds, so there is no export and no undo.",
    "admin.deleteButton": "Delete permanently",
    "admin.resendDone": "Verification email sent.",

    // Entitlements dialog
    "admin.limitsTitle": "Limits for {email}",
    "admin.limitsBudget": "AI budget (USD)",
    "admin.limitsStorage": "Originals storage (MB)",
    "admin.limitsHint":
      "Empty = instance default. The budget is applied to the user's AI key immediately.",
    "admin.limitsSave": "Save",
    "admin.limitsCancel": "Cancel",

    // Invites
    "admin.invitesTitle": "Invites",
    "admin.invitesIntro":
      "Single-use codes as an alternative to the shared invite code. A code is shown only once, right after creation.",
    "admin.inviteNotePlaceholder": "Note (e.g. who it's for)",
    "admin.inviteCreate": "Create invite",
    "admin.inviteCodeIs": "Invite code (copy now — shown only once):",
    "admin.inviteOpen": "open",
    "admin.inviteUsed": "used",
    "admin.inviteExpired": "expired",
    "admin.inviteRevoke": "Revoke",
    "admin.invitesEmpty": "No invites yet.",

    // Audit
    "admin.auditTitle": "Audit log",
    "admin.auditEmpty": "No admin actions recorded yet.",

    // Errors / access
    "admin.denied": "This area is for instance administrators.",
    "admin.loadError": "Could not load admin data.",
  },
  de: {
    "nav.admin": "Admin",
    "admin.title": "Verwaltung",
    "admin.subtitle":
      "Konten und Einladungen dieser Instanz verwalten. Du siehst nur Metadaten — Inhalte bleiben Ende-zu-Ende verschlüsselt, auch für Admins.",

    "admin.statsUsers": "Konten",
    "admin.statsActive": "aktiv",
    "admin.statsPending": "unbestätigt",
    "admin.statsSuspended": "gesperrt",
    "admin.statsStorage": "Speicher belegt",
    "admin.statsInvites": "Offene Einladungen",

    "admin.usersTitle": "Konten",
    "admin.colEmail": "E-Mail",
    "admin.colStatus": "Status",
    "admin.colLastSeen": "Zuletzt aktiv",
    "admin.colStorage": "Speicher",
    "admin.colBudget": "KI-Budget",
    "admin.budgetUsedOf": "{used} $ von {limit} $",
    "admin.never": "nie",
    "admin.roleAdmin": "Admin",
    "admin.statusActive": "Aktiv",
    "admin.statusPending": "Unbestätigt",
    "admin.statusSuspended": "Gesperrt",
    "admin.overrideBadge": "angepasst",
    "admin.actionSuspend": "Sperren",
    "admin.actionReactivate": "Entsperren",
    "admin.actionResend": "Bestätigungs-Mail erneut senden",
    "admin.actionLimits": "Limits…",
    "admin.actionMakeAdmin": "Zum Admin machen",
    "admin.actionRemoveAdmin": "Admin-Rolle entziehen",
    "admin.suspendConfirm":
      "{email} sperren? Die Person wird sofort abgemeldet und kann sich bis zur Entsperrung nicht anmelden. Alle Daten bleiben erhalten.",
    "admin.actionDelete": "Konto löschen…",
    "admin.deleteConfirm":
      "{email} endgültig löschen? ALLE Daten werden entfernt und sind nicht wiederherstellbar — sie sind mit Schlüsseln verschlüsselt, die nur diese Person besitzt; es gibt keinen Export und kein Zurück.",
    "admin.deleteButton": "Endgültig löschen",
    "admin.resendDone": "Bestätigungs-Mail gesendet.",

    "admin.limitsTitle": "Limits für {email}",
    "admin.limitsBudget": "KI-Budget (USD)",
    "admin.limitsStorage": "Original-Speicher (MB)",
    "admin.limitsHint":
      "Leer = Instanz-Standard. Das Budget wird sofort auf den KI-Schlüssel angewendet.",
    "admin.limitsSave": "Speichern",
    "admin.limitsCancel": "Abbrechen",

    "admin.invitesTitle": "Einladungen",
    "admin.invitesIntro":
      "Einmal-Codes als Alternative zum gemeinsamen Einladungscode. Ein Code wird nur einmal angezeigt — direkt nach dem Erstellen.",
    "admin.inviteNotePlaceholder": "Notiz (z. B. für wen)",
    "admin.inviteCreate": "Einladung erstellen",
    "admin.inviteCodeIs": "Einladungscode (jetzt kopieren — wird nur einmal angezeigt):",
    "admin.inviteOpen": "offen",
    "admin.inviteUsed": "verwendet",
    "admin.inviteExpired": "abgelaufen",
    "admin.inviteRevoke": "Zurückziehen",
    "admin.invitesEmpty": "Noch keine Einladungen.",

    "admin.auditTitle": "Protokoll",
    "admin.auditEmpty": "Noch keine Admin-Aktionen protokolliert.",

    "admin.denied": "Dieser Bereich ist für Instanz-Administratoren.",
    "admin.loadError": "Admin-Daten konnten nicht geladen werden.",
  },
} as const;
