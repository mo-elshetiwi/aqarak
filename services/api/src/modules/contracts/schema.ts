import { z } from "zod";
import {
  encodeCanonical,
  sha256Hex,
  nonNegativeFils,
  basisPoints,
  localDate,
  unitId,
  type ContractTerms,
} from "./runtime/domain";
export const money = z.number().int().min(0).max(100_000_000_000);
export const hash = z.string().regex(/^[0-9a-f]{64}$/);
export const termsSchema = z.strictObject({
  termStart: z.iso.date(),
  termEnd: z.iso.date(),
  graceDays: z.number().int().min(0).max(365),
  annualRentFils: money,
  totalFils: money,
  depositFils: money,
  vatBp: z.union([z.literal(0), z.literal(500)]),
  instalments: z
    .array(
      z.strictObject({
        seqNo: z.number().int().min(1).max(24),
        dueOn: z.iso.date(),
        amountFils: money,
        vatFils: money,
        cheque: z
          .strictObject({
            chequeNo: z.string().min(1).max(20),
            bankName: z.string().min(1).max(80),
          })
          .nullable(),
      }),
    )
    .min(1)
    .max(24),
  specialClauses: z
    .array(
      z.strictObject({
        textEn: z.string().min(1).max(2000),
        textAr: z.string().min(1).max(2000),
        modelTranslated: z.boolean().default(false),
        suggestionId: z.uuid().optional(),
      }),
    )
    .max(10),
});
export const draftSchema = termsSchema.extend({
  tenantId: z.uuid(),
  unitId: z.uuid(),
});
export type DraftInput = z.infer<typeof draftSchema>;
export type TermsInput = z.infer<typeof termsSchema>;
export const versionSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
});
export const editSchema = versionSchema.extend({ terms: termsSchema });
export const approvalSchema = versionSchema.extend({ subjectHash: hash });
export const reasonSchema = versionSchema.extend({
  reason: z.string().max(1000).nullable().optional(),
});
export const listSchema = z.strictObject({
  status: z
    .enum([
      "draft",
      "awaiting_owner_approval",
      "awaiting_tenant_acceptance",
      "concluded",
      "ended",
      "cancelled",
    ])
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(500).optional(),
});
export function terms(input: DraftInput): ContractTerms {
  return {
    unitIds: [unitId.parse(input.unitId)],
    termStart: localDate.parse(input.termStart),
    termEnd: localDate.parse(input.termEnd),
    totalFils: nonNegativeFils.parse(input.totalFils),
    vatBp: basisPoints.parse(input.vatBp),
    instalments: input.instalments.map((i) => ({
      seqNo: i.seqNo,
      amountFils: nonNegativeFils.parse(i.amountFils),
      vatFils: nonNegativeFils.parse(i.vatFils),
    })),
  };
}
export function contentHash(input: DraftInput): string {
  return sha256Hex(
    encodeCanonical({
      tenantId: input.tenantId,
      unitIds: [input.unitId],
      termStart: input.termStart,
      termEnd: input.termEnd,
      graceDays: input.graceDays,
      annualRentFils: input.annualRentFils,
      totalFils: input.totalFils,
      depositFils: input.depositFils,
      vatBp: input.vatBp,
      instalments: [...input.instalments].sort((a, b) => a.seqNo - b.seqNo),
      specialClauses: input.specialClauses.map(
        ({ textEn, textAr, modelTranslated }) => ({
          textEn,
          textAr,
          modelTranslated,
        }),
      ),
      templateCode: "standard_residential",
      templateVersion: 1,
    }),
  );
}
