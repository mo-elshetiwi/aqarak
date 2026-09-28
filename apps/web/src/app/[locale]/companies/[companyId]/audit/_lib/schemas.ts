import { z } from "zod";
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const sequence = z.number().int().positive();
export const subjectTypeSchema = z.enum([
  "tawtheeq_record",
  "discrepancy",
  "contract",
  "contract_version",
  "approval",
  "document_version",
  "document",
  "company",
]);
export const filtersSchema = z.object({
  subjectType: z.string().min(1).max(100).optional(),
  subjectId: z.guid().optional(),
  actorAccountId: z.guid().optional(),
  eventType: z
    .string()
    .regex(/^[a-z_]+\.[a-z_]+$/)
    .optional(),
  initiator: z
    .enum(["person", "co_worker", "pipeline", "scheduler"])
    .optional(),
  refusalsOnly: z.enum(["true", "false"]).optional(),
  afterSeq: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(5000).optional(),
});
export const eventFiltersSchema = filtersSchema.extend({
  limit: z.coerce.number().int().positive().max(100).optional(),
});
export const eventSchema = z.object({
  seq: sequence,
  eventId: z.uuid(),
  occurredAt: z.iso.datetime(),
  eventType: z.string(),
  refused: z.boolean(),
  actor: z
    .object({
      accountId: z.guid(),
      displayName: z.string().nullable(),
      role: z.string().nullable(),
    })
    .nullable(),
  initiator: z.enum(["person", "co_worker", "pipeline", "scheduler"]),
  channel: z.enum([
    "web_form",
    "mobile_form",
    "chat",
    "voice",
    "system",
    "import",
  ]),
  subject: z.object({
    type: z.string(),
    id: z.uuid(),
    versionBefore: sequence.nullable(),
    versionAfter: sequence.nullable(),
  }),
  reason: z.string().nullable(),
  changedFields: z.array(z.string()),
  details: z.record(z.string(), z.json()),
  modelCallIds: z.array(z.uuid()),
  registryEntry: z.string().nullable(),
  promptVersion: z.string().nullable(),
  prevHash: hashSchema,
  rowHash: hashSchema,
});
export const eventsSchema = z.object({
  events: z.array(eventSchema),
  nextCursor: sequence.nullable(),
});
export const anchorSchema = z.object({
  seq: sequence,
  headHash: hashSchema,
  anchoredAt: z.iso.datetime(),
  objectVersionId: z.string(),
});
export const anchorResultSchema = anchorSchema.extend({ key: z.string() });
export const verificationSchema = z.object({
  ok: z.boolean(),
  checkedAt: z.iso.datetime(),
  eventCount: z.number().int().nonnegative(),
  firstSeq: sequence.nullable(),
  lastSeq: sequence.nullable(),
  headHash: hashSchema.nullable(),
  anchor: anchorSchema.nullable(),
  anchorProblem: z.string().nullable(),
  sql: z.object({
    ok: z.boolean(),
    firstBadSeq: sequence.nullable(),
    problem: z.string().nullable(),
  }),
  recomputed: z.object({
    ok: z.boolean(),
    break: z
      .object({
        kind: z.enum([
          "seq_gap",
          "seq_out_of_order",
          "prev_hash_mismatch",
          "row_hash_mismatch",
          "head_mismatch",
          "behind_anchor",
        ]),
        seq: sequence,
      })
      .nullable(),
  }),
});
export const versionSchema = z.object({
  version: sequence,
  recordedAt: z.iso.datetime(),
  snapshotSha256: hashSchema,
  snapshot: z.record(z.string(), z.json()),
  event: z
    .object({
      seq: sequence,
      eventType: z.string().nullable(),
      actorDisplayName: z.string().nullable(),
      actorRole: z.string().nullable(),
      reason: z.string().nullable(),
    })
    .nullable(),
  diff: z.array(
    z.object({ field: z.string(), before: z.json(), after: z.json() }),
  ),
});
export const versionsSchema = z.object({
  subject: z.object({ type: subjectTypeSchema, id: z.guid() }),
  versions: z.array(versionSchema),
});
export type AuditFilters = z.infer<typeof filtersSchema>;
export type AuditEvent = z.infer<typeof eventSchema>;
export type Events = z.infer<typeof eventsSchema>;
export type Anchor = z.infer<typeof anchorResultSchema>;
export type Verification = z.infer<typeof verificationSchema>;
export type Versions = z.infer<typeof versionsSchema>;
export type SubjectType = z.infer<typeof subjectTypeSchema>;
export type AuditResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { status: number; code: string; domainCode?: string } };
export const unavailable = {
  ok: false,
  error: { status: 503, code: "UNAVAILABLE" },
} as const;
export function filterQuery(filters: AuditFilters): string {
  return new URLSearchParams(
    Object.entries(filters)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  ).toString();
}
