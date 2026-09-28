import { randomUUID } from "node:crypto";
import type { DataApiExecutor } from "@aqarak/db/data-api";
import { Hono } from "hono";
import { expect, it, vi } from "vitest";
import { createMaintenanceModules } from "../maintenance";
it.each([
  ["POST", "/media/uploads"],
  ["POST", `/media/${randomUUID()}/complete`],
  ["GET", `/media/${randomUUID()}/download`],
  ["GET", "/maintenance/units"],
  ["POST", "/maintenance/intakes"],
  ["GET", `/maintenance/intakes/${randomUUID()}`],
  ["POST", `/maintenance/intakes/${randomUUID()}/confirm`],
  ["POST", `/maintenance/intakes/${randomUUID()}/reject`],
  ["GET", "/maintenance/tickets"],
  ["GET", `/maintenance/tickets/${randomUUID()}`],
])(
  "AC-2 refuses unauthenticated %s %s without data access",
  async (method, path) => {
    const db: DataApiExecutor = {
      begin: vi.fn(),
      execute: vi.fn(),
      commit: vi.fn(),
      rollback: vi.fn(),
    };
    const app = new Hono();
    for (const module of createMaintenanceModules({ db })) {
      const sub = new Hono();
      module.register(sub);
      app.route(module.basePath, sub);
    }
    const response = await app.request(`/v1/companies/${randomUUID()}${path}`, {
      method,
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    expect(db.begin).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
  },
);

it.each([undefined, "short", "space invalid", "a".repeat(129)])(
  "refuses malformed idempotency key %s without database access",
  async (key) => {
    const db: DataApiExecutor = {
      begin: vi.fn(),
      execute: vi.fn(),
      commit: vi.fn(),
      rollback: vi.fn(),
    };
    const app = new Hono();
    for (const module of createMaintenanceModules({
      db,
      authenticate: () => Promise.resolve({ subject: randomUUID() }),
    })) {
      const sub = new Hono();
      module.register(sub);
      app.route(module.basePath, sub);
    }
    const response = await app.request(
      `/v1/companies/${randomUUID()}/media/uploads`,
      { method: "POST", headers: key ? { "Idempotency-Key": key } : {} },
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "IDEMPOTENCY_KEY_REQUIRED",
    });
    expect(db.begin).not.toHaveBeenCalled();
  },
);

it("returns 404 for a verified account without company access", async () => {
  const db: DataApiExecutor = {
    begin: vi.fn().mockResolvedValue("synthetic-tx"),
    execute: vi.fn().mockResolvedValue({ rows: [], numberOfRecordsUpdated: 0 }),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
  };
  const app = new Hono();
  for (const module of createMaintenanceModules({
    db,
    authenticate: () => Promise.resolve({ subject: randomUUID() }),
  })) {
    const sub = new Hono();
    module.register(sub);
    app.route(module.basePath, sub);
  }
  const response = await app.request(
    `/v1/companies/${randomUUID()}/maintenance/units`,
  );
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
  expect(db.rollback).toHaveBeenCalledOnce();
  expect(
    vi
      .mocked(db.execute)
      .mock.calls.some(([sql]) => /^(insert|update)/u.test(sql)),
  ).toBe(false);
});
