import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { createMockApi, createMockState } from "../api/mock-adapter";
import {
  MOCK_COMPANY_A_ID,
  MOCK_CONFIRMATION_CODE,
  MOCK_ONLY_PASSWORD,
} from "../api/mock-fixtures";
import { SESSION_COOKIE, SIGN_UP_COOKIE } from "../session/cookie";
import { csrfTokenFor } from "../session/csrf";
import { POST as signIn } from "../../app/api/auth/sign-in/route";
import { POST as signUp } from "../../app/api/auth/sign-up/route";
import { POST as confirm } from "../../app/api/auth/confirm-sign-up/route";
import { POST as resend } from "../../app/api/auth/resend-code/route";
import { POST as signOut } from "../../app/api/auth/sign-out/route";
import { POST as company } from "../../app/api/companies/route";
import type { AqarakApi } from "../api/contract";
const { getApi } = vi.hoisted(() => ({ getApi: vi.fn<() => AqarakApi>() }));
vi.mock("../api", () => ({ getApi }));
const origin = "https://app.example.com";
let api: AqarakApi;
const credentials = {
  locale: "en",
  email: "layla.haddad@example.com",
  password: MOCK_ONLY_PASSWORD,
};
const companyInput = {
  locale: "en",
  kind: "management_company",
  nameEn: "New Properties",
  nameAr: "أملاك جديدة",
  tradeLicenceNumber: "SYNTHETIC-123",
};
function request(
  body: unknown,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(`${origin}/api/auth/sign-in`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, ...headers },
    body: JSON.stringify(body),
  });
}
async function signedIn(email = credentials.email): Promise<string> {
  const response = await signIn(request({ ...credentials, email }));
  const id = response.cookies.get(SESSION_COOKIE)?.value;
  if (!id) throw new Error("Missing test session");
  return id;
}
function authenticated(id: string, token?: string): Record<string, string> {
  return {
    Cookie: `${SESSION_COOKIE}=${id}`,
    ...(token === undefined ? {} : { "X-CSRF-Token": token }),
  };
}
async function expectProblem(
  response: NextResponse,
  status: number,
  code: string,
): Promise<void> {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toContain(
    "application/problem+json",
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({
    type: "about:blank",
    title: code,
    status,
    code,
  });
}
beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("AQARAK_APP_ORIGIN", origin);
  api = createMockApi({ state: createMockState() });
  getApi.mockReset().mockReturnValue(api);
});
describe("same-origin route handlers", () => {
  it.each([
    ["layla.haddad@example.com", `/en/companies/${MOCK_COMPANY_A_ID}/home`],
    ["mariam.alnuaimi@example.com", "/en/companies"],
  ])(
    "AC-4 issues one protected cookie and only a redirect for %s",
    async (email, redirectTo) => {
      const response = await signIn(request({ ...credentials, email }));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.cookies.getAll()).toHaveLength(1);
      const id = response.cookies.get(SESSION_COOKIE)?.value;
      expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const cookie = response.headers.get("set-cookie");
      for (const attribute of [
        "HttpOnly",
        "Secure",
        "SameSite=lax",
        "Path=/",
        "Max-Age=",
      ])
        expect(cookie?.toLowerCase()).toContain(attribute.toLowerCase());
      expect(cookie?.toLowerCase()).not.toContain("domain=");
      const body: unknown = await response.json();
      expect(body).toEqual({ redirectTo });
      expect(JSON.stringify(body)).not.toContain(id);
      expect(
        [...response.headers]
          .filter(
            ([name, value]) =>
              name !== "set-cookie" && id && value.includes(id),
          )
          .map(([name]) => name),
      ).toEqual([]);
    },
  );
  const routes = [signUp, confirm, resend, signIn, signOut, company];
  it.each(
    routes.flatMap((handler, index) =>
      ["attacker", "missing", "cross-site"].map((kind) => ({
        handler,
        index,
        kind,
      })),
    ),
  )(
    "AC-5 refuses $kind on handler $index before API access",
    async ({ handler, kind }) => {
      const req = request(
        {},
        kind === "attacker"
          ? { Origin: "https://attacker.example" }
          : kind === "cross-site"
            ? { "Sec-Fetch-Site": "cross-site" }
            : {},
      );
      if (kind === "missing") req.headers.delete("Origin");
      await expectProblem(await handler(req), 403, "FORBIDDEN_ORIGIN");
      expect(getApi).not.toHaveBeenCalled();
    },
  );
  it.each([signOut, company])(
    "AC-6 refuses missing, empty and another session's CSRF token",
    async (handler) => {
      const id = await signedIn();
      const otherId = await signedIn();
      const before = await api.getMe(id);
      getApi.mockClear();
      for (const token of [undefined, "", csrfTokenFor(otherId)]) {
        await expectProblem(
          await handler(
            request(
              handler === company ? companyInput : { locale: "en" },
              authenticated(id, token),
            ),
          ),
          403,
          "CSRF_TOKEN_INVALID",
        );
      }
      expect(getApi).not.toHaveBeenCalled();
      expect(await api.getMe(id)).toEqual(before);
    },
  );
  it("AC-6 revokes a session and clears its cookie with the right CSRF token", async () => {
    const id = await signedIn();
    const response = await signOut(
      request({ locale: "en" }, authenticated(id, csrfTokenFor(id))),
    );
    expect(await response.json()).toEqual({ redirectTo: "/en/sign-in" });
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await api.getMe(id)).toMatchObject({
      error: { code: "SESSION_INVALID" },
    });
    const again = await signOut(
      request({ locale: "en" }, authenticated(id, csrfTokenFor(id))),
    );
    expect(again.headers.get("set-cookie")).toContain("Max-Age=0");
  });
  it.each([
    "//attacker.example",
    "https://attacker.example",
    "/en/../../x",
    "/\\attacker.example",
    "/ar/companies",
  ])("AC-7 ignores unsafe next value %s", async (next) => {
    const response = await signIn(request({ ...credentials, next }));
    expect(await response.json()).toEqual({
      redirectTo: `/en/companies/${MOCK_COMPANY_A_ID}/home`,
    });
  });
  it("AC-11 keeps the normalized pending email in a protected cookie and out of the URL", async () => {
    const response = await signUp(
      request({
        locale: "ar",
        email: " New@EXAMPLE.COM ",
        password: MOCK_ONLY_PASSWORD,
        fullName: "اسم تجريبي",
      }),
    );
    expect(response.cookies.getAll()).toHaveLength(1);
    expect(response.cookies.get(SIGN_UP_COOKIE)?.value).toBe("new@example.com");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=1800");
    expect(await response.json()).toEqual({ redirectTo: "/ar/verify" });
    const headers = { Cookie: `${SIGN_UP_COOKIE}=new%40example.com` };
    expect(await (await resend(request({}, headers))).json()).toEqual({
      ok: true,
    });
    const confirmed = await confirm(
      request({ locale: "ar", code: MOCK_CONFIRMATION_CODE }, headers),
    );
    expect(await confirmed.json()).toEqual({ redirectTo: "/ar/sign-in" });
    expect(confirmed.headers.get("set-cookie")).toContain("Max-Age=0");
    const loggedIn = await signIn(
      request({
        locale: "ar",
        email: "new@example.com",
        password: MOCK_ONLY_PASSWORD,
      }),
    );
    expect(await loggedIn.json()).toEqual({ redirectTo: "/ar/setup/company" });
  });
  it("sets the pending email when sign-in requires confirmation", async () => {
    const response = await signIn(
      request({ ...credentials, email: "sara.nasser@example.com" }),
    );
    await expectProblem(response, 403, "USER_NOT_CONFIRMED");
    expect(response.cookies.get(SIGN_UP_COOKIE)?.value).toBe(
      "sara.nasser@example.com",
    );
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });
  it("creates a company with trimmed bilingual names and a valid session token", async () => {
    const id = await signedIn();
    const response = await company(
      request(
        { ...companyInput, nameEn: "  New Properties  " },
        authenticated(id, csrfTokenFor(id)),
      ),
    );
    const me = await api.getMe(id);
    if (!me.ok) throw new Error(me.error.code);
    const context = me.value.contexts.at(-1);
    if (!context) throw new Error("Missing company context");
    expect(context.companyName.en).toBe("New Properties");
    expect(context.staffRoles).toEqual(["company_administrator"]);
    expect(await response.json()).toEqual({
      redirectTo: `/en/companies/${context.companyId}/home`,
    });
  });
  it("refuses missing sessions, malformed JSON and invalid company input", async () => {
    await expectProblem(
      await company(request(companyInput)),
      401,
      "SESSION_INVALID",
    );
    const malformed = new NextRequest(`${origin}/api/auth/sign-in`, {
      method: "POST",
      headers: { Origin: origin },
      body: "{",
    });
    await expectProblem(await signIn(malformed), 400, "VALIDATION_FAILED");
    await expectProblem(
      await signIn(request({ ...credentials, locale: "fr" })),
      400,
      "VALIDATION_FAILED",
    );
    const id = await signedIn();
    getApi.mockClear();
    await expectProblem(
      await company(
        request(
          { ...companyInput, tradeLicenceNumber: "" },
          authenticated(id, csrfTokenFor(id)),
        ),
      ),
      400,
      "VALIDATION_FAILED",
    );
    expect(getApi).not.toHaveBeenCalled();
  });
  it("uses a safe next path", async () => {
    const response = await signIn(
      request({ ...credentials, next: "/en/companies" }),
    );
    expect(await response.json()).toEqual({ redirectTo: "/en/companies" });
  });
  it("returns a no-store sanitized problem for unexpected adapter failures", async () => {
    vi.spyOn(api, "signIn").mockRejectedValue(
      new Error("Sensitive upstream detail"),
    );
    await expectProblem(await signIn(request(credentials)), 503, "UNAVAILABLE");
  });
});
