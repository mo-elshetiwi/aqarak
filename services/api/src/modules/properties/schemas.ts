import { z } from "@hono/zod-openapi";
import { unitStatus } from "./lib/domain";
import {
  nameSchema,
  expectedVersion,
  reasonSchema,
  documentItemSchema,
  historySchema,
} from "./lib/schemas";
const optionalText = z.string().trim().min(1).max(250);
export const propertyUse = z.enum(["residential", "commercial", "mixed"]);
export const propertySummarySchema = z.object({
  id: z.uuid(),
  version: expectedVersion,
  name: nameSchema,
});
export const createPropertySchema = z
  .object({
    name: nameSchema,
    kind: z.enum(["building", "villa", "plot"]),
    area: nameSchema.optional(),
    plotNo: optionalText.optional(),
    titleDeedNo: optionalText.optional(),
    prpNumber: optionalText.optional(),
    onwaniAddress: optionalText.optional(),
    zone: optionalText.optional(),
    use: propertyUse,
    ownerId: z.uuid(),
    ownerGateOverride: z.boolean().nullable(),
  })
  .strict();
export const updatePropertySchema = createPropertySchema
  .omit({ kind: true, ownerId: true })
  .partial()
  .extend({ expectedVersion, reason: reasonSchema.optional() })
  .strict()
  .refine((body) =>
    Object.keys(body).some(
      (key) => key !== "expectedVersion" && key !== "reason",
    ),
  );
export const unitInputSchema = z
  .object({
    unitNo: z.string().trim().min(1).max(20),
    untNumber: optionalText.optional(),
    use: z.enum(["residential", "commercial"]),
    kind: z.enum([
      "apartment",
      "villa",
      "townhouse",
      "office",
      "shop",
      "warehouse",
      "other",
    ]),
    bedrooms: z.number().int().min(0).max(100).optional(),
    areaSqm: z
      .string()
      .regex(/^(0|[1-9][0-9]{0,7})(\.[0-9]{1,2})?$/)
      .refine((value) => Number(value) > 0)
      .optional(),
  })
  .strict();
export const bulkUnitsSchema = z
  .object({ units: z.array(unitInputSchema).min(1).max(100) })
  .strict();
export const updateUnitSchema = unitInputSchema
  .partial()
  .extend({ expectedVersion })
  .strict()
  .refine((body) => Object.keys(body).length > 1);
export const unitStatusSchema = z
  .object({
    expectedVersion,
    command: z.enum([
      "list",
      "delist",
      "block",
      "unblock",
      "open_make_ready",
      "close_make_ready",
    ]),
    reason: reasonSchema,
    blockReason: z.enum(["owner_use", "legal_hold", "sale"]).optional(),
  })
  .strict()
  .refine(
    (body) => body.command !== "block" || body.blockReason !== undefined,
    { path: ["blockReason"] },
  );
export const unitItemSchema = z.object({
  id: z.uuid(),
  version: expectedVersion,
  unitNo: z.string(),
  untNumber: z.string().nullable(),
  use: z.enum(["residential", "commercial"]),
  kind: z.enum([
    "apartment",
    "villa",
    "townhouse",
    "office",
    "shop",
    "warehouse",
    "other",
  ]),
  bedrooms: z.number().nullable(),
  areaSqm: z.string().nullable(),
  status: unitStatus,
  blockReason: z.string().nullable(),
});
export const propertyListItemSchema = propertySummarySchema.extend({
  kind: z.enum(["building", "villa", "plot"]),
  area: nameSchema.nullable(),
  use: propertyUse.nullable(),
  owners: z.array(z.object({ id: z.uuid(), fullName: nameSchema })),
  unitCount: z.number(),
  unitsByStatus: z.record(unitStatus, z.number()),
  titleDeed: z
    .object({ reviewStatus: z.string(), processingStatus: z.string() })
    .nullable(),
  ownerGate: z.object({
    value: z.boolean(),
    source: z.enum([
      "mandate",
      "company_default",
      "self_managed",
      "property_override",
    ]),
  }),
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
  history: historySchema,
});
