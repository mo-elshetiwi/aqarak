import { z } from "zod";
import { companyId, personAccountId } from "../ids";
import { utcInstant, type UtcInstant } from "../time";

const commonFields = {
  companyId,
  version: z.int().min(1),
  createdAt: utcInstant,
  createdBy: personAccountId.nullable(),
  updatedAt: utcInstant.nullable(),
  updatedBy: personAccountId.nullable(),
};

/** Supplies the identity and audit fields shared by stored business records. */
export function standardFields<Id extends z.ZodType>(
  id: Id,
): typeof commonFields & { id: Id } {
  return { id, ...commonFields };
}

/** Validates a bounded text field on a business record. */
export const text = z.string().min(1).max(500);
/** Validates the selected language on a business record. */
export const language = z.enum(["en", "ar"]);
/** Validates an international phone number on a business record. */
export const phoneE164 = z.string().regex(/^\+[1-9][0-9]{7,14}$/);
/** Validates a fifteen digit identity or tax registration number. */
export const fifteenDigits = z.string().regex(/^[0-9]{15}$/);
/** Validates a lowercase digest used instead of storing large content. */
export const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
/** Validates a polymorphic record reference without assigning an entity brand. */
export const subjectId = z.guid().regex(/^[0-9a-f-]+$/);
/** Validates a snake case table name used by a polymorphic record reference. */
export const subjectType = z.string().regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/);
/** Validates a JSON value retained as structured business data. */
export const jsonValue = z.json();

/** Measures a validated instant in microseconds for exact record time comparisons. */
export function instantMicroseconds(value: UtcInstant): bigint {
  const fraction = /\.(\d+)Z$/.exec(value)?.[1] ?? "";
  return (
    BigInt(Date.parse(value)) * 1_000n +
    BigInt(fraction.padEnd(6, "0").slice(3))
  );
}
