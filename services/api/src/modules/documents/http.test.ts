import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { expect, it, vi } from "vitest";
import type { DataApiExecutor, Parameter, Row } from "@aqarak/db/data-api";
import type { J3Dependencies } from "./context";
import { createTenantsModule } from "../tenants";

it("refuses a stored replay after a manager becomes an accountant and records one denial", async () => {
  const company = randomUUID();
  const account = randomUUID();
  const tenant = randomUUID();
  const key = randomUUID();
  let manager = true;
  let stored: Row | undefined;
  const events: Record<string, Parameter["value"]>[] = [];
  const execute = vi.fn<DataApiExecutor["execute"]>((sql, params = []) => {
    const values = Object.fromEntries(
      params.map(({ name, value }) => [name, value]),
    );
    let rows: Row[] = [];
    if (sql.includes("from core.membership")) {
      rows = [
        {
          kind: "membership",
          data: { is_manager: manager, is_accountant: !manager },
        },
      ];
    } else if (sql.includes("insert into ops.idempotency_key")) {
      if (!stored) {
        stored = {
          request_sha256: values.hash,
          response: null,
          created_at: "2026-09-28T00:00:00Z",
        };
        rows = [{ key }];
      }
    } else if (sql.includes("from ops.idempotency_key")) {
      rows = stored ? [stored] : [];
    } else if (sql.includes("update ops.idempotency_key")) {
      if (!stored) throw new Error("Expected a reserved response");
      stored.response = values.response;
    } else if (sql.includes("insert into party.tenant")) {
      rows = [
        {
          id: tenant,
          version: 1,
          kind: "individual",
          full_name_en: values.en,
          email: values.email,
          preferred_language: values.language,
        },
      ];
    } else if (sql.includes("insert into audit.audit_event")) {
      events.push(values);
    }
    return Promise.resolve({ rows, numberOfRecordsUpdated: rows.length });
  });
  const executor: DataApiExecutor = {
    begin: vi.fn(() => Promise.resolve(randomUUID())),
    execute,
    commit: vi.fn(() => Promise.resolve()),
    rollback: vi.fn(() => Promise.resolve()),
  };
  const deps: J3Dependencies = {
    authenticate: () => Promise.resolve({ accountId: account }),
    appExecutor: executor,
    pipelineExecutor: null,
    extraction: null,
    now: () => new Date("2026-09-28T00:00:01Z"),
    randomBytes: (size) => new Uint8Array(size),
    storage: {
      bucket: "synthetic",
      keyPrefix: "test/",
      presignPut: vi.fn(),
      head: vi.fn(),
      scanStatus: vi.fn(),
      getBytes: vi.fn(),
      putReceipt: vi.fn(),
      presignGet: vi.fn(),
    },
  };
  const module = createTenantsModule(deps);
  const child = new Hono();
  module.register(child);
  const app = new Hono().route(module.basePath, child);
  const request = () =>
    app.request(`/v1/companies/${company}/tenants`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({
        kind: "individual",
        fullNameEn: "Synthetic Tenant",
        email: "tenant@example.test",
        preferredLanguage: "en",
      }),
    });
  const created = await request();
  expect(created.status).toBe(201);
  const body: unknown = await created.json();
  expect(stored?.response).toBeTruthy();
  const replay = await request();
  expect(replay.status).toBe(201);
  expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
  expect(await replay.json()).toEqual(body);
  manager = false;
  execute.mockClear();
  const refused = await request();
  expect(refused.status).toBe(403);
  expect(await refused.json()).toMatchObject({ code: "FORBIDDEN" });
  expect(refused.headers.get("Idempotent-Replayed")).toBeNull();
  expect(
    execute.mock.calls.some(([sql]) => sql.includes("ops.idempotency_key")),
  ).toBe(false);
  expect(
    execute.mock.calls.some(([sql]) =>
      sql.includes("insert into party.tenant"),
    ),
  ).toBe(false);
  expect(
    events.filter((event) => event.type === "tenant.created"),
  ).toHaveLength(1);
  expect(events.filter((event) => event.type === "policy.denied")).toEqual([
    expect.objectContaining({
      company,
      account,
      policy: JSON.stringify({
        policy_version: "j3-1",
        result: "deny",
        reasons: ["FORBIDDEN"],
      }),
    }),
  ]);
  expect(executor.rollback).toHaveBeenCalledTimes(1);
});
