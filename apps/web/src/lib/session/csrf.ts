import { createHmac, timingSafeEqual } from "node:crypto";
import { getSessionSecret } from "./config";
/** Binds a CSRF token to a single opaque session. */
export function csrfTokenFor(sessionId: string): string {
  return createHmac("sha256", getSessionSecret())
    .update(`csrf|${sessionId}`)
    .digest("base64url");
}
/** Rejects malformed tokens before performing a constant-time comparison. */
export function verifyCsrfToken(
  sessionId: string,
  candidate: unknown,
): boolean {
  if (typeof candidate !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(candidate))
    return false;
  const expected = Buffer.from(csrfTokenFor(sessionId), "utf8");
  const actual = Buffer.from(candidate, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
