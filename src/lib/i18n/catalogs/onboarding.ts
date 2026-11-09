/**
 * "onboarding" namespace UI strings. Keys are prefixed `onboarding.*`. Keep `en` and `de`
 * in sync - a missing German key is a compile error via catalog.ts's typing.
 *
 * The step-1 "Redacted N" callout is count-driven - `onboarding.callout.normal.one` /
 * `.other` are picked via `plural()`. Neither language actually inflects "redacted" /
 * "geschwärzt" by count, but the pair still exists (rather than a single interpolated
 * template) so the count-1 case can read "1 redacted" instead of forcing every count
 * through the same `{count}` template - and so a future language that does inflect
 * drops in cleanly.
 */
export const onboarding = {
  en: {
    "onboarding.callout.normal.one":
      "1 redacted. Tap to see what — and flip to your original wording anytime.",
    "onboarding.callout.normal.other":
      "{count} redacted. Tap to see what — and flip to your original wording anytime.",
    "onboarding.callout.fallback":
      "{count} redacted — but the deep-scan layer is offline right now, so some items may have been missed. Tap to check.",
    "onboarding.callout.showHint": 'Look for "Show original" / "Show anonymized".',
    "onboarding.callout.skip": "Skip",
    "onboarding.callout.skipAriaLabel": "Skip onboarding",

    "onboarding.teaser.heading": "That's the core loop. Two more things worth knowing:",
    "onboarding.teaser.reviewTitle": "Review mode",
    "onboarding.teaser.reviewDescription": "Approve every redaction before it sends.",
    "onboarding.teaser.memoryTitle": "Memory & Projects",
    "onboarding.teaser.memoryDescription":
      "Save facts once; QUON recalls them — still scrubbed before sending.",
    "onboarding.teaser.showMe": "Show me",

    "onboarding.notice.dismiss": "Dismiss",
  },
  de: {
    "onboarding.callout.normal.one":
      "1 geschwärzt. Tipp drauf, um zu sehen, was — und wechsle jederzeit zurück zu deinem Original.",
    "onboarding.callout.normal.other":
      "{count} geschwärzt. Tipp drauf, um zu sehen, was — und wechsle jederzeit zurück zu deinem Original.",
    "onboarding.callout.fallback":
      "{count} geschwärzt — aber die Tiefenprüfung ist gerade offline, ein paar Angaben könnten also durchgerutscht sein. Tipp drauf, um das zu prüfen.",
    "onboarding.callout.showHint": 'Achte auf „Original anzeigen" / „Anonymisiert anzeigen".',
    "onboarding.callout.skip": "Überspringen",
    "onboarding.callout.skipAriaLabel": "Onboarding überspringen",

    "onboarding.teaser.heading": "Das ist die Grundidee. Noch zwei Dinge, die sich lohnen:",
    "onboarding.teaser.reviewTitle": "Review-Modus",
    "onboarding.teaser.reviewDescription": "Gib jede Schwärzung frei, bevor sie rausgeht.",
    "onboarding.teaser.memoryTitle": "Erinnerungen & Projekte",
    "onboarding.teaser.memoryDescription":
      "Speicher Fakten einmal, QUON merkt sie sich — und schwärzt sie trotzdem vor dem Senden.",
    "onboarding.teaser.showMe": "Zeig’s mir",

    "onboarding.notice.dismiss": "Schließen",
  },
} as const;
