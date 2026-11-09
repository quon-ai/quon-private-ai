/**
 * The platform capability seam.
 *
 * QUON runs in three shells - the browser (the reference implementation), a
 * Tauri desktop app, and later a mobile one. Feature code must ask for a
 * CAPABILITY, never for a platform: no `if (isMac)` outside this directory.
 * That is the single rule that keeps one codebase from becoming three.
 *
 * The web implementation is today's behaviour, so the hosted build is unchanged
 * by construction and every existing test still describes the shipped product.
 *
 * Why this exists before anything else native: the Tauri webview's origin is
 * `tauri://localhost`, so every call to QUON's own API is CROSS-SITE, and
 * `cookie_samesite` is "lax" - the session cookie is simply not sent. Browser
 * `fetch` therefore cannot log in from the shell no matter what CORS allows.
 * The seam is not tidiness; it is the prerequisite for the desktop app doing
 * anything at all, and the same seam later carries IMAP (raw sockets) and real
 * filesystem access.
 */

export type PlatformKind = "web" | "tauri" | "capacitor";

/** Detected once. Tauri v2 injects `__TAURI_INTERNALS__` into the page; the
 *  Capacitor Android shell injects `Capacitor` (its native bridge) - and only
 *  reports native when it is native: the same bridge object exists, with
 *  `isNativePlatform() === false`, when a Capacitor-built bundle runs in a
 *  plain browser tab. */
export function platformKind(): PlatformKind {
  // globalThis, not window: identical in a browser/WebView, and it also works
  // under the node test environment and during SSR without a typeof guard.
  if ("__TAURI_INTERNALS__" in globalThis) return "tauri";
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (cap?.isNativePlatform?.() === true) return "capacitor";
  return "web";
}

export const isNative = (): boolean => platformKind() !== "web";

/**
 * A fetch that is not bound by the page's origin.
 *
 * On the web this is exactly `globalThis.fetch` - same CORS rules, same cookie
 * jar, no behaviour change. In a native shell it routes through the host, which
 * has its own cookie jar and no notion of CORS, so a session cookie survives
 * and a LAN service (a Paperless without TLS, a Nextcloud) becomes reachable.
 */
export interface HttpCapability {
  /** True when requests escape the page's origin rules. */
  readonly unrestricted: boolean;
  fetch: typeof globalThis.fetch;
  /** A fetch whose response BODY streams. Only needed where `fetch` cannot
   *  (the Capacitor shell's native fetch buffers whole responses); absent means
   *  `fetch` already streams - the browser and the Tauri plugin both do. */
  streamingFetch?: typeof globalThis.fetch;
}

let httpImpl: HttpCapability | null = null;

/** Install an implementation explicitly (tests; an eager native warm-up). */
export function provideHttp(impl: HttpCapability): void {
  httpImpl = impl;
}

/** Memoised native fetch, imported on first use. */
let nativeFetchPromise: Promise<typeof globalThis.fetch> | null = null;

function nativeFetch(): Promise<typeof globalThis.fetch> {
  nativeFetchPromise ??= import("@tauri-apps/plugin-http").then(
    (m) => m.fetch as unknown as typeof globalThis.fetch,
  );
  return nativeFetchPromise;
}

/** The streaming fetch for the Capacitor shell, imported on first use - the
 *  module is small, but the web bundle has no reason to carry it. */
let capacitorStreamPromise: Promise<typeof globalThis.fetch> | null = null;
function capacitorStream(): Promise<typeof globalThis.fetch> {
  capacitorStreamPromise ??= import("./streamHttp").then(
    (m) => m.streamFetch as unknown as typeof globalThis.fetch,
  );
  return capacitorStreamPromise;
}

/** The fetch to use for a response the caller reads AS A STREAM (the chat
 *  answer, its resume). Same as `http().fetch` wherever that streams. */
export function streamingFetch(): typeof globalThis.fetch {
  const h = http();
  return h.streamingFetch ?? h.fetch;
}

/**
 * The http capability.
 *
 * In a native shell this resolves LAZILY - each call awaits the plugin module
 * on first use - rather than requiring an install step to have completed
 * first. With an install step the first health poll races the import: it wins,
 * goes out through the browser fetch, and is refused by CORS, so the app shows
 * "QUON nicht erreichbar" against a perfectly healthy API. A seam that only
 * works if something ran earlier will be wrong again; resolving on demand
 * cannot be raced.
 */
