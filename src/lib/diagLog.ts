/**
 * Crash-surviving diagnostic breadcrumbs (the "mein Bruder bekommt immer wieder
 * diesen Fehler" report, 2026-07-29).
 *
 * iOS's "Auf … ist wiederholt ein Problem aufgetreten" screen means WebKit
 * killed the page PROCESS repeatedly (usually memory pressure / jetsam). No
 * JavaScript runs at that moment, so no handler can report the crash itself —
 * the honest best is breadcrumbs written SYNCHRONOUSLY to localStorage *before*
 * it, plus an on-next-launch marker that the previous session never shut down
 * cleanly. That is what this module provides; the user attaches it to feedback
 * ("Technisches Protokoll anhängen") with a visible preview.
 *
 * Privacy: plain localStorage on purpose (it must be readable/writable before
 * unlock and survive a crash mid-write). Only TECHNICAL strings are recorded —
 * error messages, stack heads, environment facts. Never chat/memory/document
 * content, and console.log/error are deliberately NOT wrapped (app logs could
 * carry user data). Sending is consent-gated in the feedback dialog with the
 * full text shown.
 */

const LOG_KEY = "quon_diag_v1";
const ALIVE_KEY = "quon_diag_alive_v1";

const MAX_ENTRIES = 40;
const MAX_MSG_CHARS = 300;
// 5 s, not 30: the iPhone crash loops (#68, #76) killed the page in under 30 s
// every time, so every lifetime read "~0s" and the one number that could have
// separated "dies at boot" from "dies after a minute" was lost. A localStorage
// write every 5 s costs nothing measurable.
const ALIVE_REFRESH_MS = 5_000;
/** A session shorter than this that ended uncleanly counts towards a crash
 *  LOOP (deviceClass.ts safe mode). Long enough for boot + the first heavy
 *  background job; short enough that a user reading a chat never trips it. */
const SHORT_SESSION_MS = 90_000;
const CRASH_LOOP_KEY = "quon_diag_crashloop_v1";

interface DiagEntry {
  t: number; // epoch ms
  m: string;
}

function readLog(): DiagEntry[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is DiagEntry =>
        typeof e === "object" && e !== null && typeof (e as DiagEntry).m === "string",
    );
  } catch {
    return [];
  }
}

function writeLog(entries: DiagEntry[]): void {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch {
    /* quota/private mode — diagnostics degrade, the app must not */
  }
}

/** Append a technical breadcrumb (truncated, ring-capped, synchronous). */
export function diagAppend(message: string): void {
  if (typeof window === "undefined") return;
  const m = message.replace(/\s+/g, " ").trim().slice(0, MAX_MSG_CHARS);
  if (!m) return;
  const log = readLog();
  // Collapse an immediately-repeated identical message into a counter instead
  // of flooding the ring (a render-loop error would otherwise evict everything
  // else within a second).
  const last = log[log.length - 1];
  if (last && (last.m === m || last.m === `${m} (wiederholt)`)) {
    last.m = m.endsWith(" (wiederholt)") ? m : `${m} (wiederholt)`;
    last.t = Date.now();
  } else {
    log.push({ t: Date.now(), m });
  }
  writeLog(log);
}

let installed = false;

/**
 * Install the global capture: window "error" + "unhandledrejection", and the
 * unclean-shutdown marker. Idempotent; call once from the app shell.
 *
 * Marker semantics, stated honestly: pagehide clears it, so finding it on boot
 * means the last session ended WITHOUT a clean shutdown — a crash OR a
 * force-close (iOS swiping a PWA away doesn't reliably fire pagehide). It is a
 * strong hint, not proof; the entry says so.
 */
let sessionStart = 0;
/** True when THIS boot followed an unclean shutdown (crash marker written).
 *  reloadReason.explainBoot() reads it: a boot line is only diagnostic in
 *  combination with that marker — see the export below. */
let uncleanPrevious = false;

/** Did the previous session end without a clean shutdown? Only meaningful
 *  after installDiagCapture() has run. */
export function previousSessionWasUnclean(): boolean {
  return uncleanPrevious;
}

let crashLoop = 0;

/** How many boots in a row (this one included) followed a SHORT unclean
 *  session. 0 after any session that lived past SHORT_SESSION_MS or ended
 *  cleanly. deviceClass.ts turns ≥ 2 into safe mode. Only meaningful after
 *  installDiagCapture() has run. */
export function crashLoopCount(): number {
  return crashLoop;
}

function readCrashLoop(): number {
  try {
    return Math.max(0, Number(localStorage.getItem(CRASH_LOOP_KEY)) || 0);
  } catch {
    return 0;
  }
}

function writeCrashLoop(n: number): void {
  crashLoop = n;
  try {
    if (n > 0) localStorage.setItem(CRASH_LOOP_KEY, String(n));
    else localStorage.removeItem(CRASH_LOOP_KEY);
  } catch {
    /* ignore */
  }
}

