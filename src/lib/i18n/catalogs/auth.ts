/**
 * "auth" namespace UI strings. Keys are prefixed `auth.*`. Keep `en` and `de`
 * in sync — a missing German key is a compile error via catalog.ts's typing.
 * Covers ScreenAuth.tsx (login/register/forgot/unlock/recovery-kit),
 * ScreenJoinShare.tsx, and the routes verify/recover/change-email.
 *
 * A few sentences that wrap an inline element (a bold word, a dynamic value,
 * a <Link>) are split into "…Pre" / "…Bold" / "…Mid" / "…Post" keys so the
 * inline JSX can sit between translated fragments — there's no Trans-style
 * helper in this codebase, so this is the established pattern here.
 */
export const auth = {
  en: {
    // Shared across forms
    "auth.email": "Email",
    "auth.password": "Password",
    "auth.backToSignIn": "Back to sign in",
    "auth.passwordsDoNotMatch": "Passwords do not match.",

    // Main screen tagline
    "auth.tagline": "Your AI. Your Rules. Your Data.",

    // Login
    "auth.signIn": "Sign in",
    "auth.tryDemo": "Try the redaction without an account",
    "auth.forgotPasswordQuestion": "Forgot password?",
    "auth.newToQuon": "New to QUON? ",
    "auth.createAnAccount": "Create an account",

    // Register
    "auth.inviteCode": "Invite code",
    "auth.passwordMin": "Password (min. 12 chars)",
    "auth.confirmPassword": "Confirm password",
    "auth.acceptTermsAriaLabel": "Accept the terms of use",
    "auth.termsPre": "I have read and accepted the ",
    "auth.termsPost": " (terms of use).",
    "auth.createAccount": "Create account",
    "auth.zeroKnowledgeNotice":
      "QUON is zero-knowledge: your password and data never leave your device unencrypted. You'll get a recovery phrase next — keep it safe.",
    "auth.joinInviteNotice":
      "After you verify your email and sign in, you'll be brought back to this invite.",
    "auth.alreadyHaveAccount": "I already have an account",
    "auth.acceptTermsRequired": "Please accept the terms of use to continue.",

    // Forgot password
    "auth.forgotIntro":
      "Enter your email and we'll send a recovery link. You'll need your recovery phrase to set a new password.",
    "auth.sendRecoveryLink": "Send recovery link",

    // "Check your email" confirmations
    "auth.checkYourEmail": "Check your email",
    "auth.resetSentMessage":
      "If an account exists for that address, we sent a recovery link. Open it to reset your password with your recovery phrase.",
    "auth.sentVerificationPre": "If this is a new address, we sent a verification link to ",
    "auth.sentVerificationPost": " — open it to activate your account, then sign in.",
    "auth.sentAlreadyPre": "Already have an account with this email? No email will arrive — ",
    "auth.sentAlreadyMid": " instead or use ",
    "auth.sentAlreadyPost": ".",
    "auth.signInLower": "sign in",
    "auth.forgotPasswordLink": "Forgot password",

    // Recovery kit (on-screen)
    "auth.recoveryPhraseTitle": "Your recovery phrase",
    "auth.recoveryIntroPre": "These 12 words are the ",
    "auth.recoveryIntroBold": "only",
    "auth.recoveryIntroPost":
      " way to recover your data if you forget your password. QUON cannot reset them for you. Write them down and keep them somewhere safe — never share them.",
    "auth.recoveryActivatesNote": "This phrase becomes active once your email is verified.",
    "auth.copyPhrase": "Copy phrase",
    "auth.copied": "Copied",
    "auth.downloadKitPdf": "Download kit (PDF)",
    // Names the CONSEQUENCE, not the instruction. "I have saved it" is a box
    // people tick to get past a screen; irreversibility is what makes them
    // stop and actually save the phrase. Deliberately blunt, and honest —
    // zero-knowledge means this is literally true, including for us.
    "auth.savedPhraseCheckbox":
      "If I lose my password AND these 12 words, my data is gone for good. QUON cannot recover it either.",

    // Recovery kit (downloaded PDF)
    "auth.recoveryKitPdfTitle": "QUON Recovery Kit",
    "auth.recoveryKitPdfGenerated": "Generated {date}",
    "auth.recoveryKitPdfIntro":
      "These 12 words are the ONLY way to recover your QUON account and decrypt your data if you forget your password. Keep this sheet somewhere safe and private. Anyone with these words can access your data — QUON cannot recover them for you.",
    // {host} = the instance this account lives on, filled in at render time —
    // a self-hosted deployment must not print someone else's domain on its
    // users' recovery sheets.
    "auth.recoveryKitPdfCopyLine": "For copying — all twelve words in order, one line:",
    "auth.recoveryKitPdfFooter": "{host}  ·  Never share this sheet. Store it offline if you can.",

    // Unlock (locked session)
    "auth.unlockWelcomeBack": "Welcome back. Enter your password to unlock your data.",
    "auth.unlockWelcomeBackEmail":
      "Welcome back, {email}. Enter your password to unlock your data.",
    "auth.unlockWithBiometric": "Unlock with Face ID / fingerprint",
    "auth.or": "or",
    "auth.unlock": "Unlock",
    "auth.signInDifferentUser": "Sign in as a different user",
    "auth.bioTurnedOff":
      "Biometric unlock was turned off for this device. Enter your password, then re-enable it in Settings.",
    "auth.bioDidntWork": "Biometric unlock didn't work on this device — use your password.",
    "auth.bioTroubleHint":
      "Passkey not working? On some devices it disappears after a system update. Unlock with your password — QUON will then offer to create a new one.",
    "auth.offlineUnlockNote":
      "You're offline. Unlocking still works — your data is stored encrypted on this device.",
    "auth.showPassword": "Show password",
    "auth.hidePassword": "Hide password",

    // Client-side error interpretations (not backend detail strings — see
    // apiErrors.ts / errors.ts for those; these cover scrubber-down and
    // wrong-password heuristics that never come from the server)
    "auth.errScrubberUnreachable":
      "Can't reach QUON — the scrubber service isn't responding on the API. Is it running?",
    "auth.errServiceUnavailable":
      "QUON service is temporarily unavailable — please try again in a moment.",
    "auth.errScrubberDown": "Can't reach QUON — the scrubber service isn't running.",
    "auth.errWrongPassword": "Wrong password.",

    // /verify route
    "auth.missingVerificationToken": "Missing verification token.",
    "auth.verifyingAccount": "Verifying your account and provisioning your AI access…",
    "auth.accountVerified": "Account verified! Taking you to QUON…",
    "auth.verificationFailed": "Verification failed",

    // /recover route
    "auth.recoverAccountTitle": "Recover your account",
    "auth.openRecoveryLinkPre": "Open the recovery link from your email to continue.",
    "auth.passwordResetDone": "Password reset! Taking you to sign in…",
    "auth.invalidRecoveryPhrase": "That doesn't look like a valid 12-word recovery phrase.",
    "auth.recoverIntro":
      "Enter your 12-word recovery phrase and choose a new password. Your data stays decryptable — the phrase is used locally to unlock your key.",
    "auth.recoveryPhrasePlaceholder": "twelve words separated by spaces",
    "auth.newPasswordMin": "New password (min. 12 chars)",
    "auth.confirmNewPassword": "Confirm new password",
    "auth.resetPassword": "Reset password",
    "auth.recoveryFailed": "Recovery failed",

    // /change-email route
    "auth.missingConfirmationToken": "Missing confirmation token.",
    "auth.confirmingEmail": "Confirming your new email address…",
    "auth.emailUpdatedPre": "Email updated to ",
    "auth.emailUpdatedPost": ". Taking you to QUON…",
    "auth.couldNotConfirmEmailChange": "Could not confirm the email change.",
    "auth.backToQuon": "Back to QUON",

    // ScreenJoinShare (shared-project invite)
    "auth.joinInviteIncomplete": "This invite link is incomplete or damaged. Ask for a new one.",
    "auth.joinInviteInvalidExpired":
      "This invite is invalid or has expired — ask the project owner for a new link.",
    "auth.joinCouldNotJoin":
      "Couldn't join the project right now. Check your connection and try the link again.",
    "auth.joiningProject": "Joining the shared project…",
    "auth.youreIn": "You're in",
    "auth.joinDoneDescription":
      "The project and its knowledge are decrypting on your device now — the server only ever saw ciphertext.",
    "auth.openProjects": "Open Projects",
  },
  de: {
    // Shared across forms
    "auth.email": "E-Mail",
    "auth.password": "Passwort",
    "auth.backToSignIn": "Zurück zur Anmeldung",
    "auth.passwordsDoNotMatch": "Die Passwörter stimmen nicht überein.",

    // Main screen tagline
    "auth.tagline": "Deine KI. Deine Regeln. Deine Daten.",

    // Login
    "auth.signIn": "Anmelden",
    "auth.tryDemo": "Schwärzung ohne Konto ausprobieren",
    "auth.forgotPasswordQuestion": "Passwort vergessen?",
    "auth.newToQuon": "Neu bei QUON? ",
    "auth.createAnAccount": "Konto erstellen",

    // Register
    "auth.inviteCode": "Einladungscode",
    "auth.passwordMin": "Passwort (mind. 12 Zeichen)",
    "auth.confirmPassword": "Passwort bestätigen",
    "auth.acceptTermsAriaLabel": "Nutzungsvereinbarung akzeptieren",
    "auth.termsPre": "Ich habe die ",
    "auth.termsPost": " gelesen und akzeptiere sie.",
    "auth.createAccount": "Konto erstellen",
    "auth.zeroKnowledgeNotice":
      "QUON ist Zero-Knowledge: Dein Passwort und deine Daten verlassen dein Gerät nie unverschlüsselt. Gleich bekommst du deine Recovery-Phrase — bewahr sie gut auf.",
    "auth.joinInviteNotice":
      "Sobald du deine E-Mail-Adresse bestätigt hast und angemeldet bist, bringen wir dich zurück zu dieser Einladung.",
    "auth.alreadyHaveAccount": "Ich habe schon ein Konto",
    "auth.acceptTermsRequired": "Akzeptiere die Nutzungsvereinbarung, um fortzufahren.",

    // Forgot password
    "auth.forgotIntro":
      "Gib deine E-Mail-Adresse ein, wir schicken dir einen Recovery-Link. Für ein neues Passwort brauchst du deine Recovery-Phrase.",
    "auth.sendRecoveryLink": "Recovery-Link senden",

    // "Check your email" confirmations
    "auth.checkYourEmail": "Schau in dein Postfach",
    "auth.resetSentMessage":
      "Falls es zu dieser Adresse ein Konto gibt, haben wir dir einen Recovery-Link geschickt. Öffne ihn, um dein Passwort mit deiner Recovery-Phrase zurückzusetzen.",
    "auth.sentVerificationPre":
      "Falls das eine neue Adresse ist, haben wir einen Bestätigungslink an ",
    "auth.sentVerificationPost":
      " geschickt — öffne ihn, um dein Konto zu aktivieren, und melde dich dann an.",
    "auth.sentAlreadyPre": "Hast du mit dieser Adresse schon ein Konto? Dann kommt keine E-Mail — ",
    "auth.sentAlreadyMid": " oder nutze ",
    "auth.sentAlreadyPost": ".",
    "auth.signInLower": "melde dich an",
    "auth.forgotPasswordLink": "Passwort vergessen",

    // Recovery kit (on-screen)
    "auth.recoveryPhraseTitle": "Deine Recovery-Phrase",
    "auth.recoveryIntroPre": "Diese 12 Wörter sind der ",
    "auth.recoveryIntroBold": "einzige",
    "auth.recoveryIntroPost":
      " Weg, an deine Daten zu kommen, falls du dein Passwort vergisst. QUON kann sie nicht für dich zurücksetzen. Schreib sie auf und bewahr sie sicher auf — und teile sie mit niemandem.",
    "auth.recoveryActivatesNote":
      "Diese Phrase wird aktiv, sobald deine E-Mail-Adresse bestätigt ist.",
    "auth.copyPhrase": "Phrase kopieren",
    "auth.copied": "Kopiert",
    "auth.downloadKitPdf": "Kit herunterladen (PDF)",
    "auth.savedPhraseCheckbox":
      "Wenn ich mein Passwort UND diese 12 Wörter verliere, sind meine Daten endgültig weg. Auch QUON kann sie nicht wiederherstellen.",

    // Recovery kit (downloaded PDF)
    "auth.recoveryKitPdfTitle": "QUON Recovery-Kit",
    "auth.recoveryKitPdfGenerated": "Erstellt am {date}",
    "auth.recoveryKitPdfIntro":
      "Diese 12 Wörter sind der EINZIGE Weg, dein QUON-Konto wiederherzustellen und deine Daten zu entschlüsseln, falls du dein Passwort vergisst. Bewahr dieses Blatt sicher und privat auf. Jeder, der diese Wörter kennt, kommt an deine Daten — QUON kann sie nicht für dich wiederherstellen.",
    "auth.recoveryKitPdfCopyLine":
      "Zum Kopieren — alle zwölf Wörter in der richtigen Reihenfolge, in einer Zeile:",
    "auth.recoveryKitPdfFooter":
      "{host}  ·  Teile dieses Blatt niemals. Bewahr es nach Möglichkeit offline auf.",

    // Unlock (locked session)
    "auth.unlockWelcomeBack":
      "Willkommen zurück. Gib dein Passwort ein, um deine Daten zu entsperren.",
    "auth.unlockWelcomeBackEmail":
      "Willkommen zurück, {email}. Gib dein Passwort ein, um deine Daten zu entsperren.",
    "auth.unlockWithBiometric": "Mit Face ID / Fingerabdruck entsperren",
    "auth.or": "oder",
    "auth.unlock": "Entsperren",
    "auth.signInDifferentUser": "Mit anderem Konto anmelden",
    "auth.bioTurnedOff":
      "Biometrisches Entsperren ist für dieses Gerät deaktiviert. Gib dein Passwort ein und aktivier es danach wieder in den Einstellungen.",
    "auth.bioDidntWork":
      "Biometrisches Entsperren hat auf diesem Gerät nicht geklappt — nimm dein Passwort.",
    "auth.bioTroubleHint":
      "Passkey funktioniert nicht? Auf manchen Geräten verschwindet er nach einem System-Update. Entsperre mit deinem Passwort — QUON bietet dir dann an, einen neuen anzulegen.",
    "auth.offlineUnlockNote":
      "Du bist offline. Entsperren funktioniert trotzdem — deine Daten liegen verschlüsselt auf diesem Gerät.",
    "auth.showPassword": "Passwort anzeigen",
    "auth.hidePassword": "Passwort verbergen",

    // Client-side error interpretations
    "auth.errScrubberUnreachable":
      "QUON ist nicht erreichbar — der Datenschutzfilter antwortet nicht auf der API. Läuft er?",
    "auth.errServiceUnavailable":
      "QUON ist gerade nicht verfügbar — versuch es gleich noch einmal.",
    "auth.errScrubberDown": "QUON ist nicht erreichbar — der Datenschutzfilter läuft nicht.",
    "auth.errWrongPassword": "Falsches Passwort.",

    // /verify route
    "auth.missingVerificationToken": "Bestätigungs-Token fehlt.",
    "auth.verifyingAccount": "Wir bestätigen dein Konto und richten deinen KI-Zugang ein…",
    "auth.accountVerified": "Konto bestätigt! Weiter zu QUON…",
    "auth.verificationFailed": "Bestätigung fehlgeschlagen",

    // /recover route
    "auth.recoverAccountTitle": "Konto wiederherstellen",
    "auth.openRecoveryLinkPre": "Öffne den Recovery-Link aus deiner E-Mail, um weiterzumachen.",
    "auth.passwordResetDone": "Passwort zurückgesetzt! Weiter zur Anmeldung…",
    "auth.invalidRecoveryPhrase":
      "Das sieht nicht nach einer gültigen Recovery-Phrase mit 12 Wörtern aus.",
    "auth.recoverIntro":
      "Gib deine Recovery-Phrase mit 12 Wörtern ein und wähle ein neues Passwort. Deine Daten bleiben entschlüsselbar — die Phrase wird nur lokal genutzt, um deinen Schlüssel zu entsperren.",
    "auth.recoveryPhrasePlaceholder": "zwölf Wörter, durch Leerzeichen getrennt",
    "auth.newPasswordMin": "Neues Passwort (mind. 12 Zeichen)",
    "auth.confirmNewPassword": "Neues Passwort bestätigen",
    "auth.resetPassword": "Passwort zurücksetzen",
    "auth.recoveryFailed": "Wiederherstellung fehlgeschlagen",

    // /change-email route
    "auth.missingConfirmationToken": "Bestätigungs-Token fehlt.",
    "auth.confirmingEmail": "Wir bestätigen deine neue E-Mail-Adresse…",
    "auth.emailUpdatedPre": "E-Mail-Adresse geändert auf ",
    "auth.emailUpdatedPost": ". Weiter zu QUON…",
    "auth.couldNotConfirmEmailChange": "Die E-Mail-Änderung ließ sich nicht bestätigen.",
    "auth.backToQuon": "Zurück zu QUON",

    // ScreenJoinShare (shared-project invite)
    "auth.joinInviteIncomplete":
      "Dieser Einladungslink ist unvollständig oder beschädigt. Frag nach einem neuen.",
    "auth.joinInviteInvalidExpired":
      "Diese Einladung ist ungültig oder abgelaufen — frag den Projektinhaber nach einem neuen Link.",
    "auth.joinCouldNotJoin":
      "Der Beitritt hat gerade nicht geklappt. Prüf deine Verbindung und versuch den Link noch einmal.",
    "auth.joiningProject": "Du trittst dem Projekt bei…",
    "auth.youreIn": "Du bist drin",
    "auth.joinDoneDescription":
      "Das Projekt und sein Wissen werden gerade auf deinem Gerät entschlüsselt — der Server hat immer nur verschlüsselte Daten gesehen.",
    "auth.openProjects": "Projekte öffnen",
  },
} as const;
