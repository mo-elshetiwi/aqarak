import { z } from "zod";

export const workflowStateSchema = z.enum([
  "awaiting_registration",
  "submitted_on_portal",
  "under_review",
  "discrepancies_open",
  "awaiting_owner_reapproval",
  "registered",
  "skipped",
  "closed",
]);
export const fieldKeys = [
  "tawtheeq_number",
  "registered_on",
  "unt_number",
  "owner_id_number",
  "tenant_id_number",
  "term_start",
  "term_end",
  "annual_rent_fils",
  "deposit_fils",
  "contract_type",
  "owner_name",
  "tenant_name",
] as const;
export const fieldKeySchema = z.enum(fieldKeys);
export type FieldKey = z.infer<typeof fieldKeySchema>;
export const criticalFields: readonly FieldKey[] = fieldKeys.slice(0, 5);
export const valueSchema = z.union([z.string(), z.number(), z.null()]);
export const comparisonSchema = z.object({
  field: fieldKeySchema,
  class: z.enum(["identity", "material", "minor"]),
  contractValue: valueSchema,
  registeredValue: valueSchema,
  status: z.enum([
    "match",
    "mismatch",
    "format_only",
    "missing_contract",
    "missing_registered",
  ]),
});
export const resolutionKindSchema = z.enum([
  "adopt",
  "cancel_and_reregister",
  "mark_equivalent",
]);
export const proposalSchema = z.object({
  value: z.string().nullable(),
  evidence: z.string().nullable(),
  nullReason: z.string().nullable(),
});
export const proposalsSchema = z.record(z.string(), proposalSchema);
export const extractionSchema = z.object({
  status: z.enum(["succeeded", "degraded"]),
  degradedMode: z.string().nullable(),
  extractionId: z.uuid().nullable(),
  registryEntry: z.string(),
  confidenceLabel: z.literal("uncalibrated"),
  fields: proposalsSchema,
  comparisonPreview: z.array(comparisonSchema),
});
const partySchema = z.object({
  partyId: z.uuid(),
  nameEn: z.string().nullable(),
  nameAr: z.string().nullable(),
  idNumberMasked: valueSchema,
});
export const recordSchema = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
  contractId: z.uuid(),
  path: z.enum(["normal", "skip", "retroactive"]),
  workflowState: workflowStateSchema,
  portalStatus: z.string(),
  tawtheeqNumber: z.string().nullable(),
  registeredOn: z.string().nullable(),
  skipReason: z.string().nullable(),
  returnReason: z.string().nullable(),
  attestedOn: z.string().nullable(),
  daysPending: z.number().nullable(),
  contract: z.object({
    contractNo: z.string(),
    status: z.string(),
    currentVersionId: z.uuid(),
    versionNo: z.number().int(),
    contentHash: z.string(),
    frozenOwnerGate: z.boolean(),
    termStart: z.string(),
    termEnd: z.string(),
    annualRentFils: z.number(),
    depositFils: z.number(),
    totalFils: z.number(),
    graceDays: z.number(),
    unit: z.object({
      id: z.uuid(),
      unitNo: z.string(),
      untNumber: z.string().nullable(),
    }),
    owner: partySchema,
    tenant: partySchema,
  }),
  document: z
    .object({
      documentVersionId: z.uuid(),
      versionNo: z.number(),
      contentType: z.string(),
      byteSize: z.number(),
      processingStatus: z.string(),
      reviewStatus: z.string(),
      rejectReason: z.string().nullable(),
      createdAt: z.string(),
    })
    .nullable(),
  extraction: z
    .object({
      extractionId: z.uuid(),
      status: z.string(),
      registryEntry: z.string(),
      confidenceLabel: z.literal("uncalibrated"),
      fields: proposalsSchema,
    })
    .nullable(),
  comparison: z.array(comparisonSchema),
  discrepancies: z.array(
    z.object({
      id: z.uuid(),
      field: fieldKeySchema,
      class: z.enum(["identity", "material", "minor"]),
      contractValue: valueSchema,
      registeredValue: valueSchema,
      status: z.enum(["open", "resolved"]),
      resolution: z
        .object({
          kind: resolutionKindSchema,
          basis: z.string().nullable(),
          reason: z.string().nullable(),
        })
        .nullable(),
    }),
  ),
  adoption: z
    .object({
      contractVersionId: z.uuid(),
      versionNo: z.number(),
      contentHash: z.string(),
      changedFields: z.record(z.string(), z.union([z.string(), z.number()])),
      ownerApproval: z
        .object({ status: z.string(), reason: z.string().nullable() })
        .nullable(),
    })
    .nullable(),
  allowedActions: z.array(z.string()),
});
export const listSchema = z.object({
  records: z.array(
    z.object({
      id: z.uuid(),
      contractId: z.uuid(),
      contractNo: z.string(),
      unitLabel: z.string(),
      tenantName: z.string().nullable(),
      workflowState: workflowStateSchema,
      portalStatus: z.string(),
      path: z.string(),
      daysPending: z.number().nullable(),
      openDiscrepancies: z.number(),
      updatedAt: z.string(),
    }),
  ),
});
export const documentUrlSchema = z.object({
  url: z.string().min(1),
  expiresAt: z.string(),
  contentType: z.string(),
});
export const uploadResultSchema = z.object({
  documentVersionId: z.uuid(),
  upload: z.object({
    url: z.string().min(1),
    method: z.literal("PUT"),
    headers: z.record(z.string(), z.string()),
    expiresAt: z.string(),
  }),
});
export const expectedSchema = z.object({
  expectedVersion: z.number().int().positive(),
});
export const uploadInputSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z.enum(["image/jpeg", "image/png", "application/pdf"]),
  byteSize: z
    .number()
    .int()
    .min(1)
    .max(20 * 1024 * 1024),
  sha256: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/)
    .transform((s) => s.toLowerCase()),
});
const provenanceSchema = z.enum(["extracted", "edited", "manual"]);
const text = z.string().trim().min(1).max(2000);
const field = <T extends z.ZodType>(value: T) =>
  z.object({ value, provenance: provenanceSchema });
