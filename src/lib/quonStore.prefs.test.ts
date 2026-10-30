import { beforeEach, describe, expect, it } from "vitest";

import {
  applyRemotePrefs,
  getPrefsItem,
  getSweepCursor,
  onPrefsChange,
  quon,
  resetState,
  setSweepCursor,
  type PrefsItem,
} from "./quonStore";

beforeEach(() => resetState());

describe("prefs sync (the E2E `prefs` blob)", () => {
  it("getPrefsItem exposes the synced fields with id 'prefs'", () => {
    quon.setActiveModel("openrouter::openai/gpt-4o");
    quon.setAlwaysRedact(["Anna Müller"]);
    const item = getPrefsItem();
    expect(item.id).toBe("prefs");
    expect(item.activeModelId).toBe("openrouter::openai/gpt-4o");
    expect(item.alwaysRedact).toEqual(["Anna Müller"]);
    expect(item.updatedAt).toBeGreaterThan(0);
  });

  it("a synced-pref change fires onPrefsChange with the new item and bumps updatedAt", () => {
    const seen: PrefsItem[] = [];
    const off = onPrefsChange((it) => seen.push(it));
    quon.setProtectionLevel("review");
    off();
    expect(seen).toHaveLength(1);
    expect(seen[0].protectionLevel).toBe("review");
    expect(seen[0].updatedAt).toBeGreaterThan(0);
  });

  it("a device-local change (redactedTotal) does NOT touch the prefs blob", () => {
    const seen: PrefsItem[] = [];
    const off = onPrefsChange((it) => seen.push(it));
    quon.addRedacted(3); // redactedTotal is not synced
    off();
    expect(seen).toHaveLength(0);
    expect(getPrefsItem().updatedAt).toBe(0); // clock never bumped
  });

  it("applyRemotePrefs adopts a strictly-newer blob (LWW) without echoing back", () => {
    const echoed: PrefsItem[] = [];
    const off = onPrefsChange((it) => echoed.push(it));
    applyRemotePrefs({
      id: "prefs",
      protectionLevel: "review",
      activeModelId: "openrouter::google/gemini-2.5-pro",
      reasoningEffort: "high",
      useMemoryContext: false,
      alwaysRedact: ["Martin"],
      neverRedact: ["Xantan"],
      // A Dropbox/Paperless connection made on another device rides the same E2E blob.
      dropboxConnection: { refreshToken: "rt-123", path: "/Dokumente" },
      paperlessConnection: { baseUrl: "https://paperless.example.com", token: "tok-1" },
      updatedAt: Date.now() + 60_000,
    });
    off();
    const item = getPrefsItem();
    expect(item.activeModelId).toBe("openrouter::google/gemini-2.5-pro");
    expect(item.alwaysRedact).toEqual(["Martin"]);
    expect(item.neverRedact).toEqual(["Xantan"]);
    expect(item.dropboxConnection).toEqual({ refreshToken: "rt-123", path: "/Dokumente" });
    expect(item.paperlessConnection).toEqual({
      baseUrl: "https://paperless.example.com",
      token: "tok-1",
    });
    // applyRemote must not fire local change listeners (no push echo).
    expect(echoed).toHaveLength(0);
  });

  // --- v2: the Azure DevOps removal ---------------------------------------
  //
  // The integration is gone from the product, but the credential it stored is
  // not gone from anyone's data. Deleting the field from the type would have
  // left a live Personal Access Token in the synced ciphertext with no UI able
  // to remove it, for as long as the account exists.
  it("v2 migration deletes a stored Azure DevOps PAT arriving from an old client", () => {
    const echoed: PrefsItem[] = [];
    const off = onPrefsChange((it) => echoed.push(it));
    applyRemotePrefs({
      id: "prefs",
      protectionLevel: "local",
      activeModelId: "openrouter::anthropic/claude-sonnet-4",
      reasoningEffort: "off",
      useMemoryContext: true,
      alwaysRedact: [],
      neverRedact: [],
      // An older client still carries the field and the version it was written at.
      prefsSchemaVersion: 1,
      azureDevOpsConnection: {
        baseUrl: "https://dev.azure.com/contoso",
        pat: "pat-1",
        project: "MCCS nextgen",
      },
      updatedAt: Date.now() + 60_000,
    } as unknown as PrefsItem);
    off();

    const item = getPrefsItem() as PrefsItem & { azureDevOpsConnection?: unknown };
    expect(item.azureDevOpsConnection).toBeUndefined();
    expect(item.prefsSchemaVersion).toBe(2);
    // …and the cleaned blob is PUSHED. A migration is outside `set`, so nothing
    // fires a listener and the server would keep the last blob it was given —
    // the one still holding the PAT. This echo is the deliberate exception to
    // the no-echo rule asserted above: a credential removal must propagate.
    expect(echoed).toHaveLength(1);
    expect(
      (echoed[0] as PrefsItem & { azureDevOpsConnection?: unknown }).azureDevOpsConnection,
    ).toBeUndefined();
    expect(echoed[0].updatedAt).toBeGreaterThan(0);
  });

  it("v2 does not re-run v1: an account already on v1 keeps FINANCIAL_AMOUNT if it re-enabled it", () => {
    // v1 turned FINANCIAL_AMOUNT redaction OFF once, and its own doc comment
    // promises it never runs again. A single shared version guard would have
    // broken that promise the moment v2 was added — re-disabling the type for
    // everyone who had deliberately switched it back on.
    applyRemotePrefs({
      id: "prefs",
      protectionLevel: "local",
      activeModelId: "openrouter::anthropic/claude-sonnet-4",
      reasoningEffort: "off",
      useMemoryContext: true,
      alwaysRedact: [],
      neverRedact: [],
      prefsSchemaVersion: 1,
      disabledEntityTypes: [], // the user re-enabled amounts
      updatedAt: Date.now() + 120_000,
    } as unknown as PrefsItem);

    const item = getPrefsItem();
    expect(item.disabledEntityTypes).toEqual([]);
    expect(item.prefsSchemaVersion).toBe(2);
  });

  it("propagates an explicit Dropbox disconnect: a newer blob WITHOUT the connection clears it", () => {
    // Device A connects Dropbox → the connection rides the E2E prefs blob here.
    applyRemotePrefs({
      id: "prefs",
      protectionLevel: "none",
      activeModelId: "m",
      reasoningEffort: "off",
      useMemoryContext: true,
      alwaysRedact: [],
      neverRedact: [],
      dropboxConnection: { refreshToken: "rt", path: "/Docs" },
      updatedAt: 1000,
    });
    expect(getPrefsItem().dropboxConnection).toEqual({ refreshToken: "rt", path: "/Docs" });
    // Device A disconnects → pushes a NEWER blob that omits the connection.
    // Regression: `?? state` used to pin the stale connection, so a disconnect on
    // one device never reached the others.
    applyRemotePrefs({
      id: "prefs",
      protectionLevel: "none",
      activeModelId: "m",
      reasoningEffort: "off",
      useMemoryContext: true,
      alwaysRedact: [],
      neverRedact: [],
      updatedAt: 2000, // newer → wins, and the absent connection now clears it
    });
    expect(getPrefsItem().dropboxConnection).toBeUndefined();
  });

  it("setPaperlessConnection is a synced pref: it rides the blob and bumps the clock", () => {
    const seen: PrefsItem[] = [];
    const off = onPrefsChange((it) => seen.push(it));
    quon.setPaperlessConnection({ baseUrl: "https://dms.example.com", token: "tok" });
    off();
    expect(seen).toHaveLength(1);
    expect(getPrefsItem().paperlessConnection).toEqual({
      baseUrl: "https://dms.example.com",
      token: "tok",
    });
    expect(getPrefsItem().updatedAt).toBeGreaterThan(0);
  });

  it("propagates an explicit Paperless disconnect: a newer blob WITHOUT the connection clears it", () => {
    // Device A connects Paperless → the connection rides the E2E prefs blob here.
    applyRemotePrefs({
      id: "prefs",
      protectionLevel: "none",
      activeModelId: "m",
      reasoningEffort: "off",
      useMemoryContext: true,
      alwaysRedact: [],
      neverRedact: [],
      paperlessConnection: { baseUrl: "https://dms.example.com", token: "tok" },
      updatedAt: 1000,
    });
    expect(getPrefsItem().paperlessConnection).toEqual({
      baseUrl: "https://dms.example.com",
      token: "tok",
    });
    // Device A disconnects → pushes a NEWER blob that omits the connection.
    // Regression (same class as the Dropbox `?? state` bug): the absent field
    // must HARD-apply, or a disconnect on one device never reaches the others.
    applyRemotePrefs({
      id: "prefs",
      protectionLevel: "none",
      activeModelId: "m",
      reasoningEffort: "off",
      useMemoryContext: true,
      alwaysRedact: [],
      neverRedact: [],
      updatedAt: 2000, // newer → wins, and the absent connection now clears it
    });
    expect(getPrefsItem().paperlessConnection).toBeUndefined();
  });

  it("correctActiveModel changes the model WITHOUT bumping the clock or pushing", () => {
    // A system correction (invalid id → first valid) must not out-timestamp the
    // real choice arriving from the server, so it neither bumps updatedAt nor
    // fires a push. Regression for the fresh-device 'default wins over server' bug.
    const seen: PrefsItem[] = [];
    const off = onPrefsChange((it) => seen.push(it));
    quon.correctActiveModel("openrouter::openrouter/auto");
    off();
    expect(getPrefsItem().activeModelId).toBe("openrouter::openrouter/auto");
    expect(getPrefsItem().updatedAt).toBe(0);
    expect(seen).toHaveLength(0);
  });

  it("applyRemotePrefs ignores an older-or-equal blob (never regresses a local edit)", () => {
    quon.setActiveModel("openrouter::openai/gpt-4o"); // local edit → updatedAt ≈ now
    applyRemotePrefs({
      id: "prefs",
      protectionLevel: "none",
      activeModelId: "stale::model",
      reasoningEffort: "off",
      useMemoryContext: true,
      alwaysRedact: [],
      neverRedact: [],
      updatedAt: 1, // far older than the local edit
    });
    expect(getPrefsItem().activeModelId).toBe("openrouter::openai/gpt-4o");
  });
});

