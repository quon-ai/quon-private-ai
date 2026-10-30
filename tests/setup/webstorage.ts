/**
 * A deterministic in-memory `localStorage` / `sessionStorage` for the unit run.
 *
 * Why this exists (found 2026-08-04, the first CI run on a real runner):
 * `vitest.config.ts` sets `environment: "node"`, so there is no DOM and Web
 * Storage should not exist at all. The suite passed anyway on the developer's
 * machine — because **Node 25 ships Web Storage as a built-in global**, which
 * Node 20 (what CI pins) does not. So `npm run test` was green locally and
 * `ReferenceError: sessionStorage is not defined` on the runner. Nobody saw it
 * because CI itself had been failing for other reasons for a week.
 *
 * The bug was never the missing global — it was the suite silently depending on
 * whichever Node the machine happened to have. So this installs OUR shim
 * ALWAYS, even where a native implementation exists: identical behaviour on
 * every Node version is the whole point, and a test that behaves differently on
 * two machines is worth less than no test.
 *
 * Deliberately minimal and spec-shaped: string coercion, `length`, `key(i)`,
 * and insertion order — the parts the stores under test actually rely on.
 */

class MemoryStorage implements Storage {
  private map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    // Spec: a missing key is null, never undefined — code under test branches
    // on `=== null` and on falsiness, and those differ for undefined.
    return this.map.has(String(key)) ? (this.map.get(String(key)) as string) : null;
  }

  setItem(key: string, value: string): void {
    this.map.set(String(key), String(value));
  }

  removeItem(key: string): void {
    this.map.delete(String(key));
  }

  clear(): void {
    this.map.clear();
  }
}

for (const name of ["localStorage", "sessionStorage"] as const) {
  Object.defineProperty(globalThis, name, {
    value: new MemoryStorage(),
    writable: true,
    configurable: true,
  });
}
