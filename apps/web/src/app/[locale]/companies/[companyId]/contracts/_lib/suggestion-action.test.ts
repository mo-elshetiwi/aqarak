import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const calls = vi.hoisted(() => ({
  suggest: vi.fn(),
  session: vi.fn(),
  context: vi.fn(),
}));
vi.mock("@/lib/session/session", () => ({
  getCurrentSession: calls.session,
  requireCompanyContext: calls.context,
}));
vi.mock("./contracts-api", () => ({
  getContractsApi: () => ({ suggestClause: calls.suggest }),
}));
import { csrfTokenFor } from "@/lib/session/csrf";
import { suggestClause } from "./suggestion-action";
const sessionId = "a".repeat(43);
const companyId = "20000000-0000-4000-8000-000000000001";
const contractId = "60000000-0000-4000-8000-000000000001";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AQARAK_SESSION_SECRET", "s".repeat(43));
  calls.session.mockResolvedValue({ sessionId });
  calls.context.mockResolvedValue({ companyId });
  calls.suggest.mockResolvedValue({
    ok: false,
    error: { code: "MODEL_UNAVAILABLE" },
  });
});
it("validates suggestion input and CSRF before calling the service", async () => {
  const e = {
    locale: "en",
    companyId,
    contractId,
    csrfToken: csrfTokenFor(sessionId),
    idempotencyKey: "b".repeat(32),
    input: { textEn: "Synthetic clause" },
  };
  expect(await suggestClause({ ...e, csrfToken: "wrong" })).toEqual({
    ok: false,
    code: "FORBIDDEN",
  });
  expect(await suggestClause({ ...e, input: { textEn: " " } })).toEqual({
    ok: false,
    code: "VALIDATION_FAILED",
  });
  expect(calls.suggest).not.toHaveBeenCalled();
  expect(await suggestClause(e)).toEqual({
    ok: false,
    code: "MODEL_UNAVAILABLE",
  });
  expect(calls.suggest).toHaveBeenCalledWith(
    sessionId,
    companyId,
    contractId,
    e.input,
    e.idempotencyKey,
  );
});
