import { loadCompanyActor } from "../identity/adapters";
import { Refusal } from "../identity/problems";
import { randomUUID } from "node:crypto";
import type {
  DataApiExecutor,
  ExecuteResult,
  Parameter,
} from "@aqarak/db/data-api";
import { can, type PermissionActor } from "@aqarak/domain";
import { Denied } from "./problem";

export interface RequestScope {
  companyId: string;
  subject: string;
  channel: "mobile_form" | "voice";
}
export interface Transaction {
  accountId: string;
  scope: RequestScope;
  execute: (
    sql: string,
    parameters?: readonly Parameter[],
  ) => Promise<ExecuteResult>;
}
export interface Access {
  manager: boolean;
  actor: PermissionActor;
}
export function parameter(
  name: string,
  value: Parameter["value"],
  typeHint?: Parameter["typeHint"],
): Parameter {
  return { name, value, ...(typeHint ? { typeHint } : {}) };
}
export function uuid(name: string, value: string): Parameter {
  return parameter(name, value, "UUID");
}
export async function transaction<T>(
  db: DataApiExecutor,
  scope: RequestScope,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const id = await db.begin();
  const execute: Transaction["execute"] = (sql, params = []) =>
    db.execute(sql, params, id);
  try {
    await execute(
      "select set_config('app.company_id', :company, true) as company_context, set_config('app.account_id', :account, true) as account_context",
      [
        parameter("company", scope.companyId),
        parameter("account", scope.subject),
      ],
    );
    const result = await work({ accountId: scope.subject, scope, execute });
    await db.commit(id);
    return result;
  } catch (error) {
    await db.rollback(id).catch(() => undefined);
    throw error;
  }
}
export async function authorise(
  tx: Transaction,
  operation: "read" | "write",
): Promise<Access> {
  let actor: PermissionActor;
  try {
    actor = await loadCompanyActor(tx, tx.scope.companyId, tx.accountId);
  } catch (error) {
    if (error instanceof Refusal && error.code === "NOT_FOUND")
      throw new Denied("company", tx.scope.companyId);
    throw error;
  }
  const manager = actor.roles.includes("manager");
  if (!manager && !actor.roles.includes("tenant"))
    throw new Denied("company", tx.scope.companyId, 403, "NOT_AUTHORISED");
  const decision = can(
    actor,
    operation,
    operation === "write" ? "ticket_report" : "ticket_management",
    { company_id: actor.company_id, tenant_ids: actor.tenant_ids },
  );
  if (!decision.ok)
    throw new Denied("company", tx.scope.companyId, 403, "NOT_AUTHORISED");
  return { manager, actor };
}
export const ownUnitSql = `select cu.unit_id from lease.contract_unit cu
  join lease.contract lc on lc.company_id = cu.company_id and lc.id = cu.contract_id
  join party.tenant pt on pt.company_id = lc.company_id and pt.id = lc.tenant_id
  where cu.company_id = :company and lc.status = 'concluded' and pt.linked_account_id = :account`;
export const ownTicketSql = `t.reported_by_account_id = :account or exists (
  select 1 from lease.contract_unit cu
  join lease.contract lc on lc.company_id = cu.company_id and lc.id = cu.contract_id
  join lease.contract_version cv on cv.company_id = lc.company_id and cv.contract_id = lc.id and cv.id = lc.current_version_id
  join party.tenant pt on pt.company_id = lc.company_id and pt.id = lc.tenant_id
  where cu.company_id = :company and cu.unit_id = t.unit_id
    and lc.status = 'concluded' and pt.linked_account_id = :account
    and t.created_at >= (cv.term_start::timestamp at time zone 'UTC'))`;
export async function requireUnit(
  tx: Transaction,
  access: Access,
  unitId: string,
): Promise<void> {
  const result = await tx.execute(
    `select id from estate.unit where company_id = :company and id = :unit and (:manager or id in (${ownUnitSql}))`,
    [
      uuid("company", tx.scope.companyId),
      uuid("account", tx.accountId),
      uuid("unit", unitId),
      parameter("manager", access.manager),
    ],
  );
  if (!result.rows.length) throw new Denied("unit", unitId);
}
export interface AuditInput {
  event: string;
  subjectType: string;
  subjectId: string;
  versionBefore?: number;
  versionAfter?: number;
  key?: string;
  reason?: string;
  denied?: boolean;
  initiator?: "person" | "pipeline";
  draftedActionId?: string;
  modelCallIds?: readonly string[];
  provenance?: Record<string, string>;
  registryEntry?: string;
  promptVersion?: string;
  covers?: { type: string; id: string; version: number }[];
}
export async function audit(tx: Transaction, input: AuditInput): Promise<void> {
  const eventId = randomUUID();
  await tx.execute(
    `insert into audit.audit_event
    (event_id, company_id, actor_account_id, event_type, initiator, channel, subject_type, subject_id,
     version_before, version_after, idempotency_key, reason, policy_decision, visibility,
     drafted_action_id, model_call_ids, field_provenance, registry_entry, prompt_version)
    values (:event_id, :company, :account, :event, :initiator, :channel, :type, :id, :before, :after, :key, :reason, :policy, 'staff',
     :draft, :model_calls, :provenance, :registry, :prompt)`,
    [
      uuid("company", tx.scope.companyId),
      uuid("account", tx.accountId),
      uuid("event_id", eventId),
      parameter("initiator", input.initiator ?? "person"),
      parameter("draft", input.draftedActionId ?? null, "UUID"),
      parameter(
        "model_calls",
        JSON.stringify(input.modelCallIds ?? []),
        "JSON",
      ),
      parameter(
        "provenance",
        input.provenance ? JSON.stringify(input.provenance) : null,
        "JSON",
      ),
      parameter("registry", input.registryEntry ?? null),
      parameter("prompt", input.promptVersion ?? null),
      parameter("event", input.event),
      parameter("channel", tx.scope.channel),
      parameter("type", input.subjectType),
      uuid("id", input.subjectId),
      parameter("before", input.versionBefore ?? null),
      parameter("after", input.versionAfter ?? null),
      parameter("key", input.key ?? null),
      parameter("reason", input.reason ?? null),
      parameter(
        "policy",
        input.denied
          ? JSON.stringify({
              policy_version: "maintenance-access-1",
              result: "deny",
              reasons: [input.reason],
            })
          : null,
        "JSON",
      ),
    ],
  );
  for (const subject of input.covers ?? []) {
    await tx.execute(
      "insert into audit.event_subject(company_id, event_id, subject_type, subject_id, subject_version) values (:company, :event, :type, :id, :version)",
      [
        uuid("company", tx.scope.companyId),
        uuid("event", eventId),
        parameter("type", subject.type),
        uuid("id", subject.id),
        parameter("version", subject.version),
      ],
    );
  }
}
export async function recordDenial(
  db: DataApiExecutor,
  scope: RequestScope,
  error: Denied,
): Promise<void> {
  await transaction(db, scope, async (tx) => {
    const company = await tx.execute(
      "select id from core.company where id = :company",
      [uuid("company", scope.companyId)],
    );
    if (company.rows.length)
      await audit(tx, {
        event: "policy.denied",
        subjectType: error.subjectType,
        subjectId: error.subjectId,
        reason: error.body.code,
        denied: true,
      });
  });
}
