import { z } from "zod";

/** Startup configuration is validated before choosing a transport. */
export function parseConfig(
  adapter: unknown,
  baseUrl: unknown,
  development: boolean,
): Readonly<{ adapter: "fixture" | "http"; baseUrl: string }> {
  const parsed = z.enum(["fixture", "http"]).safeParse(adapter ?? "fixture");
  if (!parsed.success)
    throw new Error("EXPO_PUBLIC_AUTH_ADAPTER must be fixture or http");
  const url = typeof baseUrl === "string" ? baseUrl : "";
  if (parsed.data === "http") {
    const result = z.url().safeParse(url);
    if (!result.success)
      throw new Error("EXPO_PUBLIC_API_BASE_URL must be a valid HTTPS URL");
    const target = new URL(result.data);
    const local =
      development &&
      target.protocol === "http:" &&
      ["localhost", "10.0.2.2"].includes(target.hostname);
    if (
      (target.protocol !== "https:" && !local) ||
      target.username ||
      target.password ||
      target.search ||
      target.hash
    )
      throw new Error(
        "EXPO_PUBLIC_API_BASE_URL must be HTTPS or a development localhost URL without credentials, query or fragment",
      );
  }
  return Object.freeze({
    adapter: parsed.data,
    baseUrl: url.replace(/\/$/, ""),
  });
}

/** Literal environment reads allow Expo to inline public configuration. */
export const config = parseConfig(
  process.env.EXPO_PUBLIC_AUTH_ADAPTER,
  process.env.EXPO_PUBLIC_API_BASE_URL,
  __DEV__,
);
