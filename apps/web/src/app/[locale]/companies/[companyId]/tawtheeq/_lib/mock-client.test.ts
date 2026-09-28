import { createHash, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { MOCK_COMPANY_A_ID, MOCK_COMPANY_B_ID } from "@/lib/api/mock-fixtures";
import { createMockClient } from "./mock-client";
import { acceptObject, mockStore, resetSyntheticStore } from "./mock-store";
import { mockRecordIds } from "./fixtures";
import {
  listSchema,
  recordSchema,
  type ResolutionsInput,
  type ReviewInput,
  type TawtheeqRecord,
  type WorkflowResult,
} from "./schemas";
import { describeUpload, validateFile } from "./upload";
const session = "synthetic-test-session";
function unwrap<T>(result: WorkflowResult<T>): T {
  if (!result.ok) throw new Error(result.error.domainCode ?? result.error.code);
  return result.value;
}
const client = (): ReturnType<typeof createMockClient> =>
  createMockClient(MOCK_COMPANY_A_ID, session);
function choices(
  record: TawtheeqRecord,
  kind: "adopt" | "cancel_and_reregister" = "adopt",
): ResolutionsInput {
  return {
    expectedVersion: record.version,
    choices: record.discrepancies.map((d) => ({
      discrepancyId: d.id,
      kind: d.class === "material" ? kind : "mark_equivalent",
      basis: "formatting",
      reason: "Synthetic review reason",
    })),
  };
}
beforeEach(resetSyntheticStore);
describe("Tawtheeq synthetic workflow", () => {
  it("seeds five schema-valid records and rejects another company", async () => {
    const board = unwrap(await client().listRecords());
    expect(listSchema.safeParse(board).success).toBe(true);
    expect(board.records).toHaveLength(5);
    for (const row of board.records)
      expect(
        recordSchema.safeParse(unwrap(await client().getRecord(row.id)))
          .success,
      ).toBe(true);
    expect(
      await createMockClient(MOCK_COMPANY_B_ID, session).listRecords(),
    ).toMatchObject({ ok: false, error: { status: 403 } });
  });
  it.each([true, false])(
    "adoption respects frozen owner gate %s and preserves prior version until approval",
    async (gate) => {
      const record = mockStore(session).records.get(mockRecordIds.differences);
      if (!record) throw new Error("Missing record");
      record.contract.frozenOwnerGate = gate;
      const next = unwrap(
        await client().submitResolutions(
          record.id,
          choices(record),
          randomUUID(),
        ),
      );
      expect(next.workflowState).toBe(
        gate ? "awaiting_owner_reapproval" : "registered",
      );
      expect(next.contract.versionNo).toBe(gate ? 1 : 2);
      expect(next.contract.annualRentFils).toBe(gate ? 7_000_000 : 7_200_000);
      expect(next.adoption?.changedFields).toEqual({
        annual_rent_fils: 7_200_000,
      });
    },
  );
  it("replays a double submit and rejects changed payloads and stale versions", async () => {
    const record = unwrap(await client().getRecord(mockRecordIds.differences));
    const key = randomUUID();
    const input = choices(record);
    const first = await client().submitResolutions(record.id, input, key);
    expect(await client().submitResolutions(record.id, input, key)).toEqual(
      first,
    );
    expect(
      await client().submitResolutions(
        record.id,
        { ...input, choices: [] },
        key,
      ),
    ).toMatchObject({
      ok: false,
      error: { domainCode: "IDEMPOTENCY_CONFLICT" },
    });
    expect(
      await client().submitResolutions(record.id, input, randomUUID()),
    ).toMatchObject({ ok: false, error: { domainCode: "STALE_VERSION" } });
  });
  it("rejects amount equivalence and incomplete choices; cancellation returns to registration", async () => {
    const record = unwrap(await client().getRecord(mockRecordIds.differences));
    const input = choices(record);
    expect(
      await client().submitResolutions(
        record.id,
        { ...input, choices: [] },
        randomUUID(),
      ),
    ).toMatchObject({
      ok: false,
      error: { domainCode: "DISCREPANCIES_UNRESOLVED" },
    });
    expect(
      await client().submitResolutions(
        record.id,
        {
          ...input,
          choices: input.choices.map((c) => ({
            ...c,
            kind: "mark_equivalent",
          })),
        },
        randomUUID(),
      ),
    ).toMatchObject({
      ok: false,
      error: { domainCode: "MARK_EQUIVALENT_NOT_ALLOWED" },
    });
    expect(
      unwrap(
        await client().submitResolutions(
          record.id,
          choices(record, "cancel_and_reregister"),
          randomUUID(),
        ),
      ).workflowState,
    ).toBe("awaiting_registration");
  });
  it("attests, records portal return, requests skip confirmation and resumes a skipped record", async () => {
    const api = client();
    const id = mockRecordIds.awaiting;
    const gated = mockStore(session).records.get(id);
    if (gated) gated.contract.frozenOwnerGate = true;
    const submitted = unwrap(
      await api.attestPortal(id, { expectedVersion: 1 }, randomUUID()),
    );
    expect(submitted.workflowState).toBe("submitted_on_portal");
    const returned = unwrap(
      await api.portalReturn(
        id,
        {
          expectedVersion: submitted.version,
          reason: "Synthetic portal return",
        },
        randomUUID(),
      ),
    );
    expect(returned.returnReason).toBe("Synthetic portal return");
    expect(
      await api.skip(
        id,
        { expectedVersion: returned.version, reason: "Synthetic skip" },
        randomUUID(),
      ),
    ).toMatchObject({
      ok: false,
      error: { domainCode: "OWNER_CONFIRMATION_REQUIRED" },
    });
    const pending = unwrap(
      await api.skip(
        id,
        {
          expectedVersion: returned.version,
          reason: "Synthetic skip",
          requestOwnerConfirmation: true,
        },
        randomUUID(),
      ),
    );
    expect(pending.workflowState).toBe("awaiting_registration");
    expect(pending.skipReason).toBe("Synthetic skip");
    expect(
      unwrap(
        await api.resume(
          mockRecordIds.skipped,
          { expectedVersion: 1 },
          randomUUID(),
        ),
      ).workflowState,
    ).toBe("awaiting_registration");
  });
  it("checks file types, size, SHA-256 and source bytes before extraction and review", async () => {
    expect(
      validateFile({
        name: "synthetic.exe",
        type: "application/octet-stream",
        size: 8,
      }),
    ).toBe(false);
    expect(
      validateFile({
        name: "synthetic.png",
        type: "image/png",
        size: 20 * 1024 * 1024 + 1,
      }),
    ).toBe(false);
    const file = new File(
      [new Uint8Array([137, 80, 78, 71, 1, 2, 3])],
      "synthetic.png",
      { type: "image/png" },
    );
    const input = await describeUpload(file);
    expect(input.sha256).toBe(
      createHash("sha256")
        .update(Buffer.from(await file.arrayBuffer()))
        .digest("hex"),
    );
    const api = client();
    const upload = unwrap(
      await api.requestUpload(mockRecordIds.awaiting, input, randomUUID()),
    );
    const object = mockStore(session).objects.get(upload.documentVersionId);
    if (!object) throw new Error("Missing object");
    expect(acceptObject(object, new Uint8Array([0]))).toBe(false);
    expect(acceptObject(object, new Uint8Array(await file.arrayBuffer()))).toBe(
      true,
    );
    const reviewed = unwrap(
      await api.completeUpload(
        mockRecordIds.awaiting,
        upload.documentVersionId,
        { expectedVersion: 1 },
        randomUUID(),
      ),
    );
    expect(reviewed.workflowState).toBe("under_review");
    const extraction = unwrap(
      await api.runExtraction(reviewed.id, randomUUID()),
    );
    expect(extraction.confidenceLabel).toBe("uncalibrated");
    const fields = Object.fromEntries(
      Object.entries(extraction.fields).map(([key, value]) => [
        key,
        { value: value.value, provenance: "extracted" },
      ]),
    );
    const payload = {
      expectedVersion: reviewed.version,
      documentVersionId: upload.documentVersionId,
      extractionId: extraction.extractionId,
      fields,
    } as ReviewInput;
    const registered = unwrap(
      await api.submitReview(reviewed.id, payload, randomUUID()),
    );
    expect(registered.workflowState).toBe("registered");
    expect(registered.comparison.every((r) => r.status === "match")).toBe(true);
  });
  it("rejects a certificate whose reviewed tenant identity differs", async () => {
    const r = mockStore(session).records.get(mockRecordIds.identity);
    if (!r?.document) throw new Error("Missing fixture");
    r.workflowState = "under_review";
    r.document.reviewStatus = "pending_review";
    const result = await client().submitReview(
      r.id,
      {
        expectedVersion: r.version,
        documentVersionId: r.document.documentVersionId,
        extractionId: null,
        fields: {
          tawtheeq_number: { value: "SYNTHETIC", provenance: "manual" },
          registered_on: { value: "2026-09-28", provenance: "manual" },
          unt_number: { value: "UNT-SYNTHETIC-107", provenance: "manual" },
          owner_id_number: {
            value: "784-0000-0000001-1",
            provenance: "manual",
          },
          tenant_id_number: {
            value: "784-0000-0000099-9",
            provenance: "manual",
          },
        },
      },
      randomUUID(),
    );
    const next = unwrap(result);
    expect(next.workflowState).toBe("awaiting_registration");
    expect(next.document?.reviewStatus).toBe("rejected");
    expect(next.allowedActions).toContain("upload");
  });
});

it("returns degraded extraction for a PDF and preserves scan rejection state", async () => {
  const api = client();
  for (const [contentType, content, id] of [
    ["application/pdf", "%PDF-synthetic", mockRecordIds.awaiting],
    ["image/png", "synthetic invalid signature", mockRecordIds.identity],
  ] as const) {
    const file = new File([content], "synthetic-certificate", {
      type: contentType,
    });
    const upload = unwrap(
      await api.requestUpload(id, await describeUpload(file), randomUUID()),
    );
    const object = mockStore(session).objects.get(upload.documentVersionId);
    if (!object) throw new Error("Missing object");
    expect(acceptObject(object, new Uint8Array(await file.arrayBuffer()))).toBe(
      true,
    );
    const before = unwrap(await api.getRecord(id));
    const result = await api.completeUpload(
      id,
      upload.documentVersionId,
      { expectedVersion: 1 },
      randomUUID(),
    );
    if (contentType === "application/pdf") {
      expect(result.ok).toBe(true);
      expect(unwrap(await api.runExtraction(id, randomUUID()))).toMatchObject({
        status: "degraded",
        extractionId: null,
        fields: {},
      });
    } else {
      expect(result).toMatchObject({
        ok: false,
        error: { domainCode: "SCAN_REJECTED" },
      });
      expect(unwrap(await api.getRecord(id))).toEqual(before);
    }
  }
});

it("compares decimal AED without binary rounding drift", async () => {
  const record = mockStore(session).records.get(mockRecordIds.identity);
  if (!record?.document) throw new Error("Missing fixture");
  record.workflowState = "under_review";
  record.document.reviewStatus = "pending_review";
  record.contract.annualRentFils = 29;
  const result = unwrap(
    await client().submitReview(
      record.id,
      {
        expectedVersion: record.version,
        documentVersionId: record.document.documentVersionId,
        extractionId: null,
        fields: {
          tawtheeq_number: { value: "SYNTHETIC", provenance: "manual" },
          registered_on: { value: "2026-09-28", provenance: "manual" },
          unt_number: { value: "UNT-SYNTHETIC-107", provenance: "manual" },
          owner_id_number: {
            value: "784-0000-0000001-1",
            provenance: "manual",
          },
          tenant_id_number: {
            value: "784-0000-0000002-2",
            provenance: "manual",
          },
          annual_rent_fils: { value: "0.29", provenance: "manual" },
        },
      },
      randomUUID(),
    ),
  );
  expect(
    result.comparison.find((row) => row.field === "annual_rent_fils"),
  ).toMatchObject({ status: "match", contractValue: 29, registeredValue: 29 });
});

it("keeps the first pending completion unchanged, replays it and completes with a new key", async () => {
  const api = client();
  const id = mockRecordIds.awaiting;
  const before = unwrap(await api.getRecord(id));
  const file = new File(["%PDF-synthetic"], "synthetic-pending.pdf", {
    type: "application/pdf",
  });
  const upload = unwrap(
    await api.requestUpload(id, await describeUpload(file), randomUUID()),
  );
  const object = mockStore(session).objects.get(upload.documentVersionId);
  if (!object) throw new Error("Missing object");
  expect(acceptObject(object, new Uint8Array(await file.arrayBuffer()))).toBe(
    true,
  );
  const key = randomUUID();
  const pending = await api.completeUpload(
    id,
    object.id,
    { expectedVersion: before.version },
    key,
  );
  expect(pending).toEqual({
    ok: false,
    error: {
      status: 409,
      code: "INVALID_TRANSITION",
      domainCode: "SCAN_PENDING",
    },
  });
  expect(unwrap(await api.getRecord(id))).toEqual(before);
  expect(
    await api.completeUpload(
      id,
      object.id,
      { expectedVersion: before.version },
      key,
    ),
  ).toEqual(pending);
  expect(object.completionAttempts).toBe(1);
  const clean = unwrap(
    await api.completeUpload(
      id,
      object.id,
      { expectedVersion: before.version },
      randomUUID(),
    ),
  );
  expect(clean.workflowState).toBe("under_review");
  expect(clean.version).toBe(before.version + 1);
  expect(clean.document?.processingStatus).toBe("scan_clean");
});

it("refuses a changed checksum at completion without changing the record", async () => {
  const api = client();
  const id = mockRecordIds.awaiting;
  const before = unwrap(await api.getRecord(id));
  const file = new File(["%PDF-synthetic"], "synthetic.pdf", {
    type: "application/pdf",
  });
  const upload = unwrap(
    await api.requestUpload(id, await describeUpload(file), randomUUID()),
  );
  const object = mockStore(session).objects.get(upload.documentVersionId);
  if (!object) throw new Error("Missing object");
  expect(acceptObject(object, new Uint8Array(await file.arrayBuffer()))).toBe(
    true,
  );
  object.bytes = new Uint8Array([0]);
  expect(
    await api.completeUpload(
      id,
      object.id,
      { expectedVersion: before.version },
      randomUUID(),
    ),
  ).toEqual({
    ok: false,
    error: {
      status: 422,
      code: "VALIDATION_FAILED",
      domainCode: "CHECKSUM_MISMATCH",
    },
  });
  expect(unwrap(await api.getRecord(id))).toEqual(before);
});
