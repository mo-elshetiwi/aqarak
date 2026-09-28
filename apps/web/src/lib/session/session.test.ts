import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "@aqarak/domain";
import type { AqarakApi } from "../api/contract";
import {
  MOCK_ACCOUNTS,
  MOCK_ACCOUNT_IDS,
  MOCK_COMPANY_A_ID,
  MOCK_COMPANY_B_ID,
} from "../api/mock-fixtures";
const { cookie, getMe, redirect, notFound } = vi.hoisted(() => ({
  cookie: vi.fn<() => { value: string } | undefined>(),
  getMe: vi.fn<AqarakApi["getMe"]>(),
  redirect: vi.fn<(path: string) => never>(() => {
    throw new Error("redirect");
  }),
  notFound: vi.fn<() => never>(() => {
    throw new Error("notFound");
  }),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: cookie }),
}));
vi.mock("next/navigation", () => ({ redirect, notFound }));
vi.mock("../api", () => ({ getApi: () => ({ getMe }) }));
import { getCurrentSession, requireCompanyContext } from "./session";
const fixture = MOCK_ACCOUNTS.find((account) => account.handle === "manager-1");
if (!fixture) throw new Error("Missing fixture");
const me = {
  account: {
    id: MOCK_ACCOUNT_IDS["manager-1"],
    email: fixture.email,
    displayName: fixture.name.en,
    locale: "en" as const,
  },
  contexts: fixture.contexts,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("AQARAK_SESSION_SECRET", undefined);
  cookie.mockReturnValue({ value: "a".repeat(43) });
  getMe.mockResolvedValue(ok(me));
});
describe("server session authorization", () => {
  it("AC-9 redirects with no cookie even when page middleware is bypassed", async () => {
    cookie.mockReturnValue(undefined);
    await expect(
      requireCompanyContext("en", MOCK_COMPANY_A_ID),
    ).rejects.toThrow("redirect");
    expect(redirect).toHaveBeenCalledWith("/en/sign-in");
    expect(getMe).not.toHaveBeenCalled();
  });
  it.each(["40000000-0000-4000-8000-000000000099", MOCK_COMPANY_B_ID])(
    "AC-9 hides unknown or foreign company %s",
    async (id) => {
      await expect(requireCompanyContext("en", id)).rejects.toThrow("notFound");
      expect(notFound).toHaveBeenCalledOnce();
    },
  );
  it("AC-9 returns the held company context from the API", async () => {
    expect(await requireCompanyContext("en", MOCK_COMPANY_A_ID)).toEqual(
      me.contexts[0],
    );
    expect(getMe).toHaveBeenCalledWith("a".repeat(43));
  });
  it("treats malformed and invalid sessions as unauthenticated", async () => {
    cookie.mockReturnValue({ value: "invalid" });
    expect(await getCurrentSession()).toBeNull();
    expect(getMe).not.toHaveBeenCalled();
    cookie.mockReturnValue({ value: "a".repeat(43) });
    getMe.mockResolvedValue(err({ code: "SESSION_INVALID", status: 401 }));
    expect(await getCurrentSession()).toBeNull();
  });
  it("does not mistake an API outage for a signed-out account", async () => {
    getMe.mockResolvedValue(err({ code: "UNAVAILABLE", status: 503 }));
    await expect(getCurrentSession()).rejects.toThrow(
      "Session API unavailable",
    );
  });
});
