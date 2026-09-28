import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MOCK_COMPANIES,
  MOCK_COMPANY_A_ID,
  MOCK_COMPANY_B_ID,
} from "@/lib/api/mock-fixtures";
import type { J3Client, FieldDecision } from "./j3-contract";
import { fieldCatalogue } from "./j3-contract";
import { seedTenant, seedVersion } from "./j3-mock";
const doubles = vi.hoisted(() => ({
  session: vi.fn(),
  context: vi.fn(),
  client: vi.fn(),
  revalidate: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/session/session", () => ({
  getCurrentSession: doubles.session,
  requireCompanyContext: doubles.context,
}));
vi.mock("./j3", () => ({ getJ3Client: doubles.client }));
vi.mock("next/navigation", () => ({ redirect: doubles.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: doubles.revalidate }));
import {
  recordDecisionsAction,
  requestUploadAction,
  completeUploadAction,
  startExtractionAction,
  saveIdentityAction,
  createTenantAction,
  inviteTenantAction,
  rejectUploadAction,
} from "./actions";
const version = seedVersion();
const route = {
  locale: "en",
  companyId: MOCK_COMPANY_A_ID,
  tenantId: "tenant-1",
  documentId: version.documentId,
  versionId: version.id,
  key: "55000000-0000-4000-8000-000000000001",
};
const decisions = Object.fromEntries(
  [...fieldCatalogue].reverse().map((field, index) => [
    field.name,
    {
      status:
        index === 0 ? "edited" : index === 1 ? "not_on_document" : "accepted",
      value: index === 0 ? "123456789" : "ignored",
      sourceViewed: true,
    },
  ]),
);
const client = {
  createTenant: vi.fn<J3Client["createTenant"]>(),
  inviteTenant: vi.fn<J3Client["inviteTenant"]>(),
  rejectVersion: vi.fn<J3Client["rejectVersion"]>(),
  getTenant: vi.fn<J3Client["getTenant"]>(),
  getVersion: vi.fn<J3Client["getVersion"]>(),
  recordField: vi.fn<J3Client["recordField"]>(),
  saveIdentity: vi.fn<J3Client["saveIdentity"]>(),
  requestUpload: vi.fn<J3Client["requestUpload"]>(),
  completeUpload: vi.fn<J3Client["completeUpload"]>(),
  startExtraction: vi.fn<J3Client["startExtraction"]>(),
};
beforeEach(() => {
  vi.clearAllMocks();
  const context = {
    ...MOCK_COMPANIES.a,
    staffRoles: ["manager"],
    partyLinks: [],
  };
  doubles.session.mockResolvedValue({
    sessionId: "session",
    me: { contexts: [context] },
  });
  doubles.context.mockResolvedValue(context);
  doubles.client.mockReturnValue(client);
  client.getTenant.mockResolvedValue({ ok: true, tenant: seedTenant() });
  client.getVersion.mockResolvedValue({ ok: true, version: seedVersion() });
  client.recordField.mockImplementation((_a, ref, input) =>
    Promise.resolve({
      ok: true,
      decision: {
        fieldName: ref.fieldName,
        ...input,
        value: input.value ?? null,
        provenance: "ai_confirmed",
        version: 1,
        decidedBy: "manager",
        decidedAt: "2026-09-28T04:00:00Z",
      },
    }),
  );
});
describe("W-3 records decisions in catalogue order", () => {
  it("sends accepted without value, edited with value, absent without value and existing versions", async () => {
    const prior: FieldDecision = {
      fieldName: "name_en",
      decision: "edited",
      value: "Earlier",
      sourceViewed: false,
      provenance: "ai_edited",
      version: 7,
      decidedBy: "manager",
      decidedAt: "2026-09-28T04:00:00Z",
    };
    client.getVersion.mockResolvedValue({
      ok: true,
      version: { ...version, decisions: [prior] },
    });
    expect(await recordDecisionsAction({ ...route, decisions })).toEqual({
      ok: true,
      recorded: 10,
    });
    expect(
      client.recordField.mock.calls.map((call) => call[1].fieldName),
    ).toEqual(fieldCatalogue.map((field) => field.name));
    expect(client.recordField.mock.calls[0]?.[2]).toEqual({
      decision: "accepted",
      sourceViewed: true,
      expectedVersion: null,
    });
    expect(client.recordField.mock.calls[1]?.[2].expectedVersion).toBe(7);
    expect(client.recordField.mock.calls[8]?.[2]).toEqual({
      decision: "not_on_document",
      sourceViewed: true,
      expectedVersion: null,
    });
    expect(client.recordField.mock.calls[9]?.[2]).toEqual({
      decision: "edited",
      value: "123456789",
      sourceViewed: true,
      expectedVersion: null,
    });
    expect(
      new Set(client.recordField.mock.calls.map((call) => call[3])).size,
    ).toBe(10);
  });
  it("stops at the first refusal, returns the field and retains command keys on retry", async () => {
    client.recordField.mockResolvedValueOnce({
      ok: false,
      code: "FIELD_INVALID",
    });
    expect(await recordDecisionsAction({ ...route, decisions })).toEqual({
      ok: false,
      code: "FIELD_INVALID",
      field: "id_number",
    });
    expect(client.recordField).toHaveBeenCalledTimes(1);
    const firstKey = client.recordField.mock.calls[0]?.[3];
    await recordDecisionsAction({ ...route, decisions });
    expect(client.recordField.mock.calls[1]?.[3]).toBe(firstKey);
  });
  it("returns the first undecided field without inventing a decision", async () => {
    expect(await recordDecisionsAction({ ...route, decisions: {} })).toEqual({
      ok: false,
      code: "FIELD_REQUIRED",
      field: "id_number",
    });
    expect(client.recordField).not.toHaveBeenCalled();
  });
});
describe("W-6 action authorization", () => {
  const upload = {
    subjectType: "tenant",
    subjectId: "tenant-1",
    docType: "emirates_id",
    fileName: "sample.jpg",
    contentType: "image/jpeg",
    byteSize: 123,
    sha256: "a".repeat(64),
    uploadedVia: "web",
  };
  it.each([
    requestUploadAction,
    completeUploadAction,
    startExtractionAction,
    recordDecisionsAction,
    saveIdentityAction,
  ])(
    "conceals a foreign company before constructing a client",
    async (action) => {
      const result = await action({
        ...route,
        companyId: MOCK_COMPANY_B_ID,
        upload,
        decisions,
        expectedTenantVersion: 1,
        role: "manager",
      });
      expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
      expect(doubles.client).not.toHaveBeenCalled();
      expect(doubles.context).not.toHaveBeenCalled();
    },
  );
  it("rejects absent sessions and ungranted roles", async () => {
    doubles.session.mockResolvedValueOnce(null);
    expect(await completeUploadAction(route)).toEqual({
      ok: false,
      code: "SESSION_INVALID",
    });
    doubles.context.mockResolvedValue({
      ...MOCK_COMPANIES.a,
      staffRoles: ["accountant"],
      partyLinks: [],
    });
    expect(await completeUploadAction({ ...route, role: "manager" })).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(doubles.client).not.toHaveBeenCalled();
  });
  it("checks document ownership before calling the command", async () => {
    expect(
      await completeUploadAction({ ...route, versionId: "foreign-version" }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(client.completeUpload).not.toHaveBeenCalled();
  });
  it("uses the version from the check page and preserves stale refusals", async () => {
    client.saveIdentity.mockResolvedValue({ ok: false, code: "STALE_VERSION" });
    expect(
      await saveIdentityAction({ ...route, expectedTenantVersion: 2 }),
    ).toEqual({ ok: false, code: "STALE_VERSION" });
    expect(client.saveIdentity).toHaveBeenCalledWith(
      { sessionId: "session", companyId: MOCK_COMPANY_A_ID },
      "tenant-1",
      { documentVersionId: version.id, expectedTenantVersion: 2 },
      route.key,
    );
    expect(doubles.revalidate).not.toHaveBeenCalled();
  });
});

const createValues = {
  fullNameEn: "Synthetic Tenant",
  fullNameAr: "",
  email: "synthetic@example.com",
  phoneE164: "",
  preferredLanguage: "en" as const,
};
it("T-2 redirects a created tenant to onboarding with an idempotency key", async () => {
  client.createTenant.mockResolvedValue({
    ok: true,
    tenant: seedTenant("new-tenant"),
  });
  await expect(
    createTenantAction({ ...route, values: createValues }),
  ).rejects.toThrow(
    `REDIRECT:/en/companies/${route.companyId}/tenants/new-tenant`,
  );
  expect(client.createTenant).toHaveBeenCalledWith(
    { sessionId: "session", companyId: route.companyId },
    {
      kind: "individual",
      fullNameEn: createValues.fullNameEn,
      email: createValues.email,
      preferredLanguage: "en",
    },
    route.key,
  );
});
it.each(["STALE_VERSION", "VALIDATION_FAILED"] as const)(
  "T-2 retains input on %s refusal",
  async (code) => {
    client.createTenant.mockResolvedValue({ ok: false, code });
    expect(
      await createTenantAction({ ...route, values: createValues }),
    ).toEqual({ ok: false, code, values: createValues });
    expect(doubles.redirect).not.toHaveBeenCalled();
  },
);
it("T-4 rejects an owned upload then redirects to onboarding", async () => {
  client.rejectVersion.mockResolvedValue({
    ok: true,
    version: { ...version, reviewStatus: "rejected" },
  });
  const rejection = { reason: "illegible", note: "Synthetic unreadable image" };
  await expect(rejectUploadAction({ ...route, rejection })).rejects.toThrow(
    `REDIRECT:/en/companies/${route.companyId}/tenants/tenant-1`,
  );
  expect(client.rejectVersion).toHaveBeenCalledWith(
    { sessionId: "session", companyId: route.companyId },
    expect.objectContaining({
      documentId: version.documentId,
      versionId: version.id,
    }),
    rejection,
    route.key,
  );
  expect(doubles.revalidate).toHaveBeenCalled();
});
it("rejects foreign uploads and notes over 500 characters before mutation", async () => {
  expect(
    await rejectUploadAction({
      ...route,
      versionId: "foreign",
      rejection: { reason: "other" },
    }),
  ).toEqual({ ok: false, code: "NOT_FOUND" });
  expect(
    await rejectUploadAction({
      ...route,
      rejection: { reason: "other", note: "x".repeat(501) },
    }),
  ).toEqual({ ok: false, code: "VALIDATION_FAILED" });
  expect(client.rejectVersion).not.toHaveBeenCalled();
});
it.each([createTenantAction, inviteTenantAction, rejectUploadAction])(
  "new commands enforce server section permissions",
  async (action) => {
    doubles.context.mockResolvedValue({
      ...MOCK_COMPANIES.a,
      staffRoles: [],
      partyLinks: [{ kind: "tenant", id: "tenant-1" }],
    });
    const input = {
      ...route,
      values: createValues,
      rejection: { reason: "other" },
    };
    const result = await action(input);
    expect(result).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(doubles.client).not.toHaveBeenCalled();
  },
);
