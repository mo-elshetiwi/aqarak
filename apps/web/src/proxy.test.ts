import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "./lib/session/cookie";
const { localeMiddleware } = vi.hoisted(() => ({ localeMiddleware: vi.fn() }));
vi.mock("next-intl/middleware", () => ({ default: () => localeMiddleware }));
import { proxy } from "./proxy";
beforeEach(() => {
  localeMiddleware.mockReset().mockReturnValue(NextResponse.next());
});
describe("proxy session presence gate", () => {
  it("AC-10 redirects a protected URL without including its query", () => {
    const response = proxy(
      new NextRequest(
        "https://app.example.com/en/companies/x/home?private=value",
      ),
    );
    expect(response.headers.get("location")).toBe(
      "https://app.example.com/en/sign-in?next=%2Fen%2Fcompanies%2Fx%2Fhome",
    );
    expect(localeMiddleware).not.toHaveBeenCalled();
  });
  it("AC-10 passes a cookie to locale handling without claiming it is valid", () => {
    const request = new NextRequest(
      "https://app.example.com/en/companies/x/home",
      { headers: { Cookie: `${SESSION_COOKIE}=opaque` } },
    );
    proxy(request);
    expect(localeMiddleware).toHaveBeenCalledWith(request);
  });
  it.each(["/en/sign-in", "/ar/sign-in", "/en/companies-other"])(
    "AC-10 leaves public path %s to locale handling",
    (path) => {
      const request = new NextRequest(`https://app.example.com${path}`);
      proxy(request);
      expect(localeMiddleware).toHaveBeenCalledWith(request);
    },
  );
  it("protects setup and preserves the Arabic locale", () => {
    const response = proxy(
      new NextRequest("https://app.example.com/ar/setup/company"),
    );
    expect(response.headers.get("location")).toBe(
      "https://app.example.com/ar/sign-in?next=%2Far%2Fsetup%2Fcompany",
    );
  });
});
