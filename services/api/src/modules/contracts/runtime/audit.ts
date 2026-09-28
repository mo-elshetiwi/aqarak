import { randomUUID } from "node:crypto";
import type { CompanyTransaction } from "./db";
import { parameters } from "./sql";
export interface AuditActor {
  companyId: string;
  accountId: string;
  role: "manager" | "owner" | "tenant" | null;
  channel: "web_form" | "mobile_form";
  traceId: string | null;
  key: string | null;
}
export interface Mutation {
  subjectType: string;
  subjectId: string;
  version: number;
  before: number | null;
  fields: readonly string[];
  eventType: string;
}
export interface EventInput {
  eventType: string;
  subjectType: string;
  subjectId: string;
  before?: number | null;
  after?: number | null;
  fields?: readonly string[];
  reason?: string | null;
  denied?: readonly string[];
  registryEntry?: string | null;
  promptVersion?: string | null;
  fieldProvenance?: Readonly<Record<string, string>> | null;
}
export async function insertAudit(
  tx: CompanyTransaction,
  actor: AuditActor,
  input: EventInput,
): Promise<string> {
  const eventId = randomUUID();
  await tx.execute(
    `insert into audit.audit_event
    (event_id, company_id, event_type, actor_account_id, actor_role, initiator, channel,
     subject_type, subject_id, version_before, version_after, changed_fields, reason,
     policy_decision, idempotency_key, trace_id, registry_entry, prompt_version, field_provenance)
    values (:id::uuid, :company::uuid, :type, :account::uuid, :role, 'person', :channel,
     :subjectType, :subjectId::uuid, :before::integer, :after::integer, :fields::jsonb, :reason,
     :policy::jsonb, :key, :trace, :registry, :prompt, :provenance::jsonb)`,
    parameters({
      id: eventId,
      company: actor.companyId,
      type: input.eventType,
      account: actor.accountId,
      role: actor.role,
      channel: actor.channel,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      before: input.before ?? null,
      after: input.after ?? null,
      fields: JSON.stringify([...(input.fields ?? [])].sort()),
      reason: input.reason ?? null,
      policy: JSON.stringify({
        policy_version: "contracts.v1",
        result: input.denied ? "deny" : "allow",
        reasons: input.denied ?? [],
      }),
      key: actor.key,
      trace: actor.traceId,
      registry: input.registryEntry ?? null,
      prompt: input.promptVersion ?? null,
      provenance: input.fieldProvenance
        ? JSON.stringify(input.fieldProvenance)
        : null,
    }),
  );
  return eventId;
}
export async function coverMutation(
  tx: CompanyTransaction,
  input: { companyId: string; eventId: string; mutation: Mutation },
): Promise<void> {
  const m = input.mutation;
  await tx.execute(
    `insert into audit.event_subject(company_id,event_id,subject_type,subject_id,subject_version)
    values (:company::uuid,:event::uuid,:type,:id::uuid,:version)`,
    parameters({
      company: input.companyId,
      event: input.eventId,
      type: m.subjectType,
      id: m.subjectId,
      version: m.version,
    }),
  );
}
export async function flushAudit(
  tx: CompanyTransaction,
  actor: AuditActor,
  input: {
    events: readonly string[];
    mutations: readonly Mutation[];
    contractId: string;
    reason?: string | null;
    provenance?: Pick<
      EventInput,
      "registryEntry" | "promptVersion" | "fieldProvenance"
    >;
  },
): Promise<void> {
  for (const eventType of input.events) {
    const group = input.mutations.filter((m) => m.eventType === eventType);
    const subjectType = eventType.split(".")[0] ?? "contract";
    const primary = group.findLast((m) => m.subjectType === subjectType);
    const eventId = await insertAudit(tx, actor, {
      eventType,
      subjectType: primary?.subjectType ?? subjectType,
      subjectId: primary?.subjectId ?? input.contractId,
      ...primaryFields(primary, group),
      ...(eventType === "contract.created" ? { before: null } : {}),
      reason:
        eventType === "approval.voided"
          ? "contract_cancelled"
          : (input.reason ?? null),
      ...(eventType.startsWith("contract.") ? input.provenance : {}),
    });
    for (const mutation of group)
      if (mutation !== primary)
        await coverMutation(tx, {
          companyId: actor.companyId,
          eventId,
          mutation,
        });
  }
}

function primaryFields(
  primary: Mutation | undefined,
  group: readonly Mutation[],
): Pick<EventInput, "before" | "after" | "fields"> {
  if (!primary) return { before: null, after: null, fields: [] };
  const versions = group.filter(
    (m) =>
      m.subjectType === primary.subjectType &&
      m.subjectId === primary.subjectId,
  );
  return {
    before: versions[0]?.before ?? null,
    after: primary.version,
    fields: [...new Set(versions.flatMap((m) => m.fields))],
  };
}