describe("sweep-cursor sync (P5 — key-wise MAX-merge, independent of the whole-blob LWW gate)", () => {
  const basePrefs = (overrides: Partial<PrefsItem>): PrefsItem => ({
    id: "prefs",
    protectionLevel: "none",
    activeModelId: "m",
    reasoningEffort: "off",
    useMemoryContext: true,
    alwaysRedact: [],
    neverRedact: [],
    updatedAt: 1,
    ...overrides,
  });

  it("getSweepCursor/setSweepCursor round-trip locally", () => {
    expect(getSweepCursor("s1")).toBeUndefined();
    setSweepCursor("s1", 7);
    expect(getSweepCursor("s1")).toBe(7);
  });

  it("a remote cursor ADVANCES a local one even when the rest of the blob is OLDER (stale-blob-carried cursor)", () => {
    setSweepCursor("s1", 5); // local advance, bumps prefsUpdatedAt
    const localTs = getPrefsItem().updatedAt;
    applyRemotePrefs(
      basePrefs({ sweepCursors: { s1: 9 }, updatedAt: localTs - 100 }), // OLDER blob overall
    );
    expect(getSweepCursor("s1")).toBe(9); // still merges — the cursor's own value is newer
    // The rest of the (older, otherwise-stale) blob must NOT have been adopted.
    expect(getPrefsItem().activeModelId).not.toBe("m");
  });

  it("an OLDER remote cursor for the SAME session can never rewind a newer local advance", () => {
    setSweepCursor("s1", 20);
    const localTs = getPrefsItem().updatedAt;
    applyRemotePrefs(basePrefs({ sweepCursors: { s1: 5 }, updatedAt: localTs + 1000 }));
    expect(getSweepCursor("s1")).toBe(20); // NOT rewound to 5
  });

  it("key-wise merge: a remote blob's cursor for a DIFFERENT session doesn't touch existing ones", () => {
    setSweepCursor("s1", 5);
    applyRemotePrefs(basePrefs({ sweepCursors: { s2: 3 }, updatedAt: Date.now() + 60_000 }));
    expect(getSweepCursor("s1")).toBe(5);
    expect(getSweepCursor("s2")).toBe(3);
  });

  it("an old blob with NO sweepCursors field at all does not wipe local cursors", () => {
    setSweepCursor("s1", 5);
    applyRemotePrefs(basePrefs({ updatedAt: Date.now() + 60_000 })); // no sweepCursors key
    expect(getSweepCursor("s1")).toBe(5);
  });

  it("getPrefsItem exposes the current cursor map for pushing", () => {
    setSweepCursor("s1", 5);
    setSweepCursor("s2", 9);
    expect(getPrefsItem().sweepCursors).toEqual({ s1: 5, s2: 9 });
  });
});

