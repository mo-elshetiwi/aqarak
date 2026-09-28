import { randomUUID } from "node:crypto";
import { RDSDataClient } from "@aws-sdk/client-rds-data";
import {
  createDataApiExecutor,
  type DataApiExecutor,
} from "@aqarak/db/data-api";
import { withCompanyTx, type CompanyTransaction } from "./db.mjs";
import { type Row } from "@aqarak/db/data-api";
import {
  companyId,
  ownerId,
  tenantId,
  type Capability,
  type CanonicalValue,
  type PermissionActor,
  type PermissionSubject,
  type Role,
} from "./domain";
import type { Context } from "hono";
import { estateConfig } from "./config";
import { resolveIdentity, type IdentityResolver } from "./identity";
import { authorise, resolveCompanyActor } from "./actor";
import { event, type AuditContext } from "./audit";
import { idempotent, type CommandResponse } from "./idempotency";
import { EstateProblem, fail, problemResponse } from "./problem";
import { one, rows, text, uuid } from "./sql";
export interface RequestScope {
  tx: CompanyTransaction;
  audit: AuditContext;
  actor: PermissionActor;
  company: Row;
  root: Row | null;
  params: Record<string, string>;
}
export interface RouteOperation {
  command: string;
  root: "owner" | "property";
  capability: Capability;
  write: boolean;
  roles?: readonly Role[];
  execute: (
    scope: RequestScope,
    body: unknown,
    query: unknown,
  ) => Promise<CommandResponse>;
}
export interface FailureReport {
  level: "error";
  traceId: string;
  command: string;
  errorClass: string;
}
export function logFailure(failure: FailureReport): void {
  process.stderr.write(`${JSON.stringify(failure)}\n`);
}
export interface RuntimePorts {
  identity: IdentityResolver;
  database: () => DataApiExecutor;
  onFailure?: (failure: FailureReport) => void;
}
let executor: DataApiExecutor | undefined;
export function estateDatabase(): DataApiExecutor {
  const config = estateConfig();
  if (
    !config.clusterArn ||
    !config.secretArn ||
    !config.database ||
    !config.bucket
  )
    fail(503, "UNAVAILABLE");
  executor ??= createDataApiExecutor({
    resourceArn: config.clusterArn,
    secretArn: config.secretArn,
    database: config.database,
    client: new RDSDataClient(config.region ? { region: config.region } : {}),
  });
  return executor;
}
const defaultPorts: RuntimePorts = {
  identity: resolveIdentity,
  database: estateDatabase,
};
async function rootSubject(
  tx: CompanyTransaction,
  op: RouteOperation,
  params: Record<string, string>,
  actor: PermissionActor,
): Promise<{ root: Row | null; subject: PermissionSubject }> {
  const c = actor.company_id;
  const id = params[op.root === "owner" ? "ownerId" : "propertyId"];
  if (!id)
    return {
      root: null,
      subject: {
        company_id: c,
        owner_ids: actor.owner_ids,
        tenant_ids: actor.tenant_ids,
      },
    };
  const root = one(
    await rows(
      tx,
      `select * from ${op.root === "owner" ? "party.owner" : "estate.property"} where company_id=:c and id=:id${op.write ? " for update" : ""}`,
      [uuid("c", c), uuid("id", id)],
    ),
  );
  if (op.root === "owner")
    return { root, subject: { company_id: c, owner_ids: [ownerId.parse(id)] } };
  const owners = await rows(
    tx,
    "select owner_id from estate.ownership where company_id=:c and property_id=:id",
    [uuid("c", c), uuid("id", id)],
  );
  const tenants = await rows(
    tx,
    `select distinct ct.tenant_id from lease.contract ct join lease.contract_unit cu on cu.company_id=ct.company_id and cu.contract_id=ct.id join estate.unit u on u.company_id=cu.company_id and u.id=cu.unit_id where ct.company_id=:c and u.property_id=:id`,
    [uuid("c", c), uuid("id", id)],
  );
  return {
    root,
    subject: {
      company_id: c,
      owner_ids: owners.map((row) => ownerId.parse(text(row, "owner_id"))),
      tenant_ids: tenants.map((row) => tenantId.parse(text(row, "tenant_id"))),
    },
  };
}
function denialTarget(
  op: RouteOperation,
  params: Record<string, string>,
  c: string,
): { subjectType: string; subjectId: string } {
  for (const [key, type] of [
    ["versionId", "document_version"],
    ["unitId", "unit"],
    ["documentId", "document"],
    ["ownerId", "owner"],
    ["propertyId", "property"],
  ]) {
    if (key && type && params[key])
      return { subjectType: type, subjectId: params[key] };
  }
  return { subjectType: "company", subjectId: c };
}
function operationProblem(
  cause: unknown,
  reportFailure: (cause: unknown) => void,
): EstateProblem {
  if (cause instanceof EstateProblem) return cause;
  reportFailure(cause);
  return new EstateProblem(503, "UNAVAILABLE");
}
export async function runOperation(
  c: Context,
  op: RouteOperation,
  input: { body: unknown; query: unknown },
  ports: RuntimePorts = defaultPorts,
): Promise<Response> {
  const traceId = randomUUID();
  const reportFailure = (cause: unknown): void => {
    (ports.onFailure ?? logFailure)({
      level: "error",
      traceId,
      command: op.command,
      errorClass: cause instanceof Error ? cause.constructor.name : "Unknown",
    });
  };
  let identity: Awaited<ReturnType<IdentityResolver>>;
  try {
    identity = await ports.identity(c);
  } catch (cause) {
    return problemResponse(c, operationProblem(cause, reportFailure), traceId);
  }
  if (!identity)
    return problemResponse(
      c,
      new EstateProblem(401, "SESSION_INVALID"),
      traceId,
    );
  const params = c.req.param();
  const company = companyId.safeParse(params.companyId);
  if (!company.success)
    return problemResponse(
      c,
      new EstateProblem(400, "VALIDATION_FAILED", "companyId"),
      traceId,
    );
  const audit: AuditContext = {
    companyId: company.data,
    accountId: identity.accountId,
    role: null,
    channel:
      c.req.header("X-Aqarak-Channel") === "mobile_form"
        ? "mobile_form"
        : "web_form",
    key: c.req.header("Idempotency-Key") ?? null,
    traceId,
  };
  let db: DataApiExecutor | undefined;
  const state = { exists: false };
  try {
    db = ports.database();
    const result = await withCompanyTx(db, audit, async (tx) => {
      const companyRow = one(
        await rows(
          tx,
          `select * from core.company where id=:c${op.write ? " for update" : ""}`,
          [uuid("c", company.data)],
        ),
      );
      state.exists = true;
      const actor = await resolveCompanyActor(
        tx,
        identity.accountId,
        company.data,
      );
      if (!actor) fail(404, "NOT_FOUND");
      audit.role = actor.roles[0] ?? null;
      const subject = await rootSubject(tx, op, params, actor);
      audit.role = authorise(actor, op.capability, subject.subject, {
        write: op.write,
        ...(op.roles ? { roles: op.roles } : {}),
      });
      const execute = () =>
        op.execute(
          { tx, audit, actor, company: companyRow, root: subject.root, params },
          input.body,
          input.query,
        );
      return op.write
        ? idempotent(
            tx,
            audit,
            {
              command: op.command,
              pathParams: params,
              body: input.body as CanonicalValue,
            },
            execute,
          )
        : execute();
    });
    return c.newResponse(JSON.stringify(result.body), result.status, {
      "Content-Type": "application/json",
    });
  } catch (cause) {
    const error = operationProblem(cause, reportFailure);
    if (db && state.exists && [403, 404, 409, 422].includes(error.status)) {
      try {
        await withCompanyTx(db, audit, (tx) =>
          event(tx, audit, {
            type: "policy.denied",
            ...denialTarget(op, params, company.data),
            policy: {
              policy_version: "estate-1",
              result: "deny",
              reasons: [error.code, `command:${op.command}`],
            },
          }),
        );
      } catch (cause) {
        if (!(cause instanceof EstateProblem)) reportFailure(cause);
        return problemResponse(
          c,
          new EstateProblem(503, "UNAVAILABLE"),
          traceId,
        );
      }
    }
    return problemResponse(c, error, traceId);
  }
}
