import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  // Per-request CSP nonce, provided by src/server.ts via AsyncLocalStorage
  // (globalThis handshake — this file is isomorphic and cannot import
  // node:async_hooks). With `ssr.nonce` set, the router tags every inline
  // script it injects (hydration state, stream chunks) so the enforcing
  // `script-src 'nonce-…'` header lets exactly those run. On the client the
  // framework re-reads the nonce from the <meta property="csp-nonce"> tag.
  const nonce = (globalThis as { __quonCspNonce?: () => string | undefined }).__quonCspNonce?.();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    ...(nonce ? { ssr: { nonce } } : {}),
  });

  return router;
};
