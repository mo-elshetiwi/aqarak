import { instant } from "../runtime/sql";
import { Hono } from "hono";
import { z } from "zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticateIdentity, deviceSummary, traceId } from "../runtime/auth";
import { createRuntime, json } from "../runtime/request";
const accountId = "00000000-0000-4000-8000-000000000001";
const companyId = "00000000-0000-4000-8000-000000000002";
afterEach(() => vi.unstubAllEnvs());
describe("identity authentication", () => {
  it("refuses the former Local authorization scheme", async () => {
    expect(
      await authenticateIdentity(
        new Request("https://example.invalid", {
          headers: { Authorization: `Local ${accountId}.${"a".repeat(43)}` },
        }),
      ),
    ).toBeNull();
  });
});
it("refuses unauthenticated requests without using the executor", async () => {
  const begin = vi.fn();
  const runtime = createRuntime({
    authenticate: () => Promise.resolve(null),
    dependencies: {
      executor: { begin, execute: vi.fn(), commit: vi.fn(), rollback: vi.fn() },
    },
  });
  const app = new Hono();
  app.get(
    "/v1/companies/:companyId/contracts",
    runtime({
      command: "read",
      schema: z.strictObject({}),
      run: () => Promise.resolve(json({})),
    }),
  );
  expect(
    (await app.request(`/v1/companies/${companyId}/contracts`)).status,
  ).toBe(401);
  expect(begin).not.toHaveBeenCalled();
});
it.each([undefined, "bad", "a".repeat(129), "bad key value 1234"])(
  "refuses invalid command keys before database access: %s",
  async (keyValue) => {
    const begin = vi.fn();
    const runtime = createRuntime({
      authenticate: () => Promise.resolve({ accountId }),
      dependencies: {
        executor: {
          begin,
          execute: vi.fn(),
          commit: vi.fn(),
          rollback: vi.fn(),
        },
      },
    });
    const app = new Hono();
    app.post(
      "/v1/companies/:companyId/contracts",
      runtime({
        command: "create",
        mutation: true,
        schema: z.strictObject({}),
        run: () => Promise.resolve(json({})),
      }),
    );
    const response = await app.request(`/v1/companies/${companyId}/contracts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(keyValue ? { "Idempotency-Key": keyValue } : {}),
      },
      body: "{}",
    });
    expect(response.status).toBe(400);
    expect(begin).not.toHaveBeenCalled();
  },
);
it("refuses unknown body keys before database access", async () => {
  const begin = vi.fn();
  const runtime = createRuntime({
    authenticate: () => Promise.resolve({ accountId }),
    dependencies: {
      executor: { begin, execute: vi.fn(), commit: vi.fn(), rollback: vi.fn() },
    },
  });
  const app = new Hono();
  app.post(
    "/v1/companies/:companyId/contracts",
    runtime({
      command: "create",
      mutation: true,
      schema: z.strictObject({}),
      run: () => Promise.resolve(json({})),
    }),
  );
  expect(
    (
      await app.request(`/v1/companies/${companyId}/contracts`, {
        method: "POST",
        headers: {
          "Idempotency-Key": "synthetic-key-value",
          "Content-Type": "application/json",
        },
        body: '{"unknown":true}',
      })
    ).status,
  ).toBe(400);
  expect(begin).not.toHaveBeenCalled();
});
it("stores a bounded device summary and valid trace identity", () => {
  const request = new Request("https://example.invalid", {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh) Chrome/150.0 private-content",
      traceparent: "00-12345678901234567890123456789012-1234567890123456-01",
    },
  });
  expect(deviceSummary(request)).toBe("Chrome / macOS");
  expect(traceId(request)).toBe("12345678901234567890123456789012");
  expect(
    traceId(
      new Request("https://example.invalid", {
        headers: {
          traceparent:
            "00-00000000000000000000000000000000-1234567890123456-01",
        },
      }),
    ),
  ).toBeNull();
});

it("interprets timezone-free Data API timestamps as UTC", () => {
  expect(instant("2026-09-28 06:00:00.000")).toBe("2026-09-28T06:00:00.000Z");
  expect(instant("2026-09-28T06:00:00Z")).toBe("2026-09-28T06:00:00.000Z");
  expect(instant("2026-09-28T10:00:00+04:00")).toBe("2026-09-28T06:00:00.000Z");
});