describe("redact lists are grow-only across devices", () => {
  // `prefs` is ONE blob with whole-blob last-write-wins, so two devices each
  // adding a term used to mean one was silently dropped. For alwaysRedact that
  // is a FAIL-OPEN: a value the user explicitly asked to redact quietly stops
  // being redacted. A redact list is a grow-only set, so it unions.
  const base = (over: Partial<PrefsItem>): PrefsItem =>
    ({ id: "prefs", updatedAt: 1000, ...over }) as PrefsItem;

  it("unions a newer blob's list with the local one instead of replacing it", () => {
    quon.setAlwaysRedact(["Kundennummer 48213"]); // added on THIS device
    applyRemotePrefs(base({ updatedAt: Date.now() + 5000, alwaysRedact: ["Anna Muster"] }));

    const list = getPrefsItem().alwaysRedact ?? [];
    expect(list).toContain("Kundennummer 48213"); // the local add survives
    expect(list).toContain("Anna Muster"); // and the remote one lands
  });

  it("adopts a term even from a blob that is otherwise STALE", () => {
    // The other device added a redaction but has an older clock for the rest of
    // the blob. Losing the term because some unrelated field is stale is exactly
    // the fail-open — same reasoning as sweepCursors.
    quon.setAlwaysRedact(["local"]);
    const localClock = getPrefsItem().updatedAt;
    applyRemotePrefs(base({ updatedAt: localClock - 1, alwaysRedact: ["from-old-device"] }));

    expect(getPrefsItem().alwaysRedact).toEqual(
      expect.arrayContaining(["local", "from-old-device"]),
    );
  });

  it("de-dups case-insensitively and keeps the local spelling", () => {
    // Matching is case-insensitive anyway, so two spellings are one term — and
    // the user's own capitalisation should not be overwritten by another device.
    quon.setAlwaysRedact(["Anna Muster"]);
    applyRemotePrefs(base({ updatedAt: Date.now() + 5000, alwaysRedact: ["anna muster"] }));
    expect(getPrefsItem().alwaysRedact).toEqual(["Anna Muster"]);
  });

  it("unions neverRedact the same way", () => {
    quon.setNeverRedact(["Xantan"]);
    applyRemotePrefs(base({ updatedAt: Date.now() + 5000, neverRedact: ["Guarkernmehl"] }));
    expect(getPrefsItem().neverRedact).toEqual(expect.arrayContaining(["Xantan", "Guarkernmehl"]));
  });

  it("does not fire a change or bump the clock when the union adds nothing", () => {
    // A pull that changes nothing must not echo back — that would ping-pong.
    quon.setAlwaysRedact(["Anna Muster"]);
    const before = getPrefsItem().updatedAt;
    const seen: PrefsItem[] = [];
    const off = onPrefsChange((it) => seen.push(it));
    applyRemotePrefs(base({ updatedAt: before - 1, alwaysRedact: ["Anna Muster"] }));
    off();
    expect(seen).toHaveLength(0);
    expect(getPrefsItem().updatedAt).toBe(before);
  });
});

