import { beforeEach, expect, it, vi } from "vitest";
import { ok } from "@aqarak/domain";
import {
  MOCK_COMPANY_A_ID,
  MOCK_ACCOUNTS,
  MOCK_ACCOUNT_IDS,
} from "@/lib/api/mock-fixtures";
const stubs = vi.hoisted(() => ({
  getCurrentSession: vi.fn(),
  requireCompanyContext: vi.fn(),
  createOwner: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: stubs.revalidatePath }));
vi.mock("@/lib/session/session", () => stubs);
vi.mock("../server/estate-api", () => ({
  getEstateApi: () => ({ createOwner: stubs.createOwner }),
}));
import { createOwnerAction } from "../actions";
const context = {
  locale: "en" as const,
  companyId: MOCK_COMPANY_A_ID,
  idempotencyKey: "a".repeat(32),
};
const input = {
  fullName: { en: "Synthetic Owner", ar: "مالك تجريبي" },
  preferredLanguage: "en" as const,
};
beforeEach(() => {
  vi.resetAllMocks();
  const fixture = MOCK_ACCOUNTS.find((a) => a.handle === "manager-1");
  if (!fixture) throw new Error("Missing fixture");
  stubs.getCurrentSession.mockResolvedValue({
    sessionId: "synthetic-session",
    me: {
      account: { id: MOCK_ACCOUNT_IDS["manager-1"] },
      contexts: fixture.contexts,
    },
  });
  stubs.requireCompanyContext.mockResolvedValue(fixture.contexts[0]);
});
it.each(["tenant-1", "technician-1"])(
  "refuses %s before calling the estate API",
  async (handle) => {
    const context = MOCK_ACCOUNTS.find((a) => a.handle === handle)?.contexts[0];
    stubs.requireCompanyContext.mockResolvedValue(context);
    expect(
      await createOwnerAction(
        {
          locale: "en",
          companyId: MOCK_COMPANY_A_ID,
          idempotencyKey: "a".repeat(32),
        },
        input,
      ),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(stubs.createOwner).not.toHaveBeenCalled();
  },
);
it("validates input and forwards the stable idempotency key after re-reading authority", async () => {
  expect(
    await createOwnerAction(context, { ...input, eidNumber: "1".repeat(14) }),
  ).toMatchObject({ ok: false, code: "VALIDATION_FAILED", field: "eidNumber" });
  expect(stubs.createOwner).not.toHaveBeenCalled();
  const response = {
    owner: {
      id: crypto.randomUUID(),
      version: 1,
      fullName: input.fullName,
      linked: false,
      selfManaged: false,
    },
  };
  stubs.createOwner.mockResolvedValue(ok(response));
  expect(await createOwnerAction(context, input)).toEqual({
    ok: true,
    data: response,
  });
  expect(stubs.createOwner).toHaveBeenCalledWith(
    "synthetic-session",
    context.companyId,
    input,
    [],
    context.idempotencyKey,
  );
  expect(stubs.revalidatePath).toHaveBeenCalledTimes(2);
});
