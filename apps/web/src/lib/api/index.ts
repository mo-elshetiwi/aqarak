import type { AqarakApi } from "./contract";
import { createHttpApi } from "./http-adapter";
import { createMockApi } from "./mock-adapter";
export type { AqarakApi, ApiProblem } from "./contract";

function apiMode(): "mock" | "http" {
  const mode = process.env.AQARAK_API_MODE;
  if (mode === "mock" || mode === "http") return mode;
  if (
    mode === undefined &&
    (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test")
  )
    return "mock";
  throw new Error("AQARAK_API_MODE must be mock or http");
}
export function apiBaseUrl(): string {
  try {
    const value = process.env.AQARAK_API_BASE_URL;
    if (!value) throw new Error();
    const url = new URL(value);
    const loopback =
      url.hostname === "localhost" ||
      url.hostname === "[::1]" ||
      /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
    if (
      (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error();
    return url.href.replace(/\/$/, "");
  } catch {
    throw new Error(
      "AQARAK_API_BASE_URL must be an HTTPS URL or an HTTP loopback URL",
    );
  }
}
/** Reads deployment configuration at call time. */
export function getApi(): AqarakApi {
  return apiMode() === "mock" ? createMockApi() : createHttpApi(apiBaseUrl());
}
/** Lets server-rendered screens disclose the synthetic development mode. */
export function isMockApi(): boolean {
  return apiMode() === "mock";
}
