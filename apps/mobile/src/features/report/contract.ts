// I mirror services/api/src/modules/maintenance/contract.ts at the mobile boundary.
import { z } from "zod";

export const categorySchema = z.enum([
  "ac",
  "plumbing",
  "electrical",
  "appliances",
  "pest_control",
  "cleaning",
  "carpentry",
  "painting",
  "lift",
  "fire_safety",
  "other",
]);
export const prioritySchema = z.enum(["emergency", "urgent", "routine"]);
export const payerSchema = z.enum(["owner", "tenant", "company", "split"]);
export const safetyFlagSchema = z.enum([
  "gas_smell",
  "electrical_sparking",
  "water_into_electrics",
  "lift_entrapment",
  "other_safety_hazard",
]);
export const ticketStatusSchema = z.enum([
  "reported",
  "triaged",
  "awaiting_quote",
  "awaiting_cost_approval",
  "scheduled",
  "in_progress",
  "on_hold",
  "work_completed",
  "closed",
  "cancelled",
]);
export const mediaViewSchema = z.object({
  id: z.uuid(),
  unitId: z.uuid(),
  kind: z.enum(["photo", "voice_note"]),
  contentType: z.string(),
  byteSize: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  durationMs: z.number().int().min(0).max(300000).nullable(),
  status: z.enum([
    "awaiting_upload",
    "uploaded",
    "scan_clean",
    "scan_rejected",
  ]),
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
});
export const uploadBodySchema = z.strictObject({
  unitId: z.uuid(),
  kind: z.enum(["photo", "voice_note"]),
  contentType: z.string(),
  byteSize: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  durationMs: z.number().int().nonnegative().optional(),
});
export const completeBodySchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
});
export const ticketSummarySchema = z.object({
  id: z.uuid(),
  unitId: z.uuid(),
  unitLabel: z.string(),
  category: categorySchema,
  priority: prioritySchema,
  status: ticketStatusSchema,
  safetyCritical: z.boolean(),
  createdAt: z.iso.datetime(),
  reportedByMe: z.boolean(),
});
export const ticketViewSchema = ticketSummarySchema.extend({
  version: z.number().int().positive(),
  description: z.string().nullable(),
  transcript: z.string().nullable(),
  safetyFlags: z.array(safetyFlagSchema),
  payer: payerSchema,
  channel: z.enum(["mobile_form", "voice"]).nullable(),
  intakeId: z.uuid().nullable(),
  media: z.array(mediaViewSchema),
});
export const intakeBodySchema = z.strictObject({
  unitId: z.uuid(),
  language: z.enum(["en", "ar"]),
  voiceMediaId: z.uuid().nullable(),
  photoMediaIds: z.array(z.uuid()).max(3),
  typedText: z.string().max(2000).nullable(),
});
export const confirmIntakeBodySchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  transcript: z.string().max(8000).nullable(),
  category: categorySchema,
  priority: prioritySchema,
  safetyFlags: z.array(safetyFlagSchema),
  description: z.string().min(1).max(1000),
});
export const rejectIntakeBodySchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  reason: z.string().nullable(),
});
export const intakeViewSchema = z.object({
  id: z.uuid(),
  version: z.number().int().positive(),
  status: z.enum(["ready", "committed", "rejected", "expired", "failed"]),
  unitId: z.uuid(),
  language: z.enum(["en", "ar"]),
  transcript: z.string().max(8000).nullable(),
  typedText: z.string().max(2000).nullable(),
  category: categorySchema,
  priority: prioritySchema,
  safetyFlags: z.array(safetyFlagSchema),
  description: z.string().max(1000),
  payer: payerSchema,
  transcription: z.object({
    mode: z.enum(["model", "degraded", "not_requested"]),
  }),
  triage: z.object({
    mode: z.enum(["model", "degraded"]),
    confidence: z.number().min(0).max(1).nullable(),
  }),
  media: z.array(mediaViewSchema),
  ticketId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});
export type MediaView = z.infer<typeof mediaViewSchema>;
export type UploadBody = z.infer<typeof uploadBodySchema>;
export type TicketSummary = z.infer<typeof ticketSummarySchema>;
export type TicketView = z.infer<typeof ticketViewSchema>;
export type IntakeView = z.infer<typeof intakeViewSchema>;

export const unitsSchema = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      unitNo: z.string(),
      propertyName: z.string(),
      label: z.string(),
    }),
  ),
});
export const uploadResponseSchema = z.object({
  media: mediaViewSchema,
  upload: z.object({
    method: z.literal("PUT"),
    url: z.url(),
    headers: z.record(z.string(), z.string()),
    expiresAt: z.iso.datetime(),
  }),
});
export const mediaResponseSchema = z.object({ media: mediaViewSchema });
export const intakeResponseSchema = z.object({ intake: intakeViewSchema });
export const confirmResponseSchema = z.object({
  ticket: ticketViewSchema,
  intake: intakeViewSchema,
});
export type ReportUnit = z.infer<typeof unitsSchema>["items"][number];
export type UploadResponse = z.infer<typeof uploadResponseSchema>;
export type IntakeBody = z.infer<typeof intakeBodySchema>;
export type ConfirmIntakeBody = z.infer<typeof confirmIntakeBodySchema>;
export type RejectIntakeBody = z.infer<typeof rejectIntakeBodySchema>;
export type ConfirmResponse = z.infer<typeof confirmResponseSchema>;

export const ticketsResponseSchema = z.object({
  items: z.array(ticketSummarySchema),
  nextCursor: z.string().nullable(),
});
export const ticketResponseSchema = z.object({ ticket: ticketViewSchema });
export const mediaLinkSchema = z.object({
  url: z.url(),
  expiresAt: z.iso.datetime(),
});
export type TicketsPage = z.infer<typeof ticketsResponseSchema>;
export type MediaLink = z.infer<typeof mediaLinkSchema>;
