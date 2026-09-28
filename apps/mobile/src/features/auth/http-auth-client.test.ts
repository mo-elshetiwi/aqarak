import { createHttpAuthClient } from "./http-auth-client";
import { createAuthClient } from "./auth-client";
import { createFixtureAuthClient } from "./fixture-auth-client";
import { SessionController } from "./session-controller";
import { createTokenStore } from "./token-store";
const base = "https://example.test/api";
const credentials = { username: "manager-1", password: "synthetic" };
const tokens = {
  accessToken: "synthetic-access",
  accessTokenExpiresAt: "2026-09-28T03:15:00Z",
  refreshToken: "synthetic-refresh",
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type":
        status >= 400 ? "application/problem+json" : "application/json",
    },
  });
}
function fake(): jest.Mock<ReturnType<typeof fetch>, Parameters<typeof fetch>> {
  return jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
}
afterEach(() => {
  jest.useRealTimers();
});
describe("AC-10 HTTP contract", () => {
  it("calls all four endpoints with the exact methods, headers and bodies and returns rotation", async () => {
    const fixture = createFixtureAuthClient();
    const issued = await fixture.signIn(credentials);
    const fixtureMe = await fixture.getMe(issued.accessToken);
    const me = {
      ...fixtureMe,
      account: {
        ...fixtureMe.account,
        id: "11111111-1111-7111-f111-111111111111",
      },
    };
    const fetcher = fake()
      .mockResolvedValueOnce(json(tokens))
      .mockResolvedValueOnce(
        json({ ...tokens, refreshToken: "synthetic-rotated" }),
      )
      .mockResolvedValueOnce(json(me))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createHttpAuthClient(`${base}/`, fetcher);
    expect(await client.signIn(credentials)).toEqual(tokens);
    expect(await client.refresh(tokens.refreshToken)).toMatchObject({
      refreshToken: "synthetic-rotated",
    });
    expect(await client.getMe(tokens.accessToken)).toEqual(me);
    await client.signOut(tokens.accessToken, "synthetic-rotated");
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      `${base}/v1/auth/sign-in`,
      `${base}/v1/auth/refresh`,
      `${base}/v1/me`,
      `${base}/v1/auth/sign-out`,
    ]);
    expect(fetcher.mock.calls.map(([, init]) => init?.method)).toEqual([
      "POST",
      "POST",
      "GET",
      "POST",
    ]);
    expect(fetcher.mock.calls.map(([, init]) => init?.body)).toEqual([
      JSON.stringify({ ...credentials, client: "mobile" }),
      JSON.stringify({ refreshToken: tokens.refreshToken, client: "mobile" }),
      undefined,
      JSON.stringify({ refreshToken: "synthetic-rotated" }),
    ]);
    const headers = fetcher.mock.calls.map(
      ([, init]) => new Headers(init?.headers),
    );
    expect(headers[0]?.get("Authorization")).toBeNull();
    expect(headers[1]?.get("Authorization")).toBeNull();
    expect(headers[2]?.get("Authorization")).toBe(
      `Bearer ${tokens.accessToken}`,
    );
    expect(headers[3]?.get("Authorization")).toBe(
      `Bearer ${tokens.accessToken}`,
    );
    expect(headers[0]?.get("Content-Type")).toBe("application/json");
    expect(headers[0]?.get("Accept")).toContain("application/problem+json");
  });
  it.each([
    [401, "INVALID_CREDENTIALS", "invalid_credentials"],
    [429, "TOO_MANY_ATTEMPTS", "too_many_attempts"],
    [500, "INTERNAL_ERROR", "service_unavailable"],
    [503, "UNAVAILABLE", "service_unavailable"],
  ] as const)(
    "maps sign-in status %s to a safe catalogue code",
    async (status, code, expected) => {
      const client = createHttpAuthClient(
        base,
        fake().mockResolvedValue(
          json(
            { code, status, title: "Synthetic error", traceId: "synthetic" },
            status,
          ),
        ),
      );
      await expect(client.signIn(credentials)).rejects.toMatchObject({
        code: expected,
      });
    },
  );
  it("maps 401 outside sign-in to session_ended", async () => {
    const fetcher = fake().mockImplementation(() =>
      Promise.resolve(json({ code: "SESSION_ENDED" }, 401)),
    );
    const client = createHttpAuthClient(base, fetcher);
    await expect(client.refresh(tokens.refreshToken)).rejects.toMatchObject({
      code: "session_ended",
    });
    await expect(client.getMe(tokens.accessToken)).rejects.toMatchObject({
      code: "session_ended",
    });
    await expect(
      client.signOut(tokens.accessToken, tokens.refreshToken),
    ).rejects.toMatchObject({ code: "session_ended" });
  });
  it.each([502, 503, 504])(
    "D07 maps HTML %s to service_unavailable",
    async (status) => {
      const client = createHttpAuthClient(
        base,
        fake().mockResolvedValue(
          new Response("<html>Unavailable</html>", {
            status,
            headers: { "Content-Type": "text/html" },
          }),
        ),
      );
      await expect(client.signIn(credentials)).rejects.toMatchObject({
        code: "service_unavailable",
      });
    },
  );
  it("D07 maps a bare 401 by route and a bare 429 to too_many_attempts", async () => {
    const client = createHttpAuthClient(
      base,
      fake().mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 401 })),
      ),
    );
    await expect(client.signIn(credentials)).rejects.toMatchObject({
      code: "invalid_credentials",
    });
    await expect(client.refresh("synthetic")).rejects.toMatchObject({
      code: "session_ended",
    });
    await expect(
      createHttpAuthClient(
        base,
        fake().mockResolvedValue(new Response(null, { status: 429 })),
      ).signIn(credentials),
    ).rejects.toMatchObject({ code: "too_many_attempts" });
  });
  it("maps rejected fetches to network_unavailable", async () => {
    const client = createHttpAuthClient(
      base,
      fake().mockRejectedValue(new TypeError("Synthetic connection failure")),
    );
    await expect(client.signIn(credentials)).rejects.toMatchObject({
      code: "network_unavailable",
    });
  });
  it("aborts and rejects at fifteen seconds even if fetch ignores abort", async () => {
    jest.useFakeTimers();
    const fetcher = fake().mockReturnValue(new Promise(() => undefined));
    const result = createHttpAuthClient(base, fetcher).signIn(credentials);
    const assertion = expect(result).rejects.toMatchObject({
      code: "network_unavailable",
    });
    await jest.advanceTimersByTimeAsync(15_000);
    await assertion;
    expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });
  it.each([
    {},
    { ...tokens, accessTokenExpiresAt: "invalid" },
    { ...tokens, extra: true },
    { ...tokens, refreshToken: "" },
  ])(
    "rejects malformed success shapes without exposing their body",
    async (body) => {
      await expect(
        createHttpAuthClient(base, fake().mockResolvedValue(json(body))).signIn(
          credentials,
        ),
      ).rejects.toMatchObject({ code: "unexpected_response" });
    },
  );
  it("rejects invalid success bodies and honours status for malformed problems", async () => {
    const fetcher = fake()
      .mockResolvedValueOnce(new Response("invalid", { status: 200 }))
      .mockResolvedValueOnce(json({ title: "Missing code" }, 401))
      .mockResolvedValueOnce(json(tokens, 201));
    const client = createHttpAuthClient(base, fetcher);
    for (const code of [
      "unexpected_response",
      "invalid_credentials",
      "unexpected_response",
    ])
      await expect(client.signIn(credentials)).rejects.toMatchObject({ code });
  });
  it("validates nested person data with strict schemas", async () => {
    const fixture = createFixtureAuthClient();
    const issued = await fixture.signIn(credentials);
    const me = await fixture.getMe(issued.accessToken);
    const fetcher = fake()
      .mockResolvedValueOnce(
        json({ ...me, account: { ...me.account, extra: true } }),
      )
      .mockResolvedValueOnce(
        json({
          ...me,
          contexts: [{ ...me.contexts[0], capacities: ["invalid"] }],
        }),
      );
    const client = createHttpAuthClient(base, fetcher);
    await expect(client.getMe(tokens.accessToken)).rejects.toMatchObject({
      code: "unexpected_response",
    });
    await expect(client.getMe(tokens.accessToken)).rejects.toMatchObject({
      code: "unexpected_response",
    });
  });
  it("keeps an existing refresh credential when renewal omits rotation", async () => {
    const store = createTokenStore();
    const fixture = createFixtureAuthClient();
    const issued = await fixture.signIn(credentials);
    const me = await fixture.getMe(issued.accessToken);
    const fetcher = fake()
      .mockResolvedValueOnce(json(tokens))
      .mockResolvedValueOnce(json(me))
      .mockResolvedValueOnce(
        json({
          accessToken: "synthetic-renewed",
          accessTokenExpiresAt: "2026-09-28T03:30:00Z",
        }),
      );
    const session = new SessionController({
      client: createHttpAuthClient(base, fetcher),
      store,
    });
    await session.signIn(credentials);
    await session.renew();
    expect(await store.getRefreshToken()).toBe(tokens.refreshToken);
  });
  it("selects the HTTP adapter only when configured", async () => {
    const fetcher = fake().mockResolvedValue(json(tokens));
    await createAuthClient(
      { adapter: "fixture", baseUrl: "" },
      { fetch: fetcher },
    ).signIn(credentials);
    expect(fetcher).not.toHaveBeenCalled();
    await createAuthClient(
      { adapter: "http", baseUrl: base },
      { fetch: fetcher },
    ).signIn(credentials);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
