import { createHash, randomUUID } from "node:crypto";
import { RDSDataClient } from "@aws-sdk/client-rds-data";
import { S3Client } from "@aws-sdk/client-s3";
import {
  createDataApiExecutor,
  type DataApiExecutor,
  type Parameter,
} from "@aqarak/db/data-api";
import { Hono } from "hono";
import { z } from "zod";
import { mediaViewSchema } from "./contract";
import type { MaintenanceDependencies } from "./runtime";
import { createMaintenanceModules } from ".";
import { createStorage } from "../media/storage";
import { parameter, transaction, uuid, type Transaction } from "./access";

export const integrationReady =
  process.env.INTEGRATION === "1" &&
  ["aqarak_mobile_intake_b", "aqarak_integration"].includes(
    process.env.DATABASE_NAME ?? "",
  ) &&
  [
    "AWS_REGION",
    "DATABASE_CLUSTER_ARN",
    "APP_SECRET_ARN",
    "DOCUMENTS_BUCKET_NAME",
  ].every((key) => Boolean(process.env[key]));
export const integrationReason =
  "needs INTEGRATION=1 and the development database variables";
function environment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
export interface Fixtures {
  app: Hono;
  db: DataApiExecutor;
  s3: S3Client;
  a: string;
  b: string;
  manager: string;
  tenant1: string;
  tenant2: string;
  accountant: string;
  tenantB: string;
  u1: string;
  u2: string;
  u3: string;
  query: (
    sql: string,
    parameters?: readonly Parameter[],
    company?: string,
  ) => ReturnType<Transaction["execute"]>;
}
async function seedTransaction(
  db: DataApiExecutor,
  company: string,
  account: string | null,
  work: (execute: Transaction["execute"]) => Promise<void>,
): Promise<void> {
  const id = await db.begin();
  const execute: Transaction["execute"] = (sql, parameters = []) =>
    db.execute(sql, parameters, id);
  try {
    await execute(
      "select set_config('app.company_id', :company, true) as company_context, set_config('app.account_id', :account, true)",
      [parameter("company", company), parameter("account", account ?? "")],
    );
    await work(execute);
    await db.commit(id);
  } catch (error) {
    await db.rollback(id).catch(() => undefined);
    throw error;
  }
}
async function cover(
  execute: Transaction["execute"],
  company: string,
  subject: { table: string; id: string; version?: number },
  account: string | null,
): Promise<void> {
  await execute(
    `insert into audit.audit_event(company_id, actor_account_id, event_type, initiator, channel, subject_type, subject_id, version_after)
    values (:company, :account, :event, 'person', 'mobile_form', :type, :id, :version)`,
    [
      uuid("company", company),
      parameter("account", account, "UUID"),
      parameter("event", `${subject.table}.created`),
      parameter("type", subject.table),
      uuid("id", subject.id),
      parameter("version", subject.version ?? 1),
    ],
  );
}
async function seedCompany(
  db: DataApiExecutor,
  company: string,
): Promise<void> {
  await seedTransaction(db, company, null, async (execute) => {
    await execute(
      "insert into core.company(id, kind, legal_name_en, legal_name_ar, is_demo) values (:id, 'management_company', 'Synthetic maintenance company', 'شركة صيانة تجريبية', true)",
      [uuid("id", company)],
    );
    await cover(execute, company, { table: "company", id: company }, null);
  });
}
async function seedAccount(
  db: DataApiExecutor,
  company: string,
  account: string,
): Promise<void> {
  await seedTransaction(db, company, account, async (execute) => {
    await execute(
      "insert into core.person_account(id, auth_subject, email, display_name, preferred_language) values (:id, :subject, :email, 'Synthetic maintenance person', 'en')",
      [
        uuid("id", account),
        parameter("subject", `synthetic-${account}`),
        parameter("email", `synthetic-${account}@example.invalid`),
      ],
    );
    await cover(
      execute,
      company,
      { table: "person_account", id: account },
      account,
    );
  });
}
async function seedEstate(
  db: DataApiExecutor,
  company: string,
  occupants: { account: string; unit: string }[],
  staff: { account: string; manager: boolean }[],
): Promise<void> {
  await seedTransaction(db, company, null, async (execute) => {
    const property = randomUUID();
    await execute(
      "insert into estate.property(id, company_id, kind, name_en, name_ar) values (:id, :company, 'building', 'Synthetic maintenance building', 'مبنى صيانة تجريبي')",
      [uuid("id", property), uuid("company", company)],
    );
    await cover(execute, company, { table: "property", id: property }, null);
    for (const person of staff) {
      const id = randomUUID();
      await execute(
        "insert into core.membership(id, company_id, account_id, is_manager, is_accountant, status) values (:id, :company, :account, :manager, :accountant, 'active')",
        [
          uuid("id", id),
          uuid("company", company),
          uuid("account", person.account),
          parameter("manager", person.manager),
          parameter("accountant", !person.manager),
        ],
      );
      await cover(execute, company, { table: "membership", id: id }, null);
    }
    for (const [index, person] of occupants.entries()) {
      const link = randomUUID();
      const tenant = randomUUID();
      const contract = randomUUID();
      const contractUnit = randomUUID();
      await execute(
        "insert into core.account_company_link(id, company_id, account_id, kind, status) values (:id, :company, :account, 'tenant', 'active')",
        [
          uuid("id", link),
          uuid("company", company),
          uuid("account", person.account),
        ],
      );
      await cover(
        execute,
        company,
        { table: "account_company_link", id: link },
        null,
      );
      await execute(
        "insert into party.tenant(id, company_id, kind, linked_account_id, full_name_en) values (:id, :company, 'individual', :account, 'Synthetic tenant')",
        [
          uuid("id", tenant),
          uuid("company", company),
          uuid("account", person.account),
        ],
      );
      await cover(execute, company, { table: "tenant", id: tenant }, null);
      await execute(
        "insert into estate.unit(id, company_id, property_id, unit_no, use, kind, status) values (:id, :company, :property, :number, 'residential', 'apartment', 'occupied')",
        [
          uuid("id", person.unit),
          uuid("company", company),
          uuid("property", property),
          parameter("number", `SYNTHETIC-${String(index + 1)}`),
        ],
      );
      await cover(execute, company, { table: "unit", id: person.unit }, null);
      await execute(
        "insert into lease.contract(id, company_id, contract_no, tenant_id, status, origin) values (:id, :company, :number, :tenant, 'concluded', 'app')",
        [
          uuid("id", contract),
          uuid("company", company),
          parameter("number", `SYNTHETIC-${randomUUID()}`),
          uuid("tenant", tenant),
        ],
      );
      await cover(execute, company, { table: "contract", id: contract }, null);
      const currentVersion = randomUUID();
      for (const [versionId, versionNo, termStart] of [
        [randomUUID(), 1, "2025-01-01"],
        [currentVersion, 2, "2026-01-01"],
      ] as const) {
        await execute(
          `insert into lease.contract_version(id, company_id, contract_id, version_no, kind, term_start, term_end, annual_rent_fils, total_fils, deposit_fils, vat_bp)
          values (:id, :company, :contract, :version, 'standard', :start, '2027-12-31', 0, 0, 0, 0)`,
          [
            uuid("id", versionId),
            uuid("company", company),
            uuid("contract", contract),
            parameter("version", versionNo),
            parameter("start", termStart, "DATE"),
          ],
        );
        await cover(
          execute,
          company,
          { table: "contract_version", id: versionId },
          null,
        );
      }
      await execute(
        "update lease.contract set current_version_id = :version where company_id = :company and id = :id",
        [
          uuid("version", currentVersion),
          uuid("company", company),
          uuid("id", contract),
        ],
      );
      await cover(
        execute,
        company,
        { table: "contract", id: contract, version: 2 },
        null,
      );
      await execute(
        "insert into lease.contract_unit(id, company_id, contract_id, unit_id, occupancy_start, occupancy_end) values (:id, :company, :contract, :unit, '2026-01-01', '2027-12-31')",
        [
          uuid("id", contractUnit),
          uuid("company", company),
          uuid("contract", contract),
          uuid("unit", person.unit),
        ],
      );
      await cover(
        execute,
        company,
        { table: "contract_unit", id: contractUnit },
        null,
      );
    }
  });
}
export async function createFixtures(
  dependencies: Pick<MaintenanceDependencies, "models" | "now"> = {},
): Promise<Fixtures> {
  if (!integrationReady) throw new Error(integrationReason);
  const db = createDataApiExecutor({
    resourceArn: environment("DATABASE_CLUSTER_ARN"),
    secretArn: environment("APP_SECRET_ARN"),
    database: process.env.DATABASE_NAME ?? "aqarak_integration",
    client: new RDSDataClient({
      region: environment("AWS_REGION"),
      maxAttempts: 1,
    }),
  });
  const database = (await db.execute("select current_database() as name"))
    .rows[0];
  if (
    !["aqarak_mobile_intake_b", "aqarak_integration"].includes(
      String(database?.name),
    )
  )
    throw new Error(
      "The live suite requires an explicitly named development database",
    );
  const s3 = new S3Client({
    region: environment("AWS_REGION"),
    maxAttempts: 1,
  });
  const a = randomUUID();
  const b = randomUUID();
  const manager = randomUUID();
  const tenant1 = randomUUID();
  const tenant2 = randomUUID();
  const accountant = randomUUID();
  const tenantB = randomUUID();
  const u1 = randomUUID();
  const u2 = randomUUID();
  const u3 = randomUUID();
  await seedCompany(db, a);
  await seedCompany(db, b);
  for (const account of [manager, tenant1, tenant2, accountant])
    await seedAccount(db, a, account);
  await seedAccount(db, b, tenantB);
  await seedEstate(
    db,
    a,
    [
      { account: tenant1, unit: u1 },
      { account: tenant2, unit: u2 },
    ],
    [
      { account: manager, manager: true },
      { account: accountant, manager: false },
    ],
  );
  await seedEstate(db, b, [{ account: tenantB, unit: u3 }], []);
  const app = new Hono();
  for (const module of createMaintenanceModules({
    ...dependencies,
    db,
    storage: createStorage(s3),
    bucket: environment("DOCUMENTS_BUCKET_NAME"),
    prefix: process.env.DOCUMENT_KEY_PREFIX ?? "",
    authenticate: (request) =>
      Promise.resolve(
        request.headers.has("authorization")
          ? {
              subject: (request.headers.get("authorization") ?? "").replace(
                /^synthetic-/,
                "",
              ),
            }
          : null,
      ),
  })) {
    const sub = new Hono();
    module.register(sub);
    app.route(module.basePath, sub);
  }
  return {
    app,
    db,
    s3,
    a,
    b,
    manager,
    tenant1,
    tenant2,
    accountant,
    tenantB,
    u1,
    u2,
    u3,
    query: (sql, parameters = [], company = a) =>
      transaction(
        db,
        {
          companyId: company,
          subject: company === a ? manager : tenantB,
          channel: "mobile_form",
        },
        (tx) => tx.execute(sql, parameters),
      ),
  };
}

