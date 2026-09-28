import { MOCK_COMPANY_A_ID, MOCK_ACCOUNT_IDS } from "@/lib/api/mock-fixtures";
import {
  fieldCatalogue,
  tenantSummarySchema,
  type J3Client,
  type TenantDetail,
  type VersionDetail,
  type FieldDecision,
  type Outcome,
  type Problem,
  type VersionRef,
  type Access,
  type FieldInput,
} from "./j3-contract";

export const mockDocumentId = "51000000-0000-4000-8000-000000000001";
export const mockVersionId = "52000000-0000-4000-8000-000000000001";
const uploadedAt = "2026-09-28T04:00:00.000Z";
const values = [
  "784-1984-0008869-0",
  "Fatima Al Dhaheri",
  "فاطمة الظاهري",
  "Pakistan",
  "باكستان",
  "1984-01-19",
  null,
  "2024-09-10",
  "2028-09-10",
  null,
];
export function seedVersion(): VersionDetail {
  return {
    id: mockVersionId,
    documentId: mockDocumentId,
    docType: "emirates_id",
    versionNo: 1,
    fileName: "emirates-id-sample.jpg",
    contentType: "image/jpeg",
    byteSize: 109725,
    processingStatus: "extracted",
    reviewStatus: "pending_review",
    rejectReason: null,
    uploadedAt,
    fields: fieldCatalogue.map((field, index) => ({
      ...field,
      suggestedValue: values[index] ?? null,
      confidence:
        values[index] === null ? 0 : field.name === "expiry_date" ? 0.5 : 1,
      category:
        field.fieldClass === "date" || field.fieldClass === "identity_number"
          ? "confirm"
          : "check",
      page: 1,
      evidence:
        field.name === "expiry_date" ? "10 Sep 2028" : (values[index] ?? ""),
      requiresSourceCheck:
        field.name === "expiry_date" || field.name === "card_number",
    })),
    decisions: [],
    modelCall: {
      id: "53000000-0000-4000-8000-000000000001",
      registryEntry: "mc1_document_extraction/primary",
      promptVersion: "document_extraction@1",
      status: "succeeded",
      latencyMs: 1200,
      createdAt: uploadedAt,
    },
  };
}
export function seedTenant(id = "tenant-1"): TenantDetail {
  const first = id === "tenant-1";
  return {
    id,
    version: 1,
    kind: "individual",
    fullNameEn: first ? "Fatima Al Dhaheri" : "Omar Farouk",
    fullNameAr: first ? "فاطمة الظاهري" : "عمر فاروق",
    email: first ? "fatima.aldhaheri@example.com" : "omar.farouk@example.com",
    preferredLanguage: "ar",
    eidMasked: null,
    linkedAccount: false,
    identityStatus: first ? "pending_review" : "missing",
    missingRequired: ["emirates_id"],
    invitation: null,
    phoneE164: "+971550000104",
    eidNumber: null,
    checklist: ["emirates_id", "passport"].map((docType) => ({
      docType,
      required: docType === "emirates_id",
      status: first && docType === "emirates_id" ? "pending_review" : "missing",
      documentId: first && docType === "emirates_id" ? mockDocumentId : null,
      currentVersionId: null,
      latestVersionId:
        first && docType === "emirates_id" ? mockVersionId : null,
    })),
  };
}
interface MockState {
  tenants: Map<string, TenantDetail>;
  versions: Map<string, VersionDetail>;
  owners: Map<string, string>;
  uploaded: Set<string>;
  commands: Map<string, { body: string; result: object }>;
  files: Map<string, { bytes: ArrayBuffer; contentType: string }>;
}
const globalState = globalThis as typeof globalThis & {
  tenantIdentityMock?: MockState;
};
function state(): MockState {
  return (globalState.tenantIdentityMock ??= {
    tenants: new Map(
      ["tenant-1", "tenant-2"].map((id) => [id, seedTenant(id)]),
    ),
    versions: new Map([[mockVersionId, seedVersion()]]),
    owners: new Map([[mockVersionId, "tenant-1"]]),
    uploaded: new Set([mockVersionId]),
    commands: new Map(),
    files: new Map(),
  });
}
export function resetJ3Mock(): void {
  delete globalState.tenantIdentityMock;
}
function failure(
  code: Problem["code"],
  field?: string,
): { ok: false } & Problem {
  return { ok: false, code, ...(field ? { field } : {}) };
}
function permitted(access: Access): boolean {
  return access.companyId === MOCK_COMPANY_A_ID;
}
function versionFor(ref: VersionRef): VersionDetail | undefined {
  const version = state().versions.get(ref.versionId);
  return version?.documentId === ref.documentId ? version : undefined;
}
function resolve<T>(value: T): Promise<T> {
  return Promise.resolve(structuredClone(value));
}
function command<T extends object>(
  access: Access,
  key: string,
  body: unknown,
  run: () => Outcome<T>,
): Promise<Outcome<T>> {
  if (!permitted(access)) return resolve(failure("NOT_FOUND"));
  const fingerprint = JSON.stringify(body);
  const prior = state().commands.get(key);
  if (prior)
    return resolve(
      prior.body === fingerprint
        ? (prior.result as Outcome<T>)
        : failure("IDEMPOTENCY_KEY_REUSED"),
    );
  const result = run();
  if (result.ok)
    state().commands.set(key, {
      body: fingerprint,
      result: structuredClone(result),
    });
  return resolve(result);
}
export function markMockUpload(
  versionId: string,
  bytes: ArrayBuffer,
  contentType: string,
): boolean {
  if (!state().versions.has(versionId)) return false;
  state().uploaded.add(versionId);
  state().files.set(versionId, { bytes, contentType });
  return true;
}
export function getMockFile(
  versionId: string,
): { bytes: ArrayBuffer; contentType: string } | undefined {
  return state().files.get(versionId);
}
export function createJ3MockClient(): J3Client {
  return {
    createTenant: (a, input, key) =>
      command(a, key, { operation: "create", ...input }, () => {
        const id = crypto.randomUUID();
        const tenant: TenantDetail = {
          ...seedTenant(id),
          ...input,
          id,
          fullNameAr: input.fullNameAr ?? null,
          phoneE164: input.phoneE164 ?? null,
          email: input.email.toLowerCase(),
        };
        state().tenants.set(id, tenant);
        return { ok: true, tenant };
      }),
    inviteTenant: (a, id, key) =>
      command(a, key, { operation: "invite", id }, () => {
        const tenant = state().tenants.get(id);
        if (!tenant) return failure("NOT_FOUND");
        if (tenant.linkedAccount) return failure("ALREADY_LINKED");
        if (
          tenant.invitation?.status === "pending" &&
          Date.parse(tenant.invitation.expiresAt) > Date.now()
        )
          return failure("INVITATION_PENDING");
        tenant.invitation = {
          id: crypto.randomUUID(),
          status: "pending",
          expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
        };
        return { ok: true, invitation: tenant.invitation };
      }),
    rejectVersion: (a, ref, input, key) =>
      command(a, key, { operation: "reject", ...ref, ...input }, () => {
        const version = versionFor(ref);
        if (!version) return failure("NOT_FOUND");
        if (
          version.reviewStatus !== "pending_review" ||
          version.processingStatus === "extracting"
        )
          return failure("INVALID_STATE");
        version.reviewStatus = "rejected";
        version.rejectReason = input.note?.trim()
          ? `${input.reason}: ${input.note.trim()}`
          : input.reason;
        const tenant = state().tenants.get(
          state().owners.get(version.id) ?? "",
        );
        const task = tenant?.checklist.find(
          (item) => item.latestVersionId === version.id,
        );
        if (task) task.status = "rejected";
        if (tenant) {
          tenant.identityStatus = tenant.checklist.some(
            (item) => item.required && item.status === "pending_review",
          )
            ? "pending_review"
            : "missing";
          tenant.missingRequired = tenant.checklist
            .filter((item) => item.required && item.status !== "accepted")
            .map((item) => item.docType);
        }
        return { ok: true, version };
      }),
    listTenants: (a) =>
      resolve(
        permitted(a)
          ? {
              ok: true,
              tenants: [...state().tenants.values()].map((tenant) =>
                tenantSummarySchema.parse(tenant),
              ),
            }
          : failure("NOT_FOUND"),
      ),
    getTenant: (a, id) => {
      const tenant = state().tenants.get(id);
      return resolve(
        permitted(a) && tenant ? { ok: true, tenant } : failure("NOT_FOUND"),
      );
    },
    getVersion: (a, ref) => {
      const version = versionFor(ref);
      return resolve(
        permitted(a) && version ? { ok: true, version } : failure("NOT_FOUND"),
      );
    },
    getContent: (a, ref) =>
      resolve(
        permitted(a) && versionFor(ref)
          ? {
              ok: true,
              url:
                ref.versionId === mockVersionId
                  ? "/synthetic/emirates-id-sample.jpg"
                  : `/en/companies/${a.companyId}/documents/mock-upload/${ref.versionId}`,
              expiresAt: new Date(Date.now() + 300_000).toISOString(),
              contentType: "image/jpeg",
            }
          : failure("NOT_FOUND"),
      ),
    requestUpload: (a, input, key) =>
      command(a, key, input, () => {
        const tenant = state().tenants.get(input.subjectId);
        if (!tenant) return failure("NOT_FOUND");
        const existing = tenant.checklist.find(
          (entry) => entry.docType === input.docType,
        );
        const documentId = existing?.documentId ?? crypto.randomUUID();
        const id = crypto.randomUUID();
        const version: VersionDetail = {
          ...seedVersion(),
          id,
          documentId,
          docType: input.docType,
          fileName: input.fileName,
          contentType: input.contentType,
          byteSize: input.byteSize,
          versionNo:
            (existing?.latestVersionId
              ? (state().versions.get(existing.latestVersionId)?.versionNo ?? 0)
              : 0) + 1,
          processingStatus: "awaiting_upload",
          uploadedAt: null,
          fields: null,
          modelCall: null,
        };
        state().versions.set(id, version);
        state().owners.set(id, tenant.id);
        const item = tenant.checklist.find(
          (entry) => entry.docType === input.docType,
        );
        if (item)
          Object.assign(item, {
            documentId,
            latestVersionId: id,
            status: "processing",
          });
        return {
          ok: true,
          document: { id: documentId, docType: input.docType },
          version,
          upload: {
            method: "PUT" as const,
            url: `/en/companies/${a.companyId}/documents/mock-upload/${id}`,
            headers: { "Content-Type": input.contentType },
            expiresAt: new Date(Date.now() + 300_000).toISOString(),
          },
        };
      }),
    completeUpload: (a, ref, key) =>
      command(a, key, { operation: "complete", ...ref }, () => {
        const version = versionFor(ref);
        if (!version) return failure("NOT_FOUND");
        if (!state().uploaded.has(version.id)) return failure("UPLOAD_MISSING");
        version.processingStatus = "uploaded";
        version.uploadedAt = new Date().toISOString();
        return { ok: true, version };
      }),
    startExtraction: (a, ref, key) =>
      command(a, key, { operation: "extract", ...ref }, () => {
        const version = versionFor(ref);
        if (!version) return failure("NOT_FOUND");
        if (!state().uploaded.has(version.id)) return failure("UPLOAD_MISSING");
        version.processingStatus = "extraction_failed";
        version.fields = null;
        const tenant = state().tenants.get(
          state().owners.get(version.id) ?? "",
        );
        const item = tenant?.checklist.find(
          (entry) => entry.latestVersionId === version.id,
        );
        if (item) item.status = "pending_review";
        if (tenant) tenant.identityStatus = "pending_review";
        return { ok: true, version };
      }),
    recordField: (a, ref, input, key) =>
      command(a, key, { ...ref, ...input }, () => {
        const version = versionFor(ref);
        if (!version) return failure("NOT_FOUND");
        if (version.reviewStatus !== "pending_review")
          return failure("INVALID_STATE");
        const prior = version.decisions.find(
          (d) => d.fieldName === ref.fieldName,
        );
        if ((prior?.version ?? null) !== input.expectedVersion)
          return failure("STALE_VERSION", ref.fieldName);
        const field = version.fields?.find((f) => f.name === ref.fieldName);
        if (
          input.decision === "accepted" &&
          field?.requiresSourceCheck &&
          !input.sourceViewed
        )
          return failure("SOURCE_NOT_VIEWED", ref.fieldName);
        const decision = mockDecision(ref.fieldName, input, { prior, field });
        if (input.decision !== "not_on_document" && !decision.value)
          return failure("FIELD_REQUIRED", ref.fieldName);
        version.decisions = [
          ...version.decisions.filter((d) => d.fieldName !== ref.fieldName),
          decision,
        ];
        return { ok: true, decision };
      }),
    saveIdentity: (a, id, input, key) =>
      command(a, key, { id, ...input }, () => {
        const tenant = state().tenants.get(id);
        const version = state().versions.get(input.documentVersionId);
        if (!tenant || !version || state().owners.get(version.id) !== id)
          return failure("NOT_FOUND");
        if (tenant.version !== input.expectedTenantVersion)
          return failure("STALE_VERSION");
        if (
          fieldCatalogue.some(
            (f) => !version.decisions.some((d) => d.fieldName === f.name),
          )
        )
          return failure("REVIEW_INCOMPLETE");
        const identity = version.decisions.find(
          (d) => d.fieldName === "id_number",
        )?.value;
        if (!identity) return failure("FIELD_REQUIRED", "id_number");
        if (version.reviewStatus !== "pending_review")
          return failure("INVALID_STATE");
        tenant.fullNameEn =
          version.decisions.find((d) => d.fieldName === "name_en")?.value ??
          tenant.fullNameEn;
        tenant.fullNameAr =
          version.decisions.find((d) => d.fieldName === "name_ar")?.value ??
          null;
        tenant.eidNumber = identity;
        tenant.eidMasked = `784-****-*******-${identity.slice(-1)}`;
        tenant.version += 1;
        version.reviewStatus = "accepted";
        const item = tenant.checklist.find(
          (entry) => entry.latestVersionId === version.id,
        );
        if (item)
          Object.assign(item, {
            status: "accepted",
            currentVersionId: version.id,
          });
        tenant.missingRequired = tenant.checklist
          .filter((entry) => entry.required && entry.status !== "accepted")
          .map((entry) => entry.docType);
        tenant.identityStatus = tenant.missingRequired.length
          ? "pending_review"
          : "verified";
        return { ok: true, tenant, version };
      }),
  };
}

function mockDecision(
  name: string,
  input: FieldInput,
  existing: {
    prior: FieldDecision | undefined;
    field: NonNullable<VersionDetail["fields"]>[number] | undefined;
  },
): FieldDecision {
  const value =
    input.decision === "accepted"
      ? (existing.field?.suggestedValue ?? null)
      : input.decision === "edited"
        ? (input.value ?? null)
        : null;
  const provenance =
    input.decision === "accepted"
      ? "ai_confirmed"
      : input.decision === "not_on_document"
        ? "not_on_document"
        : existing.field?.suggestedValue
          ? "ai_edited"
          : "human_entered";
  return {
    fieldName: name,
    decision: input.decision,
    value,
    sourceViewed: input.sourceViewed,
    provenance,
    version: (existing.prior?.version ?? 0) + 1,
    decidedBy: MOCK_ACCOUNT_IDS["manager-1"],
    decidedAt: new Date().toISOString(),
  };
}
