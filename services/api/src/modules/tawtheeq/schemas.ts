import { z } from "zod";
import { amountFils } from "./comparison";
export const expected = z.strictObject({
  expectedVersion: z.number().int().positive(),
});
const text = z.string().trim().min(1).max(2000);
const provenance = z.enum(["extracted", "edited", "manual"]);
const field = <T extends z.ZodType>(value: T) =>
  z.strictObject({ value, provenance });
const money = z
  .union([
    z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    z.string().regex(/^\d+\.\d{2}$/),
  ])
  .transform(amountFils);
export const reviewFields = z.strictObject({
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
});
export type ReviewFields = z.infer<typeof reviewFields>;
export const reviewBody = expected.extend({
  documentVersionId: z.uuid(),
  extractionId: z.uuid().nullable(),
  fields: reviewFields,
});
export const uploadBody = z.strictObject({
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
export const reasonBody = expected.extend({
  reason: z.string().max(2000).nullable().optional(),
});
export const skipBody = reasonBody.extend({
  requestOwnerConfirmation: z.boolean().optional(),
});
export const ownerDecision = z.strictObject({
  decision: z.enum(["approve", "return"]),
  reason: z.string().max(2000).optional(),
});
export const resolutionBody = expected.extend({
  choices: z
    .array(
      z.strictObject({
        discrepancyId: z.uuid(),
        kind: z.enum(["adopt", "cancel_and_reregister", "mark_equivalent"]),
        basis: z.enum(["formatting", "transliteration"]).optional(),
        reason: z.string().max(2000).nullable().optional(),
      }),
    )
    .min(1)
    .max(30),
});
