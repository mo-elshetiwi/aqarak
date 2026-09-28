import { z } from "@hono/zod-openapi";
import { expectedVersion, dateSchema, reasonSchema } from "./schemas";
export const uploadSchema = z
  .object({
    docType: z.string().trim().min(1).max(80),
    contentType: z.string().trim().min(1).max(100),
    byteSize: z.number().int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export const uploadResponseSchema = z.object({
  documentId: z.uuid(),
  documentVersionId: z.uuid(),
  versionNo: expectedVersion,
  upload: z.object({
    url: z.url(),
    method: z.literal("PUT"),
    headers: z.object({
      "Content-Type": z.string(),
      "x-amz-checksum-sha256": z.string(),
    }),
    expiresAt: z.iso.datetime(),
  }),
});
export const acceptDocumentSchema = z
  .object({
    expectedVersion,
    issueDate: dateSchema.optional(),
    expiryDate: dateSchema.optional(),
  })
  .strict();
export const rejectDocumentSchema = z
  .object({ expectedVersion, reason: reasonSchema })
  .strict();
export const ownerDocumentTypes = [
  "emirates_id",
  "passport",
  "management_agreement",
  "tawtheeq_authorisation",
] as const;
export const propertyDocumentTypes = [
  "title_deed",
  "site_plan",
  "civil_defence_certificate",
  "hassantuk_certificate",
  "occupancy_certificate",
  "floor_plan",
  "maintenance_contract",
  "fire_safety_contract",
] as const;
