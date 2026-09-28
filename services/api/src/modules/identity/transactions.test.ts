import { authRoutes } from "./auth-routes";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { CompanyTransaction } from "@aqarak/db";
import type { DataApiExecutor } from "@aqarak/db/data-api";
import {
  companyId,
  personAccountId,
  type PermissionActor,
} from "@aqarak/domain";
import {
  commandTx,
  authorize,
  type CompanyCommand,
  type Principal,
} from "./guard";
import { databaseInstant, parseKey, sha256, withIdempotency } from "./database";
import { createLocalIdentityProvider } from "./local-identity-provider";
import { createDisabledEmailSender } from "./email-sender";
import { invitationEmail, deliverInvitation } from "../companies/invitations";
const account = randomUUID();
const company = randomUUID();
const principal: Principal = {
  accountId: account,
  client: "web",
  sessionId: randomUUID(),
  claims: {
    subject: account,
    email: "synthetic@example.com",
    emailVerified: true,
    displayName: "Synthetic Person",
    locale: "en",
  },
};
describe("idempotency transaction protocol", () => {
  const input = {
    companyId: company,
    accountId: account,
    command: "test.command",
    key: "test-key-".padEnd(24, "x"),
    path: { companyId: company },
    body: { name: "Synthetic" },
  };
  it("reserves before executing and persists the exact response before returning", async () => {
    const execute = vi
      .fn<CompanyTransaction["execute"]>()
      .mockResolvedValueOnce({
        rows: [{ key: input.key }],
        numberOfRecordsUpdated: 1,
      })
      .mockResolvedValue({ rows: [], numberOfRecordsUpdated: 1 });
    const run = vi
      .fn()
      .mockResolvedValue({ status: 201, body: { id: "synthetic" } });
    expect(await withIdempotency({ execute }, input, run)).toEqual({
      status: 201,
      body: { id: "synthetic" },
    });
    expect(execute.mock.calls[0]?.[0]).toContain(
      "on conflict do nothing returning key",
    );
    expect(execute.mock.calls[1]?.[0]).toContain(
      "set response=cast(:response as jsonb)",
    );
    expect(execute.mock.calls[1]?.[1]).toContainEqual({
      name: "response",
      value: JSON.stringify({ status: 201, body: { id: "synthetic" } }),
    });
    expect(run).toHaveBeenCalledOnce();
  });
  it("parses Data API JSON text and replays without calling the command", async () => {
    let hash: string | number | boolean | null = null;
    const execute = vi
      .fn<CompanyTransaction["execute"]>()
      .mockImplementation((sql, values) => {
        if (sql.startsWith("insert")) {
          hash = values?.find((value) => value.name === "hash")?.value ?? null;
          return Promise.resolve({ rows: [], numberOfRecordsUpdated: 0 });
        }
        return Promise.resolve({
          rows: [
            {
              request_sha256: hash,
              response: JSON.stringify({
                status: 201,
                body: { id: "original" },
              }),
            },
          ],
          numberOfRecordsUpdated: 0,
        });
      });
    const run = vi.fn();
    expect(await withIdempotency({ execute }, input, run)).toEqual({
      status: 201,
      body: { id: "original" },
      replayed: true,
    });
    expect(run).not.toHaveBeenCalled();
  });
  it("refuses hash changes without running the command", async () => {
    const execute = vi
      .fn<CompanyTransaction["execute"]>()
      .mockResolvedValueOnce({ rows: [], numberOfRecordsUpdated: 0 })
      .mockResolvedValueOnce({
        rows: [{ request_sha256: "different", response: "{}" }],
        numberOfRecordsUpdated: 0,
      });
    const run = vi.fn();
    await expect(
      withIdempotency({ execute }, input, run),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
    expect(run).not.toHaveBeenCalled();
  });
  it("runs once without a header and rejects malformed keys", async () => {
    const execute = vi.fn();
    const run = vi.fn().mockResolvedValue({ status: 200, body: {} });
    await withIdempotency({ execute }, { ...input, key: undefined }, run);
    expect(run).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
    expect(() => parseKey("short")).toThrow("VALIDATION_FAILED");
    expect(() => parseKey("spaces are not valid")).toThrow("VALIDATION_FAILED");
  });
});
it("rolls back a company refusal before writing exactly one denial transaction", async () => {
  const order: string[] = [];
  let count = 0;
  const execute = vi
    .fn<DataApiExecutor["execute"]>()
    .mockImplementation((sql, _parameters, transaction) => {
      order.push(`${transaction ?? "none"}:${sql.split(" ")[0] ?? ""}`);
      if (sql.startsWith("select id from core.company"))
        return Promise.resolve({
          rows: [{ id: company }],
          numberOfRecordsUpdated: 0,
        });
      return Promise.resolve({ rows: [], numberOfRecordsUpdated: 0 });
    });
  const executor: DataApiExecutor = {
    execute,
    begin: () => {
      const tx = `tx-${String(++count)}`;
      order.push(`begin:${tx}`);
      return Promise.resolve(tx);
    },
    commit: (tx) => {
      order.push(`commit:${tx}`);
      return Promise.resolve();
    },
    rollback: (tx) => {
      order.push(`rollback:${tx}`);
      return Promise.resolve();
    },
  };
  const input: CompanyCommand = {
    deps: {
      executor,
      identityProvider: createLocalIdentityProvider({
        confirmationCode: "246810",
      }),
      emailSender: createDisabledEmailSender(),
      clock: () => new Date(),
      appOrigin: "http://localhost:3000",
    },
    principal,
    companyId: company,
    permission: {
      route: "/v1/companies/:companyId",
      method: "GET",
      capability: "company_settings",
      operation: "read",
    },
  };
  const run = vi.fn();
  await expect(commandTx(input, run)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect(run).not.toHaveBeenCalled();
  expect(order.indexOf("rollback:tx-1")).toBeLessThan(
    order.indexOf("begin:tx-2"),
  );
  expect(order.at(-1)).toBe("commit:tx-2");
  const writes = execute.mock.calls.filter(([sql]) => sql.startsWith("insert"));
  expect(writes).toHaveLength(1);
  expect(writes[0]?.[1]).toContainEqual({
    name: "type",
    value: "policy.denied",
  });
  expect(writes[0]?.[1]).toContainEqual({
    name: "decision",
    value: JSON.stringify({
      policy_version: "permissions-2026-09-28",
      result: "deny",
      reasons: [
        "NOT_FOUND",
        "route:GET /v1/companies/:companyId",
        "capability:company_settings",
        "operation:read",
      ],
    }),
  });
});
it("uses the domain matrix and identifies the role which grants the operation", () => {
  const actor: PermissionActor = {
    account_id: personAccountId.parse(account),
    company_id: companyId.parse(company),
    roles: ["manager", "company_administrator"],
    owner_ids: [],
    tenant_ids: [],
    technician_profile_id: null,
  };
  expect(
    authorize(
      actor,
      { capability: "staff_memberships", operation: "write" },
      { company_id: actor.company_id },
    ),
  ).toBe("company_administrator");
  expect(() =>
    authorize(
      { ...actor, roles: ["manager"] },
      { capability: "staff_memberships", operation: "write" },
      { company_id: actor.company_id },
    ),
  ).toThrow("FORBIDDEN");
  expect(() =>
    authorize(
      actor,
      { capability: "staff_memberships", operation: "write" },
      null,
    ),
  ).toThrow("NOT_FOUND");
});
it("escapes bilingual invitation HTML and confines the credential to the fragment", () => {
  const token = "synthetic-token";
  const link = `http://localhost:3000/ar/invitation#${token}`;
  const message = invitationEmail({
    to: "synthetic@example.com",
    companyName: { en: "<Company>", ar: "شركة تجريبية" },
    roles: ["manager"],
    expiry: "2026-10-05T00:00:00Z",
    link,
  });
  expect(message.text.indexOf("You are invited")).toBeLessThan(
    message.text.indexOf("أنت مدعو"),
  );
  expect(message.html).toContain("&lt;Company&gt;");
  expect(message.html).not.toContain("<Company>");
  expect(message.text).toContain("مدير");
  expect(new URL(link).search).toBe("");
  expect(new URL(link).hash).toBe(`#${token}`);
});
it("does not let a superseded delivery overwrite a rotated invitation", async () => {
  const invitation = randomUUID();
  const execute = vi
    .fn<DataApiExecutor["execute"]>()
    .mockImplementation((sql) =>
      Promise.resolve({
        rows: sql.startsWith("select id from core.company")
          ? [{ id: company }]
          : sql.startsWith("select i.*")
            ? [{ id: invitation, token_hash: "superseded", version: 3 }]
            : [],
        numberOfRecordsUpdated: 0,
      }),
    );
  const executor: DataApiExecutor = {
    execute,
    begin: () => Promise.resolve("delivery"),
    commit: () => Promise.resolve(),
    rollback: () => Promise.resolve(),
  };
  const send = vi.fn().mockResolvedValue("sent");
  await deliverInvitation({
    deps: {
      executor,
      identityProvider: createLocalIdentityProvider({
        confirmationCode: "246810",
      }),
      emailSender: { send },
      clock: () => new Date(),
      appOrigin: "http://localhost:3000",
    },
    principal,
    companyId: company,
    response: {
      status: 201,
      body: {
        invitation: { id: invitation },
        token: "synthetic-token",
        acceptPath: "/en/invitation#synthetic-token",
      },
    },
    role: "company_administrator",
    permission: {
      method: "POST",
      route: "/v1/companies/:companyId/invitations",
      capability: "staff_memberships",
      operation: "write",
    },
    key: undefined,
  });
  expect(send).not.toHaveBeenCalled();
  expect(
    execute.mock.calls.some(([sql]) =>
      sql.startsWith("update core.invitation"),
    ),
  ).toBe(false);
  const event = execute.mock.calls.find(([sql]) =>
    sql.startsWith("insert into audit.audit_event"),
  );
  expect(event?.[1]).toContainEqual({
    name: "reason",
    value: "delivery_superseded",
  });
  expect(event?.[1]).toContainEqual({
    name: "role",
    value: "company_administrator",
  });
  expect(event?.[1]).toContainEqual({ name: "after", value: null });
});

it.each([
  "2026-09-28 00:00:00",
  "2026-09-28T00:00:00Z",
  "2026-09-28 04:00:00+04",
  "2026-09-28T04:00:00+04:00",
])("interprets database timestamp %s as a UTC instant", (value) => {
  expect(databaseInstant(value).toISOString()).toBe("2026-09-28T00:00:00.000Z");
});
it("records an unverified-email sign-in refusal without creating a session", async () => {
  const execute = vi
    .fn<DataApiExecutor["execute"]>()
    .mockResolvedValue({ rows: [], numberOfRecordsUpdated: 0 });
  const executor: DataApiExecutor = {
    execute,
    begin: () => Promise.resolve("refusal"),
    commit: () => Promise.resolve(),
    rollback: () => Promise.resolve(),
  };
  const provider = createLocalIdentityProvider({ confirmationCode: "246810" });
  const routes = authRoutes({
    executor,
    identityProvider: {
      ...provider,
      signInWithPassword: () =>
        Promise.resolve({
          claims: { ...principal.claims, emailVerified: false },
          tokens: {
            accessToken: "unused",
            refreshToken: "unused",
            accessTokenExpiresAt: "2026-09-28T00:00:00.000Z",
          },
        }),
    },
    emailSender: createDisabledEmailSender(),
    clock: () => new Date(),
    appOrigin: "http://localhost:3000",
  });
  const response = await routes.request("/auth/sign-in", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: principal.claims.email,
      password: "synthetic",
      client: "web",
    }),
  });
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ code: "USER_NOT_CONFIRMED" });
  const writes = execute.mock.calls.filter(([sql]) => sql.startsWith("insert"));
  expect(writes).toHaveLength(1);
  expect(writes[0]?.[0]).toContain("ops.security_event");
  expect(writes[0]?.[1]).toContainEqual({
    name: "type",
    value: "sign_in_refused",
  });
  expect(writes[0]?.[1]).toContainEqual({
    name: "email",
    value: sha256(principal.claims.email),
  });
  expect(JSON.stringify(writes)).not.toContain(principal.claims.email);
});
