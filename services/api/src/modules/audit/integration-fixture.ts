import { randomBytes, randomUUID } from "node:crypto";
import {
  withCompanyTx,
  withSystemTx,
  type CompanyTransaction,
} from "@aqarak/db";
import { Hono } from "hono";
import { z } from "zod";
import { createAuditModule } from "./index";
import {
  kernelDependenciesFromEnvironment,
  writeAuditEvent,
  coverTransactionVersions,
  type KernelDependencies,
} from "./kernel";

export type FixtureRole =
  | "manager"
  | "administrator"
  | "accountant"
  | "owner"
  | "tenant"
  | "technician";
export interface Fixture {
  readonly companyId: string;
  readonly accounts: Record<FixtureRole, string>;
  readonly sessions: Record<FixtureRole, string>;
  readonly deps: KernelDependencies;
  readonly application: Hono;
  request(
    path: string,
    options?: {
      application?: Hono;
      role?: FixtureRole;
      method?: string;
      body?: unknown;
      key?: string;
      companyId?: string;
      authorization?: string;
      headers?: Record<string, string>;
    },
  ): Promise<Response>;
  tx<T>(run: (tx: CompanyTransaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Creates synthetic data through the application role and the real coverage triggers. */
export async function createFixture(): Promise<Fixture> {
  const companyId = randomUUID();
  const accounts: Record<FixtureRole, string> = {
    manager: randomUUID(),
    administrator: randomUUID(),
    accountant: randomUUID(),
    owner: randomUUID(),
    tenant: randomUUID(),
    technician: randomUUID(),
  };
  const sessions = Object.fromEntries(
    Object.keys(accounts).map((role) => [
      role,
      randomBytes(32).toString("base64url"),
    ]),
  ) as Record<FixtureRole, string>;
  const env = { ...process.env };
  const deps = {
    ...kernelDependenciesFromEnvironment(env),
    authenticator: {
      authenticate: (headers: Headers) => {
        const match = Object.entries(sessions).find(
          ([, session]) =>
            headers.get("Authorization") === `Session ${session}`,
        );
        return Promise.resolve(
          match ? { accountId: accounts[match[0] as FixtureRole] } : null,
        );
      },
    },
  };
  await withSystemTx(deps.database, { companyId }, async (tx) => {
    await tx.execute(
      "insert into core.company(id, kind, legal_name_en) values (:company::uuid, 'management_company', 'Synthetic audit company')",
      [{ name: "company", value: companyId }],
    );
    const event = await writeAuditEvent(tx, companyId, {
      eventType: "company.created",
      actorAccountId: null,
      actorRole: null,
      initiator: "scheduler",
      channel: "system",
      subjectType: "company",
      subjectId: companyId,
      versionBefore: null,
      versionAfter: 1,
    });
    await coverTransactionVersions(tx, companyId, event.eventId);
  });
  for (const [role, accountId] of Object.entries(accounts)) {
    await withCompanyTx(deps.database, { companyId, accountId }, async (tx) => {
      const params = [
        { name: "company", value: companyId },
        { name: "account", value: accountId },
        { name: "email", value: `synthetic-${accountId}@example.invalid` },
      ];
      await tx.execute(
        "insert into core.person_account(id, auth_subject, email, display_name, preferred_language) values (:account::uuid, :account, :email, 'Synthetic audit account', 'en')",
        params,
      );
      const kind = role === "owner" || role === "tenant" ? role : "staff";
      await tx.execute(
        "insert into core.account_company_link(company_id, account_id, kind, status) values (:company::uuid, :account::uuid, :kind, 'active')",
        [...params, { name: "kind", value: kind }],
      );
      if (role === "owner")
        await tx.execute(
          "insert into party.owner(company_id, linked_account_id, full_name_en) values (:company::uuid, :account::uuid, 'Synthetic owner')",
          params,
        );
      else if (role === "tenant")
        await tx.execute(
          "insert into party.tenant(company_id, linked_account_id, kind, full_name_en) values (:company::uuid, :account::uuid, 'individual', 'Synthetic tenant')",
          params,
        );
      else
        await tx.execute(
          "insert into core.membership(company_id, account_id, status, is_manager, is_company_admin, is_accountant, is_technician) values (:company::uuid, :account::uuid, 'active', :manager, :admin, :accountant, :technician)",
          [
            ...params,
            { name: "manager", value: role === "manager" },
            { name: "admin", value: role === "administrator" },
            { name: "accountant", value: role === "accountant" },
            { name: "technician", value: role === "technician" },
          ],
        );
      const event = await writeAuditEvent(tx, companyId, {
        eventType: "account.created",
        actorAccountId: accountId,
        actorRole: null,
        initiator: "person",
        channel: "web_form",
        subjectType: "company",
        subjectId: companyId,
        versionBefore: null,
        versionAfter: null,
      });
      await coverTransactionVersions(tx, companyId, event.eventId);
    });
  }
  const application = new Hono();
  const module = createAuditModule(deps);
  const routes = new Hono();
  module.register(routes);
  application.route(module.basePath, routes);
  return {
    companyId,
    accounts,
    sessions,
    deps,
    application,
    async request(path, options = {}) {
      const headers = new Headers({
        Authorization:
          options.authorization ??
          `Session ${sessions[options.role ?? "manager"]}`,
        ...options.headers,
      });
      if (options.key) headers.set("Idempotency-Key", options.key);
      if (options.body !== undefined)
        headers.set("Content-Type", "application/json");
      return await (options.application ?? application).request(
        `/v1/companies/${options.companyId ?? companyId}/audit${path}`,
        {
          method: options.method ?? "GET",
          headers,
          ...(options.body === undefined
            ? {}
            : { body: JSON.stringify(options.body) }),
        },
      );
    },
    tx(run) {
      return withCompanyTx(
        deps.database,
        { companyId, accountId: accounts.manager },
        run,
      );
    },
    close() {
      deps.s3.destroy();
      return Promise.resolve();
    },
  };
}

export async function chainLength(fixture: Fixture): Promise<number> {
  return fixture.tx(async (tx) => {
    const result = await tx.execute(
      "select count(*) as count from audit.audit_event where company_id = :company::uuid",
      [{ name: "company", value: fixture.companyId }],
    );
    return z.strictObject({ count: z.coerce.number() }).parse(result.rows[0])
      .count;
  });
}
