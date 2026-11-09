/** Reload attribution: the "black flash" instrumentation. The load-bearing
 *  case: a RELOAD navigation with no marker produces the UNEXPLAINED line -
 *  that's the webview-was-killed signal we're hunting. */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const diagAppend = vi.fn();
const previousSessionWasUnclean = vi.fn(() => false);
vi.mock("./diagLog", () => ({
  diagAppend: (...a: unknown[]) => diagAppend(...a),
  previousSessionWasUnclean: () => previousSessionWasUnclean(),
}));

import { explainBoot, markIntentionalReload } from "./reloadReason";

function stubEnv(navType: string) {
  const map = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
  vi.stubGlobal("performance", {
    getEntriesByType: () => [{ type: navType }],
  });
  return map;
}

beforeEach(() => {
  vi.clearAllMocks();
  previousSessionWasUnclean.mockReturnValue(false);
});
afterEach(() => vi.unstubAllGlobals());

describe("explainBoot", () => {
  it(
    "a healthy first navigation logs NOTHING — an always-on line would mean the " +
      "diagnostics buffer is never empty (feedback.spec caught exactly that)",
    () => {
      stubEnv("navigate");
      explainBoot();
      expect(diagAppend).not.toHaveBeenCalled();
    },
  );

  it(
    "a navigate boot AFTER an unclean shutdown logs its type — the silent-kill " +
      "signature from issue #37, which masqueraded as a plain navigate",
    () => {
      previousSessionWasUnclean.mockReturnValue(true);
      stubEnv("navigate");
      explainBoot();
      expect(diagAppend).toHaveBeenCalledWith("boot after unclean shutdown: type=navigate");
    },
  );

  it("an intentional reload is attributed and the marker consumed", () => {
    const store = stubEnv("reload");
    markIntentionalReload("update-banner");
    explainBoot();
    expect(diagAppend).toHaveBeenCalledWith("boot: reload (intentional: update-banner)");
    expect(store.has("quon_reload_reason_v1")).toBe(false);
    // The NEXT boot must not re-attribute the consumed marker.
    diagAppend.mockClear();
    stubEnv("navigate");
    explainBoot();
    expect(diagAppend).not.toHaveBeenCalled();
  });

  it("a reload nobody asked for is flagged as unexplained (the black-flash signal)", () => {
    stubEnv("reload");
    explainBoot();
    expect(diagAppend).toHaveBeenCalledWith(expect.stringContaining("UNEXPLAINED reload"));
  });

  it("survives a missing performance API", () => {
    stubEnv("reload");
    vi.stubGlobal("performance", {
      getEntriesByType: () => {
        throw new Error("nope");
      },
    });
    expect(() => explainBoot()).not.toThrow();
  });
});
