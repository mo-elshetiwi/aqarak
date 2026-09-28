import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MOCK_ACCOUNTS,
  MOCK_ACCOUNT_IDS,
  MOCK_COMPANY_A_ID,
} from "@/lib/api/mock-fixtures";
import { csrfTokenFor } from "@/lib/session/csrf";
import type { CurrentSession } from "@/lib/session/session";
import type { TawtheeqClient } from "../_lib/client";
const { getSession, getClient, attest } = vi.hoisted(() => ({
  getSession: vi.fn<() => Promise<CurrentSession | null>>(),
  getClient: vi.fn(),
  attest: vi.fn<TawtheeqClient["attestPortal"]>(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/session/session", () => ({ getCurrentSession: getSession }));
vi.mock("../_lib/client", () => ({ getTawtheeqClient: getClient }));
import { tawtheeqAction } from "./_actions";
import { seedRecords } from "../_lib/fixtures";
const fixture = seedRecords()[0];
if (!fixture) throw new Error("Missing synthetic record");
const record = fixture;
const sessionId = "a".repeat(43);
const manager = MOCK_ACCOUNTS.find((a) => a.handle === "manager-1");
if (!manager) throw new Error("Missing manager");
const session: CurrentSession = {
  sessionId,
  csrfToken: "",
  me: {
    account: {
      id: MOCK_ACCOUNT_IDS["manager-1"],
      email: manager.email,
      displayName: manager.name.en,
      locale: "en",
    },
    contexts: manager.contexts,
  },
};
function input(): Record<string, unknown> {
  return {
    companyId: MOCK_COMPANY_A_ID,
    recordId: record.id,
    idempotencyKey: "72000000-0000-4000-8000-000000000001",
    csrfToken: csrfTokenFor(sessionId),
    command: "attestPortal",
    input: { expectedVersion: 1 },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "test");
  getSession.mockResolvedValue(session);
  getClient.mockReturnValue({ attestPortal: attest });
  attest.mockResolvedValue({ ok: true, value: record });
});
describe("Tawtheeq server action guards", () => {
  it.each([undefined, "wrong", "z".repeat(43)])(
    "AC-4 rejects missing or incorrect CSRF %s before creating a client",
    async (token) => {
      const result = await tawtheeqAction({ ...input(), csrfToken: token });
      expect(result).toEqual({
        ok: false,
        code: "CSRF_INVALID",
        fieldErrors: {},
      });
      expect(getClient).not.toHaveBeenCalled();
      expect(attest).not.toHaveBeenCalled();
    },
  );
  it("AC-4 returns field errors without changing invalid input values", async () => {
    const raw = { ...input(), input: { expectedVersion: -1 } };
    const original = structuredClone(raw);
    const result = await tawtheeqAction(raw);
    expect(result).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
      fieldErrors: { "input.expectedVersion": ["INVALID_INPUT"] },
    });
    expect(raw).toEqual(original);
    expect(getClient).not.toHaveBeenCalled();
  });
  it("passes the rendered idempotency key and authenticated session to the client", async () => {
    expect(await tawtheeqAction(input())).toEqual({ ok: true, record });
    expect(getClient).toHaveBeenCalledWith(MOCK_COMPANY_A_ID, sessionId);
    expect(attest).toHaveBeenCalledWith(
      record.id,
      { expectedVersion: 1 },
      "72000000-0000-4000-8000-000000000001",
    );
  });
  it.each(["owner-1", "technician-1"])(
    "refuses a direct mutation from %s",
    async (handle) => {
      const account = MOCK_ACCOUNTS.find((a) => a.handle === handle);
      if (!account) throw new Error("Missing account");
      getSession.mockResolvedValue({
        ...session,
        me: { ...session.me, contexts: account.contexts },
      });
      expect(await tawtheeqAction(input())).toMatchObject({
        ok: false,
        code: "NOT_PERMITTED",
      });
      expect(getClient).not.toHaveBeenCalled();
    },
  );
  it("maps domain refusal and outage without losing the command payload", async () => {
    attest.mockResolvedValue({
      ok: false,
      error: { status: 409, code: "CONFLICT", domainCode: "STALE_VERSION" },
    });
    expect(await tawtheeqAction(input())).toMatchObject({
      ok: false,
      code: "CONFLICT",
      domainCode: "STALE_VERSION",
    });
    attest.mockRejectedValue(new Error("transport"));
    expect(await tawtheeqAction(input())).toMatchObject({
      ok: false,
      code: "UNAVAILABLE",
    });
  });
});