export function http(): HttpCapability {
  if (httpImpl) return httpImpl;
  if (platformKind() === "capacitor") {
    // The Android shell enables CapacitorHttp (capacitor.config.ts), which
    // replaces the WebView's `fetch` with the native HTTP stack - own cookie
    // jar, no CORS - before any app code runs. Resolved per call, not captured
    // at module load, so the patched function is the one used.
    return {
      unrestricted: true,
      fetch: (...args) => globalThis.fetch(...args),
      // The chat answer (SSE) - CapacitorHttp cannot stream, so those two
      // requests go through the app's own native plugin (streamHttp.ts).
      streamingFetch: async (...args) => (await capacitorStream())(...args),
    };
  }
  if (platformKind() === "tauri") {
    return {
      unrestricted: true,
      fetch: async (...args) => (await nativeFetch())(...args),
    };
  }
  return {
    unrestricted: false,
    // Bound: an unbound `fetch` throws "Illegal invocation" in some engines.
    fetch: (...args) => globalThis.fetch(...args),
  };
}

// --- mail (IMAP) - native-only ---------------------------------------------

export interface MailMessageData {
  uid: number;
  /** RFC Message-ID when present - the idempotency key for ingest. */
  messageId: string | null;
  from: string | null;
  to: string | null;
  date: string | null;
  subject: string | null;
  body: string;
}

export interface MailFetchData {
  uidValidity: number;
  /** The stored cursor was invalidated (UIDVALIDITY rotated) - re-import
   *  converges because ingest is idempotent by Message-ID. */
  reset: boolean;
  messages: MailMessageData[];
  lastUid: number;
  more: boolean;
}

/**
 * IMAP access, implemented in the Rust host (src-tauri/src/mail.rs): TLS, the
 * protocol and MIME parsing never enter the webview, and the password lives in
 * the OS keychain - storePassword is write-only from the page's perspective.
 *
 * `null` on the web: a browser has no TCP. Feature code must treat null as
 * "this source doesn't exist here", not as an error.
 */
export interface MailSearchHit {
  folder: string;
  uid: number;
  messageId: string | null;
  from: string | null;
  date: string | null;
  subject: string | null;
}

export interface MailCapability {
  storePassword(host: string, username: string, password: string): Promise<void>;
  deletePassword(host: string, username: string): Promise<void>;
  listFolders(host: string, port: number, username: string): Promise<string[]>;
  /** Server-side IMAP SEARCH; headers only - nothing is bulk-downloaded. */
  search(args: {
    host: string;
    port: number;
    username: string;
    folders: string[];
    query: string;
    limit: number;
  }): Promise<MailSearchHit[]>;
  /** Fetch + parse exactly one message ("read on demand"). */
  read(args: {
    host: string;
    port: number;
    username: string;
    folder: string;
    uid: number;
  }): Promise<MailMessageData>;
  fetchSince(args: {
    host: string;
    port: number;
    username: string;
    folder: string;
    uidValidity?: number;
    lastUid: number;
    limit: number;
  }): Promise<MailFetchData>;
}

let mailImpl: MailCapability | null | undefined;

/** Test-only / native-eager injection (mirrors provideHttp). */
export function provideMail(impl: MailCapability | null): void {
  mailImpl = impl;
}

/** Memoised Tauri invoke, imported on first use - same no-install-step rule as
 *  http(): a capability that only works if something ran earlier is a bug
 *  factory (see http()'s doc). */
