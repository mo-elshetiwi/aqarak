import { z } from "zod";

export const money = z.number().int().nonnegative().max(100_000_000_000);
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const name = z.object({ en: z.string().min(1), ar: z.string().min(1) });
export const statusSchema = z.enum([
  "draft",
  "awaiting_owner_approval",
  "awaiting_tenant_acceptance",
  "concluded",
  "cancelled",
  "ended",
]);
export const slotSchema = z.enum(["manager", "owner", "tenant"]);
export const actionSchema = z.enum([
  "edit",
  "submit",
  "approve_owner",
  "return_owner",
  "accept_tenant",
  "return_tenant",
  "withdraw",
  "cancel_draft",
  "revise",
  "suggest_clause",
]);
export const problemCodeSchema = z.enum([
  "VERSION_CONFLICT",
  "STALE_SUBJECT_HASH",
  "INVALID_TRANSITION",
  "APPROVER_NOT_DISTINCT",
  "APPROVALS_REQUIRED",
  "OVERLAPPING_CONTRACT",
  "SUCCESSOR_EXISTS",
  "REASON_REQUIRED",
  "SCHEDULE_TOTAL_MISMATCH",
  "TENANT_DOCUMENTS_REQUIRED",
  "TENANT_REQUIRED",
  "OWNER_ACCOUNT_REQUIRED",
  "UNIT_BLOCKED",
  "INVALID_INPUT",
  "IDEMPOTENCY_KEY_REUSED",
  "VALIDATION_FAILED",
  "FORBIDDEN",
  "NOT_FOUND",
  "SESSION_INVALID",
  "UNAVAILABLE",
  "MODEL_UNAVAILABLE",
]);
export const problemSchema = z.object({
  status: z.number().int().min(400).max(599),
  code: problemCodeSchema,
  field: z.string().optional(),
});
export type Problem = z.infer<typeof problemSchema>;
export type ProblemCode = Problem["code"];
const cheque = z.object({
  chequeNo: z.string().min(1).max(20),
  bankName: z.string().min(1).max(80),
});
const instalment = z.object({
  seqNo: z.number().int().positive(),
  dueOn: z.iso.date(),
  amountFils: money,
  vatFils: money,
  cheque: cheque.nullable(),
});
export const provenanceSchema = z.strictObject({
  registryEntry: z.string().min(1).max(120),
  promptVersion: z.string().min(1).max(120),
  outputSha256: hashSchema,
});
const draftFieldsSchema = z.strictObject({
  tenantId: z.uuid(),
  unitId: z.uuid(),
  termStart: z.iso.date(),
  termEnd: z.iso.date(),
  graceDays: z.number().int().min(0).max(365),
  annualRentFils: money,
  totalFils: money,
  depositFils: money,
  vatBp: z.union([z.literal(0), z.literal(500)]),
  instalments: z
    .array(instalment.strict().extend({ cheque: cheque.strict().nullable() }))
    .min(1)
    .max(24),
  specialClauses: z
    .array(
      z.strictObject({
        textEn: z.string().trim().min(1).max(2000),
        textAr: z
          .string()
          .min(1)
          .max(2000)
          .refine((value) => value.trim().length > 0),
        modelTranslated: z.boolean(),
        suggestionId: z.uuid().optional(),
      }),
    )
    .max(10),
});
export const draftInputSchema = draftFieldsSchema.refine(
  (value) => value.termEnd >= value.termStart,
  {
    path: ["termEnd"],
    message: "INVALID_INPUT",
  },
);
export type DraftInput = z.infer<typeof draftInputSchema>;
export const versionInputSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
});
export const decisionInputSchema = versionInputSchema.extend({
  subjectHash: hashSchema,
});
export const reasonInputSchema = versionInputSchema.extend({
  reason: z.string().trim().min(1).max(1000),
});
export const termsInputSchema = draftFieldsSchema
  .omit({ tenantId: true, unitId: true })
  .refine((value) => value.termEnd >= value.termStart, {
    path: ["termEnd"],
    message: "INVALID_INPUT",
  });
