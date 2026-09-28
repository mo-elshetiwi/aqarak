import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "@aqarak/domain";
import {
  signIn,
  signOut,
  confirmSignUp,
  resendCode,
  createCompany,
  signUp,
} from "./actions";
import type { AqarakApi } from "../api/contract";
import { MOCK_ONLY_PASSWORD } from "../api/mock-fixtures";
const unavailable = { status: 503, code: "UNAVAILABLE" } as const;
const input = {
  locale: "en" as const,
  email: "synthetic@example.com",
  password: MOCK_ONLY_PASSWORD,
};
const sessionId = "a".repeat(43);
const context = { sessionId, pendingEmail: undefined };
function stubApi(): {
  [K in keyof AqarakApi]: ReturnType<typeof vi.fn<AqarakApi[K]>>;
} {
  return {
    changeMemberRoles: vi.fn<AqarakApi["changeMemberRoles"]>(),
    suspendMember: vi.fn<AqarakApi["suspendMember"]>(),
    reactivateMember: vi.fn<AqarakApi["reactivateMember"]>(),
    removeMember: vi.fn<AqarakApi["removeMember"]>(),
    revokeInvitation: vi.fn<AqarakApi["revokeInvitation"]>(),
    resendInvitation: vi.fn<AqarakApi["resendInvitation"]>(),
    getCompany: vi.fn<AqarakApi["getCompany"]>(),
    updateCompany: vi.fn<AqarakApi["updateCompany"]>(),
    signIn: vi.fn<AqarakApi["signIn"]>(),
    signOut: vi.fn<AqarakApi["signOut"]>(),
    getMe: vi.fn<AqarakApi["getMe"]>(),
    signUp: vi.fn<AqarakApi["signUp"]>(),
    confirmSignUp: vi.fn<AqarakApi["confirmSignUp"]>(),
    resendCode: vi.fn<AqarakApi["resendCode"]>(),
    createCompany: vi.fn<AqarakApi["createCompany"]>(),
    previewInvitation: vi.fn<AqarakApi["previewInvitation"]>(),
    acceptInvitation: vi.fn<AqarakApi["acceptInvitation"]>(),
    listMembers: vi.fn<AqarakApi["listMembers"]>(),
    listInvitations: vi.fn<AqarakApi["listInvitations"]>(),
    createInvitation: vi.fn<AqarakApi["createInvitation"]>(),
  };
}
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("AQARAK_SESSION_SECRET", undefined);
});
describe("authentication orchestration", () => {
  it("revokes an issued session when permission loading fails and emits no cookie", async () => {
    const api = stubApi();
    api.signIn.mockResolvedValue(
      ok({
        session: {
          id: sessionId,
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
          idleExpiresAt: new Date(Date.now() + 3600000).toISOString(),
        },
      }),
    );
    api.getMe.mockResolvedValue(err(unavailable));
    api.signOut.mockResolvedValue(ok(null));
    expect(await signIn(api, input)).toEqual(err(unavailable));
    expect(api.signOut).toHaveBeenCalledWith(sessionId);
    expect(api.signIn).toHaveBeenCalledWith({
      email: input.email,
      password: MOCK_ONLY_PASSWORD,
      client: "web",
    });
  });
  it("preserves a cookie for retry when sign-out is unavailable", async () => {
    const api = stubApi();
    api.signOut.mockResolvedValue(err(unavailable));
    expect(await signOut(api, { locale: "en" }, context)).toEqual(
      err(unavailable),
    );
  });
  it("requires a valid pending email before confirmation or resend", async () => {
    const api = stubApi();
    expect(
      await confirmSignUp(api, { locale: "en", code: "246810" }, context),
    ).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
    expect(
      await resendCode(api, {}, { ...context, pendingEmail: "invalid" }),
    ).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
    expect(api.confirmSignUp).not.toHaveBeenCalled();
    expect(api.resendCode).not.toHaveBeenCalled();
  });
  it("propagates expected API refusals without adding cookies or navigation", async () => {
    const api = stubApi();
    api.signUp.mockResolvedValue(err(unavailable));
    api.confirmSignUp.mockResolvedValue(err(unavailable));
    api.resendCode.mockResolvedValue(err(unavailable));
    api.createCompany.mockResolvedValue(err(unavailable));
    expect(
      await signUp(api, { ...input, fullName: "Synthetic Account" }),
    ).toEqual(err(unavailable));
    expect(
      await confirmSignUp(
        api,
        { locale: "en", email: input.email, code: "246810" },
        context,
      ),
    ).toEqual(err(unavailable));
    expect(await resendCode(api, { email: input.email }, context)).toEqual(
      err(unavailable),
    );
    expect(
      await createCompany(
        api,
        {
          locale: "ar",
          kind: "self_managed_owner",
          nameEn: "Synthetic Properties",
          nameAr: "أملاك تجريبية",
        },
        context,
      ),
    ).toEqual(err(unavailable));
    expect(api.createCompany).toHaveBeenCalledWith(sessionId, {
      kind: "self_managed_owner",
      name: { en: "Synthetic Properties", ar: "أملاك تجريبية" },
    });
  });
});
