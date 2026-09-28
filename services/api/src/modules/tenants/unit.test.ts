import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { describe, it, expect, vi } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
import type { DataApiExecutor } from "@aqarak/db/data-api";
import { createTenantsModule, tenantsModule } from ".";
import { createDocumentsModule, documentsModule } from "../documents";
import type { ApiModule } from "..";
import type { J3Dependencies } from "../documents/context";
import { createS3Storage } from "../documents/s3-storage";
import {
  evidenceConfidence,
  mapFields,
  catalogue,
  presentedFields,
  validateField,
} from "../extraction/fields";
import { checklistStatus, dubaiDate } from "./read";

function mount(modules: readonly ApiModule[]): Hono {
  const app = new Hono();
  for (const module of modules) {
    const child = new Hono();
    module.register(child);
    app.route(module.basePath, child);
  }
  return app;
}
function fakeDependencies(): J3Dependencies {
  const executor: DataApiExecutor = {
    begin: vi.fn(() => Promise.resolve("tx")),
    execute: vi.fn(() =>
      Promise.resolve({ rows: [], numberOfRecordsUpdated: 0 }),
    ),
    commit: vi.fn(() => Promise.resolve(undefined)),
    rollback: vi.fn(() => Promise.resolve(undefined)),
  };
  return {
    authenticate: () => Promise.resolve(null),
    appExecutor: executor,
    pipelineExecutor: null,
    extraction: null,
    now: () => new Date("2026-09-28T00:00:00Z"),
    randomBytes: (size) => new Uint8Array(size),
    storage: {
      bucket: "synthetic",
      keyPrefix: "test/tenants/",
      presignPut: vi.fn(),
      head: vi.fn(),
      scanStatus: vi.fn(),
      getBytes: vi.fn(),
      putReceipt: vi.fn(),
      presignGet: vi.fn(),
    },
  };
}
const company = randomUUID();
const tenant = randomUUID();
const document = randomUUID();
const version = randomUUID();
const base = `/v1/companies/${company}`;
const documentPath = `${base}/documents/${document}/versions/${version}`;
const endpoints = [
  ["POST", `${base}/tenants`],
  ["GET", `${base}/tenants`],
  ["GET", `${base}/tenants/${tenant}`],
  ["POST", `${base}/tenants/${tenant}/invitations`],
  ["POST", `${base}/tenants/${tenant}/identity`],
  ["POST", `${base}/documents`],
  ["POST", `${documentPath}/upload-complete`],
  ["POST", `${documentPath}/extraction`],
  ["GET", documentPath],
  ["GET", `${documentPath}/content`],
  ["PUT", `${documentPath}/fields/name_en`],
  ["POST", `${documentPath}/reject`],
] as const;
describe("Tenant onboarding boundary", () => {
  it.each(endpoints)(
    "U-1 unauthenticated %s %s executes no statement",
    async (method, path) => {
      const deps = fakeDependencies();
      const app = mount([
        createTenantsModule(deps),
        createDocumentsModule(deps),
      ]);
      const response = await app.request(path, { method });
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "SESSION_INVALID" });
      expect(deps.appExecutor.begin).not.toHaveBeenCalled();
      expect(deps.appExecutor.execute).not.toHaveBeenCalled();
    },
  );
  it.each(endpoints)(
    "U-6 production composition refuses %s %s",
    async (method, path) => {
      const response = await mount([tenantsModule, documentsModule]).request(
        path,
        { method, headers: { "X-Account-Id": randomUUID() } },
      );
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "SESSION_INVALID" });
    },
  );
  it("U-4 mounted company parameter reaches the transaction", async () => {
    const original = fakeDependencies();
    const account = randomUUID();
    const deps = {
      ...original,
      authenticate: () => Promise.resolve({ accountId: account }),
    };
    const response = await mount([createTenantsModule(deps)]).request(
      `${base}/tenants`,
    );
    expect(response.status).toBe(404);
    expect(deps.appExecutor.execute).toHaveBeenCalledWith(
      expect.stringContaining("set_config('app.company_id'"),
      expect.arrayContaining([
        { name: "company_id", value: company },
        { name: "account_id", value: account },
      ]),
      "tx",
    );
  });
  it("400 malformed command and missing idempotency key write nothing", async () => {
    const deps = {
      ...fakeDependencies(),
      authenticate: () => Promise.resolve({ accountId: randomUUID() }),
    };
    const response = await mount([createTenantsModule(deps)]).request(
      `${base}/tenants`,
      { method: "POST", body: "{}" },
    );
    expect(response.status).toBe(400);
    expect(deps.appExecutor.begin).not.toHaveBeenCalled();
  });
});
describe("Extraction evidence", () => {
  it.each([
    ["id_number", "784-1978-4829163-5", "ID 784-1978-4829163-5", 1],
    ["expiry_date", "2029-11-22", "Expiry 22/11/2029", 1],
    ["id_number", "784197848291635", "٧٨٤-١٩٧٨-٤٨٢٩١٦٣-٥", 1],
    ["expiry_date", "2029-11-22", "Expiry ۲۲/۱۱/۲۰۲۹", 1],
    ["name_en", "Synthetic Example", "Different name", 0.5],
    ["name_ar", null, null, 0],
  ] as const)("U-2 %s evidence score", (name, value, evidence, expected) => {
    expect(evidenceConfidence(name, value, evidence)).toBe(expected);
  });
  it("U-3 stored fields have exactly four keys and null evidence becomes empty", () => {
    const fields = Object.fromEntries(
      catalogue.map(({ name }) => [
        name,
        { value: null, evidence: null, null_reason: "absent" },
      ]),
    );
    const mapped = mapFields({ fields });
    for (const field of Object.values(mapped))
      expect(field).toEqual({
        value: null,
        confidence: 0,
        page: 1,
        evidence: "",
      });
    const presented = presentedFields(mapped);
    expect(presented.map((f) => f.name)).toEqual(catalogue.map((f) => f.name));
    expect(presented.find((f) => f.name === "id_number")).toMatchObject({
      category: "confirm",
      requiresSourceCheck: true,
    });
    expect(presented.find((f) => f.name === "name_en")).toMatchObject({
      category: "check",
      requiresSourceCheck: false,
    });
  });
  it("edited fields reject impossible dates and short identity numbers", () => {
    expect(() => validateField("expiry_date", "2029-02-29")).toThrow(
      "FIELD_INVALID",
    );
    expect(() => validateField("id_number", "12345678901234")).toThrow(
      "FIELD_INVALID",
    );
    expect(validateField("id_number", "٧٨٤-١٩٧٨-٤٨٢٩١٦٣-٥")).toBe(
      "784197848291635",
    );
  });
});
it("U-5 presigned PUT signs content type, length and unhoisted raw digest", async () => {
  const storage = createS3Storage({
    client: new S3Client({
      region: "us-east-1",
      credentials: {
        accessKeyId: "synthetic-access-key",
        secretAccessKey: "synthetic-signing-key",
      },
    }),
    bucket: "synthetic",
    keyPrefix: "test/tenants/",
    now: () => new Date("2026-09-28T00:00:00Z"),
  });
  const result = await storage.presignPut({
    bucket: "synthetic",
    key: "synthetic.jpg",
    contentType: "image/jpeg",
    byteSize: 10240,
    sha256: "ab".repeat(32),
  });
  const url = new URL(result.url);
  expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toEqual(
    expect.arrayContaining([
      "content-type",
      "content-length",
      "x-amz-checksum-sha256",
    ]),
  );
  expect(url.searchParams.has("x-amz-checksum-sha256")).toBe(false);
  expect(result.headers["x-amz-checksum-sha256"]).toBe(
    Buffer.from("ab".repeat(32), "hex").toString("base64"),
  );
  expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
});
it("checklist uses Dubai midnight and all pending and expired states", () => {
  expect(dubaiDate(new Date("2026-09-27T20:00:00Z"))).toBe("2026-09-28");
  expect(checklistStatus(undefined, "2026-09-28")).toBe("missing");
  expect(
    checklistStatus(
      {
        latest_version_id: version,
        review_status: "accepted",
        expiry_date: "2026-09-27",
      },
      "2026-09-28",
    ),
  ).toBe("expired");
  expect(
    checklistStatus(
      {
        latest_version_id: version,
        review_status: "accepted",
        expiry_date: null,
      },
      "2026-09-28",
    ),
  ).toBe("accepted");
  expect(
    checklistStatus(
      {
        latest_version_id: version,
        review_status: "pending_review",
        processing_status: "extraction_failed",
      },
      "2026-09-28",
    ),
  ).toBe("pending_review");
});
