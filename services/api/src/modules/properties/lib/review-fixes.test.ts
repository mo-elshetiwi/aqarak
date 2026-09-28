import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { Row } from "@aqarak/db/data-api";
import { createOwnersApp } from "../../owners";
import { ownerDetail, listOwners } from "../../owners/read";
import { propertyDetail, listProperties } from "../read";
import { companyId, personAccountId } from "./domain";
import * as gates from "./gate";
import { EstateProblem } from "./problem";
import { logFailure, type RequestScope, type RuntimePorts } from "./runtime";
import { utcTimestamp } from "./sql";

describe("D02 UTC timestamp reads", () => {
  it("parses offsetless Data API timestamps as UTC under Asia/Dubai", () => {
    vi.stubEnv("TZ", "Asia/Dubai");
    try {
      expect(new Date("2026-09-28T07:00:00Z").getTimezoneOffset()).toBe(-240);
      expect(utcTimestamp("2026-09-28 07:00:00")).toBe(
        "2026-09-28T07:00:00.000Z",
      );
      expect(utcTimestamp("2026-09-28 07:00:00.123456")).toBe(
        "2026-09-28T07:00:00.123Z",
      );
      expect(utcTimestamp("2026-09-28 07:00:00.1")).toBe(
        "2026-09-28T07:00:00.100Z",
      );
      expect(utcTimestamp("2026-09-28T07:00:00.123Z")).toBe(
        "2026-09-28T07:00:00.123Z",
      );
      expect(utcTimestamp("2026-09-28T11:00:00+04:00")).toBe(
        "2026-09-28T07:00:00.000Z",
      );
      expect(() => utcTimestamp("invalid")).toThrow(RangeError);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

it.each([false, true])(
  "D04 every owner and property read passes the company default %s to the gate",
  async (defaultOwnerGate) => {
    const id = randomUUID();
    const c = randomUUID();
    const account = randomUUID();
    const owner: Row = {
      id,
      version: 1,
      full_name_en: "Synthetic owner",
      full_name_ar: "مالك تجريبي",
      self_managed: false,
      preferred_language: "en",
    };
    const property: Row = {
      id,
      version: 1,
      name_en: "Synthetic property",
      name_ar: "عقار تجريبي",
      kind: "villa",
      use: "residential",
    };
    const scope: RequestScope = {
      params: {},
      root: null,
      company: {
        kind: "management_company",
        default_owner_gate: defaultOwnerGate,
      },
      audit: {
        companyId: c,
        accountId: account,
        role: "manager",
        channel: "web_form",
        key: null,
        traceId: randomUUID(),
      },
      actor: {
        account_id: personAccountId.parse(account),
        company_id: companyId.parse(c),
        roles: ["manager"],
        owner_ids: [],
        tenant_ids: [],
        technician_profile_id: null,
      },
      tx: {
        execute: (sql) =>
          Promise.resolve({
            rows: sql.startsWith("select * from party.owner")
              ? [owner]
              : sql.startsWith("select p.* from estate.property")
                ? [property]
                : [],
            numberOfRecordsUpdated: 0,
          }),
      },
    };
    const gate = vi.spyOn(gates, "gate");
    try {
      const expected = { value: defaultOwnerGate, source: "company_default" };
      expect((await ownerDetail(scope, owner)).ownerGate).toMatchObject(
        expected,
      );
      expect((await listOwners(scope, {})).items[0]?.ownerGate).toMatchObject(
        expected,
      );
      expect((await propertyDetail(scope, property)).ownerGate).toEqual(
        expected,
      );
      expect((await listProperties(scope, {})).items[0]?.ownerGate).toEqual(
        expected,
      );
      expect(gate).toHaveBeenCalledTimes(4);
      for (const [company] of gate.mock.calls)
        expect(company).toEqual({
          kind: "management_company",
          defaultOwnerGate,
        });
    } finally {
      gate.mockRestore();
    }
  },
);

async function failedRequest(ports: RuntimePorts): Promise<Response> {
  const app = new Hono();
  app.route("/v1/companies/:companyId/owners", createOwnersApp(ports));
  return app.request(`/v1/companies/${randomUUID()}/owners`);
}

it.each([true, false])(
  "D05 a throwing database reports one private JSON line with custom port %s",
  async (customPort) => {
    const privateMessage =
      "Synthetic private database message with SQL and parameters";
    const cause = new TypeError(privateMessage);
    cause.name = privateMessage;
    const onFailure = vi.fn(logFailure);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      const response = await failedRequest({
        identity: () => Promise.resolve({ accountId: randomUUID() }),
        database: () => {
          throw cause;
        },
        ...(customPort ? { onFailure } : {}),
      });
      const body: unknown = await response.json();
      expect(response.status).toBe(503);
      expect(body).toMatchObject({ code: "UNAVAILABLE" });
      expect(onFailure).toHaveBeenCalledTimes(customPort ? 1 : 0);
      expect(stderr).toHaveBeenCalledTimes(1);
      const line = String(stderr.mock.calls[0]?.[0]);
      expect(line.split("\n")).toHaveLength(2);
      expect(line.endsWith("\n")).toBe(true);
      expect(line).not.toContain(privateMessage);
      expect(JSON.stringify(body)).not.toContain(privateMessage);
      const logged: unknown = JSON.parse(line);
      expect(logged).toEqual({
        level: "error",
        traceId: expect.any(String) as string,
        command: "owners.list",
        errorClass: "TypeError",
      });
      expect(body).toMatchObject({
        traceId: (logged as { traceId: string }).traceId,
      });
      if (customPort) expect(onFailure).toHaveBeenCalledWith(logged);
    } finally {
      stderr.mockRestore();
    }
  },
);

it("D05 identity failures use the same single failure report", async () => {
  const onFailure = vi.fn();
  const database = vi.fn();
  const response = await failedRequest({
    identity: () =>
      Promise.reject(new RangeError("Synthetic private identity failure")),
    database,
    onFailure,
  });
  expect(response.status).toBe(503);
  expect(onFailure).toHaveBeenCalledExactlyOnceWith({
    level: "error",
    traceId: expect.any(String) as string,
    command: "owners.list",
    errorClass: "RangeError",
  });
  expect(database).not.toHaveBeenCalled();
});

it("D05 expected EstateProblem refusals do not report unexpected failures", async () => {
  const onFailure = vi.fn();
  const response = await failedRequest({
    identity: () => Promise.resolve({ accountId: randomUUID() }),
    database: () => {
      throw new EstateProblem(503, "UNAVAILABLE");
    },
    onFailure,
  });
  expect(response.status).toBe(503);
  expect(onFailure).not.toHaveBeenCalled();
});

it("D06 documents a development database selected by DATABASE_NAME and a synthetic key prefix", () => {
  const section = readFileSync(
    new URL("../../../../README.md", import.meta.url),
    "utf8",
  )
    .split("## Owners and properties module")[1]
    ?.split("\n## ")[0]
    ?.replace(/\s+/g, " ");
  expect(section).toContain("a development database named by `DATABASE_NAME`");
  expect(section).toContain("a synthetic key prefix in `DOCUMENT_KEY_PREFIX`");
  expect(section).not.toContain("aqarak_owners");
  expect(section).not.toContain("stream's");
});