let invokePromise: Promise<
  (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
> | null = null;
function tauriInvoke() {
  invokePromise ??= import("@tauri-apps/api/core").then((m) => m.invoke);
  return invokePromise;
}

export function mail(): MailCapability | null {
  if (mailImpl !== undefined) return mailImpl;
  if (platformKind() !== "tauri") return null;
  return {
    storePassword: async (host, username, password) =>
      void (await (
        await tauriInvoke()
      )("mail_store_password", { host, username, password })),
    deletePassword: async (host, username) =>
      void (await (
        await tauriInvoke()
      )("mail_delete_password", { host, username })),
    listFolders: async (host, port, username) => {
      const folders = (await (
        await tauriInvoke()
      )("mail_list_folders", {
        host,
        port,
        username,
      })) as Array<{ name: string }>;
      return folders.map((f) => f.name);
    },
    search: async (args) =>
      (await (
        await tauriInvoke()
      )("mail_search", {
        host: args.host,
        port: args.port,
        username: args.username,
        folders: args.folders,
        query: args.query,
        limit: args.limit,
      })) as MailSearchHit[],
    read: async (args) =>
      (await (
        await tauriInvoke()
      )("mail_read_message", {
        host: args.host,
        port: args.port,
        username: args.username,
        folder: args.folder,
        uid: args.uid,
      })) as MailMessageData,
    fetchSince: async (args) =>
      (await (
        await tauriInvoke()
      )("mail_fetch_since", {
        host: args.host,
        port: args.port,
        username: args.username,
        folder: args.folder,
        uidValidity: args.uidValidity ?? null,
        lastUid: args.lastUid,
        limit: args.limit,
      })) as MailFetchData,
  };
}

// --- files (real filesystem) - native-only ---------------------------------

export interface PickedFolder {
  path: string;
  name: string;
}

export interface ListedFile {
  /** Root-relative path with `/` separators - the connector's stable ref. */
  refPath: string;
  size: number;
}

/** One entry of a mkdir call. `reason` is the host's machine code for
 *  "rejected" (symlink, file_exists, hidden, ...) - worded in firstParty.ts. */
export interface MkdirResult {
  path: string;
  status: "created" | "existed" | "rejected";
  reason?: string;
}

export interface MoveResult {
  from: string;
  /** The actual destination when moved ("into a folder" resolved). */
  to: string;
  status: "moved" | "rejected";
  reason?: string;
}

export interface WriteResult {
  path: string;
  status: "written" | "rejected";
  reason?: string;
}

/**
 * Real filesystem access, implemented in the Rust host (src-tauri/src/files.rs).
 * The OS folder picker runs HOST-side and registers the pick as a granted
 * root; list/read are canonicalize+prefix contained there - the page can never
 * name a path the user didn't grant. The writes - mkdir, move, write - are all
 * non-destructive (never delete, never overwrite) and walk their paths without
 * following symlinks. `null` on the web (the FS Access API / input fallback
 * covers reading there).
 */
export interface FilesCapability {
  pickFolder(): Promise<PickedFolder | null>;
  list(root: string, max: number): Promise<ListedFile[]>;
  readFile(root: string, refPath: string): Promise<ArrayBuffer>;
  mkdir(root: string, paths: string[]): Promise<MkdirResult[]>;
  move(root: string, moves: { from: string; to: string }[]): Promise<MoveResult[]>;
  write(root: string, files: { path: string; content: string }[]): Promise<WriteResult[]>;
}

let filesImpl: FilesCapability | null | undefined;

/** Test-only / native-eager injection (mirrors provideHttp/provideMail). */
export function provideFiles(impl: FilesCapability | null): void {
  filesImpl = impl;
}

export function files(): FilesCapability | null {
  if (filesImpl !== undefined) return filesImpl;
  if (platformKind() !== "tauri") return null;
  return {
    pickFolder: async () =>
      (await (
        await tauriInvoke()
      )("files_pick_folder")) as PickedFolder | null,
    list: async (root, max) =>
      (await (
        await tauriInvoke()
      )("files_list", { root, max })) as ListedFile[],
    readFile: async (root, refPath) =>
      (await (
        await tauriInvoke()
      )("files_read", { root, refPath })) as ArrayBuffer,
    mkdir: async (root, paths) =>
      (await (
        await tauriInvoke()
      )("files_mkdir", { root, paths })) as MkdirResult[],
    move: async (root, moves) =>
      (await (
        await tauriInvoke()
      )("files_move", { root, moves })) as MoveResult[],
    write: async (root, files) =>
      (await (
        await tauriInvoke()
      )("files_write", { root, files })) as WriteResult[],
  };
}

// --- embeddings - native-only (the black-flash fix) ------------------------

/**
 * On-device text embeddings in the Rust host, so the webview never loads the
 * ~20MB ONNX/WASM ML runtime (its WebKit WASM compilation gets the WebContent
 * process CPU-killed). Same quantized MiniLM + tokenizer as the browser;
 * calibrated retrieval-equivalent (native queries retrieve the same best match
 * from browser-embedded vectors - src-tauri/tests/embed_parity.rs), so vectors
 * keep one embModel id and native/web never re-embed each other.
 *
 * `null` on the web - the browser worker path stays exactly as before.
 */
export interface EmbedCapability {
  warm(): Promise<void>;
  embed(texts: string[]): Promise<number[][]>;
}

let embedImpl: EmbedCapability | null | undefined;

export function provideEmbed(impl: EmbedCapability | null): void {
  embedImpl = impl;
}

export function embed(): EmbedCapability | null {
  if (embedImpl !== undefined) return embedImpl;
  if (platformKind() !== "tauri") return null;
  return {
    warm: async () => void (await (await tauriInvoke())("embed_warm")),
    embed: async (texts) => (await (await tauriInvoke())("embed_texts", { texts })) as number[][],
  };
}

/** Test-only: forget an injected implementation so a cold start can be observed. */
export function resetForTest(): void {
  httpImpl = null;
  nativeFetchPromise = null;
  capacitorStreamPromise = null;
  mailImpl = undefined;
  filesImpl = undefined;
  embedImpl = undefined;
  invokePromise = null;
}
