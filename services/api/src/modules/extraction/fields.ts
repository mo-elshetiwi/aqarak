import { z } from "zod";
import { DOCUMENT_FIELD_CATALOGUE } from "../../models";
import { Problem } from "../documents/problem";

export const catalogue = DOCUMENT_FIELD_CATALOGUE.emirates_id;
export const fieldNames = catalogue.map((field) => field.name);
export const fieldNameSchema = z.enum(fieldNames);
export type FieldName = z.infer<typeof fieldNameSchema>;
export type FieldClass =
  "identity_number" | "person_name" | "nationality" | "date" | "text";
export interface StoredField {
  readonly value: string | null;
  readonly confidence: number;
  readonly page: number;
  readonly evidence: string;
}
export interface ExtractedField {
  readonly name: string;
  readonly fieldClass: FieldClass;
  readonly suggestedValue: string | null;
  readonly confidence: number;
  readonly category: "confirm" | "check";
  readonly page: number;
  readonly evidence: string;
  readonly requiresSourceCheck: boolean;
}
export function asciiDigits(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (digit) =>
      String(
        digit.charCodeAt(0) - (digit.charCodeAt(0) >= 0x6f0 ? 0x6f0 : 0x660),
      ),
    );
}
export function identityDigits(value: string): string {
  return asciiDigits(value).replace(/[^0-9]/g, "");
}
function normalized(value: string): string {
  return asciiDigits(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}
export function evidenceConfidence(
  name: string,
  value: string | null,
  evidence: string | null,
): number {
  if (value === null) return 0;
  if (fieldClass(name) === "date") {
    const parts = asciiDigits(value).split("-").map(Number);
    const groups = (asciiDigits(evidence ?? "").match(/\d+/g) ?? []).map(
      Number,
    );
    return parts.length === 3 && parts.every((part) => groups.includes(part))
      ? 1
      : 0.5;
  }
  const text = normalized(value);
  return text.length > 0 && normalized(evidence ?? "").includes(text) ? 1 : 0.5;
}
export function fieldClass(name: string): FieldClass {
  if (name === "id_number" || name === "card_number") return "identity_number";
  if (name === "name_en" || name === "name_ar") return "person_name";
  if (name.startsWith("nationality_")) return "nationality";
  if (["date_of_birth", "issue_date", "expiry_date"].includes(name))
    return "date";
  return "text";
}
const mappedFieldSchema = z.object({
  value: z.string().nullable(),
  evidence: z.string().nullable(),
});
export function mapFields(output: {
  readonly fields: Readonly<
    Record<
      string,
      { readonly value: string | null; readonly evidence: string | null }
    >
  >;
}): Record<string, StoredField> {
  return Object.fromEntries(
    catalogue.map(({ name }) => {
      const field = mappedFieldSchema.parse(output.fields[name]);
      return [
        name,
        {
          value: field.value,
          confidence: evidenceConfidence(name, field.value, field.evidence),
          page: 1,
          evidence: field.evidence ?? "",
        },
      ];
    }),
  );
}
export const storedFieldsSchema = z.record(
  z.string(),
  z.strictObject({
    value: z.string().nullable(),
    confidence: z.number(),
    page: z.number(),
    evidence: z.string(),
  }),
);
export function presentedFields(
  fields: Readonly<Record<string, StoredField>>,
): ExtractedField[] {
  return catalogue.map(({ name }) => {
    const field = fields[name];
    if (!field) throw new Error("Stored extraction field absent");
    const cls = fieldClass(name);
    const category =
      cls === "identity_number" || cls === "date" ? "confirm" : "check";
    return {
      name,
      fieldClass: cls,
      suggestedValue: field.value,
      confidence: field.confidence,
      category,
      page: field.page,
      evidence: field.evidence,
      requiresSourceCheck: category === "confirm" && field.confidence < 1,
    };
  });
}
export function validateField(name: string, value: string | undefined): string {
  if (value === undefined || value.length === 0 || value.length > 2000)
    throw new Problem(422, "FIELD_INVALID", { field: name });
  const cls = fieldClass(name);
  if (cls === "identity_number") {
    const digits = identityDigits(value);
    if (!digits || (name === "id_number" && digits.length !== 15))
      throw new Problem(422, "FIELD_INVALID", { field: name });
    return digits;
  }
  if (cls === "date" && !z.iso.date().safeParse(value).success)
    throw new Problem(422, "FIELD_INVALID", { field: name });
  if (
    cls === "person_name" &&
    (value.trim().length === 0 || value.length > 120)
  )
    throw new Problem(422, "FIELD_INVALID", { field: name });
  return value;
}
