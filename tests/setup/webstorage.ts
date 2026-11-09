/**
 * A deterministic in-memory `localStorage` / `sessionStorage` for the unit run.
 *
 * Why this exists: `vitest.config.ts` sets `environment: "node"`, so there is
 * no DOM and Web Storage should not exist at all. **Node 25 ships Web Storage
 * as a built-in global**, which Node 20 (what CI pins) does not, so without
 * this the suite is green on a developer machine with a newer Node and fails
 * on the runner with `ReferenceError: sessionStorage is not defined`.
 *
 * The bug is never the missing global, it is the suite silently depending on
 * whichever Node the machine happens to have. So this installs the shim
 * always, even where a native implementation exists: identical behaviour on
 * every Node version is the whole point, and a test that behaves differently on
 * two machines is worth less than no test.
 *
 * Deliberately minimal and spec-shaped: string coercion, `length`, `key(i)`,
 * and insertion order - the parts the stores under test actually rely on.
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
    // Spec: a missing key is null, never undefined - code under test branches
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
