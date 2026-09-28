import { z } from "zod";
import { retroactiveConfirmationFields } from "@aqarak/domain";
import { Refusal } from "../audit/kernel";
import { expected, uploadBody } from "./schemas";

const provenance = z.enum(["extracted", "edited", "manual"]);
const field = <T extends z.ZodType>(value: T) =>
  z.strictObject({ value, provenance });
const text = z.string().trim().min(1).max(2000);
const fils = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const confirmationFields = z.strictObject({
  unt_number: field(text),
  owner_id_number: field(text),
  tenant_id_number: field(text),
  term_start: field(z.iso.date()),
  term_end: field(z.iso.date()),
  total_fils: field(fils),
  vat_bp: field(z.union([z.literal(0), z.literal(500)])),
  payment_schedule: field(
    z
      .array(
        z.strictObject({
          seqNo: z.number().int().positive(),
          amountFils: fils,
          vatFils: fils,
        }),
      )
      .min(1)
      .max(120),
  ),
  tawtheeq_number: field(text),
  registered_on: field(z.iso.date()),
});
export const confirmBody = expected.extend({
  ownerId: z.uuid(),
  unitId: z.uuid(),
  tenantId: z.uuid(),
  documentVersionId: z.uuid().optional(),
  fields: confirmationFields,
});
export type ConfirmBody = z.infer<typeof confirmBody>;
export const retroactiveUploadBody = uploadBody.extend(expected.shape);
export const requiredFields = [
  ...retroactiveConfirmationFields,
  "tawtheeq_number",
  "registered_on",
];
export class IntakeRefusal extends Refusal {
  constructor(
    domainCode: string,
    draftId: string,
    readonly field?: string,
    readonly missing: string[] = [],
  ) {
    super(
      domainCode === "IDENTITY_MISMATCH" ||
        domainCode === "INVALID_INPUT" ||
        domainCode === "SCHEDULE_TOTAL_MISMATCH"
        ? "VALIDATION_FAILED"
        : "INVALID_TRANSITION",
      { type: "drafted_action", id: draftId },
      field ? `${domainCode}: ${field}` : domainCode,
      domainCode,
    );
  }
}
export function parseConfirmation(raw: unknown, draftId: string): ConfirmBody {
  const envelope = z
    .object({ fields: z.record(z.string(), z.unknown()).optional() })
    .safeParse(raw);
  const fields = envelope.success ? (envelope.data.fields ?? {}) : {};
  const missing = requiredFields.filter((key) => fields[key] === undefined);
  if (missing.length)
    throw new IntakeRefusal(
      "RETROACTIVE_EVIDENCE_MISSING",
      draftId,
      "manager_confirmation",
      missing,
    );
  const result = confirmBody.safeParse(raw);
  if (!result.success)
    throw new IntakeRefusal(
      "INVALID_INPUT",
      draftId,
      result.error.issues[0]?.path.join("."),
    );
  return result.data;
}
export const provenanceValues = {
  extracted: "ai_confirmed",
  edited: "ai_edited",
  manual: "human_entered",
} as const;
/** I recognise PostgreSQL exclusion errors through both native and Data API error shapes. */
export function isExclusionViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if (
    ("code" in error && error.code === "23P01") ||
    ("sqlState" in error && error.sqlState === "23P01")
  )
    return true;
  if (
    error instanceof Error &&
    /(?:\b23P01\b|conflicting key value violates exclusion constraint)/i.test(
      error.message,
    )
  )
    return true;
  return "cause" in error && error.cause !== error
    ? isExclusionViolation(error.cause)
    : false;
}
