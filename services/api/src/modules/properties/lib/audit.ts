import type { CompanyTransaction } from "./db.mjs";
import { randomUUID } from "node:crypto";
import { uuid, param, json } from "./sql";
export interface AuditContext {
  companyId: string;
  accountId: string;
  role: string | null;
  channel: "web_form" | "mobile_form";
  key: string | null;
  traceId: string;
}
export interface EventInput {
  type: string;
  subjectType: string;
  subjectId: string;
  before?: number;
  after?: number;
  fields?: string[];
  reason?: string;
  policy?: unknown;
}
export async function event(
  tx: CompanyTransaction,
  context: AuditContext,
  input: EventInput,
): Promise<string> {
  const id = randomUUID();
  await tx.execute(
    `insert into audit.audit_event(event_id,company_id,event_type,actor_account_id,actor_role,initiator,channel,subject_type,subject_id,version_before,version_after,changed_fields,reason,idempotency_key,trace_id,policy_decision) values (:event,:c,:type,:a,:role,'person',:channel,:subjectType,:subject,:before,:after,:fields,:reason,:key,:trace,:policy)`,
    [
      uuid("event", id),
      uuid("c", context.companyId),
      uuid("a", context.accountId),
      param("type", input.type),
      param("role", context.role),
      param("channel", context.channel),
      param("subjectType", input.subjectType),
      uuid("subject", input.subjectId),
      param("before", input.before ?? null),
      param("after", input.after ?? null),
      json("fields", input.fields ?? []),
      param("reason", input.reason ?? null),
      param("key", context.key),
      param("trace", context.traceId),
      input.policy === undefined
        ? param("policy", null, "JSON")
        : json("policy", input.policy),
    ],
  );
  return id;
}
