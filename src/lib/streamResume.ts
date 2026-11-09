/**
 * Helpers for re-attaching to a chat stream after the browser dropped it.
 *
 * The trigger case is mobile backgrounding: the OS freezes the page, the SSE
 * socket dies, and JavaScript resumes only when the user comes back. The
 * generation itself survives server-side (stream_jobs.py), so the client just
 * has to notice "this was a transport failure, not a real error" and reconnect
 * once it is visible again.
 */

import { QuonError, StreamPayloadError } from "./quonApi";

/**
 * True when an error looks like the connection broke rather than the request
 * being rejected. Only these are worth resuming - a provider error, a 4xx/5xx
 * or a rejected payload is a real answer about the request and must surface.
 *
 * QuonError carries the HTTP status when there was a response; a fetch that
 * never got one (dropped socket, offline, frozen tab) has none, which is
 * exactly the signature we resume on. A raw TypeError is fetch's own
 * network-failure shape.
 */
export function isTransportFailure(err: unknown, ownAbort = true): boolean {
  // An `{error}` event in the stream body is the provider's answer - it has no
  // HTTP status (the stream was 200), so it would otherwise pass as a dropped
  // socket and be resumed into "Verbindung verloren".
  if (err instanceof StreamPayloadError) return false;
  if (err instanceof QuonError) return err.status === undefined;
  if (err instanceof DOMException && err.name === "AbortError") {
    // An abort is only "not worth resuming" when WE aborted (the user pressed
    // stop). A mobile OS tearing down an in-flight request of a backgrounded
    // tab surfaces as an AbortError too, and that is precisely the case the job
    // buffer exists for - treating it as final threw the answer away while the
    // server had already finished writing it.
    return !ownAbort;
  }
  return err instanceof TypeError;
}

/**
 * Resolve once the document is visible (immediately if it already is), so a
 * reconnect is not attempted while the tab is still frozen/hidden - that
 * attempt would just fail again and burn a retry. Also resolves if the run is
 * aborted, so the caller can bail promptly.
 */
export function whenVisible(signal?: AbortSignal): Promise<void> {
  if (typeof document === "undefined" || document.visibilityState === "visible") {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const done = () => {
      document.removeEventListener("visibilitychange", onChange);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const onChange = () => {
      if (document.visibilityState === "visible") done();
    };
    document.addEventListener("visibilitychange", onChange);
    signal?.addEventListener("abort", done, { once: true });
  });
}
