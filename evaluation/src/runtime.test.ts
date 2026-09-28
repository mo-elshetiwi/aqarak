import { afterEach, expect, it, vi } from "vitest";
import { createBudgetGuard, getCandidate } from "@aqarak/api/models";
import { fakeRegistry, fakeRequest } from "./test-fixtures";
import { loadConfig } from "./config";
import { createScreeningRuntime } from "./runtime";
afterEach(() => {
  vi.unstubAllGlobals();
});
it("requires a key only when a selected candidate needs it", () => {
  const options = {
    config: loadConfig({ AQARAK_DATA_DIR: "/synthetic-data" }),
    classId: "mc1_document_extraction" as const,
    candidateIds: ["fake-candidate"],
    budget: createBudgetGuard({}),
    now: () => new Date(),
  };
  expect(() =>
    createScreeningRuntime({ ...options, registry: fakeRegistry() }),
  ).toThrow("Missing provider configuration");
  const runtime = createScreeningRuntime({
    ...options,
    registry: fakeRegistry("ollama"),
  });
  runtime.close();
});
it("verifies local digests before executing a structured call", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      Response.json({ models: [{ name: "fake-model", digest: "fake" }] }),
    )
    .mockResolvedValueOnce(
      Response.json({
        model: "fake-model",
        message: { content: '{"value":"synthetic"}' },
        done: true,
        prompt_eval_count: 1,
        eval_count: 1,
      }),
    );
  vi.stubGlobal("fetch", fetch);
  const registry = fakeRegistry("ollama");
  const runtime = createScreeningRuntime({
    config: loadConfig({ AQARAK_DATA_DIR: "/synthetic-data" }),
    registry,
    classId: "mc1_document_extraction",
    candidateIds: ["fake-candidate"],
    budget: createBudgetGuard({}),
    now: () => new Date(),
  });
  try {
    await runtime.beforeCandidate(
      getCandidate(registry, "mc1_document_extraction", "fake-candidate"),
    );
    expect(
      (await runtime.gateway.generateStructured(fakeRequest())).record.status,
    ).toBe("ok");
    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      "http://127.0.0.1:11434/api/tags",
      "http://127.0.0.1:11434/api/chat",
    ]);
  } finally {
    runtime.close();
  }
});
