import type { ModelGateway } from "../../../models/contracts";
import { expect } from "vitest";
import { randomUUID } from "node:crypto";
import { RDSDataClient } from "@aws-sdk/client-rds-data";
import {
  createDataApiExecutor,
  type DataApiExecutor,
} from "@aqarak/db/data-api";
import { Hono } from "hono";
import { z } from "zod";
import { withCompanyTx } from "../runtime/db";
import { parameters, rows } from "../runtime/sql";
import { insertAudit } from "../runtime/audit";
import { createWorkflowModules } from "../workflows";
import type { DraftInput } from "../schema";
export function integrationExecutor(
  role: "APP" | "SCHEDULER" | "MASTER" = "APP",
): DataApiExecutor {
  const resourceArn =
    process.env.AQARAK_IT_CLUSTER_ARN ?? process.env.DATABASE_CLUSTER_ARN;
  const secretArn =
    process.env[`AQARAK_IT_${role}_SECRET_ARN`] ??
    process.env[`${role}_SECRET_ARN`];
  const database =
    process.env.AQARAK_IT_DATABASE_NAME ?? process.env.DATABASE_NAME;
  if (!resourceArn || !secretArn || !database)
    throw new Error("Integration database variables are required");
  return createDataApiExecutor({
    resourceArn,
    secretArn,
    database,
    client: new RDSDataClient({
      region: process.env.AWS_REGION ?? "us-east-1",
      maxAttempts: 1,
    }),
  });
}
export interface Fixture {
  companyId: string;
  manager: string;
  owner: string;
  tenant: string;
  accountant: string;
  technician: string;
  otherTenant: string;
  tenantId: string;
  ownerId: string;
  unitId: string;
  propertyId: string;
  executor: DataApiExecutor;
  app: Hono;
}
export async function seed(
  options: {
    gate?: boolean;
    selfManaged?: boolean;
    sharedOwner?: boolean;
    documents?: boolean;
    modelGateway?: ModelGateway;
    secondManager?: boolean;
  } = {},
): Promise<Fixture> {
  const executor = integrationExecutor();
  const ids = {
    companyId: randomUUID(),
    manager: randomUUID(),
    owner: randomUUID(),
    tenant: randomUUID(),
    accountant: randomUUID(),
    technician: randomUUID(),
    otherTenant: randomUUID(),
    tenantId: randomUUID(),
    ownerId: randomUUID(),
    unitId: randomUUID(),
    propertyId: randomUUID(),
  };
  if (options.sharedOwner) ids.owner = ids.manager;
  const managerRoles = new Set(
    options.secondManager ? ["manager", "accountant"] : ["manager"],
  );
  await withCompanyTx(
    executor,
    { companyId: ids.companyId, accountId: ids.manager },
    async (tx) => {
      await tx.execute(
        "insert into core.company(id,kind,legal_name_en,legal_name_ar,is_demo) values (:id::uuid,:kind,'Synthetic test company','شركة اختبار اصطناعية',true)",
        parameters({
          id: ids.companyId,
          kind: options.selfManaged
            ? "self_managed_owner"
            : "management_company",
        }),
      );
      for (const [role, id] of Object.entries({
        manager: ids.manager,
        owner: ids.owner,
        tenant: ids.tenant,
        accountant: ids.accountant,
        technician: ids.technician,
        otherTenant: ids.otherTenant,
      })) {
        if (role === "owner" && options.sharedOwner) continue;
        await tx.execute(
          "select set_config('app.account_id',:id,true)",
          parameters({ id }),
        );
        await tx.execute(
          "insert into core.person_account(id,auth_subject,email,display_name,preferred_language) values (:id::uuid,:id,:email,:name,:language)",
          parameters({
            id,
            email: `synthetic-${id}@example.invalid`,
            name: `Synthetic ${role}`,
            language: role === "owner" ? "ar" : "en",
          }),
        );
        await tx.execute(
          "insert into core.account_company_link(company_id,account_id,kind,status) values (:company::uuid,:id::uuid,:kind,'active')",
          parameters({
            company: ids.companyId,
            id,
            kind:
              role === "owner"
                ? "owner"
                : role === "tenant" || role === "otherTenant"
                  ? "tenant"
                  : "staff",
          }),
        );
      }
      await tx.execute(
        "select set_config('app.account_id',:id,true)",
        parameters({ id: ids.manager }),
      );
      for (const [role, id] of Object.entries({
        manager: ids.manager,
        accountant: ids.accountant,
        technician: ids.technician,
      }))
        await tx.execute(
          "insert into core.membership(company_id,account_id,status,is_manager,is_accountant,is_technician) values (:company::uuid,:id::uuid,'active',:manager,:accountant,:technician)",
          parameters({
            company: ids.companyId,
            id,
            manager: managerRoles.has(role),
            accountant: role === "accountant",
            technician: role === "technician",
          }),
        );
      await tx.execute(
        "insert into party.owner(id,company_id,full_name_en,full_name_ar,linked_account_id) values (:id::uuid,:company::uuid,'Synthetic Owner','مالك اصطناعي',:account::uuid)",
        parameters({
          id: ids.ownerId,
          company: ids.companyId,
          account: ids.owner,
        }),
      );
      for (const [id, account] of [
        [ids.tenantId, ids.tenant],
        [randomUUID(), ids.otherTenant],
      ])
        await tx.execute(
          "insert into party.tenant(id,company_id,kind,full_name_en,full_name_ar,linked_account_id) values (:id::uuid,:company::uuid,'individual','Synthetic Tenant','مستأجر اصطناعي',:account::uuid)",
          parameters({
            id: id ?? "",
            company: ids.companyId,
            account: account ?? "",
          }),
        );
      await tx.execute(
        "insert into estate.property(id,company_id,name_en,name_ar,kind,owner_gate_override) values (:id::uuid,:company::uuid,'Synthetic Residence','سكن اصطناعي','building',:gate)",
        parameters({
          id: ids.propertyId,
          company: ids.companyId,
          gate: options.gate ?? null,
        }),
      );
      await tx.execute(
        "insert into estate.unit(id,company_id,property_id,unit_no,use,kind,status) values (:id::uuid,:company::uuid,:property::uuid,'Synthetic 101','residential','apartment','vacant')",
        parameters({
          id: ids.unitId,
          company: ids.companyId,
          property: ids.propertyId,
        }),
      );
      await tx.execute(
        "insert into estate.ownership(company_id,owner_id,property_id,share_bp,is_representative) values (:company::uuid,:owner::uuid,:property::uuid,10000,true)",
        parameters({
          company: ids.companyId,
          owner: ids.ownerId,
          property: ids.propertyId,
        }),
      );
      if (options.documents !== false) {
        const document = randomUUID();
        const version = randomUUID();
        await tx.execute(
          "insert into doc.document(id,company_id,subject_type,subject_id,doc_type,sensitivity) values (:id::uuid,:company::uuid,'tenant',:tenant::uuid,'emirates_id','identity')",
          parameters({
            id: document,
            company: ids.companyId,
            tenant: ids.tenantId,
          }),
        );
        await tx.execute(
          "insert into doc.document_version(id,company_id,document_id,version_no,bucket,s3_key,sha256,byte_size,content_type,processing_status,review_status) values (:id::uuid,:company::uuid,:document::uuid,1,'synthetic-test-bucket',:id,repeat('a',64),100,'application/pdf','scan_clean','accepted')",
          parameters({ id: version, company: ids.companyId, document }),
        );
        await tx.execute(
          "update doc.document set current_version_id=:version::uuid where id=:id::uuid",
          parameters({ version, id: document }),
        );
      }
      const event = await insertAudit(
        tx,
        {
          companyId: ids.companyId,
          accountId: ids.manager,
          role: "manager",
          channel: "web_form",
          key: null,
          traceId: null,
        },
        {
          eventType: "company.created",
          subjectType: "company",
          subjectId: ids.companyId,
          after: 1,
          fields: ["kind", "legal_name_en"],
        },
      );
      await tx.execute(
        `insert into audit.event_subject(company_id,event_id,subject_type,subject_id,subject_version)
      select v.company_id,:event::uuid,v.subject_type,v.subject_id,v.subject_version from audit.entity_version v
      where v.tx_id=pg_current_xact_id()::text::bigint and not exists(select 1 from audit.event_subject s where s.company_id=v.company_id and s.subject_type=v.subject_type and s.subject_id=v.subject_id and s.subject_version=v.subject_version)`,
        parameters({ event }),
      );
    },
  );
  const modules = createWorkflowModules({
    authenticate: (request) =>
      Promise.resolve(
        request.headers.get("X-Synthetic-Account")
          ? { accountId: request.headers.get("X-Synthetic-Account") ?? "" }
          : null,
      ),
    dependencies: {
      executor,
      clock: () => new Date("2026-09-28T06:00:00Z"),
      modelGateway: options.modelGateway ?? null,
    },
  });
  const app = new Hono();
  for (const module of modules) {
    const routes = new Hono();
    module.register(routes);
    app.route(module.basePath, routes);
  }
  return { ...ids, executor, app };
}
export function draft(f: Fixture): DraftInput {
  return {
    tenantId: f.tenantId,
    unitId: f.unitId,
    termStart: "2026-10-01",
    termEnd: "2027-09-30",
    graceDays: 0,
    annualRentFils: 8_500_000,
    totalFils: 8_500_000,
    depositFils: 500_000,
    vatBp: 0,
    instalments: [
      {
        seqNo: 1,
        dueOn: "2026-10-01",
        amountFils: 8_500_000,
        vatFils: 0,
        cheque: { chequeNo: "12345", bankName: "Synthetic Bank" },
      },
    ],
    specialClauses: [
      {
        textEn: "Synthetic special clause.",
        textAr: "شرط خاص اصطناعي.",
        modelTranslated: false,
      },
    ],
  };
}
export interface Reply {
  status: number;
  body: Record<string, unknown>;
}
export async function request(
  f: Fixture,
  actor: string,
  path: string,
  input: { body?: unknown; key?: string; method?: string } = {},
): Promise<Reply> {
  const response = await f.app.request(`/v1/companies/${f.companyId}${path}`, {
    method: input.method ?? (input.body === undefined ? "GET" : "POST"),
    headers: {
      "X-Synthetic-Account": actor,
      "Idempotency-Key": input.key ?? randomUUID(),
      "Content-Type": "application/json",
      "User-Agent": "Synthetic Chrome/150.0 (Macintosh)",
    },
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
  });
  return {
    status: response.status,
    body: z.record(z.string(), z.unknown()).parse(await response.json()),
  };
}
export function object(value: unknown): Record<string, unknown> {
  return z.record(z.string(), z.unknown()).parse(value);
}
export async function companyRows(
  f: Fixture,
  sql: string,
): Promise<Record<string, unknown>[]> {
  return withCompanyTx(
    f.executor,
    { companyId: f.companyId, accountId: f.manager },
    (tx) => rows(tx, sql),
  );
}

