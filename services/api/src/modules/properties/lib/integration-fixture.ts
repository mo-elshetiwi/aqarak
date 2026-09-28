import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { withCompanyTx, type CompanyTransaction } from "./db.mjs";
import { type Row } from "@aqarak/db/data-api";
import type { DataApiExecutor } from "@aqarak/db/data-api";
import { z } from "zod";
import { createPropertiesApp } from "../routes";
import { createOwnersApp } from "../../owners";
import { apiModules } from "../../index";
import { estateDatabase, type FailureReport } from "./runtime";
import { auditEventContent } from "./domain";
import { event, type AuditContext } from "./audit";
import { rows, uuid, param } from "./sql";
export interface SyntheticCompany {
  id: string;
  manager: string;
  accounts: Record<string, string>;
  owner: string;
  tenant: string;
}
export function integrationApp(): Hono<{
  Variables: { identity: { accountId: string } };
}> {
  const app = new Hono<{ Variables: { identity: { accountId: string } } }>();
  app.use("*", async (c, next) => {
    const account = c.req.header("X-Synthetic-Account");
    if (account) c.set("identity", { accountId: account });
    await next();
  });
  for (const module of apiModules) {
    const sub = new Hono();
    if (module.name === "owners")
      sub.route(
        "/",
        createOwnersApp({
          identity: (c) =>
            Promise.resolve(
              (c.get("identity") as { accountId: string } | undefined) ?? null,
            ),
          database: estateDatabase,
          onFailure: recordFailure,
        }),
      );
    else if (module.name === "properties")
      sub.route(
        "/",
        createPropertiesApp({
          identity: (c) =>
            Promise.resolve(
              (c.get("identity") as { accountId: string } | undefined) ?? null,
            ),
          database: estateDatabase,
          onFailure: recordFailure,
        }),
      );
    else module.register(sub);
    app.route(module.basePath, sub);
  }
  return app;
}
function audit(companyId: string, accountId: string): AuditContext {
  return {
    companyId,
    accountId,
    role: "manager",
    channel: "web_form",
    key: null,
    traceId: randomUUID(),
  };
}
async function seedAccount(
  tx: CompanyTransaction,
  context: AuditContext,
): Promise<void> {
  await tx.execute(
    "insert into core.person_account(id,auth_subject,email,display_name,preferred_language) values (:a,:auth,:email,'Synthetic test person','en')",
    [
      uuid("a", context.accountId),
      param("auth", `synthetic:${context.accountId}`),
      param("email", `synthetic-${context.accountId}@example.com`),
    ],
  );
  await event(tx, context, {
    type: "person_account.created",
    subjectType: "person_account",
    subjectId: context.accountId,
    after: 1,
  });
}
async function seedCapacity(
  tx: CompanyTransaction,
  context: AuditContext,
  role: string,
): Promise<{ owner: string; tenant: string }> {
  const id = randomUUID();
  const kind = ["owner", "tenant"].includes(role) ? role : "staff";
  await tx.execute(
    "insert into core.account_company_link(id,company_id,account_id,kind,status) values (:id,:c,:a,:kind,'active')",
    [
      uuid("id", id),
      uuid("c", context.companyId),
      uuid("a", context.accountId),
      param("kind", kind),
    ],
  );
  await event(tx, context, {
    type: "account_company_link.created",
    subjectType: "account_company_link",
    subjectId: id,
    after: 1,
  });
  const target = randomUUID();
  if (kind === "staff") {
    const flags = {
      manager: "is_manager",
      admin: "is_company_admin",
      accountant: "is_accountant",
      technician: "is_technician",
    };
    const flag = flags[role as keyof typeof flags];
    if (!flag) throw new Error("Invalid synthetic role");
    await tx.execute(
      `insert into core.membership(id,company_id,account_id,${flag},status) values (:id,:c,:a,true,'active')`,
      [
        uuid("id", target),
        uuid("c", context.companyId),
        uuid("a", context.accountId),
      ],
    );
    await event(tx, context, {
      type: "membership.created",
      subjectType: "membership",
      subjectId: target,
      after: 1,
    });
  } else {
    await tx.execute(
      `insert into party.${kind}(id,company_id,full_name_en,full_name_ar,preferred_language,linked_account_id${kind === "tenant" ? ",kind" : ""}) values (:id,:c,'Synthetic linked party','طرف تجريبي','en',:a${kind === "tenant" ? ",'individual'" : ""})`,
      [
        uuid("id", target),
        uuid("c", context.companyId),
        uuid("a", context.accountId),
      ],
    );
    await event(tx, context, {
      type: `${kind}.created`,
      subjectType: kind,
      subjectId: target,
      after: 1,
    });
  }
  return {
    owner: kind === "owner" ? target : "",
    tenant: kind === "tenant" ? target : "",
  };
}
export async function seedCompany(
  kind: "management_company" | "self_managed_owner",
  extraRoles: readonly string[] = [],
): Promise<SyntheticCompany> {
  const db = integrationDatabase();
  const id = randomUUID();
  const manager = randomUUID();
  const context = audit(id, manager);
  await withCompanyTx(db, context, async (tx) => {
    await tx.execute(
      "insert into core.company(id,kind,legal_name_en,legal_name_ar,is_demo) values (:c,:kind,'Synthetic estate test company','شركة تجريبية',true)",
      [uuid("c", id), param("kind", kind)],
    );
    await event(tx, context, {
      type: "company.created",
      subjectType: "company",
      subjectId: id,
      after: 1,
    });
    await seedAccount(tx, context);
    await seedCapacity(tx, context, "manager");
  });
  const result: SyntheticCompany = {
    id,
    manager,
    accounts: { manager },
    owner: "",
    tenant: "",
  };
  for (const role of extraRoles) {
    const account = randomUUID();
    const ctx = audit(id, account);
    result.accounts[role] = account;
    const party = await withCompanyTx(db, ctx, async (tx) => {
      await seedAccount(tx, ctx);
      return seedCapacity(tx, ctx, role);
    });
    if (party.owner) result.owner = party.owner;
    if (party.tenant) result.tenant = party.tenant;
  }
  return result;
}
export async function query(
  company: SyntheticCompany,
  sql: string,
  params: Parameters<CompanyTransaction["execute"]>[1] = [],
  db: DataApiExecutor = integrationDatabase(),
): Promise<Row[]> {
  return withCompanyTx(
    db,
    { companyId: company.id, accountId: company.manager },
    (tx) => rows(tx, sql, [uuid("c", company.id), ...params]),
  );
}
export async function request(
  app: Pick<Hono, "request">,
  company: SyntheticCompany,
  input: {
    path?: string;
    method?: string;
    body?: unknown;
    account?: string | undefined;
    key?: string;
    root?: "owners" | "properties";
  } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await app.request(
    `/v1/companies/${company.id}/${input.root ?? "owners"}${input.path ?? ""}`,
    {
      method: input.method ?? "GET",
      headers: {
        "X-Synthetic-Account": input.account ?? company.manager,
        "Idempotency-Key": input.key ?? randomUUID(),
        "Content-Type": "application/json",
      },
      ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
    },
  );
  if (response.status === 503)
    throw new Error(`Estate request unavailable: ${failureCategory}`);
  return {
    status: response.status,
    body: z.record(z.string(), z.unknown()).parse(await response.json()),
  };
}
export async function countEvents(
  company: SyntheticCompany,
  type: string,
): Promise<number> {
  const records = await query(
    company,
    "select count(*) as n from audit.audit_event where company_id=:c and event_type=:type",
    [param("type", type)],
  );
  return Number(records[0]?.n);
}
export async function verifyChain(company: SyntheticCompany): Promise<boolean> {
  return (
    (await query(company, "select * from audit.verify_chain(:c)"))[0]?.ok ===
    true
  );
}

