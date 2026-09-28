import { afterEach, describe, expect, it, vi } from "vitest";
import { createProductionDependencies } from "../documents/dependencies";
import { loadModelRegistry } from "../../models";
import { smokeMain } from "./smoke";
import { goldDecision, smokeEnabled } from "./smoke-support";
import { catalogue, mapFields, storedFieldsSchema } from "../extraction/fields";

const enabled = {
  J3_SMOKE: "1",
  LIVE_MODELS: "1",
  J3_DEV_DATABASE: "1",
  DATABASE_NAME: "aqarak_tenants",
  AWS_REGION: "synthetic-region",
  DATABASE_CLUSTER_ARN: "synthetic-cluster",
  APP_SECRET_ARN: "synthetic-app",
  PIPELINE_SECRET_ARN: "synthetic-pipeline",
  OPENAI_API_KEY: "synthetic-key",
  DOCUMENTS_BUCKET_NAME: "synthetic-bucket",
  DOCUMENT_KEY_PREFIX: "test/tenants/smoke/",
};
describe("live tenant smoke gates", () => {
  it("refuses without configuration in one content-free line and never starts the journey", async () => {
    const write = vi.fn();
    const journey = vi.fn();
    expect(await smokeMain({}, write, journey)).toBe(2);
    expect(journey).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/^J3 smoke refused:[^\n]+\n$/),
    );
  });
  it.each(Object.keys(enabled))("refuses when %s is absent", (name) => {
    const environment: NodeJS.ProcessEnv = { ...enabled };
    environment[name] = undefined;
    expect(smokeEnabled(environment)).toBe(false);
  });
  it.each([
    { J3_SMOKE: "0" },
    { LIVE_MODELS: "0" },
    { J3_DEV_DATABASE: "0" },
    { DATABASE_NAME: "production" },
    { DOCUMENT_KEY_PREFIX: "production/" },
    { OPENAI_API_KEY: " " },
  ])("refuses unsafe or empty configuration %j", (change) => {
    expect(smokeEnabled({ ...enabled, ...change })).toBe(false);
  });
  it("accepts complete isolated development configuration", () => {
    expect(smokeEnabled(enabled)).toBe(true);
  });
});
describe("production smoke composition", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it("uses the committed extraction registry and real storage without making a request", async () => {
    for (const [name, value] of Object.entries(enabled))
      vi.stubEnv(name, value);
    const fetch = vi.fn();
    const original = globalThis.fetch;
    globalThis.fetch = fetch;
    try {
      const deps = createProductionDependencies();
      expect(deps.extraction?.registry).toEqual(loadModelRegistry());
      expect(deps.pipelineExecutor).not.toBeNull();
      expect(deps.storage.bucket).toBe(enabled.DOCUMENTS_BUCKET_NAME);
      expect(deps.storage.keyPrefix).toBe(enabled.DOCUMENT_KEY_PREFIX);
      expect(
        await deps.authenticate(new Request("https://example.com")),
      ).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = original;
    }
  });
});
describe("gold decisions", () => {
  it.each([
    ["name_en", " Example ", "Example", "accepted", undefined],
    ["name_ar", " مثال ", "مثال", "accepted", undefined],
    ["name_en", "Different", " Example ", "edited", "Example"],
    ["name_en", null, "Example", "edited", "Example"],
    ["name_en", "Example", null, "not_on_document", undefined],
    ["name_en", null, undefined, "not_on_document", undefined],
    ["expiry_date", " 2030-01-02 ", "2030-01-02", "accepted", undefined],
    ["expiry_date", "2030-01-03", "2030-01-02", "edited", "2030-01-02"],
    ["expiry_date", "2030-1-2", "2030-01-02", "edited", "2030-01-02"],
    ["expiry_date", "2030-02-31", "2030-01-02", "edited", "2030-01-02"],
    ["id_number", "123", "124", "edited", "124"],
  ] as const)(
    "compares %s gold without network",
    (name, suggestion, gold, ...expected) => {
      const [decision, value] = expected;
      expect(goldDecision(name, suggestion, gold)).toEqual({
        decision,
        ...(value === undefined ? {} : { value }),
        sourceViewed: true,
        expectedVersion: null,
      });
    },
  );
});
describe("tenant extraction value boundary", () => {
  it.each([42, true, {}, [], undefined])(
    "rejects a non-string, non-null value %j in mapping and storage",
    (value) => {
      const fields = Object.fromEntries(
        catalogue.map(({ name }) => [name, { value, evidence: null }]),
      );
      expect(() =>
        mapFields({ fields } as Parameters<typeof mapFields>[0]),
      ).toThrow();
      expect(
        storedFieldsSchema.safeParse({
          name_en: { value, confidence: 1, page: 1, evidence: "" },
        }).success,
      ).toBe(false);
    },
  );
  it.each(["Example", null])(
    "preserves an allowed extraction value %j",
    (value) => {
      const fields = Object.fromEntries(
        catalogue.map(({ name }) => [name, { value, evidence: value }]),
      );
      const mapped = mapFields({ fields });
      expect(storedFieldsSchema.safeParse(mapped).success).toBe(true);
      expect(
        Object.values(mapped).every((field) => field.value === value),
      ).toBe(true);
    },
  );
});
