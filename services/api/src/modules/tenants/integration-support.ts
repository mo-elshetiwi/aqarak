import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { RDSDataClient } from "@aws-sdk/client-rds-data";
import { S3Client } from "@aws-sdk/client-s3";
import {
  withCompanyTx,
  type CompanyTransaction,
  type Row,
} from "../documents/database";
import {
  createDataApiExecutor,
  type DataApiExecutor,
} from "@aqarak/db/data-api";
import { z } from "zod";
import { expect } from "vitest";
import {
  createModelGateway,
  loadModelRegistry,
  ZERO_USAGE,
} from "../../models";
import { createTenantsModule } from ".";
import { createDocumentsModule } from "../documents";
import type { J3Dependencies } from "../documents/context";
import { createS3Storage } from "../documents/s3-storage";
import { appendAuditEvent } from "../documents/audit";
import { one, rows, num } from "../documents/sql";
import { catalogue } from "../extraction/fields";
import { cover, createAccount, seedDemoManager } from "./fixture-seed";

export const syntheticValues: Readonly<Record<string, string | null>> = {
  id_number: "784-1978-4829163-5",
  name_en: "Synthetic Tenant",
  name_ar: "مستأجر تجريبي",
  nationality_en: "Synthetic",
  nationality_ar: "تجريبي",
  date_of_birth: "1978-01-02",
  sex: "M",
  issue_date: "2024-11-22",
  expiry_date: "2029-11-22",
  card_number: null,
};
export const syntheticOutput = {
  fields: Object.fromEntries(
    catalogue.map(({ name }) => {
      const value = syntheticValues[name] ?? null;
      return [
        name,
        {
          value,
          evidence: value,
          null_reason: value === null ? "absent" : null,
        },
      ];
    }),
  ),
};
const objectSchema = z.record(z.string(), z.unknown());
export interface Reply {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly headers: Headers;
}
export interface UploadFixture {
  readonly tenantId: string;
  readonly documentId: string;
  readonly versionId: string;
  readonly path: string;
  readonly upload: {
    readonly url: string;
    readonly headers: Record<string, string>;
  };
  readonly bytes: Uint8Array;
}
export interface IntegrationHarness {
  readonly companyA: string;
  readonly companyB: string;
  readonly managerA: string;
  readonly managerB: string;
  readonly accountantA: string;
  readonly tenantAccount: string;
  readonly deps: J3Dependencies;
  readonly failures: string[];
  scan: string | null;
  failProvider: boolean;
  calls: number;
  request(
    account: string,
    method: string,
    path: string,
    body?: unknown,
    key?: string,
  ): Promise<Reply>;
  tx<T>(
    account: string,
    company: string,
    fn: (tx: CompanyTransaction) => Promise<T>,
  ): Promise<T>;
}
function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Integration configuration missing: ${name}`);
  return value;
}
function traced(
  executor: DataApiExecutor,
  failures: string[],
): DataApiExecutor {
  return {
    ...executor,
    async execute(...args) {
      try {
        return await executor.execute(...args);
      } catch (error) {
        failures.push(
          error instanceof Error ? error.message : "Database operation failed",
        );
        throw error;
      }
    },
    async commit(id) {
      try {
        await executor.commit(id);
      } catch (error) {
        failures.push(error instanceof Error ? error.message : "Commit failed");
        throw error;
      }
    },
  };
}
export function createHarness(): IntegrationHarness {
  if (
    process.env.J3_DEV_DATABASE !== "1" ||
    !["aqarak_tenants", "aqarak_integration"].includes(
      process.env.DATABASE_NAME ?? "",
    )
  )
    throw new Error(
      "Integration tests require the isolated development database",
    );
  const region = env("AWS_REGION");
  const connection = {
    resourceArn: env("DATABASE_CLUSTER_ARN"),
    database: process.env.DATABASE_NAME ?? "aqarak_integration",
    client: new RDSDataClient({ region }),
  };
  const failures: string[] = [];
  const appExecutor = traced(
    createDataApiExecutor({ ...connection, secretArn: env("APP_SECRET_ARN") }),
    failures,
  );
  const pipelineExecutor = traced(
    createDataApiExecutor({
      ...connection,
      secretArn: env("PIPELINE_SECRET_ARN"),
    }),
    failures,
  );
  const storage = createS3Storage({
    client: new S3Client({ region }),
    bucket: env("DOCUMENTS_BUCKET_NAME"),
    keyPrefix: env("DOCUMENT_KEY_PREFIX"),
    now: () => new Date(),
  });
  if (!storage.keyPrefix.startsWith("test/tenants/"))
    throw new Error("Integration storage must use the tenant test prefix");
  const registry = loadModelRegistry();
  const gateway = createModelGateway({
    registry,
    now: () => new Date(),
    transcriptionAdapters: {},
    structuredAdapters: {
      [registry.classes.mc1_document_extraction.candidates[
        registry.classes.mc1_document_extraction.primary
      ]?.provider ?? "openai_responses"]: {
        generate: () => {
          harness.calls += 1;
          if (harness.failProvider)
            return Promise.reject(new Error("Synthetic provider failure"));
          return Promise.resolve({
            text: JSON.stringify(syntheticOutput),
            usage: ZERO_USAGE,
            modelEcho: null,
            finish: "completed" as const,
          });
        },
      },
    },
  });
  const deps: J3Dependencies = {
    authenticate: () => Promise.resolve(null),
    appExecutor,
    pipelineExecutor,
    storage: { ...storage, scanStatus: () => Promise.resolve(harness.scan) },
    extraction: { registry, gateway },
    now: () => new Date(),
    randomBytes,
  };
  const harness: IntegrationHarness = {
    companyA: randomUUID(),
    companyB: randomUUID(),
    managerA: randomUUID(),
    managerB: randomUUID(),
    accountantA: randomUUID(),
    tenantAccount: randomUUID(),
    deps,
    failures,
    scan: "NO_THREATS_FOUND",
    failProvider: false,
    calls: 0,
    async request(...args: Parameters<IntegrationHarness["request"]>) {
      const [account, method, path, body, key = randomUUID()] = args;
      const app = new Hono();
      const scoped = {
        ...deps,
        authenticate: () => Promise.resolve({ accountId: account }),
      };
      for (const module of [
        createTenantsModule(scoped),
        createDocumentsModule(scoped),
      ]) {
        const child = new Hono();
        module.register(child);
        app.route(module.basePath, child);
      }
      const response = await app.request(path, {
        method,
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        ...(method !== "GET" ? { body: JSON.stringify(body ?? {}) } : {}),
      });
      const parsed = objectSchema.parse(await response.json());
      if (response.status === 503 && failures.length)
        throw new Error(failures.at(-1));
      return {
        status: response.status,
        body: parsed,
        headers: response.headers,
      };
    },
    tx(account, company, fn) {
      return withCompanyTx(
        appExecutor,
        { companyId: company, accountId: account },
        fn,
      );
    },
  };
  return harness;
}
export async function seedHarness(h: IntegrationHarness): Promise<void> {
  for (const [company, account] of [
    [h.companyA, h.managerA],
    [h.companyB, h.managerB],
  ] as const) {
    await h.tx(account, company, async (tx) => {
      await seedDemoManager(tx, {
        company,
        account,
        companyName: "Synthetic J3 company",
        email: `j3-${account}@example.com`,
      });
    });
  }
  await h.tx(h.accountantA, h.companyA, async (tx) => {
    await createAccount(tx, h.companyA, h.accountantA);
    const membership = await one(
      tx,
      `insert into core.membership(company_id,account_id,is_accountant,status) values(cast(:company as uuid),cast(:account as uuid),true,'active') returning id,version`,
      { company: h.companyA, account: h.accountantA },
    );
    await cover(
      tx,
      { company: h.companyA, account: h.accountantA },
      "membership",
      membership,
    );
  });
  await h.tx(h.tenantAccount, h.companyA, (tx) =>
    createAccount(tx, h.companyA, h.tenantAccount),
  );
}
export function record(
  body: Record<string, unknown>,
  name: string,
): Record<string, unknown> {
  return objectSchema.parse(body[name]);
}
export async function newTenant(
  h: IntegrationHarness,
): Promise<Record<string, unknown>> {
  const result = await h.request(
    h.managerA,
    "POST",
    `/v1/companies/${h.companyA}/tenants`,
    {
      kind: "individual",
      fullNameEn: "Synthetic Initial",
      email: `j3-${randomUUID()}@example.com`,
      preferredLanguage: "en",
    },
  );
  expect(result.status).toBe(201);
  return record(result.body, "tenant");
}
export async function uploadFixture(
  h: IntegrationHarness,
  tenantId: string,
  complete = true,
  input?: {
    readonly bytes: Uint8Array<ArrayBuffer>;
    readonly contentType: string;
    readonly fileName: string;
  },
): Promise<UploadFixture> {
  const bytes =
    input?.bytes ??
    new Uint8Array(
      readFileSync(
        new URL("./fixtures/synthetic-emirates-id.jpg", import.meta.url),
      ),
    );
  const result = await h.request(
    h.managerA,
    "POST",
    `/v1/companies/${h.companyA}/documents`,
    {
      subjectType: "tenant",
      subjectId: tenantId,
      docType: "emirates_id",
      fileName: input?.fileName ?? "synthetic-emirates-id.jpg",
      contentType: input?.contentType ?? "image/jpeg",
      byteSize: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      uploadedVia: "web",
    },
  );
  expect(result.status).toBe(201);
  const documentId = z.string().parse(record(result.body, "document").id);
  const versionId = z.string().parse(record(result.body, "version").id);
  const upload = z
    .object({ url: z.string(), headers: z.record(z.string(), z.string()) })
    .parse(result.body.upload);
  const fixture = {
    tenantId,
    documentId,
    versionId,
    path: `/v1/companies/${h.companyA}/documents/${documentId}/versions/${versionId}`,
    upload,
    bytes,
  };
  if (complete) {
    const put = await fetch(upload.url, {
      method: "PUT",
      headers: upload.headers,
      body: bytes,
    });
    await put.body?.cancel();
    expect(put.status).toBe(200);
    expect(
      (await h.request(h.managerA, "POST", `${fixture.path}/upload-complete`))
        .status,
    ).toBe(200);
  }
  return fixture;
}
export async function extractFixture(
  h: IntegrationHarness,
  fixture: UploadFixture,
): Promise<Record<string, unknown>> {
  const response = await h.request(
    h.managerA,
    "POST",
    `${fixture.path}/extraction`,
  );
  expect(response.status).toBe(200);
  return record(response.body, "version");
}
export async function reviewAll(
  h: IntegrationHarness,
  fixture: UploadFixture,
  manual = false,
): Promise<void> {
  for (const { name } of catalogue) {
    const value =
      name === "name_en" ? "Synthetic Reviewed Name" : syntheticValues[name];
    const decision =
      value === null
        ? "not_on_document"
        : manual || name === "name_en"
          ? "edited"
          : "accepted";
    const response = await h.request(
      h.managerA,
      "PUT",
      `${fixture.path}/fields/${name}`,
      {
        decision,
        ...(typeof value === "string" ? { value } : {}),
        sourceViewed: true,
        expectedVersion: null,
      },
    );
    expect(response.status).toBe(200);
    if (manual)
      expect(record(response.body, "decision").provenance).toBe(
        "human_entered",
      );
  }
}
export async function eventCount(
  h: IntegrationHarness,
  type: string,
  account?: string,
): Promise<number> {
  return h.tx(h.managerA, h.companyA, async (tx) => {
    const row = await one(
      tx,
      `select count(*) as count from audit.audit_event where company_id=cast(:company as uuid) and event_type=:type${account ? " and actor_account_id=cast(:account as uuid)" : ""}`,
      { company: h.companyA, type, ...(account ? { account } : {}) },
    );
    return num(row, "count");
  });
}
export async function linkTenant(
  h: IntegrationHarness,
  tenantId: string,
): Promise<void> {
  await h.tx(h.managerA, h.companyA, async (tx) => {
    const link = await one(
      tx,
      `insert into core.account_company_link(company_id,account_id,kind,status) values(cast(:company as uuid),cast(:account as uuid),'tenant','active') returning id,version`,
      { company: h.companyA, account: h.tenantAccount },
    );
    await cover(
      tx,
      { company: h.companyA, account: h.managerA },
      "account_company_link",
      link,
    );
    const tenant = await one(
      tx,
      `update party.tenant set linked_account_id=cast(:account as uuid) where company_id=cast(:company as uuid) and id=cast(:tenant as uuid) returning version`,
      { company: h.companyA, account: h.tenantAccount, tenant: tenantId },
    );
    await appendAuditEvent(tx, {
      companyId: h.companyA,
      accountId: h.managerA,
      type: "tenant.updated",
      subjectType: "tenant",
      subjectId: tenantId,
      versionAfter: num(tenant, "version"),
    });
  });
}
export async function query(
  h: IntegrationHarness,
  sql: string,
  values: Readonly<Record<string, string | number | null>> = {},
): Promise<Row[]> {
  return h.tx(h.managerA, h.companyA, (tx) =>
    rows(tx, sql, { company: h.companyA, ...values }),
  );
}