export async function createDraftFixture(
  options: Parameters<typeof seed>[0] = {},
): Promise<{ f: Fixture; id: string; created: Reply }> {
  const f = await seed(options);
  const created = await request(f, f.manager, "/contracts", { body: draft(f) });
  if (created.status !== 201) throw new Error(JSON.stringify(created));
  return { f, id: z.string().parse(object(created.body.contract).id), created };
}
export async function eventCount(f: Fixture): Promise<number> {
  return Number(
    (await companyRows(f, "select count(*) as count from audit.audit_event"))[0]
      ?.count,
  );
}
export async function expectRefusal(
  f: Fixture,
  operation: () => Promise<Reply>,
  code: string,
): Promise<void> {
  const before = await eventCount(f);
  const business = await companyRows(
    f,
    "select id,status,current_version_id,version from lease.contract order by id",
  );
  const result = await operation();
  expect(result.body.code, JSON.stringify(result)).toBe(code);
  expect(
    await companyRows(
      f,
      "select id,status,current_version_id,version from lease.contract order by id",
    ),
  ).toEqual(business);
  expect(await eventCount(f)).toBe(before + 1);
  expect(
    (
      await companyRows(
        f,
        "select event_type from audit.audit_event order by seq desc limit 1",
      )
    )[0]?.event_type,
  ).toBe("policy.denied");
}