export function installDiagCapture(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  try {
    const prev = localStorage.getItem(ALIVE_KEY);
    if (prev) {
      uncleanPrevious = true;
      // "start|lastAlive" since 2026-08-10 (bare lastAlive before that). The
      // LIFETIME is the diagnostic payload: the black-flash report showed
      // sessions dying every ~3 minutes like clockwork — a constant lifetime
      // is the signature of a constant-rate leak (WebContent killed at a
      // fixed memory ceiling), an irregular one points at external pressure.
      const [startRaw, lastRaw] = prev.includes("|") ? prev.split("|") : [prev, prev];
      const last = Number(lastRaw) || 0;
      const start = Number(startRaw) || last;
      const lived = last > start ? Math.round((last - start) / 1000) : 0;
      diagAppend(
        `Vorherige Sitzung endete ohne sauberes Beenden (Absturz ODER erzwungenes Schließen) — ` +
          `zuletzt aktiv ${new Date(last).toISOString()}, Lebensdauer ~${lived}s`,
      );
      // A short unclean session extends the loop; a long one breaks it (the
      // page lived — whatever killed it was not the boot).
      if (lived * 1000 < SHORT_SESSION_MS) {
        writeCrashLoop(readCrashLoop() + 1);
        if (crashLoop >= 2) {
          diagAppend(
            `crash loop: ${crashLoop} kurze Sitzungen in Folge → Schonmodus (kein Modell-Vorladen, keine Hintergrund-Uploads/-Indizierung in dieser Sitzung)`,
          );
        }
      } else {
        writeCrashLoop(0);
      }
    }
    sessionStart = Date.now();
    localStorage.setItem(ALIVE_KEY, `${sessionStart}|${sessionStart}`);
  } catch {
    /* ignore */
  }
  setInterval(() => {
    const now = Date.now();
    try {
      localStorage.setItem(ALIVE_KEY, `${sessionStart}|${now}`);
    } catch {
      /* ignore */
    }
    // Lived past the short-session line: this boot was fine, so the NEXT
    // boot must not inherit a loop count from earlier crashes.
    if (crashLoop > 0 && now - sessionStart >= SHORT_SESSION_MS) writeCrashLoop(0);
  }, ALIVE_REFRESH_MS);
  window.addEventListener("pagehide", () => {
    try {
      localStorage.removeItem(ALIVE_KEY);
    } catch {
      /* ignore */
    }
  });

  // #68: the two iPhone "Fehler beim Senden" logs showed sessions dying
  // every few seconds with NO event between the boots. On iOS a PWA that is
  // backgrounded, restored from bfcache, or loses the network mid-send fails
  // in ways that are invisible unless the lifecycle itself is recorded.
  // Facts only — state names and booleans, never content.
  document.addEventListener("visibilitychange", () => {
    diagAppend(`lifecycle: visibility=${document.visibilityState} online=${navigator.onLine}`);
  });
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) diagAppend("lifecycle: restored from back/forward cache (persisted page)");
  });
  window.addEventListener("online", () => diagAppend("lifecycle: network online"));
  window.addEventListener("offline", () => diagAppend("lifecycle: network OFFLINE"));
  // Page Lifecycle API (Chromium): the browser froze the tab. Absent on WebKit.
  document.addEventListener("freeze", () => diagAppend("lifecycle: frozen by the browser"));
  document.addEventListener("resume", () => diagAppend("lifecycle: resumed by the browser"));

  window.addEventListener("error", (e) => {
    const src = e.filename ? ` @ ${e.filename.split("/").pop()}:${e.lineno}` : "";
    diagAppend(`error: ${e.message}${src}`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r: unknown = e.reason;
    const msg =
      r instanceof Error ? `${r.name}: ${r.message}` : typeof r === "string" ? r : "(no message)";
    diagAppend(`unhandled rejection: ${msg}`);
  });
}

/** The full report as plain text (environment header + entries), or "" when
 *  nothing has been recorded — the feedback dialog hides the option then. */
export function getDiagReport(): string {
  if (typeof window === "undefined") return "";
  const log = readLog();
  if (log.length === 0) return "";
  const nav = navigator as Navigator & { deviceMemory?: number; standalone?: boolean };
  const standalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches || nav.standalone === true;
  const header = [
    `erstellt: ${new Date().toISOString()}`,
    `ua: ${navigator.userAgent}`,
    `pwa: ${standalone ? "ja (standalone)" : "nein (browser-tab)"}`,
    `viewport: ${window.innerWidth}x${window.innerHeight}`,
    `deviceMemory: ${nav.deviceMemory ?? "n/a"}`,
    `sprache: ${navigator.language}`,
    `online: ${navigator.onLine}`,
    `sichtbar: ${typeof document !== "undefined" ? document.visibilityState : "n/a"}`,
  ].join("\n");
  const lines = log.map((e) => `${new Date(e.t).toISOString()} ${e.m}`).join("\n");
  return `${header}\n---\n${lines}`;
}

/** Wipe the recorded entries (offered next to the preview). */
export function clearDiagLog(): void {
  try {
    localStorage.removeItem(LOG_KEY);
  } catch {
    /* ignore */
  }
}
