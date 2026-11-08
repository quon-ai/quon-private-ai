import { useEffect, useState } from "react";

/**
 * False during server rendering and until React has attached on the client,
 * true afterwards. A server-rendered page's controls exist before React does,
 * and a click or keystroke in that window is silently lost (the language
 * switch of the public demo and docs pages, on slow e2e runners first).
 * Gate such controls with `disabled={!hydrated}` / `readOnly={!hydrated}`:
 * nothing can be lost, and Playwright's auto-wait covers the window.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
