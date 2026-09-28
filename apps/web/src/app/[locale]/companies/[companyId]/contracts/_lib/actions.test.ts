import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  command: vi.fn(),
  context: vi.fn(),
  session: vi.fn(),
  redirect: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("@/lib/session/session", () => ({
  requireCompanyContext: mocks.context,
  getCurrentSession: mocks.session,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("./contracts-api", () => ({
  getContractsApi: () => ({
    create: mocks.command,
    edit: mocks.command,
    submit: mocks.command,
    approveOwner: mocks.command,
    returnOwner: mocks.command,
    acceptTenant: mocks.command,
    returnTenant: mocks.command,
    withdraw: mocks.command,
    cancel: mocks.command,
    revise: mocks.command,
  }),
}));
import { csrfTokenFor } from "@/lib/session/csrf";
import * as actions from "./actions";
import { termsInputSchema } from "./schemas";
import { company, draft } from "./test-fixtures";
const session = "a".repeat(43);
const id = "60000000-0000-4000-8000-000000000001";
const version = { expectedVersion: 1 };
const cases = [
  { action: actions.createContract, input: draft() },
  {
    action: actions.editContract,
    input: { ...version, terms: termsInputSchema.strip().parse(draft()) },
  },
  { action: actions.submitContract, input: version },
  {
    action: actions.approveOwner,
    input: { ...version, subjectHash: "a".repeat(64) },
  },
  {
    action: actions.acceptTenant,
    input: { ...version, subjectHash: "a".repeat(64) },
  },
  ...[
    actions.returnOwner,
    actions.returnTenant,
    actions.withdrawContract,
    actions.cancelContract,
  ].map((action) => ({
    action,
    input: { ...version, reason: "Change terms" },
  })),
  { action: actions.reviseContract, input: version },
];
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AQARAK_SESSION_SECRET", "s".repeat(43));
  mocks.session.mockResolvedValue({ sessionId: session });
  mocks.context.mockResolvedValue({ companyId: company });
  mocks.command.mockResolvedValue({ ok: true, value: { contract: { id } } });
});
describe("Contract command boundaries", () => {
  for (const row of cases) {
    it(`${row.action.name} rejects invalid input and a token from another session before transport`, async () => {
      const envelope = {
        locale: "en",
        companyId: company,
        contractId: id,
        csrfToken: csrfTokenFor(session),
        idempotencyKey: "b".repeat(32),
        input: row.input,
      };
      expect(
        await row.action({
          ...envelope,
          csrfToken: csrfTokenFor("z".repeat(43)),
        }),
      ).toEqual({ ok: false, code: "FORBIDDEN" });
      expect(
        await row.action({ ...envelope, input: { ...row.input, extra: true } }),
      ).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
      expect(
        await row.action({ ...envelope, idempotencyKey: "invalid" }),
      ).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
      expect(mocks.command).not.toHaveBeenCalled();
      expect(await row.action(envelope)).toEqual({ ok: true, contractId: id });
      expect(mocks.context).toHaveBeenCalledWith("en", company);
      expect(mocks.command).toHaveBeenCalledTimes(1);
    });
  }
  it("preserves refusal details without redirecting successful form state", async () => {
    mocks.command.mockResolvedValue({
      ok: false,
      error: { status: 409, code: "INVALID_INPUT", field: "termEnd" },
    });
    expect(
      await actions.createContract({
        locale: "en",
        companyId: company,
        csrfToken: csrfTokenFor(session),
        idempotencyKey: "b".repeat(32),
        input: draft(),
      }),
    ).toEqual({ ok: false, code: "INVALID_INPUT", field: "termEnd" });
  });
});
