import type { z } from "zod";
export type PostResult =
  { ok: true; redirectTo: string } | { ok: false; code: string };

/** Limits browser responses to navigation or a stable refusal code. */
export async function postJson(
  path: string,
  body: unknown,
  { csrfToken }: { csrfToken?: string } = {},
): Promise<PostResult> {
  try {
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      },
      body: JSON.stringify(body),
    });
    const data: unknown = await response.json();
    if (typeof data !== "object" || data === null)
      return { ok: false, code: "UNAVAILABLE" };
    if (!response.ok)
      return {
        ok: false,
        code:
          "code" in data && typeof data.code === "string"
            ? data.code
            : "UNAVAILABLE",
      };
    if ("redirectTo" in data && typeof data.redirectTo === "string")
      return { ok: true, redirectTo: data.redirectTo };
    if ("ok" in data && data.ok === true) return { ok: true, redirectTo: "" };
    return { ok: false, code: "UNAVAILABLE" };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}
/** Discards the previous document and its client cache at account transitions. */
export function navigateDocument(path: string): void {
  window.location.assign(path);
}

/** Validates declared response data without retaining request or response bodies. */
export async function postJsonData<T>(
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
  { csrfToken }: { csrfToken?: string } = {},
): Promise<{ ok: true; data: T } | { ok: false; code: string }> {
  try {
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      },
      body: JSON.stringify(body),
    });
    const data: unknown = await response.json();
    if (!response.ok)
      return {
        ok: false,
        code:
          typeof data === "object" &&
          data !== null &&
          "code" in data &&
          typeof data.code === "string"
            ? data.code
            : "UNAVAILABLE",
      };
    const parsed = schema.safeParse(data);
    return parsed.success
      ? { ok: true, data: parsed.data }
      : { ok: false, code: "UNAVAILABLE" };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}
