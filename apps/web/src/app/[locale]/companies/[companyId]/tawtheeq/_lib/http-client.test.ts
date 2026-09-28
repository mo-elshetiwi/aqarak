import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createHttpClient } from "./http-client";
import { mockRecordIds, seedRecords } from "./fixtures";
import { MOCK_COMPANY_A_ID } from "@/lib/api/mock-fixtures";
const record = seedRecords()[1];
if (!record) throw new Error("Missing synthetic record");
const sessionId = "synthetic-session";
function response(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}
describe("Tawtheeq HTTP contract", () => {
  afterEach(() => vi.restoreAllMocks());
  it("AC-3 parses a record and strips unknown keys at every object boundary", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        ...record,
        surprise: true,
        contract: { ...record.contract, unknown: "ignored" },
      }),
    );
    const result = await createHttpClient(
      "http://localhost:4000",
      MOCK_COMPANY_A_ID,
      sessionId,
      transport,
    ).getRecord(record.id);
    expect(result).toEqual({ ok: true, value: record });
    expect(timeout).toHaveBeenLastCalledWith(10_000);
    expect(transport.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(transport).toHaveBeenCalledWith(
      `http://localhost:4000/v1/companies/${MOCK_COMPANY_A_ID}/tawtheeq/${record.id}`,
      expect.objectContaining({
        cache: "no-store",
        redirect: "error",
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Session ${sessionId}`,
        },
      }),
    );
  });
  it("AC-3 preserves the 403 problem code and domainCode", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      response(
        {
          code: "NOT_PERMITTED",
          domainCode: "NOT_NAMED_PARTY",
          detail: "ignored",
        },
        403,
      ),
    );
    expect(
      await createHttpClient(
        "http://localhost:4000",
        MOCK_COMPANY_A_ID,
        sessionId,
        transport,
      ).getRecord(record.id),
    ).toEqual({
      ok: false,
      error: {
        status: 403,
        code: "NOT_PERMITTED",
        domainCode: "NOT_NAMED_PARTY",
      },
    });
  });
  it.each(["500", "timeout", "invalid body", "wrong status"])(
    "AC-3 maps %s to UNAVAILABLE",
    async (mode) => {
      const transport = vi.fn<typeof fetch>();
      if (mode === "timeout")
        transport.mockRejectedValue(
          new DOMException("Timeout", "TimeoutError"),
        );
      else
        transport.mockResolvedValue(
          response(
            mode === "invalid body" ? {} : record,
            mode === "500" ? 500 : mode === "wrong status" ? 201 : 200,
          ),
        );
      expect(
        await createHttpClient(
          "http://localhost:4000",
          MOCK_COMPANY_A_ID,
          sessionId,
          transport,
        ).getRecord(record.id),
      ).toEqual({ ok: false, error: { status: 503, code: "UNAVAILABLE" } });
    },
  );
  it("AC-3 sends a stable Idempotency-Key and gives POST commands and extraction sixty seconds", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response(record));
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const client = createHttpClient(
      "http://localhost:4000/",
      MOCK_COMPANY_A_ID,
      sessionId,
      transport,
    );
    await client.attestPortal(
      mockRecordIds.awaiting,
      { expectedVersion: 1 },
      "synthetic-key",
    );
    expect(transport).toHaveBeenLastCalledWith(
      expect.stringContaining("/attest-portal"),
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        redirect: "error",
        headers: {
          Accept: "application/json",
          Authorization: `Session ${sessionId}`,
          "Content-Type": "application/json",
          "Idempotency-Key": "synthetic-key",
        },
        body: '{"expectedVersion":1}',
      }),
    );
    expect(timeout).toHaveBeenLastCalledWith(60_000);
    transport.mockResolvedValue(
      response({
        status: "degraded",
        degradedMode: "manual_entry",
        extractionId: null,
        registryEntry: "synthetic",
        confidenceLabel: "uncalibrated",
        fields: {},
        comparisonPreview: [],
      }),
    );
    expect((await client.runExtraction(record.id, "extraction-key")).ok).toBe(
      true,
    );
    expect(timeout).toHaveBeenLastCalledWith(60_000);
  });
});

it.each([
  [409, "INVALID_TRANSITION", "SCAN_PENDING"],
  [422, "VALIDATION_FAILED", "SCAN_REJECTED"],
  [422, "VALIDATION_FAILED", "CHECKSUM_MISMATCH"],
] as const)(
  "preserves completion outcome %s %s %s",
  async (status, code, domainCode) => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ code, domainCode }, status));
    const client = createHttpClient(
      "http://localhost:4000",
      MOCK_COMPANY_A_ID,
      sessionId,
      transport,
    );
    expect(
      await client.completeUpload(
        record.id,
        "synthetic-document",
        { expectedVersion: record.version },
        "synthetic-complete-key",
      ),
    ).toEqual({ ok: false, error: { status, code, domainCode } });
  },
);
