import { randomBytes, randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { demoDraft, runContractSmoke } from "../scripts/smoke";
import type { DemoIds } from "../scripts/seed-demo";
const ids: DemoIds = {
  companyId: randomUUID(),
  manager: randomUUID(),
  owner: randomUUID(),
  tenant: randomUUID(),
  tenantId: randomUUID(),
  ownerId: randomUUID(),
  unitId: randomUUID(),
  propertyId: randomUUID(),
  mandateId: randomUUID(),
};
it("builds four quarterly synthetic cheques with an exact total across a year boundary", () => {
  const draft = demoDraft(ids, new Date("2026-12-15T00:00:00Z"));
  expect(draft.termStart).toBe("2027-01-01");
  expect(draft.termEnd).toBe("2027-12-31");
  expect(draft.instalments.map((i) => i.dueOn)).toEqual([
    "2027-01-01",
    "2027-04-01",
    "2027-07-01",
    "2027-10-01",
  ]);
  expect(draft.instalments.reduce((sum, i) => sum + i.amountFils, 0)).toBe(
    draft.totalFils,
  );
  expect(
    draft.instalments.every((i) => i.cheque?.bankName.endsWith("(synthetic)")),
  ).toBe(true);
});
it("uses the manager session and stops at an unexpected HTTP status", async () => {
  const token = randomBytes(32).toString("base64url");
  const sessions = Object.fromEntries(
    [ids.manager, ids.owner, ids.tenant].map((id) => [id, token]),
  );
  const request = vi
    .fn<(url: string, init: RequestInit) => Promise<Response>>()
    .mockResolvedValue(
      new Response(JSON.stringify({ code: "UNAVAILABLE" }), { status: 503 }),
    );
  const print = vi.fn();
  await expect(
    runContractSmoke(ids, { sessions, request, print }),
  ).rejects.toThrow("unexpected result");
  expect(request).toHaveBeenCalledTimes(1);
  expect(
    new Headers(request.mock.calls[0]?.[1].headers).get("Authorization"),
  ).toBe(`Session ${token}`);
  expect(print).toHaveBeenCalledWith(
    "Synthetic draft: HTTP 503; contract not_created",
  );
});
it("refuses missing sessions before making a request", async () => {
  const request = vi.fn();
  await expect(
    runContractSmoke(ids, { sessions: {}, request }),
  ).rejects.toThrow("sessions are required");
  expect(request).not.toHaveBeenCalled();
});
