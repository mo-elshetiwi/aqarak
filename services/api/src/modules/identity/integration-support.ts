import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { RDSDataClient } from "@aws-sdk/client-rds-data";
import {
  createDataApiExecutor,
  type DataApiExecutor,
} from "@aqarak/db/data-api";
import { withCompanyTx, type CompanyTransaction } from "@aqarak/db";
import { z } from "zod";
import { expect } from "vitest";
import { createIdentityModule } from "./index";
import { createCompaniesModule } from "../companies";
import { createLocalIdentityProvider } from "./local-identity-provider";
import { rows, accountTx, auditEvent } from "./database";
import type { Dependencies, EmailMessage, IdentityProvider } from "./ports";
import type { Principal } from "./guard";
export const testPassword = "Synthetic-Only-123!";
export const responseObject = z.record(z.string(), z.unknown());
export interface TestAccount {
  id: string;
  email: string;
  session: string;
  principal: Principal;
}
export interface Harness {
  app: Hono;
  deps: Dependencies;
  emails: EmailMessage[];
  errors: string[];
  setTime: (time: Date) => void;
  request: (
    method: string,
    path: string,
    options?: {
      body?: unknown;
      account?: TestAccount;
      authorization?: string;
      key?: string;
    },
  ) => Promise<Response>;
  account: () => Promise<TestAccount>;
  company: (
    account: TestAccount,
    kind?: "management_company" | "self_managed_owner",
  ) => Promise<string>;
  inCompany: <T>(
    companyId: string,
    account: TestAccount,
    fn: (tx: CompanyTransaction) => Promise<T>,
  ) => Promise<T>;
}
export function harness(
  options: { identityProvider?: IdentityProvider; failEmail?: boolean } = {},
): Harness {
  if (
    !["aqarak_identity", "aqarak_integration", "aqarak_integration2"].includes(
      process.env.DATABASE_NAME ?? "",
    )
  )
    throw new Error("Integration tests require DATABASE_NAME=aqarak_identity");
  const resourceArn = process.env.DATABASE_CLUSTER_ARN;
  const secretArn = process.env.APP_SECRET_ARN;
  if (!resourceArn || !secretArn)
    throw new Error("Integration tests require runtime database ARNs");
  const raw = createDataApiExecutor({
    client: new RDSDataClient({}),
    resourceArn,
    secretArn,
    database: process.env.DATABASE_NAME ?? "aqarak_integration",
  });
  const errors: string[] = [];
  const executor: DataApiExecutor = {
    ...raw,
    async execute(...args) {
      try {
        return await raw.execute(...args);
      } catch (error) {
        errors.push(
          error instanceof Error ? error.message : "Unknown database error",
        );
        throw error;
      }
    },
  };
  let now = new Date();
  const clock = (): Date => new Date(now);
  const emails: EmailMessage[] = [];
  const deps: Dependencies = {
    executor,
    identityProvider:
      options.identityProvider ??
      createLocalIdentityProvider({ confirmationCode: "246810", clock }),
    emailSender: {
      send(message) {
        if (options.failEmail)
          return Promise.reject(new TypeError("Synthetic delivery failure"));
        emails.push(message);
        return Promise.resolve("sent");
      },
    },
    clock,
    appOrigin: "http://localhost:3000",
  };
  const app = new Hono();
  for (const module of [
    createIdentityModule(deps),
    createCompaniesModule(deps),
  ]) {
    const routes = new Hono();
    module.register(routes);
    app.route(module.basePath, routes);
  }
  const request: Harness["request"] = async (method, path, input = {}) =>
    app.request(path, {
      method,
      headers: {
        ...(input.body !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
        ...(input.account
          ? { Authorization: `Session ${input.account.session}` }
          : {}),
        ...(input.authorization ? { Authorization: input.authorization } : {}),
        ...(input.key ? { "Idempotency-Key": input.key } : {}),
      },
      ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
    });
  async function account(): Promise<TestAccount> {
    const email = `identity-${randomUUID()}@example.com`;
    const signed = await request("POST", "/v1/auth/sign-up", {
      body: {
        email,
        password: testPassword,
        fullName: "Synthetic Person",
        locale: "en",
      },
    });
    expect(signed.status, errors.at(-1)).toBe(201);
    const data = z.object({ accountId: z.uuid() }).parse(await signed.json());
    const confirmed = await request("POST", "/v1/auth/confirm-sign-up", {
      body: { email, code: "246810" },
    });
    expect(confirmed.status, errors.at(-1)).toBe(204);
    const login = await request("POST", "/v1/auth/sign-in", {
      body: { email, password: testPassword, client: "web" },
    });
    expect(login.status, errors.at(-1)).toBe(200);
    const grant = z
      .object({
        session: z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }),
      })
      .parse(await login.json());
    return {
      id: data.accountId,
      email,
      session: grant.session.id,
      principal: {
        accountId: data.accountId,
        client: "web",
        sessionId: null,
        claims: {
          subject: data.accountId,
          email,
          displayName: "Synthetic Person",
          locale: "en",
          emailVerified: true,
        },
      },
    };
  }
  async function company(
    account: TestAccount,
    kind: "management_company" | "self_managed_owner" = "management_company",
  ): Promise<string> {
    const result = await request("POST", "/v1/companies", {
      account,
      body: {
        kind,
        name: { en: "Synthetic Company", ar: "شركة تجريبية" },
        tradeLicenceNumber: `TEST-${randomUUID().slice(0, 8)}`,
      },
    });
    expect(result.status, errors.at(-1)).toBe(201);
    return z
      .object({ company: z.object({ id: z.uuid() }) })
      .parse(await result.json()).company.id;
  }
  return {
    app,
    deps,
    emails,
    errors,
    request,
    account,
    company,
    setTime: (time) => {
      now = time;
    },
    inCompany: (companyId, account, fn) =>
      withCompanyTx(executor, { companyId, accountId: account.id }, fn),
  };
}
export async function events(
  h: Harness,
  companyId: string,
  account: TestAccount,
): Promise<Record<string, unknown>[]> {
  return h.inCompany(companyId, account, (tx) =>
    rows(tx, "select * from audit.audit_event order by seq"),
  );
}
export async function assertChain(
  h: Harness,
  companyId: string,
  account: TestAccount,
): Promise<void> {
  const result = await h.inCompany(companyId, account, (tx) =>
    rows(tx, "select * from audit.verify_chain(cast(:company as uuid))", {
      company: companyId,
    }),
  );
  expect(result[0]).toMatchObject({ ok: true });
}
export async function securityTypes(
  h: Harness,
  account: TestAccount,
): Promise<unknown[]> {
  return accountTx(h.deps, account.id, async (tx) =>
    (
      await rows(
        tx,
        "select event_type from ops.security_event where account_id=cast(:account as uuid) order by occurred_at",
        { account: account.id },
      )
    ).map((row) => row.event_type),
  );
}
export async function ownerFixture(
  h: Harness,
  companyId: string,
  account: TestAccount,
  kind: "owner" | "tenant" = "owner",
): Promise<string> {
  return h.inCompany(companyId, account, async (tx) => {
    const id = randomUUID();
    await rows(
      tx,
      `insert into party.${kind}(id,company_id,full_name_en,full_name_ar${kind === "tenant" ? ",kind" : ""}) values(cast(:id as uuid),cast(:company as uuid),'Synthetic Party','طرف تجريبي'${kind === "tenant" ? ",'individual'" : ""})`,
      { id, company: companyId },
    );
    await auditEvent(tx, {
      companyId,
      principal: account.principal,
      eventType: `${kind}.created`,
      primary: { type: kind, id, after: 1 },
      role: "company_administrator",
      changedFields: ["full_name_en", "full_name_ar"],
    });
    return id;
  });
}
export const invitationResponse = z.object({
  invitation: z.object({
    id: z.uuid(),
    version: z.number(),
    deliveryStatus: z.enum(["pending", "sent", "not_configured", "failed"]),
  }),
  token: z.string(),
  acceptPath: z.string(),
});
export async function invite(
  h: Harness,
  companyId: string,
  administrator: TestAccount,
  options: {
    invitee: TestAccount;
    kind?: "staff" | "owner" | "tenant";
    targetId?: string;
    staffRoles?: string[];
    key?: string;
  },
): Promise<z.infer<typeof invitationResponse>> {
  const kind = options.kind ?? "staff";
  const body = {
    kind,
    email: options.invitee.email,
    locale: "en",
    ...(kind === "staff"
      ? { staffRoles: options.staffRoles ?? ["manager"] }
      : { targetId: options.targetId }),
  };
  const result = await h.request(
    "POST",
    `/v1/companies/${companyId}/invitations`,
    {
      account: administrator,
      body,
      ...(options.key ? { key: options.key } : {}),
    },
  );
  expect(result.status, h.errors.at(-1)).toBe(201);
  return invitationResponse.parse(await result.json());
}
export async function accept(
  h: Harness,
  invitee: TestAccount,
  token: string,
): Promise<void> {
  const result = await h.request("POST", "/v1/invitations/accept", {
    account: invitee,
    body: { token },
  });
  expect(result.status, h.errors.at(-1)).toBe(200);
}
export async function memberId(
  h: Harness,
  companyId: string,
  administrator: TestAccount,
  account: TestAccount,
): Promise<string> {
  const members = await h.inCompany(companyId, administrator, (tx) =>
    rows(
      tx,
      "select id from core.membership where account_id=cast(:account as uuid) and status='active'",
      { account: account.id },
    ),
  );
  return z.uuid().parse(members[0]?.id);
}
export async function invitationVersion(
  h: Harness,
  companyId: string,
  administrator: TestAccount,
  invitationId: string,
): Promise<number> {
  const result = await h.inCompany(companyId, administrator, (tx) =>
    rows(tx, "select version from core.invitation where id=cast(:id as uuid)", {
      id: invitationId,
    }),
  );
  return Number(result[0]?.version);
}
export async function expectDenial(
  h: Harness,
  companyId: string,
  administrator: TestAccount,
  options: { run: () => Promise<Response>; code: string; status: number },
): Promise<void> {
  const snapshot = (): Promise<Record<string, unknown>[]> =>
    h.inCompany(companyId, administrator, (tx) =>
      rows(
        tx,
        "select (select count(*) from audit.entity_version) as versions, (select coalesce(jsonb_agg(event_type order by seq),'[]'::jsonb) from audit.audit_event) as events, (select bool_and(ok) from audit.verify_chain(ops.ctx_company_id())) as chain_ok",
      ),
    );
  const before = (await snapshot())[0];
  const response = await options.run();
  expect(response.status, h.errors.at(-1)).toBe(options.status);
  expect(await response.json()).toMatchObject({ code: options.code });
  const after = (await snapshot())[0];
  const beforeEvents = z
    .array(z.string())
    .parse(
      typeof before?.events === "string"
        ? JSON.parse(before.events)
        : before?.events,
    );
  const afterEvents = z
    .array(z.string())
    .parse(
      typeof after?.events === "string"
        ? JSON.parse(after.events)
        : after?.events,
    );
  expect(afterEvents.slice(beforeEvents.length)).toEqual(["policy.denied"]);
  expect(after?.versions).toBe(before?.versions);
  expect(after?.chain_ok).toBe(true);
}
