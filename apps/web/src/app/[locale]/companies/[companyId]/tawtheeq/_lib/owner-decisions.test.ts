import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  MOCK_ACCOUNTS,
  MOCK_ACCOUNT_IDS,
  MOCK_COMPANY_A_ID,
} from "@/lib/api/mock-fixtures";
import { auditStore, resetAuditStores } from "../../audit/_lib/mock-store";
import { createMockClient } from "./mock-client";
import { mockRecordIds } from "./fixtures";
import { resetSyntheticStore } from "./mock-store";
import { ownerReapprovalSchema, type TawtheeqRecord } from "./schemas";
function ownerClient(handle = "owner-1"): ReturnType<typeof createMockClient> {
  const context = MOCK_ACCOUNTS.find((a) => a.handle === handle)?.contexts.find(
    (c) => c.companyId === MOCK_COMPANY_A_ID,
  );
  if (!context) throw new Error("Missing fixture");
  return createMockClient(MOCK_COMPANY_A_ID, `session-${handle}`, context);
}
async function adopt(): Promise<TawtheeqRecord> {
  const manager = createMockClient(MOCK_COMPANY_A_ID, "manager-session");
  const before = await manager.getRecord(mockRecordIds.differences);
  if (!before.ok) throw new Error("Missing fixture");
  const result = await manager.submitResolutions(
    before.value.id,
    {
      expectedVersion: before.value.version,
      choices: before.value.discrepancies.map((d) => ({
        discrepancyId: d.id,
        kind: d.class === "material" ? "adopt" : "mark_equivalent",
        basis: "formatting",
        reason: "Synthetic resolution",
      })),
    },
    randomUUID(),
  );
  if (!result.ok) throw new Error("Adoption failed");
  return result.value;
}
beforeEach(() => {
  resetSyntheticStore();
  resetAuditStores();
});
describe("owner decisions", () => {
  it("AC-6 approves in the named owner's separate session, updates the manager and records the owner actor", async () => {
    const pending = await adopt();
    const owner = ownerClient();
    expect(await owner.getRecord(pending.id)).toMatchObject({
      ok: true,
      value: {
        workflowState: "awaiting_owner_reapproval",
        contract: { annualRentFils: 7000000 },
      },
    });
    const key = randomUUID();
    const approved = await owner.ownerReapproval(
      pending.id,
      { expectedVersion: pending.version, decision: "approve" },
      key,
    );
    expect(approved).toMatchObject({
      ok: true,
      value: {
        workflowState: "registered",
        contract: { annualRentFils: 7200000, versionNo: 2 },
      },
    });
    expect(
      await owner.ownerReapproval(
        pending.id,
        { expectedVersion: pending.version, decision: "approve" },
        key,
      ),
    ).toEqual(approved);
    expect(
      await createMockClient(MOCK_COMPANY_A_ID, "manager-session").getRecord(
        pending.id,
      ),
    ).toMatchObject({
      ok: true,
      value: {
        workflowState: "registered",
        contract: { annualRentFils: 7200000 },
      },
    });
    expect(auditStore("manager-session").events.at(-1)?.actor?.accountId).toBe(
      MOCK_ACCOUNT_IDS["owner-1"],
    );
  });
  it("AC-6 refuses a missing return reason and preserves the prior version on return", async () => {
    const pending = await adopt();
    const owner = ownerClient();
    expect(
      ownerReapprovalSchema.safeParse({
        expectedVersion: pending.version,
        decision: "return",
        reason: "  ",
      }).success,
    ).toBe(false);
    expect(
      await owner.ownerReapproval(
        pending.id,
        { expectedVersion: pending.version, decision: "return" },
        randomUUID(),
      ),
    ).toMatchObject({ ok: false, error: { domainCode: "REASON_REQUIRED" } });
    expect(
      await owner.ownerReapproval(
        pending.id,
        {
          expectedVersion: pending.version,
          decision: "return",
          reason: "Synthetic rent returned for correction",
        },
        randomUUID(),
      ),
    ).toMatchObject({
      ok: true,
      value: {
        workflowState: "awaiting_registration",
        contract: { annualRentFils: 7000000, versionNo: 1 },
        returnReason: "Synthetic rent returned for correction",
      },
    });
  });
  it("refuses another owner, manager impersonation and stale owner decisions", async () => {
    const pending = await adopt();
    const manager = createMockClient(MOCK_COMPANY_A_ID, "manager-session");
    expect(
      await manager.ownerReapproval(
        pending.id,
        { expectedVersion: pending.version, decision: "approve" },
        randomUUID(),
      ),
    ).toMatchObject({ ok: false, error: { code: "NOT_PERMITTED" } });
    const other = ownerClient("owner-2");
    const otherRecord = await other.getRecord(pending.id);
    if (!otherRecord.ok) throw new Error("Missing fixture");
    expect(
      await other.ownerReapproval(
        pending.id,
        { expectedVersion: otherRecord.value.version, decision: "approve" },
        randomUUID(),
      ),
    ).toMatchObject({ ok: false, error: { code: "NOT_PERMITTED" } });
    expect(
      await ownerClient().ownerReapproval(
        pending.id,
        { expectedVersion: pending.version - 1, decision: "approve" },
        randomUUID(),
      ),
    ).toMatchObject({ ok: false, error: { domainCode: "STALE_VERSION" } });
  });
  it("gated skip confirmation permits a subsequent manager skip without marking it skipped early", async () => {
    const manager = createMockClient(MOCK_COMPANY_A_ID, "manager-session");
    const request = await manager.skip(
      mockRecordIds.identity,
      {
        expectedVersion: 1,
        reason: "Synthetic gated skip",
        requestOwnerConfirmation: true,
      },
      randomUUID(),
    );
    expect(request).toMatchObject({
      ok: true,
      value: { workflowState: "awaiting_registration" },
    });
    const confirmed = await ownerClient().skipConfirmation(
      mockRecordIds.identity,
      { decision: "approve" },
      randomUUID(),
    );
    if (!confirmed.ok) throw new Error("Confirmation failed");
    expect(confirmed.value.workflowState).toBe("awaiting_registration");
    expect(
      await manager.skip(
        mockRecordIds.identity,
        {
          expectedVersion: confirmed.value.version,
          reason: "Synthetic gated skip",
        },
        randomUUID(),
      ),
    ).toMatchObject({ ok: true, value: { workflowState: "skipped" } });
  });
});
