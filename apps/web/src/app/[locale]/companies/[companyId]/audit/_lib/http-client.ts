import "server-only";
import { z } from "zod";
import type { AuditClient } from "./client";
import {
  anchorResultSchema,
  eventsSchema,
  filterQuery,
  unavailable,
  verificationSchema,
  versionsSchema,
  type AuditResult,
} from "./schemas";
// Reads keep the ten-second timeout for prompt feedback when the API is unavailable.
const READ_TIMEOUT_MS = 10_000;
// Commands run several Data API database statements and can exceed ten seconds; the idempotency key makes retries replay the stored result.
const COMMAND_TIMEOUT_MS = 60_000;
const problemSchema = z.object({
  code: z.string(),
  domainCode: z.string().optional(),
});
export function createAuditHttpClient(
  baseUrl: string,
  companyId: string,
  sessionId: string,
  transport: typeof fetch = fetch,
): AuditClient {
  const base = `${baseUrl.replace(/\/$/, "")}/v1/companies/${encodeURIComponent(companyId)}/audit`;
  async function response(path: string, key?: string): Promise<Response> {
    return transport(`${base}${path}`, {
      method: key ? "POST" : "GET",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(key ? COMMAND_TIMEOUT_MS : READ_TIMEOUT_MS),
      headers: {
        Authorization: `Session ${sessionId}`,
        Accept: path.startsWith("/export.csv")
          ? "text/csv"
          : "application/json",
        ...(key
          ? { "Content-Type": "application/json", "Idempotency-Key": key }
          : {}),
      },
      ...(key ? { body: "{}" } : {}),
    });
  }
  async function problem(res: Response): Promise<AuditResult<never>> {
    if (res.status >= 500) return unavailable;
    const parsed = problemSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success)
      return res.status === 403
        ? { ok: false, error: { status: 403, code: "NOT_PERMITTED" } }
        : unavailable;
    return {
      ok: false,
      error: {
        status: res.status,
        code: parsed.data.code,
        ...(parsed.data.domainCode
          ? { domainCode: parsed.data.domainCode }
          : {}),
      },
    };
  }
  async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    options?: { key: string; status: number },
  ): Promise<AuditResult<T>> {
    try {
      const res = await response(path, options?.key);
      if (!res.ok) return await problem(res);
      if (res.status !== (options?.status ?? 200)) return unavailable;
      const parsed = schema.safeParse(await res.json());
      return parsed.success ? { ok: true, value: parsed.data } : unavailable;
    } catch {
      return unavailable;
    }
  }
  return {
    events: (filters) =>
      request(`/events?${filterQuery(filters)}`, eventsSchema),
    versions: (type, id) =>
      request(
        `/subjects/${encodeURIComponent(type)}/${encodeURIComponent(id)}/versions`,
        versionsSchema,
      ),
    verify: (key) =>
      request("/verification", verificationSchema, { key, status: 200 }),
    anchor: (key) =>
      request("/anchors", anchorResultSchema, { key, status: 201 }),
    async exportCsv(filters) {
      try {
        const res = await response(`/export.csv?${filterQuery(filters)}`);
        if (!res.ok) return await problem(res);
        const disposition = res.headers.get("Content-Disposition");
        if (
          res.status !== 200 ||
          !res.body ||
          !res.headers.get("Content-Type")?.startsWith("text/csv") ||
          !disposition?.startsWith("attachment;")
        )
          return unavailable;
        return { ok: true, value: { body: res.body, disposition } };
      } catch {
        return unavailable;
      }
    },
  };
}
