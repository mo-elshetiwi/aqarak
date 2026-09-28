import "server-only";
import { z } from "zod";
import type { TawtheeqClient } from "./client";
import {
  documentUrlSchema,
  extractionSchema,
  listSchema,
  recordSchema,
  uploadResultSchema,
  type WorkflowResult,
} from "./schemas";
// Reads keep the ten-second timeout for prompt feedback when the API is unavailable.
const READ_TIMEOUT_MS = 10_000;
// Commands run several Data API database statements and can exceed ten seconds; the idempotency key makes retries replay the stored result.
const COMMAND_TIMEOUT_MS = 60_000;
const unavailable = {
  ok: false,
  error: { status: 503, code: "UNAVAILABLE" },
} as const;
const problemSchema = z.object({
  code: z.string(),
  domainCode: z.string().optional(),
});
export function createHttpClient(
  baseUrl: string,
  companyId: string,
  sessionId: string,
  transport: typeof fetch = fetch,
): TawtheeqClient {
  const base = `${baseUrl.replace(/\/$/, "")}/v1/companies/${encodeURIComponent(companyId)}/tawtheeq`;
  async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    options?: { body: unknown; key: string; status?: number },
  ): Promise<WorkflowResult<T>> {
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        Authorization: `Session ${sessionId}`,
      };
      if (options) {
        headers["Content-Type"] = "application/json";
        headers["Idempotency-Key"] = options.key;
      }
      const response = await transport(`${base}${path}`, {
        method: options ? "POST" : "GET",
        headers,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(
          options ? COMMAND_TIMEOUT_MS : READ_TIMEOUT_MS,
        ),
        ...(options ? { body: JSON.stringify(options.body) } : {}),
      });
      if (response.status >= 500) return unavailable;
      if (!response.ok) {
        const parsed = problemSchema.safeParse(
          await response.json().catch(() => null),
        );
        return {
          ok: false,
          error: {
            status: response.status,
            ...(parsed.success
              ? parsed.data
              : {
                  code:
                    response.status === 403 ? "NOT_PERMITTED" : "UNAVAILABLE",
                }),
          },
        };
      }
      if (response.status !== (options?.status ?? 200)) return unavailable;
      const parsed = schema.safeParse(await response.json());
      return parsed.success ? { ok: true, value: parsed.data } : unavailable;
    } catch {
      return unavailable;
    }
  }
  const path = (id: string): string => `/${encodeURIComponent(id)}`;
  return {
    ownerReapproval: (id, body, key) =>
      request(`${path(id)}/owner-reapproval`, recordSchema, { body, key }),
    skipConfirmation: (id, body, key) =>
      request(`${path(id)}/skip-confirmation`, recordSchema, { body, key }),
    listRecords: () => request("", listSchema),
    getRecord: (id) => request(path(id), recordSchema),
    getDocumentUrl: (id) =>
      request(`${path(id)}/document-url`, documentUrlSchema),
    attestPortal: (id, body, key) =>
      request(`${path(id)}/attest-portal`, recordSchema, { body, key }),
    requestUpload: (id, body, key) =>
      request(`${path(id)}/uploads`, uploadResultSchema, {
        body,
        key,
        status: 201,
      }),
    completeUpload: (id, documentId, body, key) =>
      request(
        `${path(id)}/uploads/${encodeURIComponent(documentId)}/complete`,
        recordSchema,
        { body, key },
      ),
    runExtraction: (id, key) =>
      request(`${path(id)}/extraction`, extractionSchema, {
        body: {},
        key,
      }),
    submitReview: (id, body, key) =>
      request(`${path(id)}/review`, recordSchema, { body, key }),
    submitResolutions: (id, body, key) =>
      request(`${path(id)}/resolutions`, recordSchema, { body, key }),
    portalReturn: (id, body, key) =>
      request(`${path(id)}/portal-return`, recordSchema, { body, key }),
    skip: (id, body, key) =>
      request(`${path(id)}/skip`, recordSchema, { body, key }),
    resume: (id, body, key) =>
      request(`${path(id)}/resume`, recordSchema, { body, key }),
  };
}
