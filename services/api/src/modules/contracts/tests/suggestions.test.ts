import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataApiExecutor, Parameter, Row } from "@aqarak/db/data-api";
import { createModelGateway } from "../../../models/gateway";
import * as registryModule from "../../../models/registry";
import { loadModelRegistry } from "../../../models/registry";
import { createBudgetGuard } from "../../../models/budget";
import type {
  ModelGateway,
  StructuredAdapter,
} from "../../../models/contracts";
import { ZERO_USAGE } from "../../../models/cost";
import { createWorkflowModules } from "../workflows";
const companyId = randomUUID();
const contractId = randomUUID();
const accountId = randomUUID();
const output = {
  textAr: "شرط تجريبي باللغة العربية.",
  warnings: ["عبارة تتطلب المراجعة."],
};
function setup(
  options: {
    role?: "manager" | "owner" | "tenant";
    status?: string;
    gateway?: ModelGateway | null;
  } = {},
) {
  const role = options.role ?? "manager";
  const status = options.status ?? "draft";
  const saved = new Map<string, Row>();
  const writes: { sql: string; values: Record<string, Parameter["value"]> }[] =
    [];
  const executor: DataApiExecutor = {
    begin: () => Promise.resolve(randomUUID()),
    commit: () => Promise.resolve(),
    rollback: () => Promise.resolve(),
    execute: (sql, params = []) => {
      const values = Object.fromEntries(params.map((p) => [p.name, p.value]));
      writes.push({ sql, values });
      let rows: Row[] = [];
      if (sql.startsWith("select * from core.company"))
        rows = [{ id: companyId }];
      else if (sql.includes("from core.membership"))
        rows =
          role === "owner" || role === "tenant"
            ? [{ kind: role, data: { id: randomUUID() } }]
            : [
                {
                  kind: "membership",
                  data: { is_manager: true },
                },
              ];
      else if (sql.startsWith("select id,status from lease.contract"))
        rows = [{ id: contractId, status }];
      else if (sql.startsWith("insert into ops.idempotency_key")) {
        if (!saved.has(String(values.key))) {
          const row = {
            request_sha256: values.hash,
            response: null,
            created_at: new Date().toISOString(),
          };
          saved.set(String(values.key), row);
          rows = [row];
        }
      } else if (sql.startsWith("select request_sha256")) {
        const row = saved.get(String(values.key));
        if (row) rows = [row];
      } else if (sql.startsWith("update ops.idempotency_key")) {
        const row = saved.get(String(values.key));
        if (row) row.response = values.response;
      }
      return Promise.resolve({ rows, numberOfRecordsUpdated: 1 });
    },
  };
  const app = new Hono();
  for (const module of createWorkflowModules({
    authenticate: () => Promise.resolve({ accountId }),
    dependencies: { executor, modelGateway: options.gateway ?? null },
  })) {
    const routes = new Hono();
    module.register(routes);
    app.route(module.basePath, routes);
  }
  const request = (
    key = randomUUID(),
    textEn = "A synthetic English clause.",
  ) =>
    app.request(
      `/v1/companies/${companyId}/contracts/${contractId}/clause-suggestions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ textEn }),
      },
    );
  return { request, writes };
}
function fakeGateway(mode = "success") {
  const registry = loadModelRegistry();
  const generate = vi.fn<StructuredAdapter["generate"]>(() => {
    if (mode === "failure")
      return Promise.reject(new Error("Synthetic provider failure"));
    if (mode === "timeout") return new Promise(() => undefined);
    return Promise.resolve({
      text: JSON.stringify(
        mode === "invalid" ? { textAr: "", warnings: [] } : output,
      ),
      usage: ZERO_USAGE,
      modelEcho: null,
      finish: mode === "refused" ? "refused" : "completed",
    });
  });
  const gateway = createModelGateway({
    registry,
    structuredAdapters: { openai_responses: { generate } },
    transcriptionAdapters: {},
    now: () => new Date(),
    ...(mode === "budget"
      ? { budget: createBudgetGuard({ mc5_drafting: 0 }) }
      : {}),
  });
  return { generate, gateway, registry };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe("clause translation suggestions", () => {
  it("returns a labelled suggestion with current registry provenance and replays without another call", async () => {
    const f = fakeGateway();
    const generateStructured = vi.spyOn(f.gateway, "generateStructured");
    const route = setup({ gateway: f.gateway });
    const key = randomUUID();
    const response = await route.request(key);
    expect(response.status).toBe(200);
    const result: unknown = await response.json();
    expect(result).toEqual({
      suggestionId: z.object({ suggestionId: z.uuid() }).parse(result)
        .suggestionId,
      suggestion: output,
      provenance: {
        registryEntry: `mc5_drafting/${f.registry.classes.mc5_drafting.primary}`,
        promptVersion: "clause-translation.v1",
        outputSha256: createHash("sha256")
          .update(JSON.stringify(output))
          .digest("hex"),
      },
    });
    expect(await (await route.request(key)).json()).toEqual(result);
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(generateStructured).toHaveBeenCalledWith(
      expect.objectContaining({
        timeoutMs: 20_000,
        classId: "mc5_drafting",
        candidateId: f.registry.classes.mc5_drafting.primary,
      }),
    );
    const suggestions = route.writes.filter((w) =>
      w.sql.startsWith("insert into lease.clause_suggestion"),
    );
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.values).toMatchObject({
      requested_by: accountId,
      contract_id: contractId,
      text_ar: output.textAr,
      text_ar_sha256: createHash("sha256").update(output.textAr).digest("hex"),
    });
    const events = route.writes.filter((w) =>
      w.sql.startsWith("insert into audit.audit_event"),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.values).toMatchObject({
      type: "clause_suggestion.created",
      account: accountId,
      subjectId: suggestions[0]?.values.id,
      after: 1,
    });
  });
  it("reads the registry primary again for a new suggestion request", async () => {
    const f = fakeGateway();
    const entry = f.registry.classes.mc5_drafting;
    const alternate = Object.keys(entry.candidates).find(
      (id) => id !== entry.primary,
    );
    if (!alternate)
      throw new Error(
        "A second registered candidate is required for this test",
      );
    const reader = vi
      .spyOn(registryModule, "loadModelRegistry")
      .mockReturnValue(f.registry);
    const route = setup({ gateway: f.gateway });
    expect((await route.request()).status).toBe(200);
    reader.mockReturnValue({
      ...f.registry,
      classes: {
        ...f.registry.classes,
        mc5_drafting: { ...entry, primary: alternate },
      },
    });
    const response = await route.request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      provenance: { registryEntry: `mc5_drafting/${alternate}` },
    });
    expect(f.generate.mock.calls[1]?.[0].candidate).toEqual(
      entry.candidates[alternate],
    );
  });
  it("loads the source registry when a local bundle has no adjacent registry file", async () => {
    const f = fakeGateway();
    vi.spyOn(registryModule, "loadModelRegistry").mockImplementation(() => {
      throw Object.assign(new Error("Synthetic missing file"), {
        code: "ENOENT",
      });
    });
    expect((await setup({ gateway: f.gateway }).request()).status).toBe(200);
  });
  it.each(["failure", "refused", "invalid", "budget"])(
    "returns manual fallback for %s",
    async (mode) => {
      const f = fakeGateway(mode);
      const route = setup({ gateway: f.gateway });
      const response = await route.request();
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        code: "MODEL_UNAVAILABLE",
        detail: "The clause can be translated by hand.",
      });
      expect(
        route.writes.some((w) =>
          w.sql.startsWith("update ops.idempotency_key"),
        ),
      ).toBe(false);
      expect(
        route.writes.some((w) =>
          /^(insert|update) (into )?lease\./u.test(w.sql),
        ),
      ).toBe(false);
    },
  );
  it("times out structured generation after twenty seconds", async () => {
    vi.useFakeTimers();
    const f = fakeGateway("timeout");
    const promise = setup({ gateway: f.gateway }).request();
    await vi.waitFor(() => {
      expect(f.generate).toHaveBeenCalled();
    });
    await vi.advanceTimersByTimeAsync(20_000);
    const response = await promise;
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "MODEL_UNAVAILABLE" });
  });
  it("fails closed without a provider credential and makes no network call", async () => {
    vi.stubEnv("OPENAI_API_KEY", undefined);
    const network = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Unexpected network call"));
    const response = await setup().request();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "MODEL_UNAVAILABLE",
      detail: "The clause can be translated by hand.",
    });
    expect(network).not.toHaveBeenCalled();
  });
  it.each(["owner", "tenant"] as const)(
    "denies %s with a policy event",
    async (role) => {
      const f = fakeGateway();
      const route = setup({ role, gateway: f.gateway });
      const response = await route.request();
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "FORBIDDEN" });
      expect(
        route.writes.find((w) =>
          w.sql.includes("insert into audit.audit_event"),
        )?.values.type,
      ).toBe("policy.denied");
      expect(f.generate).not.toHaveBeenCalled();
    },
  );
  it("denies submitted contracts before a model call", async () => {
    const f = fakeGateway();
    const route = setup({
      status: "awaiting_owner_approval",
      gateway: f.gateway,
    });
    const response = await route.request();
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "INVALID_TRANSITION" });
    expect(
      route.writes.find((w) => w.sql.includes("insert into audit.audit_event"))
        ?.values.type,
    ).toBe("policy.denied");
    expect(f.generate).not.toHaveBeenCalled();
  });
  it.each(["", " ", "x".repeat(2001), `a${" ".repeat(2000)}`])(
    "validates bounded English input of length %i",
    async (text) => {
      expect((await setup().request(randomUUID(), text)).status).toBe(400);
    },
  );
  it("rejects an idempotency key reused for different text", async () => {
    const f = fakeGateway();
    const route = setup({ gateway: f.gateway });
    const key = randomUUID();
    expect((await route.request(key)).status).toBe(200);
    expect((await route.request(key, "Different synthetic text.")).status).toBe(
      422,
    );
    expect(f.generate).toHaveBeenCalledTimes(1);
  });
});
