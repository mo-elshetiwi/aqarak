import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { MOCK_COMPANY_A_ID, MOCK_COMPANY_B_ID } from "@/lib/api/mock-fixtures";
import { createAuditMockClient, csvCell } from "./mock-client";
import {
  auditStore,
  resetAuditStores,
  tamperSyntheticChain,
} from "./mock-store";
beforeEach(resetAuditStores);
describe("synthetic audit chain", () => {
  it("pages newest first without overlap and filters actor, record, initiator and refusals", async () => {
    const client = createAuditMockClient(MOCK_COMPANY_A_ID, "test");
    const first = await client.events({ limit: 2 });
    if (!first.ok || first.value.nextCursor === null)
      throw new Error("Missing first page");
    expect(first.value.events.map((e) => e.seq)).toEqual([8, 7]);
    const next = await client.events({
      limit: 2,
      afterSeq: first.value.nextCursor,
    });
    expect(next).toMatchObject({
      ok: true,
      value: { events: [{ seq: 6 }, { seq: 5 }] },
    });
    const refusal = auditStore("test").events.find((e) => e.refused);
    if (!refusal?.actor) throw new Error("Missing refusal");
    expect(
      await client.events({
        refusalsOnly: "true",
        subjectId: refusal.subject.id,
        actorAccountId: refusal.actor.accountId,
        initiator: "person",
      }),
    ).toEqual({ ok: true, value: { events: [refusal], nextCursor: null } });
    expect(await client.events({ initiator: "scheduler" })).toEqual({
      ok: true,
      value: { events: [], nextCursor: null },
    });
  });
  it("AC-2 recomputes the chain, retains anchors and detects row tampering at sequence 7", async () => {
    const client = createAuditMockClient(MOCK_COMPANY_A_ID, "test");
    expect(await client.verify("verify")).toMatchObject({
      ok: true,
      value: { ok: true, firstSeq: 1, lastSeq: 8, eventCount: 8, anchor: null },
    });
    const anchor = await client.anchor("anchor");
    expect(await client.anchor("anchor")).toEqual(anchor);
    expect(await client.verify("again")).toMatchObject({
      ok: true,
      value: { ok: true, anchor: { seq: 9 } },
    });
    tamperSyntheticChain("test");
    expect(await client.verify("tampered")).toMatchObject({
      ok: true,
      value: {
        ok: false,
        recomputed: { break: { seq: 7, kind: "row_hash_mismatch" } },
      },
    });
  });
  it("isolates companies and escapes CSV formulas and quotes", async () => {
    expect(
      await createAuditMockClient(MOCK_COMPANY_B_ID, "test").events({}),
    ).toMatchObject({ ok: false, error: { code: "NOT_PERMITTED" } });
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell("line\nnext")).toBe('"line\nnext"');
  });
});
