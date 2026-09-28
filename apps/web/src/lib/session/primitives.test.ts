import { afterEach, describe, expect, it, vi } from "vitest";
import { getApi, isMockApi } from "../api";
import { getAppOrigin, getSessionSecret } from "./config";
import {
  clearedSessionCookie,
  sessionCookieOptions,
  signUpCookieOptions,
} from "./cookie";
import { csrfTokenFor, verifyCsrfToken } from "./csrf";
import { checkRequestOrigin } from "./origin";
import { safeNextPath } from "./redirects";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
describe("deployment configuration", () => {
  it("AC-8 refuses missing production mode and secret without leaking values", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AQARAK_API_MODE", undefined);
    vi.stubEnv("AQARAK_SESSION_SECRET", undefined);
    expect(getApi).toThrow("AQARAK_API_MODE");
    expect(getSessionSecret).toThrow("AQARAK_SESSION_SECRET");
  });
  it("AC-8 refuses HTTP mode without a base URL and a short session secret", () => {
    vi.stubEnv("AQARAK_API_MODE", "http");
    vi.stubEnv("AQARAK_API_BASE_URL", undefined);
    expect(getApi).toThrow("AQARAK_API_BASE_URL");
    const shortValue = "x".repeat(12);
    vi.stubEnv("AQARAK_SESSION_SECRET", shortValue);
    expect(getSessionSecret).toThrow("AQARAK_SESSION_SECRET");
    expect(getSessionSecret).not.toThrow(shortValue);
  });
  it.each(["development", "test"] as const)(
    "uses stable process defaults only in %s",
    (mode) => {
      vi.stubEnv("NODE_ENV", mode);
      vi.stubEnv("AQARAK_API_MODE", undefined);
      vi.stubEnv("AQARAK_SESSION_SECRET", undefined);
      expect(isMockApi()).toBe(true);
      expect(getApi()).toBeDefined();
      expect(getSessionSecret().length).toBeGreaterThanOrEqual(32);
      expect(getSessionSecret()).toBe(getSessionSecret());
    },
  );
  it.each(["unknown", ""])("refuses unknown mode %s", (mode) => {
    vi.stubEnv("AQARAK_API_MODE", mode);
    expect(getApi).toThrow("AQARAK_API_MODE");
  });
  it.each([
    "http://api.example.com",
    "ftp://localhost",
    "https://name:credential@example.com",
    "https://api.example.com?query=1",
    "https://api.example.com/#fragment",
  ])("refuses invalid base URL %s", (url) => {
    vi.stubEnv("AQARAK_API_MODE", "http");
    vi.stubEnv("AQARAK_API_BASE_URL", url);
    expect(getApi).toThrow("AQARAK_API_BASE_URL");
    expect(getApi).not.toThrow(url);
  });
  it.each([
    "https://api.example.com/base",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://[::1]:8000",
  ])("accepts supported base URL %s at call time", (url) => {
    vi.stubEnv("AQARAK_API_MODE", "http");
    vi.stubEnv("AQARAK_API_BASE_URL", url);
    expect(getApi()).toBeDefined();
    expect(isMockApi()).toBe(false);
    vi.stubEnv("AQARAK_API_MODE", "mock");
    expect(isMockApi()).toBe(true);
  });
  it("validates the public origin without echoing its value", () => {
    vi.stubEnv("AQARAK_APP_ORIGIN", "https://app.example.com/path");
    expect(getAppOrigin).toThrow("AQARAK_APP_ORIGIN");
    expect(getAppOrigin).not.toThrow("https://app.example.com/path");
  });
});
describe("session request primitives", () => {
  it("derives distinct per-session tokens and rejects malformed inputs", () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("AQARAK_SESSION_SECRET", "x".repeat(32));
    const id = "a".repeat(43);
    const token = csrfTokenFor(id);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(verifyCsrfToken(id, token)).toBe(true);
    expect(csrfTokenFor("b".repeat(43))).not.toBe(token);
    for (const candidate of [
      undefined,
      null,
      "",
      123,
      {},
      "!".repeat(43),
      token + "x",
      token.slice(1),
      csrfTokenFor("b".repeat(43)),
    ])
      expect(verifyCsrfToken(id, candidate)).toBe(false);
  });
  it("computes whole-second absolute cookie expiry and matching clear attributes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:00:00.500Z"));
    expect(sessionCookieOptions("2026-09-01T00:00:10.000Z")).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 9,
    });
    expect(sessionCookieOptions("2026-08-01T00:00:00.000Z").maxAge).toBe(0);
    expect(clearedSessionCookie()).toEqual({
      ...signUpCookieOptions(),
      maxAge: 0,
    });
    expect(() => sessionCookieOptions("invalid")).toThrow(
      "Invalid session expiry",
    );
  });
  it("uses trusted deployment origin or forwarded origin and requires same-origin metadata", () => {
    vi.stubEnv("AQARAK_APP_ORIGIN", undefined);
    const headers = {
      Origin: "https://app.example.com",
      "X-Forwarded-Proto": "https",
      "X-Forwarded-Host": "app.example.com",
      "Sec-Fetch-Site": "same-origin",
    };
    expect(
      checkRequestOrigin(new Request("http://localhost:3000/api", { headers })),
    ).toBe(true);
    expect(
      checkRequestOrigin(
        new Request("http://localhost:3000/api", {
          headers: {
            Origin: "https://app.example.com",
            Host: "app.example.com",
            "X-Forwarded-Proto": "https",
          },
        }),
      ),
    ).toBe(true);
    for (const site of ["same-site", "none", "cross-site"])
      expect(
        checkRequestOrigin(
          new Request("https://app.example.com/api", {
            headers: { ...headers, "Sec-Fetch-Site": site },
          }),
        ),
      ).toBe(false);
    vi.stubEnv("AQARAK_APP_ORIGIN", "https://fixed.example.com");
    expect(
      checkRequestOrigin(
        new Request("https://app.example.com/api", { headers }),
      ),
    ).toBe(false);
  });
  it.each([
    "/en/%2e%2e/x",
    "/en/%252e%252e/x",
    "/en/%2f%2fattacker.example",
    "/en/%5cattacker",
    "/en/a//b",
    "/en/%",
    "/en/hello\nthere",
  ])("rejects encoded or malformed navigation %s", (candidate) => {
    expect(safeNextPath("en", candidate)).toBeNull();
  });
  it("accepts local locale paths", () => {
    expect(safeNextPath("en", "/en/companies/a/home")).toBe(
      "/en/companies/a/home",
    );
    expect(safeNextPath("ar", "/ar/setup/company")).toBe("/ar/setup/company");
  });
});
