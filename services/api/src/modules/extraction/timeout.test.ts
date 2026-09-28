import { afterEach, expect, it, vi } from "vitest";
import type { RequestContext } from "../documents/context";
import { fakeRegistry, fakeRequest } from "../../models/test-fixtures";
import { createModelGateway } from "../../models/gateway";
import { extractDocument, runExtraction } from "./command";

const database = vi.hoisted(() => ({
  one: vi.fn(),
  audit: vi.fn(),
  store: vi.fn(),
  load: vi.fn(),
}));
vi.mock("../documents/database", () => ({
  withSystemTx: (
    _executor: unknown,
    _scope: unknown,
    work: (tx: object) => Promise<unknown>,
  ) => work({}),
}));
vi.mock("../documents/sql", () => ({
  one: database.one,
  str: (row: Record<string, unknown>, key: string) => String(row[key]),
  num: (row: Record<string, unknown>, key: string) => Number(row[key]),
  rows: vi.fn(),
}));
vi.mock("../documents/audit", () => ({ appendAuditEvent: database.audit }));
vi.mock("../documents/http", () => ({ storeResponse: database.store }));
vi.mock("../documents/read", () => ({
  loadVersion: database.load,
  versionDetail: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.clearAllMocks();
});
it("returns a timeout problem after storing the receipt and failure audit", async () => {
  vi.stubEnv("EXTRACTION_TIMEOUT_MS", "5");
  vi.useFakeTimers();
  const registry = fakeRegistry();
  const putReceipt = vi.fn().mockResolvedValue(undefined);
  const gateway = createModelGateway({
    registry,
    now: () => new Date(),
    structuredAdapters: {
      openai_responses: { generate: () => new Promise(() => undefined) },
    },
    transcriptionAdapters: {},
  });
  database.one
    .mockResolvedValueOnce({ processing_status: "extracting" })
    .mockResolvedValueOnce({ version: 1 })
    .mockResolvedValueOnce({ version: 2 });
  const context = {
    deps: {
      extraction: { gateway, registry },
      pipelineExecutor: {},
      storage: { putReceipt },
    },
    companyId: "synthetic-company",
    accountId: "synthetic-account",
    key: "synthetic-command",
  } as unknown as RequestContext;
  const request = fakeRequest();
  const image = request.images[0] ?? {
    bytes: new Uint8Array([1]),
    mediaType: "image/png" as const,
  };
  const pending = runExtraction(
    context,
    {
      id: "synthetic-version",
      s3_key: "synthetic/original",
      bucket: "synthetic-bucket",
    },
    image,
  );
  await vi.advanceTimersByTimeAsync(5);
  expect(await pending).toMatchObject({
    status: 504,
    body: { status: 504, code: "EXTRACTION_TIMEOUT" },
  });
  expect(putReceipt).toHaveBeenCalledWith(
    expect.objectContaining({ bucket: "synthetic-bucket" }),
    expect.objectContaining({
      record: expect.objectContaining({ status: "timeout" }) as unknown,
    }),
  );
  expect(database.audit).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ type: "model_call.created" }),
    expect.anything(),
  );
  expect(database.store).toHaveBeenCalledWith(
    expect.anything(),
    "document.extraction",
    expect.objectContaining({ status: 504 }),
  );
});

it("keeps manual review available after an unavailable provider", async () => {
  database.load.mockResolvedValue({
    id: "synthetic-version",
    processing_status: "scan_clean",
    doc_type: "emirates_id",
    review_status: "pending_review",
    content_type: "image/png",
    version: 1,
  });
  database.one.mockResolvedValue({ version: 2 });
  const context = {
    deps: { extraction: null, pipelineExecutor: {} },
    companyId: "synthetic-company",
    accountId: "synthetic-account",
    tx: {},
    key: "synthetic-command",
  } as unknown as RequestContext;
  expect(await extractDocument(context)).toMatchObject({
    status: 503,
    body: { code: "EXTRACTION_UNAVAILABLE" },
  });
  expect(database.one).toHaveBeenCalledWith(
    expect.anything(),
    expect.stringContaining("update doc.document_version"),
    expect.objectContaining({
      status: "extraction_failed",
      reason: "provider_unavailable",
    }),
  );
  expect(database.audit).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      type: "document_version.extracting",
      reason: "provider_unavailable",
    }),
  );
});
