import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const calls = vi.hoisted(() => ({
  read: vi.fn(),
  session: vi.fn(),
  context: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/lib/session/session", () => ({
  getCurrentSession: calls.session,
  requireCompanyContext: calls.context,
}));
vi.mock("next/cache", () => ({ revalidatePath: calls.refresh }));
vi.mock("../../contracts/_lib/contracts-api", () => ({
  getContractsApi: () => ({ markNotificationRead: calls.read }),
}));
import { csrfTokenFor } from "@/lib/session/csrf";
import { markRead } from "./actions";
const sessionId = "a".repeat(43);
const companyId = "20000000-0000-4000-8000-000000000001";
const notificationId = "80000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AQARAK_SESSION_SECRET", "s".repeat(43));
  calls.session.mockResolvedValue({ sessionId });
  calls.context.mockResolvedValue({ companyId });
  calls.read.mockResolvedValue({
    ok: true,
    value: { id: notificationId, readAt: "2026-09-28T06:00:00.000Z" },
  });
});
it("validates the read request and CSRF token before issuing an authenticated command", async () => {
  const input = {
    locale: "en",
    companyId,
    csrfToken: csrfTokenFor(sessionId),
    idempotencyKey: "b".repeat(32),
    input: { notificationId },
  };
  expect(await markRead({ ...input, csrfToken: "wrong" })).toEqual({
    ok: false,
    code: "FORBIDDEN",
  });
  expect(
    await markRead({ ...input, input: { notificationId: "wrong" } }),
  ).toEqual({ ok: false, code: "VALIDATION_FAILED" });
  expect(calls.read).not.toHaveBeenCalled();
  expect(await markRead(input)).toEqual({ ok: true });
  expect(calls.read).toHaveBeenCalledWith(
    sessionId,
    companyId,
    notificationId,
    "b".repeat(32),
  );
  expect(calls.refresh).toHaveBeenCalledWith(
    `/en/companies/${companyId}/approvals`,
  );
});
it("returns service failures without marking the notice read", async () => {
  calls.read.mockRejectedValue(new Error("Unavailable"));
  expect(
    await markRead({
      locale: "en",
      companyId,
      csrfToken: csrfTokenFor(sessionId),
      idempotencyKey: "b".repeat(32),
      input: { notificationId },
    }),
  ).toEqual({ ok: false, code: "UNAVAILABLE" });
  expect(calls.refresh).not.toHaveBeenCalled();
});
