export const SESSION_COOKIE = "__Host-aqarak-sid";
export const SIGN_UP_COOKIE = "__Host-aqarak-signup";
interface CookieOptions {
  httpOnly: true;
  secure: true;
  sameSite: "lax";
  path: "/";
  maxAge: number;
}
const attributes = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
} as const;
/** Uses the API's absolute expiry, without widening the cookie's host scope. */
export function sessionCookieOptions(expiresAt: string): CookieOptions {
  const milliseconds = Date.parse(expiresAt) - Date.now();
  if (!Number.isFinite(milliseconds)) throw new Error("Invalid session expiry");
  return {
    ...attributes,
    maxAge: Math.max(0, Math.floor(milliseconds / 1000)),
  };
}
/** Expires a session cookie using the same host and path attributes. */
export function clearedSessionCookie(): CookieOptions {
  return { ...attributes, maxAge: 0 };
}
/** Keeps a pending email out of navigation URLs. */
export function signUpCookieOptions(): CookieOptions {
  return { ...attributes, maxAge: 30 * 60 };
}
