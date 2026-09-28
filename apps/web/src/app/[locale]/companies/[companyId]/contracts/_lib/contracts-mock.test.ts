import { mockDraftingOptions } from "./contracts-mock";
import { verifyChain } from "@aqarak/domain";
import { describe, expect, it } from "vitest";
import { company, draft, key, setupMock } from "./test-fixtures";
import { detailSchema } from "./schemas";
import { MOCK_COMPANY_B_ID } from "@/lib/api/mock-fixtures";

describe("Synthetic contract lifecycle", () => {
  it("binds three decisions to one version through separate authenticated sessions", async () => {
    const { api, login } = setupMock();
    const manager = await login("manager-1");
    const owner = await login("owner-1");
    const tenant = await login("tenant-1");
    const created = await api.create(manager, company, draft(), key());
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.contract.status).toBe("draft");
    const id = created.value.contract.id;
    expect(detailSchema.safeParse(created.value).success).toBe(true);
    expect(
      await api.submit(owner, company, id, { expectedVersion: 1 }, key()),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    const submitted = await api.submit(
      manager,
      company,
      id,
      { expectedVersion: 1 },
      key(),
    );
    expect(submitted).toMatchObject({
      ok: true,
      value: { contract: { status: "awaiting_owner_approval" } },
    });
    expect(
      await api.approveOwner(
        tenant,
        company,
        id,
        { expectedVersion: 1, subjectHash: created.value.version.contentHash },
        key(),
      ),
    ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(
      await api.approveOwner(
        owner,
        company,
        id,
        { expectedVersion: 1, subjectHash: "a".repeat(64) },
        key(),
      ),
    ).toMatchObject({ ok: false, error: { code: "STALE_SUBJECT_HASH" } });
    const approved = await api.approveOwner(
      owner,
      company,
      id,
      { expectedVersion: 1, subjectHash: created.value.version.contentHash },
      key(),
    );
    expect(approved).toMatchObject({
      ok: true,
      value: { contract: { status: "awaiting_tenant_acceptance" } },
    });
    const accepted = await api.acceptTenant(
      tenant,
      company,
      id,
      { expectedVersion: 1, subjectHash: created.value.version.contentHash },
      key(),
    );
    expect(accepted).toMatchObject({
      ok: true,
      value: { contract: { status: "concluded" } },
    });
    if (accepted.ok) {
      expect(accepted.value.approvals).toHaveLength(3);
      expect(
        new Set(accepted.value.approvals.map((item) => item.subjectHash)).size,
      ).toBe(1);
      expect(
        accepted.value.approvals.every((item) => item.status === "approved"),
      ).toBe(true);
    }
    expect(
      await api.get(await login("technician-1"), company, id),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(await api.get(owner, MOCK_COMPANY_B_ID, id)).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    expect(await api.get(await login("owner-2"), company, id)).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });
  it("replays identical commands and refuses changed bodies under the same key", async () => {
    const { api, login } = setupMock();
    const session = await login("manager-1");
    const token = key();
    const input = draft();
    const first = await api.create(session, company, input, token);
    expect(await api.create(session, company, input, token)).toEqual(first);
    expect(
      await api.create(session, company, { ...input, graceDays: 1 }, token),
    ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_KEY_REUSED" } });
    expect(await api.list(session, company)).toMatchObject({
      ok: true,
      value: { items: [expect.objectContaining({ status: "draft" })] },
    });
  });
  it("keeps submitted terms immutable, requires return reasons and links one successor", async () => {
    const { api, login } = setupMock();
    const manager = await login("manager-1");
    const owner = await login("owner-1");
    const created = await api.create(manager, company, draft(), key());
    if (!created.ok) throw new Error(created.error.code);
    const id = created.value.contract.id;
    await api.submit(manager, company, id, { expectedVersion: 1 }, key());
    expect(
      await api.edit(
        manager,
        company,
        id,
        { expectedVersion: 1, terms: draft() },
        key(),
      ),
    ).toMatchObject({ ok: false, error: { code: "INVALID_TRANSITION" } });
    expect(
      await api.returnOwner(
        owner,
        company,
        id,
        { expectedVersion: 1, reason: "" },
        key(),
      ),
    ).toMatchObject({ ok: false, error: { code: "REASON_REQUIRED" } });
    expect(
      await api.returnOwner(
        owner,
        company,
        id,
        { expectedVersion: 1, reason: "Change the dates" },
        key(),
      ),
    ).toMatchObject({ ok: true, value: { contract: { status: "cancelled" } } });
    const revision = await api.revise(
      manager,
      company,
      id,
      { expectedVersion: 1 },
      key(),
    );
    expect(revision).toMatchObject({
      ok: true,
      value: { contract: { status: "draft", revisionOfId: id } },
    });
    expect(
      await api.revise(manager, company, id, { expectedVersion: 1 }, key()),
    ).toMatchObject({ ok: false, error: { code: "SUCCESSOR_EXISTS" } });
  });
  it("refuses mismatched schedules and overlapping submitted terms", async () => {
    const { api, login } = setupMock();
    const manager = await login("manager-1");
    const invalid = await api.create(
      manager,
      company,
      { ...draft(), totalFils: 1 },
      key(),
    );
    if (!invalid.ok) throw new Error(invalid.error.code);
    expect(
      await api.submit(
        manager,
        company,
        invalid.value.contract.id,
        { expectedVersion: 1 },
        key(),
      ),
    ).toMatchObject({ ok: false, error: { code: "SCHEDULE_TOTAL_MISMATCH" } });
    const first = await api.create(manager, company, draft(), key());
    const second = await api.create(manager, company, draft(), key());
    if (!first.ok || !second.ok) throw new Error("Draft creation failed");
    await api.submit(
      manager,
      company,
      first.value.contract.id,
      { expectedVersion: 1 },
      key(),
    );
    expect(
      await api.submit(
        manager,
        company,
        second.value.contract.id,
        { expectedVersion: 1 },
        key(),
      ),
    ).toMatchObject({ ok: false, error: { code: "OVERLAPPING_CONTRACT" } });
  });
});

it("records verifiable audit events and scopes notification reads to their recipient", async () => {
  const { api, state, login } = setupMock();
  const manager = await login("manager-1");
  const owner = await login("owner-1");
  const tenant = await login("tenant-1");
  const created = await api.create(manager, company, draft(), key());
  if (!created.ok) throw new Error(created.error.code);
  const token = key();
  await api.submit(
    manager,
    company,
    created.value.contract.id,
    { expectedVersion: 1 },
    token,
  );
  const count = state.activity.rows.length;
  await api.submit(
    manager,
    company,
    created.value.contract.id,
    { expectedVersion: 1 },
    token,
  );
  expect(state.activity.rows).toHaveLength(count);
  expect(
    verifyChain({
      rows: state.activity.rows,
      head: state.activity.head,
      anchor: null,
    }),
  ).toMatchObject({ ok: true });
  const notifications = await api.listNotifications(owner, company);
  expect(notifications).toMatchObject({ ok: true, value: { unreadCount: 1 } });
  if (!notifications.ok || !notifications.value.items[0])
    throw new Error("Missing owner notification");
  const id = notifications.value.items[0].id;
  expect(
    await api.markNotificationRead(tenant, company, id, key()),
  ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  const readKey = key();
  const read = await api.markNotificationRead(owner, company, id, readKey);
  expect(read).toMatchObject({ ok: true, value: { id } });
  expect(await api.markNotificationRead(owner, company, id, readKey)).toEqual(
    read,
  );
  expect(
    await api.markNotificationRead(
      owner,
      company,
      created.value.contract.id,
      readKey,
    ),
  ).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_KEY_REUSED" } });
  expect(await api.listNotifications(owner, company)).toMatchObject({
    ok: true,
    value: { unreadCount: 0 },
  });
});

it("treats equivalent property ordering as the same replay body", async () => {
  const { api, login } = setupMock();
  const manager = await login("manager-1");
  const input = draft();
  const token = key();
  const first = await api.create(manager, company, input, token);
  const { tenantId, ...rest } = input;
  expect(
    await api.create(manager, company, { ...rest, tenantId }, token),
  ).toEqual(first);
});

it("freezes the disabled owner gate and concludes with two separate people", async () => {
  const unit = mockDraftingOptions.units[0];
  if (!unit) throw new Error("Missing unit");
  const original = unit.ownerGate;
  try {
    unit.ownerGate = false;
    const { api, login } = setupMock();
    const manager = await login("manager-1");
    const tenant = await login("tenant-1");
    const created = await api.create(manager, company, draft(), key());
    if (!created.ok) throw new Error(created.error.code);
    const submitted = await api.submit(
      manager,
      company,
      created.value.contract.id,
      { expectedVersion: 1 },
      key(),
    );
    expect(submitted).toMatchObject({
      ok: true,
      value: {
        contract: { status: "awaiting_tenant_acceptance" },
        ownerGate: { value: false, frozen: true },
      },
    });
    unit.ownerGate = true;
    const accepted = await api.acceptTenant(
      tenant,
      company,
      created.value.contract.id,
      { expectedVersion: 1, subjectHash: created.value.version.contentHash },
      key(),
    );
    expect(accepted).toMatchObject({
      ok: true,
      value: {
        contract: { status: "concluded" },
        ownerGate: { value: false, frozen: true },
      },
    });
    if (accepted.ok)
      expect(accepted.value.approvals.map((item) => item.slot)).toEqual([
        "manager",
        "tenant",
      ]);
  } finally {
    unit.ownerGate = original;
  }
});

it.each(["withdraw", "returnTenant"] as const)(
  "%s cancels a pending contract with a recorded reason",
  async (method) => {
    const { api, login } = setupMock();
    const manager = await login("manager-1");
    const owner = await login("owner-1");
    const tenant = await login("tenant-1");
    const created = await api.create(manager, company, draft(), key());
    if (!created.ok) throw new Error(created.error.code);
    const id = created.value.contract.id;
    await api.submit(manager, company, id, { expectedVersion: 1 }, key());
    if (method === "returnTenant")
      await api.approveOwner(
        owner,
        company,
        id,
        { expectedVersion: 1, subjectHash: created.value.version.contentHash },
        key(),
      );
    expect(
      await api[method](
        method === "withdraw" ? manager : tenant,
        company,
        id,
        { expectedVersion: 1, reason: "Dates need to change" },
        key(),
      ),
    ).toMatchObject({
      ok: true,
      value: {
        contract: { status: "cancelled", cancelReason: "Dates need to change" },
      },
    });
  },
);

it("shows two own requested approvals and an empty queue for other linked people or companies", async () => {
  const { api, login } = setupMock();
  const manager = await login("manager-1");
  for (const unit of mockDraftingOptions.units) {
    const created = await api.create(
      manager,
      company,
      { ...draft(), unitId: unit.id },
      key(),
    );
    if (!created.ok) throw new Error(created.error.code);
    await api.submit(
      manager,
      company,
      created.value.contract.id,
      { expectedVersion: 1 },
      key(),
    );
  }
  const owner = await api.listApprovals(await login("owner-1"), company);
  if (!owner.ok) throw new Error(owner.error.code);
  expect(owner.value.items).toHaveLength(2);
  expect(
    owner.value.items.every(
      (item) => item.slot === "owner" && Boolean(item.requestedAt),
    ),
  ).toBe(true);
  const other = await login("owner-2");
  expect(await api.listApprovals(other, company)).toEqual({
    ok: true,
    value: { items: [] },
  });
  expect(await api.listApprovals(other, MOCK_COMPANY_B_ID)).toEqual({
    ok: true,
    value: { items: [] },
  });
  expect(await api.listNotifications(other, MOCK_COMPANY_B_ID)).toEqual({
    ok: true,
    value: { unreadCount: 0, items: [] },
  });
});
