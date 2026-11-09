/**
 * Backend-originated user-facing errors. The server returns English `detail`
 * strings (and provider-error strings over the chat stream); these are mapped
 * to localized text by translateApiError (apiErrors.ts). The EN value here must
 * equal the backend string so English mode is a faithful passthrough and the
 * detail->key map (apiErrors.ts) stays consistent.
 */
export const errors = {
  en: {
    // auth
    "errors.invalidCredentials": "Invalid email or password.",
    "errors.emailNotVerified": "Please verify your email first, then sign in.",
    "errors.accountSuspended": "This account is suspended.",
    "errors.invalidInviteCode": "That invite code isn't valid.",
    "errors.invalidEmail": "That doesn't look like a valid email address.",
    "errors.invalidOrExpiredToken": "This link is invalid or has expired.",
    "errors.malformedToken": "This link is malformed.",
    "errors.provisionFailed": "Couldn't set up your AI access — please try again.",
    "errors.emailAlreadyRegistered": "That email address is already registered.",
    "errors.currentPasswordIncorrect": "Your current password is incorrect.",
    "errors.passwordIncorrect": "That password is incorrect.",
    "errors.sessionExpired": "Your session has expired — please sign in again.",
    "errors.notAuthenticated": "Please sign in to continue.",
    "errors.tooManyDevices": "You've reached the limit of enrolled devices.",
    "errors.badLanguage": "Language must be German or English.",
    // OCR / cloud
    "errors.noCloudOcrKey": "Cloud text recognition isn't set up for this account.",
    "errors.invalidImage": "That image couldn't be read.",
    "errors.imageTooLarge": "That image is too large (max 8 MB).",
    "errors.unsupportedImage": "Unsupported image type — use a JPEG, PNG or WebP.",
    // providers / connections
    "errors.noProviderKey": "No API key is configured for this provider.",
    "errors.connectionNoKey": "This connection has no API key configured.",
    // provider relay (chat)
    "errors.providerRateLimited":
      "The model provider is rate-limiting right now — wait a moment and try again.",
    "errors.providerBudgetExhausted":
      "Your AI budget is used up — this account's included credit or spending cap has been reached. Add your own provider API key under Settings → Providers to keep chatting.",
    "errors.providerBadKey":
      "The AI provider rejected this account's API key. If you added your own key, check it under Settings → Providers — only an OpenRouter key (sk-or-…) works there.",
    "errors.ownKeyNotOpenRouter":
      "That is not an OpenRouter key — an OpenRouter key starts with sk-or-… (openrouter.ai → Keys). A key from OpenAI or Anthropic does not work here.",
    "errors.ownKeyUnknown": "OpenRouter does not know this key — check it at openrouter.ai → Keys.",
    "errors.ownKeyUnverified":
      "Could not verify the key with OpenRouter right now — try again in a moment.",
    "errors.providerUnreachable": "Couldn't reach the AI provider — please try again.",
    "errors.modelNotInRegion":
      "This model is not available with EU routing — pick another model from the list.",
    // generic
    "errors.generic": "Something went wrong. Please try again.",
    "errors.offline": "QUON's privacy filter can't be reached — please try again in a moment.",
  },
  de: {
    "errors.invalidCredentials": "E-Mail-Adresse oder Passwort stimmt nicht.",
    "errors.emailNotVerified":
      "Bestätige zuerst deine E-Mail-Adresse, dann kannst du dich anmelden.",
    "errors.accountSuspended": "Dieses Konto ist gesperrt.",
    "errors.invalidInviteCode": "Dieser Einladungscode ist ungültig.",
    "errors.invalidEmail": "Das sieht nicht nach einer gültigen E-Mail-Adresse aus.",
    "errors.invalidOrExpiredToken": "Dieser Link ist ungültig oder abgelaufen.",
    "errors.malformedToken": "Dieser Link ist fehlerhaft.",
    "errors.provisionFailed": "Dein KI-Zugang ließ sich nicht einrichten — versuch es noch einmal.",
    "errors.emailAlreadyRegistered": "Diese E-Mail-Adresse ist schon registriert.",
    "errors.currentPasswordIncorrect": "Dein aktuelles Passwort stimmt nicht.",
    "errors.passwordIncorrect": "Dieses Passwort stimmt nicht.",
    "errors.sessionExpired": "Deine Sitzung ist abgelaufen — melde dich bitte neu an.",
    "errors.notAuthenticated": "Melde dich an, um weiterzumachen.",
    "errors.tooManyDevices": "Du hast das Limit an registrierten Geräten erreicht.",
    "errors.badLanguage": "Die Sprache muss Deutsch oder Englisch sein.",
    "errors.noCloudOcrKey": "Cloud-Texterkennung ist für dieses Konto nicht eingerichtet.",
    "errors.invalidImage": "Dieses Bild ließ sich nicht lesen.",
    "errors.imageTooLarge": "Dieses Bild ist zu groß (max. 8 MB).",
    "errors.unsupportedImage": "Bildformat nicht unterstützt — nimm JPEG, PNG oder WebP.",
    "errors.noProviderKey": "Für diesen Anbieter ist kein API-Schlüssel hinterlegt.",
    "errors.connectionNoKey": "Für diese Verbindung ist kein API-Schlüssel hinterlegt.",
    "errors.providerRateLimited":
      "Der Modellanbieter drosselt gerade — warte kurz und versuch es noch einmal.",
    "errors.providerBudgetExhausted":
      "Dein KI-Budget ist aufgebraucht — das enthaltene Guthaben oder das Ausgabelimit dieses Kontos ist erreicht. Hinterleg unter Einstellungen → Anbieter deinen eigenen API-Schlüssel, um weiterzuchatten.",
    "errors.providerBadKey":
      "Der KI-Anbieter hat den API-Schlüssel dieses Kontos abgelehnt. Falls du einen eigenen Schlüssel hinterlegt hast, prüf ihn unter Einstellungen → Anbieter — dort funktioniert nur ein OpenRouter-Schlüssel (sk-or-…).",
    "errors.ownKeyNotOpenRouter":
      "Das ist kein OpenRouter-Schlüssel — ein OpenRouter-Schlüssel beginnt mit sk-or-… (openrouter.ai → Keys). Ein Schlüssel von OpenAI oder Anthropic funktioniert hier nicht.",
    "errors.ownKeyUnknown":
      "OpenRouter kennt diesen Schlüssel nicht — prüf ihn unter openrouter.ai → Keys.",
    "errors.ownKeyUnverified":
      "Der Schlüssel konnte gerade nicht bei OpenRouter geprüft werden — versuch es gleich noch einmal.",
    "errors.providerUnreachable": "Der KI-Anbieter war nicht erreichbar — versuch es noch einmal.",
    "errors.modelNotInRegion":
      "Dieses Modell gibt es im EU-Routing nicht — wähl ein anderes Modell aus der Liste.",
    "errors.generic": "Etwas ist schiefgelaufen. Versuch es noch einmal.",
    "errors.offline":
      "QUONs Datenschutzfilter ist nicht erreichbar — versuch es gleich noch einmal.",
  },
} as const;