describe("FINANCIAL_AMOUNT default (prefs migration v1)", () => {
  it("is disabled for a fresh account", () => {
    // An amount identifies nobody, and redacting it usually destroys the very
    // thing the user is asking the model about ("is this invoice plausible?").
    resetState();
    expect(getPrefsItem().disabledEntityTypes).toContain("FINANCIAL_AMOUNT");
  });

  it("migrates an EXISTING account exactly once", () => {
    // A pre-migration blob carries no schema version. Operator decision: apply
    // the new default to everyone, not just new accounts, so beta testers get
    // what was actually chosen instead of the old default.
    resetState();
    applyRemotePrefs({
      ...getPrefsItem(),
      disabledEntityTypes: [],
      prefsSchemaVersion: undefined,
      updatedAt: Date.now() + 1000,
    });
    expect(getPrefsItem().disabledEntityTypes).toContain("FINANCIAL_AMOUNT");
    // Migrated all the way to the CURRENT version, not just past v1.
    expect(getPrefsItem().prefsSchemaVersion).toBe(2);
  });

  it("never re-runs against someone who switched amounts back ON", () => {
    // The migration turns redaction OFF, so running it twice would silently undo
    // a deliberate choice. The marker syncs with the blob precisely so a SECOND
    // DEVICE cannot re-apply it. This is the test that matters.
    resetState();
    applyRemotePrefs({
      ...getPrefsItem(),
      disabledEntityTypes: [],
      prefsSchemaVersion: 1,
      updatedAt: Date.now() + 1000,
    });
    expect(getPrefsItem().disabledEntityTypes).toEqual([]);
  });
});