function integrationDatabase(): DataApiExecutor {
  const db = estateDatabase();
  async function safe<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch {
      throw new Error("Synthetic fixture database operation failed");
    }
  }
  return {
    begin: () => safe(() => db.begin()),
    commit: (id) => safe(() => db.commit(id)),
    rollback: (id) => safe(() => db.rollback(id)),
    execute: (sql, params, id) => safe(() => db.execute(sql, params, id)),
  };
}

let failureCategory = "unclassified";
function recordFailure(failure: FailureReport): void {
  failureCategory = failure.errorClass;
}

export async function validateDenials(
  company: SyntheticCompany,
): Promise<number> {
  const denials = await query(
    company,
    "select policy_decision from audit.audit_event where company_id=:c and event_type='policy.denied'",
  );
  const schema = auditEventContent
    .unwrap()
    .shape.policy_decision.unwrap()
    .unwrap();
  for (const denial of denials)
    schema.parse(JSON.parse(String(denial.policy_decision)));
  return denials.length;
}

export async function seedTenantContract(
  company: SyntheticCompany,
  unitId: string,
): Promise<void> {
  const context = audit(company.id, company.manager);
  await withCompanyTx(integrationDatabase(), context, async (tx) => {
    const contract = randomUUID();
    const link = randomUUID();
    await tx.execute(
      "insert into lease.contract(id,company_id,contract_no,tenant_id,status,origin) values (:id,:c,:number,:tenant,'draft','app')",
      [
        uuid("id", contract),
        uuid("c", company.id),
        param("number", `SYNTHETIC-${contract}`),
        uuid("tenant", company.tenant),
      ],
    );
    await event(tx, context, {
      type: "contract.created",
      subjectType: "contract",
      subjectId: contract,
      after: 1,
    });
    await tx.execute(
      "insert into lease.contract_unit(id,company_id,contract_id,unit_id,occupancy_start,occupancy_end) values (:id,:c,:contract,:unit,'2026-01-01','2026-12-31')",
      [
        uuid("id", link),
        uuid("c", company.id),
        uuid("contract", contract),
        uuid("unit", unitId),
      ],
    );
    await event(tx, context, {
      type: "contract_unit.created",
      subjectType: "contract_unit",
      subjectId: link,
      after: 1,
    });
  });
}