export type TermsInput = z.infer<typeof termsInputSchema>;
export const editInputSchema = versionInputSchema.extend({
  terms: termsInputSchema,
});
export const suggestionInputSchema = z.strictObject({
  textEn: z.string().trim().min(1).max(2000),
});
export type VersionInput = z.infer<typeof versionInputSchema>;
export type DecisionInput = z.infer<typeof decisionInputSchema>;
export type ReasonInput = z.infer<typeof reasonInputSchema>;
export type EditInput = z.infer<typeof editInputSchema>;
const owner = z.object({ id: z.uuid(), name, hasAccount: z.boolean() });
const tenant = z.object({
  id: z.uuid(),
  name,
  kind: z.enum(["individual", "company", "government", "diplomatic"]),
});
export const draftingOptionsSchema = z.object({
  tenants: z.array(tenant.extend({ documentsAccepted: z.boolean() })),
  units: z.array(
    z.object({
      id: z.uuid(),
      unitNo: z.string(),
      propertyId: z.uuid(),
      propertyName: name,
      status: z.string().min(1),
      ownerGate: z.boolean(),
      owner: owner.nullable(),
    }),
  ),
});
export type DraftingOptions = z.infer<typeof draftingOptionsSchema>;
export const summarySchema = z.object({
  id: z.uuid(),
  contractNo: z.string().min(1),
  status: statusSchema,
  unit: z.object({ id: z.uuid(), unitNo: z.string(), propertyName: name }),
  tenant: z.object({ id: z.uuid(), name }),
  termStart: z.iso.date(),
  termEnd: z.iso.date(),
  annualRentFils: money,
  currentVersionNo: z.number().int().positive(),
  nextActor: slotSchema.nullable(),
  updatedAt: z.iso.datetime(),
});
export const listSchema = z.object({
  items: z.array(summarySchema),
  nextCursor: z.string().nullable(),
});
const rendered = z.object({
  title: z.string(),
  sections: z.array(
    z.object({
      number: z.number().int().positive(),
      heading: z.string(),
      body: z.string(),
      special: z.boolean(),
    }),
  ),
});
const versionSummary = z.object({
  versionNo: z.number().int().positive(),
  contentHash: hashSchema,
  submittedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export const detailSchema = z.object({
  contract: z.object({
    id: z.uuid(),
    contractNo: z.string().min(1),
    status: statusSchema,
    origin: z.enum(["app", "retroactive"]),
    cancelKind: z.string().nullable(),
    cancelReason: z.string().nullable(),
    revisionOfId: z.uuid().nullable(),
    successorId: z.uuid().nullable(),
    currentVersionNo: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
  version: z.object({
    id: z.uuid(),
    versionNo: z.number().int().positive(),
    submittedAt: z.iso.datetime().nullable(),
    contentHash: hashSchema,
    frozenOwnerGate: z.boolean().nullable(),
    termStart: z.iso.date(),
    termEnd: z.iso.date(),
    graceDays: z.number().int().nonnegative(),
    annualRentFils: money,
    totalFils: money,
    depositFils: money,
    vatBp: z.union([z.literal(0), z.literal(500)]),
    templateCode: z.string().min(1),
    templateVersion: z.number().int().positive(),
    instalments: z.array(instalment),
    specialClauses: z.array(
      z.object({
        position: z.number().int().positive(),
        textEn: z.string(),
        textAr: z.string(),
        modelTranslated: z.boolean(),
        suggestion: z
          .object({
            registryEntry: z.string().min(1),
            promptVersion: z.string().min(1),
            confirmation: z.enum(["ai_confirmed", "ai_edited"]),
          })
          .nullable(),
      }),
    ),
  }),
  unit: z.object({ id: z.uuid(), unitNo: z.string() }),
  property: z.object({ id: z.uuid(), name }),
  owner: owner.nullable(),
  tenant,
  ownerGate: z.object({ value: z.boolean(), frozen: z.boolean() }),
  rendered: z.object({ en: rendered, ar: rendered }),
  approvals: z.array(
    z.object({
      id: z.uuid(),
      slot: slotSchema,
      status: z.enum(["requested", "approved", "returned", "voided"]),
      personName: z.string().min(1),
      requestedAt: z.iso.datetime(),
      decidedAt: z.iso.datetime().nullable(),
      subjectHash: hashSchema,
      reason: z.string().nullable(),
      channel: z.string().nullable(),
      device: z.string().nullable(),
    }),
  ),
  versions: z.array(versionSummary),
  predecessor: z
    .object({
      id: z.uuid(),
      contractNo: z.string(),
      version: z.number().int().positive(),
    })
    .nullable(),
  tawtheeq: z
    .object({ workflowState: z.string(), portalStatus: z.string().nullable() })
    .nullable(),
  deliveries: z.array(
    z.object({
      notificationId: z.uuid(),
      recipientName: z.string(),
      channel: z.string(),
      templateCode: z.string(),
      status: z.string(),
      createdAt: z.iso.datetime(),
      lastErrorCode: z.string().nullable(),
      attempts: z.number().int().nonnegative(),
      deadLettered: z.boolean(),
    }),
  ),
  viewer: z.object({
    slot: z.enum(["manager", "owner", "tenant", "reader"]),
    allowedActions: z.array(actionSchema),
  }),
});
export type ContractDetail = z.infer<typeof detailSchema>;
export type ContractSummary = z.infer<typeof summarySchema>;
export type AllowedAction = z.infer<typeof actionSchema>;
export const approvalsSchema = z.object({
  items: z.array(
    z.object({
      approvalId: z.uuid(),
      slot: slotSchema,
      contractId: z.uuid(),
      contractNo: z.string(),
      unit: z.object({ unitNo: z.string(), propertyName: name }),
      versionNo: z.number().int().positive(),
      subjectHash: hashSchema,
      requestedAt: z.iso.datetime(),
      submittedBy: z.string(),
    }),
  ),
});
export const notificationsSchema = z.object({
  unreadCount: z.number().int().nonnegative(),
  items: z.array(
    z.object({
      id: z.uuid(),
      templateCode: z.string(),
      subjectType: z.string(),
      subjectId: z.uuid(),
      contractId: z.uuid().nullable(),
      createdAt: z.iso.datetime(),
      readAt: z.iso.datetime().nullable(),
    }),
  ),
});
export const notificationReadSchema = z.object({
  id: z.uuid(),
  readAt: z.iso.datetime(),
});
export const suggestionSchema = z.object({
  suggestionId: z.uuid(),
  suggestion: z.object({
    textAr: z.string().min(1).max(2000),
    warnings: z.array(z.string().max(200)).max(5),
  }),
  provenance: provenanceSchema
    .extend({ ranAt: z.iso.datetime().optional() })
    .strip(),
});
export const actionEnvelopeSchema = z.strictObject({
  locale: z.enum(["en", "ar"]),
  companyId: z.uuid(),
  contractId: z.uuid().optional(),
  csrfToken: z.string(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{32}$/),
  input: z.unknown(),
});
export type ActionEnvelope = z.infer<typeof actionEnvelopeSchema>;
export type ActionResult =
  | { ok: true; contractId: string }
  | { ok: false; code: ProblemCode; field?: string };

export type ContractNotification = z.infer<
  typeof notificationsSchema
>["items"][number];

export type ApprovalItem = z.infer<typeof approvalsSchema>["items"][number];

export type ClauseSuggestion = z.infer<typeof suggestionSchema>;
export type SuggestionResult =
  { ok: true; value: ClauseSuggestion } | { ok: false; code: ProblemCode };