export function fixtureRequest(
  f: Fixtures,
  account: string,
  method: string,
  ...[path, payload, key = randomUUID()]: [
    path: string,
    payload?: unknown,
    key?: string,
  ]
): Promise<Response> {
  return Promise.resolve(
    f.app.request(`/v1/companies/${f.a}${path}`, {
      method,
      headers: {
        authorization: `synthetic-${account}`,
        "content-type": "application/json",
        "Idempotency-Key": key,
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    }),
  );
}
export const uploadResponseSchema = z.object({
  media: mediaViewSchema,
  upload: z.object({
    method: z.literal("PUT"),
    url: z.string(),
    headers: z.record(z.string(), z.string()),
    expiresAt: z.string(),
  }),
});
export async function uploadFixtureMedia(
  f: Fixtures,
  input: {
    kind: "voice_note" | "photo";
    bytes: Buffer;
    account?: string;
    unit?: string;
  },
): Promise<string> {
  const account = input.account ?? f.tenant1;
  const response = await fixtureRequest(f, account, "POST", "/media/uploads", {
    unitId: input.unit ?? f.u1,
    kind: input.kind,
    contentType: input.kind === "photo" ? "image/jpeg" : "audio/mp4",
    byteSize: input.bytes.length,
    sha256: createHash("sha256").update(input.bytes).digest("hex"),
    ...(input.kind === "voice_note" ? { durationMs: 1000 } : {}),
  });
  if (response.status !== 201)
    throw new Error(`Upload slot failed: ${String(response.status)}`);
  const slot = uploadResponseSchema.parse(await response.json());
  const put = await fetch(slot.upload.url, {
    method: "PUT",
    headers: slot.upload.headers,
    body: new Uint8Array(input.bytes),
  });
  if (!put.ok)
    throw new Error(`Synthetic upload failed: ${String(put.status)}`);
  const completed = await fixtureRequest(
    f,
    account,
    "POST",
    `/media/${slot.media.id}/complete`,
    { expectedVersion: 1 },
  );
  if (completed.status !== 200)
    throw new Error(`Upload completion failed: ${String(completed.status)}`);
  return slot.media.id;
}
