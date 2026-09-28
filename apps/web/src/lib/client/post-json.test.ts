import { afterEach, describe, expect, it, vi } from "vitest";
import { postJson } from "./post-json";
afterEach(() => vi.unstubAllGlobals());
describe("browser JSON boundary", () => {
  it("sends JSON and a supplied CSRF token without caching", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ redirectTo: "/en/companies" })),
      );
    vi.stubGlobal("fetch", fetch);
    expect(
      await postJson(
        "/api/companies",
        { nameEn: "Synthetic" },
        { csrfToken: "csrf-test" },
      ),
    ).toEqual({ ok: true, redirectTo: "/en/companies" });
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/companies", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": "csrf-test",
      },
      body: JSON.stringify({ nameEn: "Synthetic" }),
    });
  });
  it("does not send a CSRF header for a public form and accepts resend acknowledgement", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal("fetch", fetch);
    expect(await postJson("/api/auth/resend-code", {})).toEqual({
      ok: true,
      redirectTo: "",
    });
    expect(fetch.mock.calls[0]?.[1]?.headers).toEqual({
      "Content-Type": "application/json",
    });
  });
  it.each([null, {}, { redirectTo: 3 }])(
    "refuses malformed success %j",
    async (body) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(JSON.stringify(body))),
      );
      expect(await postJson("/api/auth/sign-in", {})).toEqual({
        ok: false,
        code: "UNAVAILABLE",
      });
    },
  );
  it("retains only the refusal code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: "INVALID_CREDENTIALS",
            details: "untrusted",
          }),
          { status: 401 },
        ),
      ),
    );
    expect(await postJson("/api/auth/sign-in", {})).toEqual({
      ok: false,
      code: "INVALID_CREDENTIALS",
    });
  });
  it("normalizes network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));
    expect(await postJson("/api/auth/sign-in", {})).toEqual({
      ok: false,
      code: "UNAVAILABLE",
    });
  });
});
