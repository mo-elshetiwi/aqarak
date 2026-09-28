import { z } from "zod";

export const problemCodeSchema = z.enum([
  "VALIDATION_FAILED",
  "SESSION_INVALID",
  "FORBIDDEN",
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "INVALID_TRANSITION",
  "UPLOAD_NOT_FOUND",
  "SCAN_NOT_CLEAN",
  "INVITATION_PENDING",
  "IDEMPOTENCY_KEY_REUSED",
  "SELF_MANAGED_NOT_ALLOWED",
  "SELF_MANAGED_OWNER_EXISTS",
  "PROPERTY_NOT_OWNED",
  "OWNER_NOT_FOUND",
  "REASON_REQUIRED",
  "PRP_NUMBER_TAKEN",
  "UNIT_NUMBER_TAKEN",
  "UNT_NUMBER_TAKEN",
  "DOC_TYPE_NOT_ALLOWED",
  "UNSUPPORTED_TYPE",
  "UPLOAD_TOO_LARGE",
  "EXPIRY_BEFORE_ISSUE",
  "EXPIRY_REQUIRED",
  "OWNER_ALREADY_LINKED",
  "OWNER_EMAIL_REQUIRED",
  "UNAVAILABLE",
]);
export const problemSchema = z.object({
  status: z.number().int(),
  code: problemCodeSchema,
  field: z.string().optional(),
});
export type EstateProblemCode = z.infer<typeof problemCodeSchema>;
export type EstateProblem = z.infer<typeof problemSchema>;
export const localeSchema = z.enum(["en", "ar"]);
export const idSchema = z.uuid();
export const keySchema = z.string().regex(/^[a-f0-9]{32}$/i);
export const nameSchema = z.object({
  en: z.string().trim().min(2).max(120),
  ar: z.string().trim().min(2).max(120),
});
export const dateSchema = z.iso.date();
export const filsSchema = z.string().regex(/^(0|[1-9]\d*)$/);
export const versionSchema = z.number().int().positive();
export const reviewStatusSchema = z.enum([
  "pending_review",
  "accepted",
  "rejected",
  "superseded",
]);
export const processingStatusSchema = z.enum([
  "awaiting_upload",
  "uploaded",
  "scan_clean",
  "scan_rejected",
  "extracting",
  "extracted",
  "extraction_failed",
]);
export const validitySchema = z.enum(["valid", "expiring_soon", "expired"]);
export const onboardingSchema = z.enum([
  "invited",
  "incomplete",
  "pending_review",
  "verified",
]);
export const unitStatusSchema = z.enum([
  "vacant",
  "listed",
  "reserved",
  "occupied",
  "notice_given",
  "under_maintenance",
  "blocked",
]);
export const ownerDocTypeSchema = z.enum([
  "emirates_id",
  "passport",
  "management_agreement",
  "tawtheeq_authorisation",
]);
export const propertyDocTypeSchema = z.enum([
  "title_deed",
  "site_plan",
  "civil_defence_certificate",
  "hassantuk_certificate",
  "occupancy_certificate",
  "floor_plan",
  "maintenance_contract",
  "fire_safety_contract",
]);
export const docTypeSchema = z.enum([
  ...ownerDocTypeSchema.options,
  ...propertyDocTypeSchema.options,
]);
export const ownerGateSchema = z.object({
  value: z.boolean(),
  recorded: z.boolean(),
  source: z.enum(["mandate", "company_default", "self_managed"]),
});
export const propertyGateSchema = z.object({
  value: z.boolean(),
  source: z.enum([
    "self_managed",
    "property_override",
    "mandate",
    "company_default",
  ]),
});
export const documentSummarySchema = z.object({
  documentId: idSchema,
  reviewStatus: reviewStatusSchema,
  expiryDate: dateSchema.nullable(),
  validity: validitySchema.nullable(),
});
export const versionItemSchema = z.object({
  versionId: idSchema,
  version: versionSchema,
  versionNo: versionSchema,
  processingStatus: processingStatusSchema,
  reviewStatus: reviewStatusSchema,
  issueDate: dateSchema.nullable(),
  expiryDate: dateSchema.nullable(),
  validity: validitySchema.nullable(),
  rejectReason: z.string().nullable(),
  scanResult: z.string().nullable(),
});
export const documentItemSchema = z.object({
  documentId: idSchema,
  docType: docTypeSchema,
  current: versionItemSchema.nullable(),
  latest: versionItemSchema.nullable(),
});
export const historyEntrySchema = z.object({
  eventType: z.string(),
  occurredAt: z.iso.datetime(),
  actorDisplayName: z.string().nullable(),
  actorRole: z.string().nullable(),
  channel: z.string(),
  reason: z.string().nullable(),
});
export const mandateDetailSchema = z.object({
  id: idSchema,
  version: versionSchema,
  ownerGate: z.boolean().nullable(),
  costThresholdFils: filsSchema.nullable(),
  feeBp: z.number().int().min(0).max(10000).nullable(),
  startsOn: dateSchema,
  endsOn: dateSchema.nullable(),
  status: z.string(),
  propertyIds: z.array(idSchema),
});
const ownerBaseSchema = z.object({
  id: idSchema,
  version: versionSchema,
  fullName: nameSchema,
  selfManaged: z.boolean(),
  linked: z.boolean(),
});
const propertyRefSchema = z.object({ id: idSchema, name: nameSchema });
export const invitationSchema = z.object({
  id: idSchema,
  status: z.enum(["pending", "accepted", "expired", "revoked"]),
  expiresAt: z.iso.datetime(),
});
export const ownerListItemSchema = ownerBaseSchema.extend({
  preferredLanguage: localeSchema,
  properties: z.array(propertyRefSchema),
  ownerGate: ownerGateSchema,
  managementAgreement: documentSummarySchema.nullable(),
  tawtheeqAuthorisation: documentSummarySchema.nullable(),
  onboarding: onboardingSchema,
});
export const ownerDetailSchema = ownerBaseSchema.extend({
  email: z.string().nullable(),
  phoneE164: z.string().nullable(),
  preferredLanguage: localeSchema,
  eidNumberMasked: z.string().nullable(),
  passportNoMasked: z.string().nullable(),
  bank: z
    .object({
      bankName: z.string().nullable(),
      accountHolder: z.string().nullable(),
      ibanLast4: z.string().nullable(),
    })
    .nullable()
    .optional(),
  mandate: mandateDetailSchema.nullable(),
  ownerGate: ownerGateSchema,
  properties: z.array(
    propertyRefSchema.extend({ unitCount: z.number().int().nonnegative() }),
  ),
  documents: z.array(documentItemSchema),
  onboarding: z.object({
    status: onboardingSchema,
    missing: z.array(z.string()),
  }),
  invitation: invitationSchema.nullable(),
  history: z.array(historyEntrySchema),
});
export const ownerFieldsSchema = z.object({
  fullName: nameSchema,
  email: z
    .email()
    .max(254)
    .transform((value) => value.toLowerCase())
    .optional(),
  phoneE164: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/)
    .optional(),
  preferredLanguage: localeSchema,
  eidNumber: z
    .string()
    .regex(/^\d{15}$/)
    .optional(),
  passportNo: z.string().trim().min(1).max(40).optional(),
});
export const createOwnerSchema = ownerFieldsSchema.extend({
  selfManaged: z.boolean().optional(),
});
export const updateOwnerSchema = ownerFieldsSchema
  .partial()
  .extend({ expectedVersion: versionSchema });
