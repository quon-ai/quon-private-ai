import { verifyEmail } from "@/lib/authStore";

/** A verification token is single-use, and this effect can run twice for one
 *  page view (StrictMode's simulated remount; React 19.3 made it visible, see
 *  the regression test): the first POST consumed the token and its result was
 *  thrown away as "cancelled", the second got 400 - and a freshly activated
 *  account read "invalid or expired". One in-flight promise per token, shared
 *  by every invocation; a settled promise stays cached so a later remount
 *  re-uses the verdict instead of re-posting. */
const inflight = new Map<string, Promise<void>>();
export function verifyOnce(token: string): Promise<void> {
  let p = inflight.get(token);
  if (!p) {
    p = verifyEmail(token).then(() => undefined);
    inflight.set(token, p);
  }
  return p;
}
