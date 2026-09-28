import { z } from "@hono/zod-openapi";
import { isEmiratesIdNumber } from "./domain";
export const nameSchema = z
  .object({
    en: z.string().trim().min(2).max(120),
    ar: z.string().trim().min(2).max(120),
  })
  .strict();
export const dateSchema = z.iso.date();
export const filsSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .refine(
    (value) =>
      /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) <= 9223372036854775807n,
  );
export const expectedVersion = z.number().int().positive();
export const reasonSchema = z.string().trim().min(1).max(500);
export const emailSchema = z
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());
export const phoneSchema = z.string().regex(/^\+[1-9][0-9]{7,14}$/);
export const eidSchema = z.string().refine(isEmiratesIdNumber);
export const ownerSummarySchema = z.object({
  id: z.uuid(),
  version: expectedVersion,
  fullName: nameSchema,
  selfManaged: z.boolean(),
  linked: z.boolean(),
});
export const createOwnerSchema = z
  .object({
    fullName: nameSchema,
    email: emailSchema.optional(),
    phoneE164: phoneSchema.optional(),
    preferredLanguage: z.enum(["en", "ar"]),
    eidNumber: eidSchema.optional(),
    passportNo: z.string().trim().min(1).max(40).optional(),
    selfManaged: z.boolean().optional(),
  })
  .strict();
export const updateOwnerSchema = createOwnerSchema
  .omit({ selfManaged: true })
  .partial()
  .extend({ expectedVersion })
  .strict()
  .refine((body) => Object.keys(body).length > 1);
export function validIban(iban: string): boolean {
  if (!/^AE\d{21}$/.test(iban)) return false;
  const digits = iban.slice(4) + "1014" + iban.slice(2, 4);
  let mod = 0;
  for (const digit of digits) mod = (mod * 10 + Number(digit)) % 97;
  return mod === 1;
}
export const bankSchema = z
  .object({
    expectedVersion,
    bankName: z.string().trim().min(2).max(120),
    accountHolder: z.string().trim().min(2).max(120),
    iban: z.string().refine(validIban),
  })
  .strict();
export const mandateSchema = z
  .object({
    expectedVersion: expectedVersion.nullable(),
    ownerGate: z.boolean().nullable(),
    costThresholdFils: filsSchema,
    emergencyLimitFils: filsSchema.optional(),
    feeBp: z.number().int().min(0).max(10000).optional(),
    startsOn: dateSchema,
    endsOn: dateSchema.nullable(),
    propertyIds: z
      .array(z.uuid())
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length),
    reason: reasonSchema.optional(),
  })
  .strict()
  .refine((body) => body.endsOn === null || body.startsOn <= body.endsOn, {
    path: ["endsOn"],
  });
export const mandateDetailSchema = z.object({
  id: z.uuid(),
  version: expectedVersion,
  ownerGate: z.boolean().nullable(),
  costThresholdFils: filsSchema.nullable(),
  feeBp: z.number().nullable(),
  startsOn: dateSchema,
  endsOn: dateSchema.nullable(),
  status: z.string(),
  propertyIds: z.array(z.uuid()),
});
export const paginationSchema = z.object({
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(1000).optional(),
});
export const ownerQuerySchema = paginationSchema.extend({
  onboarding: z
    .enum(["invited", "incomplete", "pending_review", "verified"])
    .optional(),
  gate: z.enum(["on", "off", "not_recorded"]).optional(),
  mandateExpiring: z.literal("true").optional(),
});
export const versionItemSchema = z.object({
  versionId: z.uuid(),
  version: expectedVersion,
  versionNo: expectedVersion,
  processingStatus: z.string(),
  scanResult: z.string().nullable(),
  reviewStatus: z.string(),
  issueDate: dateSchema.nullable(),
  expiryDate: dateSchema.nullable(),
  validity: z.enum(["valid", "expiring_soon", "expired"]).nullable(),
  rejectReason: z.string().nullable(),
});
export const documentItemSchema = z.object({
  documentId: z.uuid(),
  docType: z.string(),
  current: versionItemSchema.nullable(),
  latest: versionItemSchema.nullable(),
});
export const documentSummarySchema = z.object({
  documentId: z.uuid(),
  reviewStatus: z.string(),
  expiryDate: dateSchema.nullable(),
  validity: z.enum(["valid", "expiring_soon", "expired"]).nullable(),
});
export const historySchema = z.array(
  z.object({
    eventType: z.string(),
    occurredAt: z.iso.datetime(),
    actorDisplayName: z.string().nullable(),
    actorRole: z.string().nullable(),
    channel: z.string(),
    reason: z.string().nullable(),
  }),
);
export const ownerGateSchema = z.object({
  value: z.boolean(),
  recorded: z.boolean(),
  source: z.enum(["mandate", "company_default", "self_managed"]),
});
export const ownerListItemSchema = ownerSummarySchema.extend({
  preferredLanguage: z.enum(["en", "ar"]),
  properties: z.array(z.object({ id: z.uuid(), name: nameSchema })),
  ownerGate: ownerGateSchema,
  managementAgreement: documentSummarySchema.nullable(),
  tawtheeqAuthorisation: documentSummarySchema.nullable(),
  onboarding: z.enum(["invited", "incomplete", "pending_review", "verified"]),
});
export const ownerDetailSchema = ownerSummarySchema.extend({
  email: z.string().nullable(),
  phoneE164: z.string().nullable(),
  preferredLanguage: z.enum(["en", "ar"]),
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
    z.object({ id: z.uuid(), name: nameSchema, unitCount: z.number() }),
  ),
  documents: z.array(documentItemSchema),
  onboarding: z.object({
    status: z.enum(["invited", "incomplete", "pending_review", "verified"]),
    missing: z.array(z.string()),
  }),
  invitation: z
    .object({ id: z.uuid(), status: z.string(), expiresAt: z.iso.datetime() })
    .nullable(),
  history: historySchema,
});
