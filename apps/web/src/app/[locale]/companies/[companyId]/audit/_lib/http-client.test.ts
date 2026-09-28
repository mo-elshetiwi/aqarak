import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { MOCK_COMPANY_A_ID } from "@/lib/api/mock-fixtures";
import { createAuditHttpClient } from "./http-client";
import { auditStore, verifySynthetic } from "./mock-store";
const company = MOCK_COMPANY_A_ID;
const session = "synthetic-session";
describe("AC-8 audit HTTP contract", () => {
  afterEach(() => vi.restoreAllMocks());
  it("parses events and strips unknown keys at nested boundaries", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const event = auditStore("http-test").events[0];
    if (!event) throw new Error("Missing fixture");
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        events: [
          {
            ...event,
            unexpected: true,
            subject: { ...event.subject, unexpected: true },
          },
        ],
        nextCursor: 3,
        unexpected: true,
      }),
    );
    const result = await createAuditHttpClient(
      "http://localhost:4000",
      company,
      session,
      transport,
    ).events({
      refusalsOnly: "true",
      afterSeq: 9,
      actorAccountId: event.actor?.accountId,
    });
    expect(result).toEqual({
      ok: true,
      value: { events: [event], nextCursor: 3 },
    });
    expect(transport.mock.calls[0]?.[0]).toContain(
      "refusalsOnly=true&afterSeq=9",
    );
    expect(transport.mock.calls[0]?.[1]).toMatchObject({
      cache: "no-store",
      redirect: "error",
      method: "GET",
      headers: { Authorization: `Session ${session}` },
    });
    expect(transport.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    expect(timeout).toHaveBeenLastCalledWith(10_000);
  });
  it("parses nullable covering events and unknown snapshot values", async () => {
    const store = auditStore("versions-http");
    const history = [...store.histories.values()][0];
    if (!history) throw new Error("Missing history");
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        ...history,
        extra: true,
        versions: history.versions.map((v) => ({
          ...v,
          extra: true,
          event: null,
          snapshot: { unknown_field: { nested: true } },
        })),
      }),
    );
    const result = await createAuditHttpClient(
      "http://localhost:4000",
      company,
      session,
      transport,
    ).versions(history.subject.type, history.subject.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).not.toHaveProperty("extra");
      expect(result.value.versions[0]).not.toHaveProperty("extra");
      expect(result.value.versions[0]?.event).toBeNull();
      expect(result.value.versions[0]?.snapshot).toEqual({
        unknown_field: { nested: true },
      });
    }
  });
  it("uses Idempotency-Key on verification and requires 201 for an anchor", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const verification = verifySynthetic(auditStore("verification-http"));
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(verification));
    const client = createAuditHttpClient(
      "http://localhost:4000/",
      company,
      session,
      transport,
    );
    expect(await client.verify("stable-key")).toEqual({
      ok: true,
      value: verification,
    });
    expect(timeout).toHaveBeenLastCalledWith(60_000);
    expect(transport.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: "{}",
      headers: {
        "Idempotency-Key": "stable-key",
        "Content-Type": "application/json",
      },
    });
    const anchor = {
      seq: 8,
      headHash: "a".repeat(64),
      anchoredAt: "2026-09-28T08:00:00Z",
      objectVersionId: "synthetic-v1",
      key: "synthetic",
    };
    transport.mockResolvedValueOnce(
      Response.json({ ...anchor, ignored: true }, { status: 201 }),
    );
    expect(await client.anchor("anchor-key")).toEqual({
      ok: true,
      value: anchor,
    });
    expect(timeout).toHaveBeenLastCalledWith(60_000);
    transport.mockResolvedValueOnce(Response.json(anchor));
    expect(await client.anchor("anchor-key")).toMatchObject({
      ok: false,
      error: { code: "UNAVAILABLE" },
    });
  });
  it("preserves problem code and domainCode without leaking other fields", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          code: "NOT_PERMITTED",
          domainCode: "NOT_NAMED_PARTY",
          secret: "ignored",
        },
        { status: 403 },
      ),
    );
    expect(
      await createAuditHttpClient(
        "http://localhost:4000",
        company,
        session,
        transport,
      ).events({}),
    ).toEqual({
      ok: false,
      error: {
        status: 403,
        code: "NOT_PERMITTED",
        domainCode: "NOT_NAMED_PARTY",
      },
    });
  });
  it.each(["outage", "timeout", "malformed", "status", "redirect"])(
    "maps %s to UNAVAILABLE",
    async (mode) => {
      const transport = vi.fn<typeof fetch>();
      if (mode === "timeout" || mode === "redirect")
        transport.mockRejectedValue(new TypeError(mode));
      else
        transport.mockResolvedValue(
          Response.json(
            mode === "malformed" ? {} : { events: [], nextCursor: null },
            { status: mode === "outage" ? 503 : mode === "status" ? 201 : 200 },
          ),
        );
      expect(
        await createAuditHttpClient(
          "http://localhost:4000",
          company,
          session,
          transport,
        ).events({}),
      ).toEqual({ ok: false, error: { status: 503, code: "UNAVAILABLE" } });
    },
  );
  it("streams CSV and preserves the API filename and filters", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const disposition = 'attachment; filename="audit-company-stamp.csv"';
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("seq,event_type\r\n1,policy.denied\r\n", {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": disposition,
        },
      }),
    );
    const result = await createAuditHttpClient(
      "http://localhost:4000",
      company,
      session,
      transport,
    ).exportCsv({ refusalsOnly: "true" });
    expect(timeout).toHaveBeenLastCalledWith(10_000);
    expect(transport.mock.calls[0]?.[0]).toContain(
      "/audit/export.csv?refusalsOnly=true",
    );
    if (!result.ok) throw new Error("CSV failed");
    expect(result.value.disposition).toBe(disposition);
    expect(await new Response(result.value.body).text()).toContain(
      "policy.denied",
    );
  });
});
