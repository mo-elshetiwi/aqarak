import { describe, expect, it, vi } from "vitest";
import { createJ3HttpClient } from "./j3-client";
import { seedTenant, seedVersion } from "./j3-mock";
import {
  fieldCatalogue,
  type FieldDecision,
  type J3Client,
  type UploadInput,
} from "./j3-contract";
const access = {
  sessionId: "test-session",
  companyId: "10000000-0000-4000-8000-000000000001",
};
const version = seedVersion();
const tenant = seedTenant();
const ref = { documentId: version.documentId, versionId: version.id };
const key = "55000000-0000-4000-8000-000000000001";
const uploadInput: UploadInput = {
  subjectType: "tenant",
  subjectId: tenant.id,
  docType: "emirates_id",
  fileName: version.fileName,
  contentType: "image/jpeg",
  byteSize: 10,
  sha256: "a".repeat(64),
  uploadedVia: "web",
};
const decision: FieldDecision = {
  fieldName: "id_number",
  decision: "accepted",
  value: "784-1960-0001031-2",
  sourceViewed: true,
  provenance: "ai_confirmed",
  version: 1,
  decidedBy: "manager-1",
  decidedAt: "2026-09-28T04:00:00Z",
};
const upload = {
  document: { id: version.documentId, docType: "emirates_id" },
  version,
  upload: {
    method: "PUT",
    url: "https://storage.example.test/put",
    headers: { "Content-Type": "image/jpeg" },
    expiresAt: "2026-09-28T05:00:00Z",
  },
};
const cases: {
  name: string;
  path: string;
  method: string;
  body?: unknown;
  status?: number;
  response: object;
  run: (client: J3Client) => Promise<unknown>;
}[] = [
  {
    name: "create",
    path: "/tenants",
    method: "POST",
    status: 201,
    body: {
      kind: "individual",
      fullNameEn: "Synthetic Tenant",
      email: "synthetic@example.com",
      preferredLanguage: "en",
    },
    response: { tenant },
    run: (c) =>
      c.createTenant(
        access,
        {
          kind: "individual",
          fullNameEn: "Synthetic Tenant",
          email: "synthetic@example.com",
          preferredLanguage: "en",
        },
        key,
      ),
  },
  {
    name: "invite",
    path: "/tenants/tenant-1/invitations",
    method: "POST",
    status: 201,
    body: {},
    response: {
      invitation: {
        id: "invitation-1",
        status: "pending",
        expiresAt: "2099-01-01T00:00:00Z",
      },
    },
    run: (c) => c.inviteTenant(access, tenant.id, key),
  },
  {
    name: "reject",
    path: `/documents/${ref.documentId}/versions/${ref.versionId}/reject`,
    method: "POST",
    body: { reason: "wrong_type", note: "Synthetic wrong document" },
    response: { version: { ...version, reviewStatus: "rejected" } },
    run: (c) =>
      c.rejectVersion(
        access,
        ref,
        { reason: "wrong_type", note: "Synthetic wrong document" },
        key,
      ),
  },
  {
    name: "list",
    path: "/tenants",
    method: "GET",
    response: { tenants: [tenant] },
    run: (c) => c.listTenants(access),
  },
  {
    name: "tenant",
    path: "/tenants/tenant-1",
    method: "GET",
    response: { tenant },
    run: (c) => c.getTenant(access, tenant.id),
  },
  {
    name: "identity",
    path: "/tenants/tenant-1/identity",
    method: "POST",
    body: { documentVersionId: version.id, expectedTenantVersion: 1 },
    response: { tenant, version },
    run: (c) =>
      c.saveIdentity(
        access,
        tenant.id,
        { documentVersionId: version.id, expectedTenantVersion: 1 },
        key,
      ),
  },
  {
    name: "upload",
    path: "/documents",
    method: "POST",
    body: uploadInput,
    status: 201,
    response: upload,
    run: (c) => c.requestUpload(access, uploadInput, key),
  },
  {
    name: "complete",
    path: `/documents/${ref.documentId}/versions/${ref.versionId}/upload-complete`,
    method: "POST",
    body: {},
    response: { version },
    run: (c) => c.completeUpload(access, ref, key),
  },
  {
    name: "extract",
    path: `/documents/${ref.documentId}/versions/${ref.versionId}/extraction`,
    method: "POST",
    body: {},
    response: { version },
    run: (c) => c.startExtraction(access, ref, key),
  },
  {
    name: "version",
    path: `/documents/${ref.documentId}/versions/${ref.versionId}`,
    method: "GET",
    response: { version },
    run: (c) => c.getVersion(access, ref),
  },
  {
    name: "content",
    path: `/documents/${ref.documentId}/versions/${ref.versionId}/content`,
    method: "GET",
    response: {
      url: "https://storage.example.test/image",
      expiresAt: "2026-09-28T05:00:00Z",
      contentType: "image/jpeg",
    },
    run: (c) => c.getContent(access, ref),
  },
  {
    name: "decision",
    path: `/documents/${ref.documentId}/versions/${ref.versionId}/fields/id_number`,
    method: "PUT",
    body: { decision: "accepted", sourceViewed: true, expectedVersion: null },
    response: { decision },
    run: (c) =>
      c.recordField(
        access,
        { ...ref, fieldName: "id_number" },
        { decision: "accepted", sourceViewed: true, expectedVersion: null },
        key,
      ),
  },
];
describe("W-1 session HTTP contract", () => {
  it.each(cases)("sends and validates $name", async (entry) => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { ...entry.response, secretExtra: "removed" },
          { status: entry.status ?? 200 },
        ),
      );
    const result = await entry.run(
      createJ3HttpClient("https://api.example.test/", transport),
    );
    expect(result).toMatchObject({ ok: true });
    expect(result).not.toHaveProperty("secretExtra");
    expect(transport).toHaveBeenCalledOnce();
    const [url, init] = transport.mock.calls[0] ?? [];
    expect(url).toBe(
      `https://api.example.test/v1/companies/${access.companyId}${entry.path}`,
    );
    expect(init).toMatchObject({
      method: entry.method,
      cache: "no-store",
      redirect: "error",
      headers: {
        Accept: "application/json",
        Authorization: "Session test-session",
        ...(entry.method !== "GET"
          ? { "Content-Type": "application/json", "Idempotency-Key": key }
          : {}),
      },
    });
    expect(init?.body).toBe(
      entry.body === undefined ? undefined : JSON.stringify(entry.body),
    );
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    if (entry.name === "list")
      expect(result).not.toHaveProperty("tenants.0.eidNumber");
  });
  it.each([
    [401, "SESSION_INVALID"],
    [404, "NOT_FOUND"],
    [409, "STALE_VERSION"],
    [422, "FIELD_INVALID"],
    [503, "UNAVAILABLE"],
  ] as const)("maps %s to %s", async (status, code) => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json(
          { code, field: "name_en", unexpected: "discard" },
          { status },
        ),
      );
    const result = await createJ3HttpClient(
      "https://api.example.test",
      transport,
    ).getTenant(access, tenant.id);
    expect(result).toEqual(
      status >= 500
        ? { ok: false, code: "UNAVAILABLE" }
        : { ok: false, code, field: "name_en" },
    );
  });
  it("rejects malformed successes and strips nested unknown properties", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ tenant: { ...tenant, version: "1" } }),
      )
      .mockResolvedValueOnce(
        Response.json({
          version: {
            ...version,
            fields: [{ ...version.fields?.[0], injected: "secret" }],
          },
        }),
      );
    const client = createJ3HttpClient("https://api.example.test", transport);
    expect(await client.getTenant(access, tenant.id)).toEqual({
      ok: false,
      code: "UNAVAILABLE",
    });
    const result = await client.getVersion(access, ref);
    expect(result).not.toHaveProperty("version.fields.0.injected");
  });
  it("maps network and abort failures, and uses the extraction timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const transport = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new DOMException("aborted", "TimeoutError"));
    const client = createJ3HttpClient("https://api.example.test", transport);
    expect(await client.getVersion(access, ref)).toEqual({
      ok: false,
      code: "UNAVAILABLE",
    });
    expect(timeout).toHaveBeenLastCalledWith(10_000);
    expect(await client.startExtraction(access, ref, key)).toEqual({
      ok: false,
      code: "UNAVAILABLE",
    });
    expect(timeout).toHaveBeenLastCalledWith(90_000);
    timeout.mockRestore();
  });
  it("keeps problem codes closed and preserves field collections", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ code: "NEW_SERVER_ERROR" }, { status: 409 }),
      )
      .mockResolvedValueOnce(
        Response.json(
          {
            code: "REVIEW_INCOMPLETE",
            fields: fieldCatalogue.map((field) => field.name),
          },
          { status: 422 },
        ),
      );
    const client = createJ3HttpClient("https://api.example.test", transport);
    expect(await client.getTenant(access, tenant.id)).toEqual({
      ok: false,
      code: "STALE_VERSION",
    });
    expect(await client.getTenant(access, tenant.id)).toEqual({
      ok: false,
      code: "REVIEW_INCOMPLETE",
      fields: fieldCatalogue.map((field) => field.name),
    });
  });
});