const money = z.union([
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  z.string().regex(/^\d+\.\d{2}$/),
]);
export const reviewInputSchema = expectedSchema.extend({
  documentVersionId: z.uuid(),
  extractionId: z.uuid().nullable(),
  fields: z.object({
    tawtheeq_number: field(text),
    registered_on: field(z.iso.date()),
    unt_number: field(text),
    owner_id_number: field(text),
    tenant_id_number: field(text),
    term_start: field(z.iso.date().nullable()).optional(),
    term_end: field(z.iso.date().nullable()).optional(),
    annual_rent_fils: field(money.nullable()).optional(),
    deposit_fils: field(money.nullable()).optional(),
    contract_type: field(
      z.enum(["RESIDENTIAL", "COMMERCIAL"]).nullable(),
    ).optional(),
    owner_name: field(text.nullable()).optional(),
    tenant_name: field(text.nullable()).optional(),
  }),
});
export const resolutionsInputSchema = expectedSchema.extend({
  choices: z
    .array(
      z.object({
        discrepancyId: z.uuid(),
        kind: resolutionKindSchema,
        basis: z.enum(["formatting", "transliteration"]).optional(),
        reason: text,
      }),
    )
    .min(1)
    .max(30),
});
export const reasonInputSchema = expectedSchema.extend({ reason: text });
export const skipInputSchema = reasonInputSchema.extend({
  requestOwnerConfirmation: z.boolean().optional(),
});
export type TawtheeqRecord = z.infer<typeof recordSchema>;
export type RecordList = z.infer<typeof listSchema>;
export type Extraction = z.infer<typeof extractionSchema>;
export type DocumentUrl = z.infer<typeof documentUrlSchema>;
export type UploadResult = z.infer<typeof uploadResultSchema>;
export type UploadInput = z.infer<typeof uploadInputSchema>;
export type ReviewInput = z.infer<typeof reviewInputSchema>;
export type ResolutionsInput = z.infer<typeof resolutionsInputSchema>;
export type Comparison = z.infer<typeof comparisonSchema>;
export type Expected = z.infer<typeof expectedSchema>;
export type ReasonInput = z.infer<typeof reasonInputSchema>;
export type SkipInput = z.infer<typeof skipInputSchema>;
export interface WorkflowProblem {
  status: number;
  code: string;
  domainCode?: string | undefined;
}
export type WorkflowResult<T> =
  { ok: true; value: T } | { ok: false; error: WorkflowProblem };

export const ownerDecisionSchema = z
  .object({
    decision: z.enum(["approve", "return"]),
    reason: z.string().trim().max(2000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.decision === "return" && !value.reason?.trim())
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: "REASON_REQUIRED",
      });
  });
export const ownerReapprovalSchema = ownerDecisionSchema.safeExtend({
  expectedVersion: z.number().int().positive(),
});
export type OwnerDecision = z.infer<typeof ownerDecisionSchema>;
export type OwnerReapproval = z.infer<typeof ownerReapprovalSchema>;
