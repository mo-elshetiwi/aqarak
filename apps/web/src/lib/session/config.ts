import { randomBytes } from "node:crypto";
const processConfig = globalThis as typeof globalThis & {
  aqarakDevelopmentSessionSecret?: string;
};
/** Reads the CSRF signing secret without exposing configuration values in errors. */
export function getSessionSecret(): string {
  const value = process.env.AQARAK_SESSION_SECRET;
  if (value) {
    if (value.length < 32)
      throw new Error("AQARAK_SESSION_SECRET must have at least 32 characters");
    return value;
  }
  if (process.env.NODE_ENV !== "development" && process.env.NODE_ENV !== "test")
    throw new Error("AQARAK_SESSION_SECRET is required");
  return (processConfig.aqarakDevelopmentSessionSecret ??=
    randomBytes(32).toString("base64url"));
}
/** Returns a configured public origin, or leaves origin resolution to the request. */
export function getAppOrigin(): string | undefined {
  const value = process.env.AQARAK_APP_ORIGIN;
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== value)
      throw new Error();
    return url.origin;
  } catch {
    throw new Error(
      "AQARAK_APP_ORIGIN must be an HTTP or HTTPS origin without a path",
    );
  }
}
