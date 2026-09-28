import { describe, expect, it, vi } from "vitest";
import { createModelGateway } from "./gateway";
import { createBudgetGuard } from "./budget";
import { ZERO_USAGE } from "./cost";
import {
  ProviderResponseError,
  ProviderUnavailableError,
  AdapterNotAvailableError,
} from "./errors";
import { fakeRegistry, fakeRequest } from "./test-fixtures";
import type { StructuredAdapterResult, ModelCallRecord } from "./contracts";
function answer(text: string): StructuredAdapterResult {
  return {
    text,
    usage: { ...ZERO_USAGE, inputTokens: 70, outputTokens: 24 },
    modelEcho: "fake-model",
    finish: "completed",
  };
}
function setup(
  generate = vi.fn(() => Promise.resolve(answer('{"value":"synthetic"}'))),
) {
  const records: ModelCallRecord[] = [];
  const gateway = createModelGateway({
    registry: fakeRegistry(),
    structuredAdapters: { openai_responses: { generate } },
    transcriptionAdapters: {},
    now: () => new Date("2026-09-28T00:00:00Z"),
    onRecord: (record) => records.push(record),
  });
  return { gateway, records, generate };
}
describe("gateway", () => {
  it("AC-3 retries invalid schema once and sums cost and usage", async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce(answer('{"wrong":1}'))
      .mockResolvedValueOnce(answer('{"value":"synthetic"}'));
    const { gateway } = setup(generate);
    const result = await gateway.generateStructured(fakeRequest());
    expect(result.record).toMatchObject({
      status: "ok",
      retries: 1,
      costMicroUsd: 38,
      usage: { inputTokens: 140, outputTokens: 48 },
    });
    expect(result.output).toEqual({ value: "synthetic" });
  });
  it("AC-3 records schema_invalid after the second invalid answer", async () => {
    const { gateway, generate } = setup(
      vi.fn(() => Promise.resolve(answer(""))),
    );
    const result = await gateway.generateStructured(fakeRequest());
    expect(result.record.status).toBe("schema_invalid");
    expect(result.record.retries).toBe(1);
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it("AC-4 stops the second call at a one micro-dollar cap", async () => {
    const generate = vi.fn(() =>
      Promise.resolve(answer('{"value":"synthetic"}')),
    );
    const gateway = createModelGateway({
      registry: fakeRegistry(),
      structuredAdapters: { openai_responses: { generate } },
      transcriptionAdapters: {},
      budget: createBudgetGuard({ mc1_document_extraction: 1 }),
      now: () => new Date(),
    });
    await gateway.generateStructured(fakeRequest());
    const second = await gateway.generateStructured(fakeRequest());
    expect(generate).toHaveBeenCalledTimes(1);
    expect(second.record.status).toBe("budget_stopped");
    expect(second.record.costMicroUsd).toBe(0);
  });
  it.each(["refused", "incomplete"] as const)(
    "records %s without a schema retry",
    async (finish) => {
      const { gateway, generate } = setup(
        vi.fn(() => Promise.resolve({ ...answer(""), finish })),
      );
      expect(
        (await gateway.generateStructured(fakeRequest())).record.status,
      ).toBe(finish);
      expect(generate).toHaveBeenCalledTimes(1);
    },
  );
  it("sanitizes errors and counts transport retries", async () => {
    const { gateway } = setup(
      vi.fn(async () => {
        await Promise.resolve();
        throw new ProviderResponseError({
          status: 400,
          cause: new Error("private content"),
          transportRetries: 1,
        });
      }),
    );
    const result = await gateway.generateStructured(fakeRequest());
    expect(result.record).toMatchObject({
      status: "provider_error",
      transportRetries: 1,
      errorMessage: "ProviderResponseError status=400",
    });
    expect(JSON.stringify(result.record)).not.toContain("private content");
  });
  it("times out even when an adapter ignores cancellation", async () => {
    const { gateway } = setup(
      vi.fn(() => new Promise<StructuredAdapterResult>(() => undefined)),
    );
    const result = await gateway.generateStructured({
      ...fakeRequest(),
      timeoutMs: 2,
    });
    expect(result.record.status).toBe("timeout");
  });
  it("maps provider timeouts and refuses missing adapters", async () => {
    const { gateway } = setup(
      vi.fn(async () => {
        await Promise.resolve();
        throw new ProviderUnavailableError({
          cause: new DOMException("", "TimeoutError"),
        });
      }),
    );
    expect(
      (await gateway.generateStructured(fakeRequest())).record.status,
    ).toBe("timeout");
    const missing = createModelGateway({
      registry: fakeRegistry(),
      structuredAdapters: {},
      transcriptionAdapters: {},
      now: () => new Date(),
    });
    await expect(missing.generateStructured(fakeRequest())).rejects.toThrow(
      AdapterNotAvailableError,
    );
  });
});
