import { randomUUID } from "node:crypto";
import type { DataApiExecutor } from "@aqarak/db/data-api";
import { Hono } from "hono";
import { expect, it, vi } from "vitest";
import { createMaintenanceModules } from ".";

function fixture(): { app: Hono; db: DataApiExecutor; company: string } {
  const db: DataApiExecutor = {
    begin: vi.fn(),
    execute: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
  };
  const app = new Hono();
  for (const module of createMaintenanceModules({
    db,
    authenticate: () =>
      Promise.resolve({ subject: "00000000-0000-4000-8000-000000000001" }),
  })) {
    const sub = new Hono();
    module.register(sub);
    app.route(module.basePath, sub);
  }
  return { app, db, company: randomUUID() };
}
it.each([
  "/intakes",
  `/intakes/${randomUUID()}/confirm`,
  `/intakes/${randomUUID()}/reject`,
])("requires an idempotency key on %s before data access", async (route) => {
  const f = fixture();
  const response = await f.app.request(
    `/v1/companies/${f.company}/maintenance${route}`,
    { method: "POST" },
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    code: "IDEMPOTENCY_KEY_REQUIRED",
  });
  expect(f.db.begin).not.toHaveBeenCalled();
});
it.each([
  ["invalid JSON", "{", 400, "INVALID_REQUEST"],
  ["missing fields", "{}", 400, "INVALID_REQUEST"],
  [
    "empty report",
    JSON.stringify({
      unitId: randomUUID(),
      language: "en",
      typedText: "   ",
      voiceMediaId: null,
      photoMediaIds: [],
    }),
    422,
    "INVALID_INPUT",
  ],
  [
    "overlapping media",
    (() => {
      const id = randomUUID();
      return JSON.stringify({
        unitId: randomUUID(),
        language: "en",
        typedText: null,
        voiceMediaId: id,
        photoMediaIds: [id],
      });
    })(),
    422,
    "INVALID_INPUT",
  ],
] as const)(
  "keeps %s validation separate from semantic failures",
  async (_name, body, status, code) => {
    const f = fixture();
    const response = await f.app.request(
      `/v1/companies/${f.company}/maintenance/intakes`,
      {
        method: "POST",
        headers: {
          "Idempotency-Key": randomUUID(),
          "content-type": "application/json",
        },
        body,
      },
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code });
    expect(f.db.begin).not.toHaveBeenCalled();
  },
);
