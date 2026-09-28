import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import type { CompanyTransaction, Parameter } from "@aqarak/db";
import { Refusal } from "./kernel";
import { decodeJsonColumn } from "./kernel/database-json";

export const subjectType = z.enum([
  "tawtheeq_record",
  "discrepancy",
  "contract",
  "contract_version",
  "approval",
  "document_version",
  "document",
  "company",
]);
const positiveInteger = z.coerce.number().int().positive();
const hash = z.string().regex(/^[0-9a-f]{64}$/);
export const jsonRecord = z.record(z.string(), z.json());

/** Validates a single-valued, closed set of trail filters. */
export function filterSchema(
  maximum = 100,
  defaultLimit = 50,
): z.ZodObject<{
  subjectType: z.ZodOptional<z.ZodString>;
  subjectId: z.ZodOptional<z.ZodGUID>;
  actorAccountId: z.ZodOptional<z.ZodGUID>;
  eventType: z.ZodOptional<z.ZodString>;
  initiator: z.ZodOptional<
    z.ZodEnum<{
      person: "person";
      co_worker: "co_worker";
      pipeline: "pipeline";
      scheduler: "scheduler";
    }>
  >;
  refusalsOnly: z.ZodOptional<z.ZodEnum<{ true: "true"; false: "false" }>>;
  afterSeq: z.ZodOptional<typeof positiveInteger>;
  limit: z.ZodDefault<typeof positiveInteger>;
}> {
  return z.strictObject({
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
    afterSeq: positiveInteger.optional(),
    limit: positiveInteger.max(maximum).default(defaultLimit),
  });
}
export type TrailFilters = z.infer<ReturnType<typeof filterSchema>>;

export function parseFilters(
  queries: Record<string, string[]>,
  csv = false,
): TrailFilters {
  if (Object.values(queries).some((values) => values.length !== 1))
    throw new Refusal("VALIDATION_FAILED", null);
  return filterSchema(csv ? 5000 : 100, csv ? 5000 : 50).parse(
    Object.fromEntries(
      Object.entries(queries).map(([key, values]) => [key, values[0]]),
    ),
  );
}

const eventRow = z.strictObject({
  seq: positiveInteger,
  event_id: z.uuid(),
  occurred_at: z.iso.datetime(),
  event_type: z.string(),
  actor_account_id: z.guid().nullable(),
  display_name: z.string().nullable(),
  actor_role: z.string().nullable(),
  initiator: z.enum(["person", "co_worker", "pipeline", "scheduler"]),
  channel: z.enum([
    "web_form",
    "mobile_form",
    "chat",
    "voice",
    "system",
    "import",
  ]),
  subject_type: z.string(),
  subject_id: z.guid(),
  version_before: positiveInteger.nullable(),
  version_after: positiveInteger.nullable(),
  reason: z.string().nullable(),
  changed_fields: z.preprocess(decodeJsonColumn, z.array(z.string())),
  details: z.preprocess(decodeJsonColumn, jsonRecord.nullable()),
  model_call_ids: z.preprocess(decodeJsonColumn, z.array(z.uuid())),
  registry_entry: z.string().nullable(),
  prompt_version: z.string().nullable(),
  prev_hash: hash,
  row_hash: hash,
});
export interface AuditEventView {
  readonly seq: number;
  readonly eventId: string;
  readonly occurredAt: string;
  readonly eventType: string;
  readonly refused: boolean;
  readonly actor: {
    accountId: string;
    displayName: string | null;
    role: string | null;
  } | null;
  readonly initiator: string;
  readonly channel: string;
  readonly subject: {
    type: string;
    id: string;
    versionBefore: number | null;
    versionAfter: number | null;
  };
  readonly reason: string | null;
  readonly changedFields: readonly string[];
  readonly details: Record<string, unknown>;
  readonly modelCallIds: readonly string[];
  readonly registryEntry: string | null;
  readonly promptVersion: string | null;
  readonly prevHash: string;
  readonly rowHash: string;
}

