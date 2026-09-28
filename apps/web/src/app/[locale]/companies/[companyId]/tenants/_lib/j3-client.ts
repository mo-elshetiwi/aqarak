import { apiBaseUrl, isMockApi } from "@/lib/api";
import { createJ3MockClient } from "./j3-mock";
import { z } from "zod";
import {
  contentSchema,
  invitationSchema,
  decisionSchema,
  problemSchema,
  tenantSchema,
  tenantSummarySchema,
  uploadSchema,
  versionSchema,
  type Access,
  type J3Client,
  type Outcome,
  type Problem,
  type VersionRef,
} from "./j3-contract";

function fallback(status: number): Problem["code"] {
  if (status === 401) return "SESSION_INVALID";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "STALE_VERSION";
  if (status === 422 || status === 400) return "VALIDATION_FAILED";
  return "UNAVAILABLE";
}
export function createJ3HttpClient(
  baseUrl: string,
  transport: typeof fetch = fetch,
): J3Client {
  async function request<T extends object>(
    access: Access,
    path: string,
    schema: z.ZodType<T>,
    options: {
      method?: "POST" | "PUT";
      body?: unknown;
      key?: string;
      status?: number;
      timeout?: number;
    } = {},
  ): Promise<Outcome<T>> {
    try {
      const response = await transport(
        `${baseUrl.replace(/\/$/, "")}/v1/companies/${encodeURIComponent(access.companyId)}${path}`,
        {
          method: options.method ?? "GET",
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(options.timeout ?? 10_000),
          headers: {
            Accept: "application/json",
            Authorization: `Session ${access.sessionId}`,
            ...(options.body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
            ...(options.key ? { "Idempotency-Key": options.key } : {}),
          },
          ...(options.body === undefined
            ? {}
            : { body: JSON.stringify(options.body) }),
        },
      );
      if (response.status >= 500) return { ok: false, code: "UNAVAILABLE" };
      if (!response.ok) {
        const parsed = problemSchema.safeParse(
          await response.json().catch(() => null),
        );
        return {
          ok: false,
          ...(parsed.success
            ? parsed.data
            : { code: fallback(response.status) }),
        };
      }
      if (response.status !== (options.status ?? 200))
        return { ok: false, code: "UNAVAILABLE" };
      const parsed = schema.safeParse(await response.json());
      return parsed.success
        ? { ok: true, ...parsed.data }
        : { ok: false, code: "UNAVAILABLE" };
    } catch {
      return { ok: false, code: "UNAVAILABLE" };
    }
  }
  function versionPath(ref: VersionRef): string {
    return `/documents/${encodeURIComponent(ref.documentId)}/versions/${encodeURIComponent(ref.versionId)}`;
  }
  return {
    createTenant: (a, body, key) =>
      request(a, "/tenants", z.object({ tenant: tenantSchema }), {
        method: "POST",
        body,
        key,
        status: 201,
      }),
    inviteTenant: (a, id, key) =>
      request(
        a,
        `/tenants/${encodeURIComponent(id)}/invitations`,
        z.object({ invitation: invitationSchema }),
        { method: "POST", body: {}, key, status: 201 },
      ),
    rejectVersion: (a, ref, body, key) =>
      request(
        a,
        `${versionPath(ref)}/reject`,
        z.object({ version: versionSchema }),
        { method: "POST", body, key },
      ),
    listTenants: (a) =>
      request(
        a,
        "/tenants",
        z.object({ tenants: z.array(tenantSummarySchema) }),
      ),
    getTenant: (a, id) =>
      request(
        a,
        `/tenants/${encodeURIComponent(id)}`,
        z.object({ tenant: tenantSchema }),
      ),
    saveIdentity: (a, id, body, key) =>
      request(
        a,
        `/tenants/${encodeURIComponent(id)}/identity`,
        z.object({ tenant: tenantSchema, version: versionSchema }),
        { method: "POST", body, key },
      ),
    requestUpload: (a, body, key) =>
      request(a, "/documents", uploadSchema, {
        method: "POST",
        body,
        key,
        status: 201,
      }),
    completeUpload: (a, ref, key) =>
      request(
        a,
        `${versionPath(ref)}/upload-complete`,
        z.object({ version: versionSchema }),
        { method: "POST", body: {}, key },
      ),
    startExtraction: (a, ref, key) =>
      request(
        a,
        `${versionPath(ref)}/extraction`,
        z.object({ version: versionSchema }),
        { method: "POST", body: {}, key, timeout: 90_000 },
      ),
    getVersion: (a, ref) =>
      request(a, versionPath(ref), z.object({ version: versionSchema })),
    getContent: (a, ref) =>
      request(a, `${versionPath(ref)}/content`, contentSchema),
    recordField: (a, ref, body, key) =>
      request(
        a,
        `${versionPath(ref)}/fields/${encodeURIComponent(ref.fieldName)}`,
        z.object({ decision: decisionSchema }),
        { method: "PUT", body, key },
      ),
  };
}

export function getJ3Client(): J3Client {
  return isMockApi() ? createJ3MockClient() : createJ3HttpClient(apiBaseUrl());
}
