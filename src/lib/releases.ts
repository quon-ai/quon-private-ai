/**
 * Release notes shown once per release in a "What's new" popup.
 *
 * To announce a new release: add a new entry at the TOP of `RELEASES` with a
 * fresh `id`. The popup compares the latest id against the one stored in
 * localStorage and shows once per device, then marks it seen.
 */

import {
  Bot,
  Brain,
  FileText,
  Gauge,
  Globe,
  KeyRound,
  Mic,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export interface ReleaseItem {
  icon: LucideIcon;
  title: string;
  desc: string;
}

export interface Release {
  id: string; // unique, stable — bump for each release
  date: string; // human-friendly, e.g. "June 2026"
  title: string;
  subtitle?: string;
  items: ReleaseItem[];
}

// Newest first. Only the top entry is shown (once) by the popup.
// Content is deliberately plain-string (not i18n'd — see nav.ts note); QUON is
// German-default, so recent entries are written in German.
export const RELEASES: Release[] = [
  {
    id: "2026.08-kompakte-chats",
    date: "August 2026",
    title: "Schnellere Chats — und eine Bitte",
    subtitle:
      "Lange Unterhaltungen brauchen jetzt deutlich weniger Platz und bremsen die App nicht mehr aus. Dafür müssen deine Geräte einmal nachziehen.",
    items: [
      {
        icon: Gauge,
        title: "Lange Chats bremsen nicht mehr",
        desc: "Der Verlauf wird beim Schreiben nicht mehr bei jedem einzelnen Wort neu gespeichert, und eine lange Unterhaltung braucht nur noch rund ein Viertel des bisherigen Platzes. Auf dem iPhone macht das den größten Unterschied.",
      },
      {
        icon: ShieldCheck,
        title: "An der Verschlüsselung ändert sich nichts",
        desc: "Deine Chats werden weiterhin auf deinem Gerät verschlüsselt, bevor sie den Server erreichen. Neu ist nur, dass sie vorher zusammengepackt werden — der Server sieht wie bisher ausschließlich unlesbare Daten.",
      },
      {
        icon: RefreshCw,
        title: "Bitte jedes Gerät einmal neu laden",
        desc: "Ein Gerät mit der alten Version kann die neu gespeicherten Chats vorübergehend nicht anzeigen. Es geht nichts verloren — sie erscheinen wieder, sobald das Gerät die neue Version geladen hat. Im Browser und auf dem iPhone genügt ein Neuladen, die Mac-App braucht eine neue Installation.",
      },
    ],
  },
  {
    id: "2026.07-agents-tools",
    date: "Juli 2026",
    title: "Neu: Agenten, Websuche & mehr",
    subtitle:
      "Die wichtigsten Neuerungen der letzten Wochen — privat wie immer, alles auf deinem Gerät gefiltert.",
    items: [
      {
        icon: Bot,
        title: "Automatische Agenten",
        desc: "Lass QUON im Hintergrund arbeiten: das Web beobachten oder Aufgaben über deine eigenen Notizen und Dokumente erledigen — geplant und Ende-zu-Ende-verschlüsselt.",
      },
      {
        icon: Globe,
        title: "Websuche & Werkzeuge",
        desc: "Der Assistent kann jetzt live im Web suchen und auf deine Erinnerungen und Dokumente zugreifen — nur deine gefilterte Frage verlässt das Gerät.",
      },
      {
        icon: Brain,
        title: "Denkprozess sichtbar",
        desc: "Sieh, wie das Modell denkt: Der Reasoning-Verlauf erscheint in einem aufklappbaren Panel.",
      },
      {
        icon: Mic,
        title: "Diktieren statt tippen",
        desc: "Sprich deine Nachricht einfach ein — die Umwandlung in Text läuft komplett auf deinem Gerät.",
      },
      {
        icon: ScanLine,
        title: "Fotos & Briefe scannen",
        desc: "Fotografiere Briefe oder Verträge ab und mach sie durchsuchbar — on-device, mit optionalem Cloud-Modell für schwierige Fälle.",
      },
      {
        icon: Wrench,
        title: "Viele Fehlerbehebungen",
        desc: "Zuverlässigere Geräte-Synchronisation (Dokumente, Dropbox), stabilere Verarbeitung großer Dateien und robustere Chat-Antworten.",
      },
      {
        icon: ShieldCheck,
        title: "Sicherheit & Transparenz",
        desc: "Sicherheits-Review, automatische Lieferketten-Prüfung (SBOM & Schwachstellen-Scans) und einsehbarer Quellcode.",
      },
      {
        icon: Gauge,
        title: "Schneller & abgesichert",
        desc: "Erweiterte Test-Suite (Chromium + WebKit) und schnellere Builds sichern jede Änderung ab, bevor sie live geht.",
      },
    ],
  },
  {
    id: "2026.06-memory-documents",
    date: "June 2026",
    title: "Memory & Documents are here",
    subtitle: "QUON can now remember your context and chat with your files — all on your device.",
    items: [
      {
        icon: Brain,
        title: "Memory",
        desc: "Save facts and notes. QUON recalls them to personalize answers — encrypted on your device.",
      },
      {
        icon: FileText,
        title: "Documents",
        desc: "Upload PDFs, Word and text files. They're read and indexed locally, never uploaded in the clear.",
      },
      {
        icon: Sparkles,
        title: "Context-aware chat",
        desc: "Ask about your own info and QUON pulls in the right memory or document — scrubbed before it reaches the AI.",
      },
    ],
  },
  {
    id: "2026.06-accounts-e2e",
    date: "June 2026",
    title: "Your private account is here",
    subtitle: "QUON now keeps your conversations truly yours — encrypted, synced, and recoverable.",
    items: [
      {
        icon: ShieldCheck,
        title: "Accounts + end-to-end encryption",
        desc: "Sign in with email & password. Your chats are encrypted on your device before they're ever stored — not even QUON can read them.",
      },
      {
        icon: KeyRound,
        title: "Your recovery phrase",
        desc: "You get a 12-word phrase when you sign up. It's your backup key — keep it safe; it's the only way back in if you forget your password.",
      },
      {
        icon: RefreshCw,
        title: "Sync across your devices",
        desc: "Log in anywhere and your chat history is right there — still fully encrypted end to end.",
      },
      {
        icon: Sparkles,
        title: "AI access included",
        desc: "Every account comes with included AI credits. Just start chatting — no keys or setup needed.",
      },
    ],
  },
];

export const LATEST_RELEASE: Release = RELEASES[0];

const SEEN_KEY = "quon_release_seen_v1";

/** The latest release if the user hasn't seen it on this device, else null. */
export function getUnseenRelease(): Release | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(SEEN_KEY) === LATEST_RELEASE.id ? null : LATEST_RELEASE;
  } catch {
    return null;
  }
}

export function markReleaseSeen(id: string): void {
  try {
    localStorage.setItem(SEEN_KEY, id);
  } catch {
    /* ignore (private mode / quota) */
  }
}
