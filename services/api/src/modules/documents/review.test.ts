import { randomUUID } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import { companyId, personAccountId } from "./domain";
import type { Row } from "./database";
import { decideField } from "./review";
import type { RequestContext, J3Dependencies } from "./context";
import { catalogue } from "../extraction/fields";

function context(
  options: {
    readonly value?: string | null;
    readonly confidence?: number;
    readonly extraction?: boolean;
    readonly existing?: number;
    readonly field?: string;
  } = {},
): RequestContext {
  const company = companyId.parse(randomUUID());
  const account = personAccountId.parse(randomUUID());
  const version = randomUUID();
  const document = randomUUID();
  const field = options.field ?? "id_number";
  const fields = Object.fromEntries(
    catalogue.map(({ name }) => [
      name,
      {
        value:
          name === field
            ? options.value === undefined
              ? "784197848291635"
              : options.value
            : null,
        confidence: options.confidence ?? 1,
        page: 1,
        evidence: "Synthetic evidence",
      },
    ]),
  );
  const tx = {
    execute: vi.fn((sql: string) => {
      let result: Row[] = [];
      if (sql.includes("select v.*"))
        result = [
          {
            id: version,
            document_id: document,
            subject_id: randomUUID(),
            doc_type: "emirates_id",
            processing_status:
              options.extraction === false ? "extraction_failed" : "extracted",
            review_status: "pending_review",
          },
        ];
      if (
        sql.includes("select * from doc.field_review") &&
        options.existing !== undefined
      )
        result = [{ version: options.existing }];
      if (sql.includes("select e.*") && options.extraction !== false)
        result = [
          {
            id: randomUUID(),
            model_call_id: randomUUID(),
            registry_entry: "synthetic",
            prompt_version: "document_extraction@1",
            fields,
          },
        ];
      if (sql.includes("insert into doc.field_review"))
        result = [
          {
            id: randomUUID(),
            field_name: field,
            decision: "accepted",
            value: options.value ?? "784197848291635",
            source_viewed: true,
            provenance: "ai_confirmed",
            version: 1,
            created_by: account,
            created_at: "2026-09-28T00:00:00Z",
          },
        ];
      return Promise.resolve({
        rows: result,
        numberOfRecordsUpdated: result.length,
      });
    }),
  };
  const executor = {
    begin: () => Promise.resolve("tx"),
    execute: tx.execute,
    commit: () => Promise.resolve(undefined),
    rollback: () => Promise.resolve(undefined),
  };
  const deps: J3Dependencies = {
    authenticate: () => Promise.resolve({ accountId: account }),
    appExecutor: executor,
    pipelineExecutor: null,
    extraction: null,
    now: () => new Date("2026-09-28T00:00:00Z"),
    randomBytes: (size) => new Uint8Array(size),
    storage: {
      bucket: "synthetic",
      keyPrefix: "",
      head: vi.fn(),
      getBytes: vi.fn(),
      presignGet: vi.fn(),
      presignPut: vi.fn(),
      putReceipt: vi.fn(),
      scanStatus: vi.fn(),
    },
  };
  return {
    tx,
    deps,
    companyId: company,
    accountId: account,
    actor: {
      account_id: account,
      company_id: company,
      roles: ["manager"],
      tenant_ids: [],
      owner_ids: [],
      technician_profile_id: null,
    },
    params: {
      companyId: company,
      documentId: document,
      versionId: version,
      fieldName: field,
    },
    key: randomUUID(),
  };
}
describe("Field review rules", () => {
  it("acceptance copies the stored suggestion and ignores client identity text", async () => {
    const ctx = context();
    await decideField(ctx, {
      decision: "accepted",
      value: "client value must be ignored",
      sourceViewed: true,
      expectedVersion: null,
    });
    expect(vi.spyOn(ctx.tx, "execute")).toHaveBeenCalledWith(
      expect.stringContaining("insert into doc.field_review"),
      expect.arrayContaining([{ name: "value", value: "784197848291635" }]),
    );
  });
  it("acceptance requires source viewing for uncertain confirmation fields", async () => {
    const ctx = context({ confidence: 0.5 });
    await expect(
      decideField(ctx, {
        decision: "accepted",
        sourceViewed: false,
        expectedVersion: null,
      }),
    ).rejects.toMatchObject({ status: 422, code: "SOURCE_NOT_VIEWED" });
  });
  it("null suggestions cannot be accepted", async () => {
    await expect(
      decideField(context({ value: null }), {
        decision: "accepted",
        sourceViewed: true,
        expectedVersion: null,
      }),
    ).rejects.toMatchObject({ status: 422, code: "NOTHING_TO_ACCEPT" });
  });
  it.each([null, 0])(
    "an existing decision refuses expectedVersion %s",
    async (expectedVersion) => {
      await expect(
        decideField(context({ existing: 1 }), {
          decision: "edited",
          value: "784197848291635",
          sourceViewed: true,
          expectedVersion,
        }),
      ).rejects.toMatchObject({ status: 409, code: "STALE_VERSION" });
    },
  );
  it("manual edits persist human_entered provenance", async () => {
    const ctx = context({ extraction: false });
    await decideField(ctx, {
      decision: "edited",
      value: "٧٨٤-١٩٧٨-٤٨٢٩١٦٣-٥",
      sourceViewed: true,
      expectedVersion: null,
    });
    expect(vi.spyOn(ctx.tx, "execute")).toHaveBeenCalledWith(
      expect.stringContaining("insert into doc.field_review"),
      expect.arrayContaining([
        { name: "provenance", value: "human_entered" },
        { name: "value", value: "784197848291635" },
      ]),
    );
  });
  it("not_on_document stores null and confirms a null extraction value", async () => {
    const ctx = context({ value: null });
    await decideField(ctx, {
      decision: "not_on_document",
      value: "ignored",
      sourceViewed: false,
      expectedVersion: null,
    });
    expect(vi.spyOn(ctx.tx, "execute")).toHaveBeenCalledWith(
      expect.stringContaining("insert into doc.field_review"),
      expect.arrayContaining([
        { name: "value", value: null },
        { name: "provenance", value: "ai_confirmed" },
      ]),
    );
  });
});
