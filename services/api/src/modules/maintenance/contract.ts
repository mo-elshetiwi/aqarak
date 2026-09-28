import { safetyCriticalFlag } from "@aqarak/domain";
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
export const safetyFlagSchema = safetyCriticalFlag;
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
export const uploadBodySchema = z
  .strictObject({
    unitId: z.uuid(),
    kind: z.enum(["photo", "voice_note"]),
    contentType: z.string(),
    byteSize: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    durationMs: z.number().int().nonnegative().optional(),
  })
  .superRefine((body, context) => {
    const photo = body.kind === "photo";
    const types = photo
      ? ["image/jpeg", "image/png"]
      : [
          "audio/mp4",
          "audio/m4a",
          "audio/aac",
          "audio/mpeg",
          "audio/wav",
          "audio/webm",
        ];
    if (!types.includes(body.contentType))
      context.addIssue({
        code: "custom",
        path: ["contentType"],
        message: photo
          ? "Photo contentType must be image/jpeg or image/png."
          : "Voice contentType must be audio/mp4, audio/m4a, audio/aac, audio/mpeg, audio/wav or audio/webm.",
        params: { problemCode: "UNSUPPORTED_TYPE" },
      });
    if (body.byteSize > (photo ? 20 : 25) * 1024 * 1024)
      context.addIssue({
        code: "custom",
        path: ["byteSize"],
        message: photo
          ? "Photo byteSize must not exceed 20 MiB."
          : "Voice byteSize must not exceed 25 MiB.",
        params: { problemCode: "LIMIT_EXCEEDED" },
      });
    if (
      (photo && body.durationMs !== undefined) ||
      (body.durationMs ?? 0) > 300000
    )
      context.addIssue({
        code: "custom",
        path: ["durationMs"],
        message: photo
          ? "Photos must not declare durationMs."
          : "Voice durationMs must not exceed 300000.",
        params: { problemCode: "LIMIT_EXCEEDED" },
      });
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
  reason: z.string().max(500).nullable(),
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

export const problemCodes = [
  "INVALID_REQUEST",
  "INVALID_INPUT",
  "MEDIA_NOT_READY",
  "MEDIA_IN_USE",
  "ALREADY_DECIDED",
  "STALE_VERSION",
  "EXPIRED",
  "IDEMPOTENCY_KEY_REQUIRED",
  "IDEMPOTENCY_KEY_REUSED",
  "NOT_FOUND",
  "NOT_AUTHORISED",
  "UNAUTHENTICATED",
  "INTERNAL_ERROR",
  "SERVICE_UNAVAILABLE",
  "UNSUPPORTED_TYPE",
  "LIMIT_EXCEEDED",
  "UPLOAD_ALREADY_COMPLETED",
  "UPLOAD_NOT_FOUND",
  "UPLOAD_MISMATCH",
  "UPLOAD_NOT_READY",
] as const;
export const problemCodeSchema = z.enum(problemCodes);
export type ProblemCode = z.infer<typeof problemCodeSchema>;
