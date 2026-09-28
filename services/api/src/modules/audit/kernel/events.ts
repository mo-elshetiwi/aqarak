import type { CompanyTransaction, Parameter } from "@aqarak/db";
import { z } from "zod";
import { Refusal } from "./problems";

export interface AuditEventInput {
  readonly eventType: string;
  readonly actorAccountId: string | null;
  readonly actorRole: string | null;
  readonly initiator: "person" | "co_worker" | "pipeline" | "scheduler";
  readonly channel:
    "web_form" | "mobile_form" | "chat" | "voice" | "system" | "import";
  readonly subjectType: string;
  readonly subjectId: string;
  readonly versionBefore: number | null;
  readonly versionAfter: number | null;
  readonly changedFields?: readonly string[];
  readonly reason?: string | null;
  readonly details?: Record<string, unknown>;
  readonly idempotencyKey?: string | null;
  readonly traceId?: string | null;
  readonly visibility?: "staff" | "parties";
  readonly modelCallIds?: readonly string[];
  readonly registryEntry?: string | null;
  readonly promptVersion?: string | null;
  readonly draftedActionId?: string | null;
  readonly fieldProvenance?: Record<string, unknown> | null;
}
const eventInput = z.strictObject({
  eventType: z.string().regex(/^[a-z_]+\.[a-z_]+$/),
  actorAccountId: z.guid().nullable(),
  actorRole: z
    .enum([
      "manager",
      "company_administrator",
      "accountant",
      "technician",
      "owner",
      "tenant",
    ])
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
  subjectType: z.string().min(1),
  subjectId: z.guid(),
  versionBefore: z.number().int().positive().nullable(),
  versionAfter: z.number().int().positive().nullable(),
  changedFields: z.array(z.string()).default([]),
  reason: z.string().nullable().default(null),
  details: z.record(z.string(), z.json()).default({}),
  idempotencyKey: z.string().nullable().default(null),
  traceId: z.string().nullable().default(null),
  visibility: z.enum(["staff", "parties"]).default("staff"),
  modelCallIds: z.array(z.uuid()).default([]),
  registryEntry: z.string().nullable().default(null),
  promptVersion: z.string().nullable().default(null),
  draftedActionId: z.uuid().nullable().default(null),
  fieldProvenance: z
    .record(z.string(), z.enum(["ai_confirmed", "ai_edited", "human_entered"]))
    .nullable()
    .default(null),
});

/** Inserts a declared event; database triggers assign sequence, hashes and primary coverage. */
export async function writeAuditEvent(
  tx: CompanyTransaction,
  companyId: string,
  input: AuditEventInput,
): Promise<{ eventId: string; seq: number }> {
  const event = eventInput.parse(input);
  if (
    /(discrepancy_resolved|skipped|rejected|returned|cancelled|withdrawn|voided|waived)$/.test(
      event.eventType,
    ) &&
    !event.reason?.trim()
  )
    throw new Refusal("REASON_REQUIRED", {
      type: event.subjectType,
      id: event.subjectId,
    });
  const columns: Record<string, string | number | null> = {
    company_id: z.uuid().parse(companyId),
    event_type: event.eventType,
    actor_account_id: event.actorAccountId,
    actor_role: event.actorRole,
    initiator: event.initiator,
    channel: event.channel,
    subject_type: event.subjectType,
    subject_id: event.subjectId,
    version_before: event.versionBefore,
    version_after: event.versionAfter,
    changed_fields: JSON.stringify(event.changedFields),
    reason: event.reason,
    details: JSON.stringify(event.details),
    idempotency_key: event.idempotencyKey,
    trace_id: event.traceId,
    visibility: event.visibility,
    model_call_ids: JSON.stringify(event.modelCallIds),
    registry_entry: event.registryEntry,
    prompt_version: event.promptVersion,
    drafted_action_id: event.draftedActionId,
    field_provenance:
      event.fieldProvenance === null
        ? null
        : JSON.stringify(event.fieldProvenance),
  };
  const jsonColumns = new Set([
    "changed_fields",
    "details",
    "model_call_ids",
    "field_provenance",
  ]);
  const uuidColumns = new Set([
    "company_id",
    "actor_account_id",
    "subject_id",
    "drafted_action_id",
  ]);
  const keys = Object.keys(columns);
  const params: Parameter[] = Object.entries(columns).map(([name, value]) => ({
    name,
    value,
  }));
  const placeholders = keys.map(
    (key) =>
      `:${key}${jsonColumns.has(key) ? "::jsonb" : uuidColumns.has(key) ? "::uuid" : ""}`,
  );
  const result = await tx.execute(
    `insert into audit.audit_event (${keys.join(",")}) values (${placeholders.join(",")}) returning event_id, seq`,
    params,
  );
  const row = z
    .strictObject({
      event_id: z.uuid(),
      seq: z.coerce.number().int().positive(),
    })
    .parse(result.rows[0]);
  return { eventId: row.event_id, seq: row.seq };
}

/** Covers every still-uncovered entity version written in this transaction. */
export async function coverTransactionVersions(
  tx: CompanyTransaction,
  companyId: string,
  eventId: string,
): Promise<number> {
  const result = await tx.execute(
    `insert into audit.event_subject(company_id, event_id, subject_type, subject_id, subject_version)
    select v.company_id, :event::uuid, v.subject_type, v.subject_id, v.subject_version
    from audit.entity_version v
    where v.company_id = :company::uuid and v.tx_id = pg_current_xact_id()::text::bigint
      and not exists (select 1 from audit.event_subject s where s.company_id = v.company_id
        and s.subject_type = v.subject_type and s.subject_id = v.subject_id and s.subject_version = v.subject_version)
    on conflict do nothing`,
    [
      { name: "company", value: z.uuid().parse(companyId) },
      { name: "event", value: z.uuid().parse(eventId) },
    ],
  );
  return result.numberOfRecordsUpdated;
}
