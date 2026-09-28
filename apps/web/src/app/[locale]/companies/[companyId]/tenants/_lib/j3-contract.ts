import { z } from "zod";
import type { CreateTenantInput } from "./create-tenant";

export const fieldCatalogue = [
  { name: "id_number", fieldClass: "identity_number" },
  { name: "name_en", fieldClass: "person_name" },
  { name: "name_ar", fieldClass: "person_name" },
  { name: "nationality_en", fieldClass: "nationality" },
  { name: "nationality_ar", fieldClass: "nationality" },
  { name: "date_of_birth", fieldClass: "date" },
  { name: "sex", fieldClass: "text" },
  { name: "issue_date", fieldClass: "date" },
  { name: "expiry_date", fieldClass: "date" },
  { name: "card_number", fieldClass: "identity_number" },
] as const;
export type FieldName = (typeof fieldCatalogue)[number]["name"];
export const problemCodeSchema = z.enum([
  "VALIDATION_FAILED",
  "INVITATION_PENDING",
  "ALREADY_LINKED",
  "SESSION_INVALID",
  "FORBIDDEN",
  "NOT_FOUND",
  "STALE_VERSION",
  "INVALID_STATE",
  "SCAN_PENDING",
  "SCAN_REJECTED",
  "UPLOAD_MISSING",
  "IDEMPOTENCY_KEY_REUSED",
  "FIELD_INVALID",
  "FIELD_REQUIRED",
  "REVIEW_INCOMPLETE",
  "SOURCE_NOT_VIEWED",
  "NOTHING_TO_ACCEPT",
  "UPLOAD_TOO_LARGE",
  "UNSUPPORTED_TYPE",
  "UNSUPPORTED_FOR_EXTRACTION",
  "EXTRACTION_UNAVAILABLE",
  "UNAVAILABLE",
]);
export const problemSchema = z.object({
  code: problemCodeSchema,
  field: z.string().optional(),
  fields: z.array(z.string()).optional(),
});
export type Problem = z.infer<typeof problemSchema>;
export type Outcome<T> = ({ ok: true } & T) | ({ ok: false } & Problem);
const identifier = z.string().min(1);
export const decisionSchema = z.object({
  fieldName: z.string(),
  decision: z.enum(["accepted", "edited", "not_on_document"]),
  value: z.string().nullable(),
  sourceViewed: z.boolean(),
  provenance: z.enum([
    "ai_confirmed",
    "ai_edited",
    "human_entered",
    "not_on_document",
  ]),
  version: z.number().int().positive(),
  decidedBy: identifier,
  decidedAt: z.string(),
});
export const extractedFieldSchema = z.object({
  name: z.string(),
  fieldClass: z.enum([
    "identity_number",
    "person_name",
    "nationality",
    "date",
    "text",
  ]),
  suggestedValue: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  category: z.enum(["confirm", "check"]),
  page: z.number().int().positive(),
  evidence: z.string().nullable(),
  requiresSourceCheck: z.boolean(),
});
export const versionSchema = z.object({
  id: identifier,
  documentId: identifier,
  docType: z.string(),
  versionNo: z.number().int().positive(),
  fileName: z.string(),
  contentType: z.string(),
  byteSize: z.number().int().nonnegative(),
  processingStatus: z.string(),
  reviewStatus: z.enum([
    "pending_review",
    "accepted",
    "rejected",
    "superseded",
  ]),
  rejectReason: z.string().nullable(),
  uploadedAt: z.string().nullable(),
  fields: z.array(extractedFieldSchema).nullable(),
  decisions: z.array(decisionSchema),
  modelCall: z
    .object({
      id: identifier,
      registryEntry: z.string(),
      promptVersion: z.string(),
      status: z.string(),
      latencyMs: z.number().nullable(),
      createdAt: z.string(),
    })
    .nullable(),
});
export const tenantSummarySchema = z.object({
  id: identifier,
  version: z.number().int().positive(),
  kind: z.string(),
  fullNameEn: z.string(),
  fullNameAr: z.string().nullable(),
  email: z.string().nullable(),
  preferredLanguage: z.enum(["en", "ar"]),
  eidMasked: z.string().nullable(),
  linkedAccount: z.boolean(),
  identityStatus: z.enum(["missing", "pending_review", "verified"]),
  missingRequired: z.array(z.string()),
  invitation: z
    .object({ id: identifier, status: z.string(), expiresAt: z.string() })
    .nullable(),
});
export const tenantSchema = tenantSummarySchema.extend({
  phoneE164: z.string().nullable(),
  eidNumber: z.string().nullable(),
  checklist: z.array(
    z.object({
      docType: z.string(),
      required: z.boolean(),
      status: z.enum([
        "missing",
        "processing",
        "pending_review",
        "accepted",
        "expired",
        "rejected",
      ]),
      documentId: identifier.nullable(),
      currentVersionId: identifier.nullable(),
      latestVersionId: identifier.nullable(),
    }),
  ),
});
export const uploadInputSchema = z.object({
  subjectType: z.literal("tenant"),
  subjectId: identifier,
  docType: z.enum(["emirates_id", "passport"]),
  fileName: z.string().min(1).max(255),
  contentType: z.enum(["image/jpeg", "image/png", "application/pdf"]),
  byteSize: z
    .number()
    .int()
    .positive()
    .max(20 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  uploadedVia: z.literal("web"),
});
export const uploadSchema = z.object({
  document: z.object({ id: identifier, docType: z.string() }),
  version: versionSchema,
  upload: z.object({
    method: z.literal("PUT"),
    url: z.string().min(1),
    headers: z.record(z.string(), z.string()),
    expiresAt: z.string(),
  }),
});
export const contentSchema = z.object({
  url: z.string().min(1),
  expiresAt: z.string(),
  contentType: z.string(),
});
export const fieldInputSchema = z.object({
  decision: z.enum(["accepted", "edited", "not_on_document"]),
  value: z.string().optional(),
  sourceViewed: z.boolean(),
  expectedVersion: z.number().int().positive().nullable(),
});
export type TenantSummary = z.infer<typeof tenantSummarySchema>;
export type TenantDetail = z.infer<typeof tenantSchema>;
export type VersionDetail = z.infer<typeof versionSchema>;
export type FieldDecision = z.infer<typeof decisionSchema>;
export type UploadInput = z.infer<typeof uploadInputSchema>;
export type Upload = z.infer<typeof uploadSchema>;
export type Content = z.infer<typeof contentSchema>;
export type FieldInput = z.infer<typeof fieldInputSchema>;
export interface Access {
  sessionId: string;
  companyId: string;
}
export interface VersionRef {
  documentId: string;
  versionId: string;
}
export const invitationSchema = z.object({
  id: identifier,
  status: z.string(),
  expiresAt: z.string(),
});
export type Invitation = z.infer<typeof invitationSchema>;
export const rejectInputSchema = z.object({
  reason: z.enum(["wrong_type", "illegible", "other"]),
  note: z.string().max(500).optional(),
});
export type RejectInput = z.infer<typeof rejectInputSchema>;
export interface J3Client {
  createTenant(
    access: Access,
    input: CreateTenantInput,
    key: string,
  ): Promise<Outcome<{ tenant: TenantDetail }>>;
  inviteTenant(
    access: Access,
    tenantId: string,
    key: string,
  ): Promise<Outcome<{ invitation: Invitation }>>;
  rejectVersion(
    access: Access,
    ref: VersionRef,
    input: RejectInput,
    key: string,
  ): Promise<Outcome<{ version: VersionDetail }>>;
  listTenants(access: Access): Promise<Outcome<{ tenants: TenantSummary[] }>>;
  getTenant(
    access: Access,
    tenantId: string,
  ): Promise<Outcome<{ tenant: TenantDetail }>>;
  saveIdentity(
    access: Access,
    tenantId: string,
    input: { documentVersionId: string; expectedTenantVersion: number },
    key: string,
  ): Promise<Outcome<{ tenant: TenantDetail; version: VersionDetail }>>;
  requestUpload(
    access: Access,
    input: UploadInput,
    key: string,
  ): Promise<Outcome<Upload>>;
  completeUpload(
    access: Access,
    ref: VersionRef,
    key: string,
  ): Promise<Outcome<{ version: VersionDetail }>>;
  startExtraction(
    access: Access,
    ref: VersionRef,
    key: string,
  ): Promise<Outcome<{ version: VersionDetail }>>;
  getVersion(
    access: Access,
    ref: VersionRef,
  ): Promise<Outcome<{ version: VersionDetail }>>;
  getContent(access: Access, ref: VersionRef): Promise<Outcome<Content>>;
  recordField(
    access: Access,
    ref: VersionRef & { fieldName: string },
    input: FieldInput,
    key: string,
  ): Promise<Outcome<{ decision: FieldDecision }>>;
}