export const ownerResponseSchema = z.object({ owner: ownerBaseSchema });
export const mandateInputSchema = z
  .object({
    expectedVersion: versionSchema.nullable(),
    ownerGate: z.boolean().nullable(),
    costThresholdFils: filsSchema,
    emergencyLimitFils: filsSchema.optional(),
    feeBp: z.number().int().min(0).max(10000).optional(),
    startsOn: dateSchema,
    endsOn: dateSchema.nullable(),
    propertyIds: z.array(idSchema),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .refine((v) => !v.endsOn || v.endsOn >= v.startsOn, { path: ["endsOn"] });
export const mandateResponseSchema = z.object({ mandate: mandateDetailSchema });
export const bankInputSchema = z.object({
  expectedVersion: versionSchema,
  bankName: z.string().trim().min(2).max(120),
  accountHolder: z.string().trim().min(2).max(120),
  iban: z.string().regex(/^AE\d{21}$/),
});
const uploadFields = {
  contentType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
  byteSize: z
    .number()
    .int()
    .positive()
    .max(20 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
};
export const ownerUploadSchema = z.object({
  docType: ownerDocTypeSchema,
  ...uploadFields,
});
export const propertyUploadSchema = z.object({
  docType: propertyDocTypeSchema,
  ...uploadFields,
});
export const uploadInputSchema = z.object({
  docType: docTypeSchema,
  ...uploadFields,
});
export const uploadResponseSchema = z.object({
  documentId: idSchema,
  documentVersionId: idSchema,
  versionNo: versionSchema,
  upload: z.object({
    url: z.string().min(1),
    method: z.literal("PUT"),
    headers: z
      .object({
        "Content-Type": z.string(),
        "x-amz-checksum-sha256": z.string(),
      })
      .strict(),
    expiresAt: z.iso.datetime(),
  }),
});
export const checkInputSchema = z.object({}).strict();
export const checkResponseSchema = z.object({
  version: versionItemSchema,
  scanPending: z.boolean(),
});
export const acceptInputSchema = z.object({
  expectedVersion: versionSchema,
  issueDate: dateSchema.optional(),
  expiryDate: dateSchema.optional(),
});
export const rejectInputSchema = z.object({
  expectedVersion: versionSchema,
  reason: z.string().trim().min(1).max(500),
});
export const versionResponseSchema = z.object({ version: versionItemSchema });
export const invitationInputSchema = z.object({ email: z.email().optional() });
export const invitationResponseSchema = z.object({
  invitation: invitationSchema.extend({ status: z.literal("pending") }),
});
export const ownerQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  onboarding: onboardingSchema.optional(),
  gate: z.enum(["on", "off", "not_recorded"]).optional(),
  mandateExpiring: z.literal("true").optional(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().max(1000).optional(),
});
export const propertyQuerySchema = ownerQuerySchema.pick({
  q: true,
  limit: true,
  cursor: true,
});
export const ownerListSchema = z.object({
  items: z.array(ownerListItemSchema),
  nextCursor: z.string().nullable(),
});
export const propertyKindSchema = z.enum(["building", "villa", "plot"]);
export const propertyUseSchema = z.enum(["residential", "commercial", "mixed"]);
export const unitUseSchema = z.enum(["residential", "commercial"]);
export const unitKindSchema = z.enum([
  "apartment",
  "villa",
  "townhouse",
  "office",
  "shop",
  "warehouse",
  "other",
]);
export const blockReasonSchema = z.enum(["owner_use", "legal_hold", "sale"]);
export const unitFieldsSchema = z.object({
  unitNo: z.string().trim().min(1).max(20),
  untNumber: z.string().trim().min(1).max(250).optional(),
  use: unitUseSchema,
  kind: unitKindSchema,
  bedrooms: z.number().int().nonnegative().max(100).optional(),
  areaSqm: z
    .string()
    .regex(/^(0|[1-9][0-9]{0,7})(\.[0-9]{1,2})?$/)
    .refine((value) => Number(value) > 0)
    .optional(),
});
export const unitItemSchema = unitFieldsSchema.extend({
  id: idSchema,
  version: versionSchema,
  untNumber: z.string().nullable(),
  bedrooms: z.number().int().nonnegative().nullable(),
  areaSqm: z.string().nullable(),
  status: unitStatusSchema,
  blockReason: blockReasonSchema.nullable(),
});
export const propertyListItemSchema = z.object({
  id: idSchema,
  version: versionSchema,
  name: nameSchema,
  kind: propertyKindSchema,
  area: nameSchema.nullable(),
  use: propertyUseSchema.nullable(),
  owners: z.array(z.object({ id: idSchema, fullName: nameSchema })),
  unitCount: z.number().int().nonnegative(),
  unitsByStatus: z.record(unitStatusSchema, z.number().int().nonnegative()),
  titleDeed: z
    .object({
      reviewStatus: reviewStatusSchema,
      processingStatus: processingStatusSchema,
    })
    .nullable(),
  ownerGate: propertyGateSchema,
});
export const propertyFieldsSchema = z.object({
  name: nameSchema,
  kind: propertyKindSchema,
  area: nameSchema.optional(),
  plotNo: z.string().trim().min(1).max(250).optional(),
  titleDeedNo: z.string().trim().min(1).max(250).optional(),
  prpNumber: z.string().trim().min(1).max(250).optional(),
  onwaniAddress: z.string().trim().min(1).max(250).optional(),
  zone: z.string().trim().min(1).max(250).optional(),
  use: propertyUseSchema,
  ownerId: idSchema,
  ownerGateOverride: z.boolean().nullable(),
});
export const createPropertySchema = propertyFieldsSchema;
export const updatePropertySchema = propertyFieldsSchema
  .omit({ kind: true, ownerId: true })
  .partial()
  .extend({
    expectedVersion: versionSchema,
    reason: z.string().trim().min(1).max(500).optional(),
  });
export const propertyResponseSchema = z.object({
  property: propertyRefSchema.extend({ version: versionSchema }),
});
export const propertyDetailSchema = propertyListItemSchema.extend({
  plotNo: z.string().nullable(),
  titleDeedNo: z.string().nullable(),
  prpNumber: z.string().nullable(),
  onwaniAddress: z.string().nullable(),
  zone: z.string().nullable(),
  ownerGateOverride: z.boolean().nullable(),
  documents: z.array(documentItemSchema),
  units: z.array(unitItemSchema),
  history: z.array(historyEntrySchema),
});
export const propertyListSchema = z.object({
  items: z.array(propertyListItemSchema),
  nextCursor: z.string().nullable(),
});
export const createUnitsSchema = z.object({
  units: z.array(unitFieldsSchema).min(1).max(100),
});
export const unitsResponseSchema = z.object({ units: z.array(unitItemSchema) });
export const updateUnitSchema = unitFieldsSchema
  .partial()
  .extend({ expectedVersion: versionSchema });
export const unitResponseSchema = z.object({ unit: unitItemSchema });
export const unitStatusInputSchema = z.object({
  expectedVersion: versionSchema,
  command: z.enum([
    "list",
    "delist",
    "block",
    "unblock",
    "open_make_ready",
    "close_make_ready",
  ]),
  reason: z.string().trim().min(1).max(500),
  blockReason: blockReasonSchema.optional(),
});
export const actionContextSchema = z.object({
  locale: localeSchema,
  companyId: idSchema,
  idempotencyKey: keySchema,
});
export const documentTargetSchema = z.object({
  entity: z.enum(["owners", "properties"]),
  recordId: idSchema,
  documentId: idSchema,
  versionId: idSchema,
});
export type Name = z.infer<typeof nameSchema>;
export type OwnerListItem = z.infer<typeof ownerListItemSchema>;
export type OwnerDetail = z.infer<typeof ownerDetailSchema>;
export type PropertyListItem = z.infer<typeof propertyListItemSchema>;
export type PropertyDetail = z.infer<typeof propertyDetailSchema>;
export type UnitItem = z.infer<typeof unitItemSchema>;
export type VersionItem = z.infer<typeof versionItemSchema>;
export type DocumentItem = z.infer<typeof documentItemSchema>;
export type MandateDetail = z.infer<typeof mandateDetailSchema>;
export type ActionContext = z.infer<typeof actionContextSchema>;
export type DocumentTarget = z.infer<typeof documentTargetSchema>;
export type UploadInput = z.infer<typeof uploadInputSchema>;
export type UploadResponse = z.infer<typeof uploadResponseSchema>;
export type OwnerQuery = z.infer<typeof ownerQuerySchema>;
export type PropertyQuery = z.infer<typeof propertyQuerySchema>;
export type EstateActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: EstateProblemCode; field?: string };
export const aedAmountSchema = z
  .string()
  .trim()
  .regex(/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/)
  .transform((value) => {
    const [whole = "0", fraction = ""] = value.replaceAll(",", "").split(".");
    return (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))).toString();
  });
export type CreateOwnerInput = z.infer<typeof createOwnerSchema>;
export type MandateInput = z.infer<typeof mandateInputSchema>;
export type CreatePropertyInput = z.infer<typeof createPropertySchema>;
export type CreateUnitsInput = z.infer<typeof createUnitsSchema>;
export type AcceptInput = z.infer<typeof acceptInputSchema>;
export type RejectInput = z.infer<typeof rejectInputSchema>;
