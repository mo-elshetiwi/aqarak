import { randomUUID } from "node:crypto";
import type { CompanyTransaction } from "./database";
import { rows } from "./sql";

export interface AuditSubject {
  readonly type: string;
  readonly id: string;
  readonly version: number;
}
export interface AuditEvent {
  readonly companyId: string;
  readonly accountId: string | null;
  readonly type: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly versionBefore?: number;
  readonly versionAfter?: number;
  readonly reason?: string;
  readonly initiator?: "person" | "pipeline";
  readonly changedFields?: readonly string[];
  readonly fieldProvenance?: Readonly<Record<string, string>>;
  readonly modelCallIds?: readonly string[];
  readonly registryEntry?: string | null;
  readonly promptVersion?: string | null;
  readonly denialCode?: string;
}
export async function appendAuditEvent(
  tx: CompanyTransaction,
  event: AuditEvent,
  extraSubjects: readonly AuditSubject[] = [],
): Promise<string> {
  const id = randomUUID();
  await rows(
    tx,
    `insert into audit.audit_event
    (event_id,company_id,event_type,actor_account_id,initiator,channel,subject_type,subject_id,
     version_before,version_after,reason,changed_fields,field_provenance,model_call_ids,registry_entry,prompt_version,policy_decision)
    values (cast(:id as uuid),cast(:company as uuid),:type,cast(:account as uuid),:initiator,'web_form',:subject_type,cast(:subject as uuid),
      :before,:after,:reason,cast(:changed as jsonb),cast(:provenance as jsonb),cast(:calls as jsonb),:registry,:prompt,cast(:policy as jsonb))`,
    {
      id,
      company: event.companyId,
      type: event.type,
      account: event.accountId,
      initiator: event.initiator ?? "person",
      subject_type: event.subjectType,
      subject: event.subjectId,
      before: event.versionBefore ?? null,
      after: event.versionAfter ?? null,
      reason: event.reason ?? null,
      changed: JSON.stringify(event.changedFields ?? []),
      provenance: event.fieldProvenance
        ? JSON.stringify(event.fieldProvenance)
        : null,
      calls: JSON.stringify(event.modelCallIds ?? []),
      registry: event.registryEntry ?? null,
      prompt: event.promptVersion ?? null,
      policy: event.denialCode
        ? JSON.stringify({
            policy_version: "j3-1",
            result: "deny",
            reasons: [event.denialCode],
          })
        : null,
    },
  );
  for (const subject of extraSubjects) {
    await rows(
      tx,
      `insert into audit.event_subject(company_id,event_id,subject_type,subject_id,subject_version)
      values(cast(:company as uuid),cast(:event as uuid),:type,cast(:id as uuid),:version)`,
      {
        company: event.companyId,
        event: id,
        type: subject.type,
        id: subject.id,
        version: subject.version,
      },
    );
  }
  return id;
}
