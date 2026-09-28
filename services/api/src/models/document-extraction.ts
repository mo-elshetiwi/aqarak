import { z } from "zod";
export const documentKindSchema = z.enum([
  "emirates_id",
  "tawtheeq_contract",
  "title_deed",
]);
export type DocumentKind = z.infer<typeof documentKindSchema>;
export const fieldTypeSchema = z.enum([
  "id_number",
  "name",
  "text",
  "date",
  "code",
  "money",
  "integer",
  "decimal",
]);
export const DOCUMENT_FIELD_CATALOGUE = {
  emirates_id: [
    {
      name: "id_number",
      type: "id_number",
      description: "The printed id number.",
    },
    {
      name: "name_en",
      type: "name",
      description: "The printed name in Latin script.",
    },
    {
      name: "name_ar",
      type: "name",
      description: "The printed name in Arabic script.",
    },
    {
      name: "nationality_en",
      type: "text",
      description: "The printed nationality in Latin script.",
    },
    {
      name: "nationality_ar",
      type: "text",
      description: "The printed nationality in Arabic script.",
    },
    {
      name: "date_of_birth",
      type: "date",
      description: "The printed date of birth.",
    },
    {
      name: "sex",
      type: "code",
      description: "The printed sex. Allowed codes: M, F.",
    },
    {
      name: "issue_date",
      type: "date",
      description: "The printed issue date.",
    },
    {
      name: "expiry_date",
      type: "date",
      description: "The printed expiry date.",
    },
    {
      name: "card_number",
      type: "id_number",
      description: "The printed card number.",
    },
  ],
  tawtheeq_contract: [
    {
      name: "contract_number",
      type: "id_number",
      description: "The printed contract number.",
    },
    {
      name: "registration_date",
      type: "date",
      description: "The printed registration date.",
    },
    {
      name: "landlord_name_en",
      type: "name",
      description: "The printed landlord name in Latin script.",
    },
    {
      name: "landlord_name_ar",
      type: "name",
      description: "The printed landlord name in Arabic script.",
    },
    {
      name: "tenant_name_en",
      type: "name",
      description: "The printed tenant name in Latin script.",
    },
    {
      name: "tenant_name_ar",
      type: "name",
      description: "The printed tenant name in Arabic script.",
    },
    {
      name: "tenant_id_number",
      type: "id_number",
      description: "The printed tenant id number.",
    },
    {
      name: "unit_number",
      type: "code",
      description: "The printed unit number.",
    },
    {
      name: "plot_number",
      type: "code",
      description: "The printed plot number.",
    },
    {
      name: "district_en",
      type: "text",
      description: "The printed district in Latin script.",
    },
    {
      name: "district_ar",
      type: "text",
      description: "The printed district in Arabic script.",
    },
    {
      name: "property_usage",
      type: "code",
      description:
        "The printed property usage. Allowed codes: RESIDENTIAL, COMMERCIAL.",
    },
    {
      name: "start_date",
      type: "date",
      description: "The printed start date.",
    },
    { name: "end_date", type: "date", description: "The printed end date." },
    {
      name: "annual_rent",
      type: "money",
      description: "The printed annual rent.",
    },
    {
      name: "security_deposit",
      type: "money",
      description: "The printed security deposit.",
    },
    {
      name: "number_of_cheques",
      type: "integer",
      description: "The printed number of cheques.",
    },
  ],
  title_deed: [
    {
      name: "deed_number",
      type: "id_number",
      description: "The printed deed number.",
    },
    {
      name: "issue_date",
      type: "date",
      description: "The printed issue date.",
    },
    {
      name: "owner_name_en",
      type: "name",
      description: "The printed owner name in Latin script.",
    },
    {
      name: "owner_name_ar",
      type: "name",
      description: "The printed owner name in Arabic script.",
    },
    {
      name: "owner_id_number",
      type: "id_number",
      description: "The printed owner id number.",
    },
    {
      name: "plot_number",
      type: "code",
      description: "The printed plot number.",
    },
    {
      name: "unit_number",
      type: "code",
      description: "The printed unit number.",
    },
    {
      name: "district_en",
      type: "text",
      description: "The printed district in Latin script.",
    },
    {
      name: "district_ar",
      type: "text",
      description: "The printed district in Arabic script.",
    },
    {
      name: "property_type",
      type: "code",
      description:
        "The printed property type. Allowed codes: APARTMENT, VILLA, TOWNHOUSE, LAND.",
    },
    {
      name: "area_sq_m",
      type: "decimal",
      description: "The printed area sq m.",
    },
  ],
} as const;
export const extractedFieldSchema = z
  .strictObject({
    value: z.string().nullable(),
    evidence: z.string().max(80).nullable(),
    null_reason: z.enum(["absent", "unreadable", "redacted"]).nullable(),
  })
  .refine(
    (field) =>
      field.value === null
        ? field.null_reason !== null && field.evidence === null
        : field.null_reason === null,
    { message: "Value and null reason must agree" },
  );
export type ExtractedField = z.infer<typeof extractedFieldSchema>;
/** Build the complete strict extraction schema for a document kind. */
export function documentExtractionSchemaFor(kind: DocumentKind): z.ZodObject<{
  fields: z.ZodObject<Record<string, typeof extractedFieldSchema>>;
}> {
  const shape = Object.fromEntries(
    DOCUMENT_FIELD_CATALOGUE[kind].map((field) => [
      field.name,
      extractedFieldSchema.describe(field.description),
    ]),
  );
  return z.strictObject({ fields: z.strictObject(shape) });
}
export const DOCUMENT_EXTRACTION_PROMPT = Object.freeze({
  id: "document_extraction",
  version: 1,
  instructions:
    "Read one page image of the named document kind. For every field copy the value as printed with these conversions: dates as YYYY-MM-DD; money as AED with two decimals and no currency word or separators; digits as Western digits; _en fields in Latin script and _ar fields in Arabic script; codes as the listed upper-case values. Evidence is the shortest printed text span, at most 80 characters, that supports the value. When the field is not printed return null value and evidence with null_reason absent. When its area is covered or blacked out use redacted. When printed but illegible use unreadable. Never infer or guess. A value printed under a different label is not this field.",
  /** Name the document kind so that similar labels retain their correct meaning. */
  userTextFor(kind: DocumentKind): string {
    return `Extract the fields from this ${kind} page.`;
  },
});