export async function readEvents(
  tx: CompanyTransaction,
  companyId: string,
  filters: TrailFilters,
  csv = false,
): Promise<AuditEventView[]> {
  const conditions = ["e.company_id = :company::uuid"];
  const params: Parameter[] = [
    { name: "company", value: companyId },
    { name: "limit", value: filters.limit + (csv ? 0 : 1) },
  ];
  const comparisons = {
    subjectType: "e.subject_type = :subjectType",
    subjectId: "e.subject_id = :subjectId::uuid",
    actorAccountId: "e.actor_account_id = :actorAccountId::uuid",
    eventType: "e.event_type = :eventType",
    initiator: "e.initiator = :initiator",
    afterSeq: "e.seq < :afterSeq::bigint",
  } as const;
  for (const key of Object.keys(comparisons) as (keyof typeof comparisons)[]) {
    const value = filters[key];
    if (value !== undefined) {
      conditions.push(comparisons[key]);
      params.push({ name: key, value });
    }
  }
  if (filters.refusalsOnly === "true")
    conditions.push("e.event_type = 'policy.denied'");
  const result = await tx.execute(
    `select e.seq, e.event_id,
    to_char(e.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as occurred_at,
    e.event_type, e.actor_account_id, p.display_name, e.actor_role, e.initiator, e.channel,
    e.subject_type, e.subject_id, e.version_before, e.version_after, e.reason, e.changed_fields,
    e.details, e.model_call_ids, e.registry_entry, e.prompt_version, e.prev_hash, e.row_hash
    from audit.audit_event e left join core.person_account p on p.id = e.actor_account_id
    where ${conditions.join(" and ")} order by e.seq ${csv ? "asc" : "desc"} limit :limit`,
    params,
  );
  return result.rows.map((raw) => {
    const row = eventRow.parse(raw);
    return {
      seq: row.seq,
      eventId: row.event_id,
      occurredAt: row.occurred_at,
      eventType: row.event_type,
      refused: row.event_type === "policy.denied",
      actor:
        row.actor_account_id === null
          ? null
          : {
              accountId: row.actor_account_id,
              displayName: row.display_name,
              role: row.actor_role,
            },
      initiator: row.initiator,
      channel: row.channel,
      subject: {
        type: row.subject_type,
        id: row.subject_id,
        versionBefore: row.version_before,
        versionAfter: row.version_after,
      },
      reason: row.reason,
      changedFields: row.changed_fields,
      details: row.details ?? {},
      modelCallIds: row.model_call_ids,
      registryEntry: row.registry_entry,
      promptVersion: row.prompt_version,
      prevHash: row.prev_hash,
      rowHash: row.row_hash,
    };
  });
}

export interface VersionDiff {
  readonly field: string;
  readonly before: unknown;
  readonly after: unknown;
}
const metadata = new Set([
  "version",
  "created_at",
  "created_by",
  "updated_at",
  "updated_by",
  "search_norm",
]);

/** Compares business fields in stable order, including non-null fields on the first version. */
export function versionDiff(
  previous: Record<string, unknown> | null,
  current: Record<string, unknown>,
): VersionDiff[] {
  const before = previous === null ? {} : jsonRecord.parse(previous);
  const after = jsonRecord.parse(current);
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .sort()
    .flatMap((field) => {
      const left = before[field] ?? null;
      const right = after[field] ?? null;
      return metadata.has(field) || isDeepStrictEqual(left, right)
        ? []
        : [{ field, before: left, after: right }];
    });
}

const versionRow = z.strictObject({
  version: positiveInteger,
  recorded_at: z.iso.datetime(),
  snapshot_sha256: hash,
  snapshot: z.preprocess(decodeJsonColumn, jsonRecord),
  seq: positiveInteger.nullable(),
  event_type: z.string().nullable(),
  display_name: z.string().nullable(),
  actor_role: z.string().nullable(),
  reason: z.string().nullable(),
});
export interface SubjectVersionView {
  readonly version: number;
  readonly recordedAt: string;
  readonly snapshotSha256: string;
  readonly snapshot: Record<string, unknown>;
  readonly event: {
    seq: number;
    eventType: string | null;
    actorDisplayName: string | null;
    actorRole: string | null;
    reason: string | null;
  } | null;
  readonly diff: readonly VersionDiff[];
}

export async function readVersions(
  tx: CompanyTransaction,
  companyId: string,
  subject: { type: string; id: string },
): Promise<SubjectVersionView[]> {
  const result = await tx.execute(
    `select v.subject_version as version,
    to_char(v.recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as recorded_at,
    v.snapshot_sha256, v.snapshot, e.seq, e.event_type, p.display_name, e.actor_role, e.reason
    from audit.entity_version v left join audit.event_subject s on s.company_id = v.company_id
      and s.subject_type = v.subject_type and s.subject_id = v.subject_id and s.subject_version = v.subject_version
    left join audit.audit_event e on e.company_id = s.company_id and e.event_id = s.event_id
    left join core.person_account p on p.id = e.actor_account_id
    where v.company_id = :company::uuid and v.subject_type = :type and v.subject_id = :id::uuid
    order by v.subject_version`,
    [
      { name: "company", value: companyId },
      { name: "type", value: subject.type },
      { name: "id", value: subject.id },
    ],
  );
  if (!result.rows.length) throw new Refusal("NOT_FOUND", subject);
  let previous: Record<string, unknown> | null = null;
  return result.rows.map((raw) => {
    const row = versionRow.parse(raw);
    const diff = versionDiff(previous, row.snapshot);
    previous = row.snapshot;
    return {
      version: row.version,
      recordedAt: row.recorded_at,
      snapshotSha256: row.snapshot_sha256,
      snapshot: row.snapshot,
      event:
        row.seq === null
          ? null
          : {
              seq: row.seq,
              eventType: row.event_type,
              actorDisplayName: row.display_name,
              actorRole: row.actor_role,
              reason: row.reason,
            },
      diff,
    };
  });
}
