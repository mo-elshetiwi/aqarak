import { AuthError } from "./auth-client";
import { createFixtureAuthClient } from "./fixture-auth-client";
import { SessionController } from "./session-controller";
import { createTokenStore } from "./token-store";
import { createAuthorisedFetch } from "./authorised-fetch";
import { registerSignOutTask, subscribe } from "./session-events";
const credentials = { username: "manager-1", password: "synthetic" };
async function signedIn(): Promise<{
  session: SessionController;
  client: ReturnType<typeof createFixtureAuthClient>;
  store: ReturnType<typeof createTokenStore>;
}> {
  const client = createFixtureAuthClient(Date.now);
  const store = createTokenStore();
  const session = new SessionController({ client, store, clock: Date.now });
  await session.signIn(credentials);
  return { session, client, store };
}
afterEach(() => {
  jest.useRealTimers();
});
describe("AC-12 renewal", () => {
  it("refreshes exactly at expiry minus sixty seconds and cancels its timer on teardown", async () => {
    jest.useFakeTimers({ now: new Date("2026-09-28T00:00:00Z") });
    const { session, client } = await signedIn();
    const refresh = jest.spyOn(client, "refresh");
    const stop = session.startRenewal();
    await jest.advanceTimersByTimeAsync(14 * 60_000 - 1);
    expect(refresh).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
    await jest.advanceTimersByTimeAsync(15 * 60_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it("refreshes immediately inside the renewal window using the injected scheduler", async () => {
    const client = createFixtureAuthClient(() => 0);
    const tasks: { task: () => void; delay: number }[] = [];
    const session = new SessionController({
      client,
      store: createTokenStore(),
      clock: () => 14 * 60_000 + 1,
      schedule: (task, delay) => {
        tasks.push({ task, delay });
        return () => undefined;
      },
    });
    await session.signIn(credentials);
    const stop = session.startRenewal();
    expect(tasks[0]?.delay).toBe(0);
    stop();
  });
  it("shares one refresh for simultaneous 401s and replays each request once", async () => {
    const { session, client } = await signedIn();
    const oldToken = session.getAccessToken();
    const refresh = jest.spyOn(client, "refresh");
    const fetcher = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockImplementation(async (input) => {
        const request = new Request(input instanceof URL ? input.href : input);
        return new Response(await request.text(), {
          status:
            request.headers.get("Authorization") === `Bearer ${oldToken}`
              ? 401
              : 200,
        });
      });
    const authorisedFetch = createAuthorisedFetch(session, fetcher);
    const responses = await Promise.all([
      authorisedFetch("https://example.test/one", {
        method: "POST",
        body: "synthetic-body",
        headers: { "X-Test": "kept" },
      }),
      authorisedFetch("https://example.test/two"),
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(await responses[0].text()).toBe("synthetic-body");
    const requests = fetcher.mock.calls.map(([input]) =>
      input instanceof Request
        ? input
        : new Request(input instanceof URL ? input.href : input),
    );
    expect(
      requests
        .filter((request) => request.url.endsWith("/one"))
        .every((request) => request.headers.get("X-Test") === "kept"),
    ).toBe(true);
  });
  it("reuses a completed refresh for a late 401", async () => {
    const { session, client } = await signedIn();
    const rejected = session.getAccessToken();
    const refresh = jest.spyOn(client, "refresh");
    const renewed = await session.renew();
    expect(await session.refreshAfterUnauthorized(rejected)).toBe(renewed);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it("signs out with a reason when renewal ends the session", async () => {
    const { session, client, store } = await signedIn();
    jest
      .spyOn(client, "refresh")
      .mockRejectedValue(new AuthError("session_ended"));
    const fetcher = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(new Response(null, { status: 401 }));
    await expect(
      createAuthorisedFetch(session, fetcher)("https://example.test/one"),
    ).rejects.toMatchObject({ code: "session_ended" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot()).toEqual({
      status: "signed_out",
      reason: "session_ended",
    });
    expect(await store.getRefreshToken()).toBeNull();
  });
  it("stops retrying after the renewed request is also rejected", async () => {
    const { session, client } = await signedIn();
    const refresh = jest.spyOn(client, "refresh");
    const fetcher = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 401 })),
      );
    await expect(
      createAuthorisedFetch(session, fetcher)("https://example.test/one"),
    ).rejects.toMatchObject({ code: "session_ended" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot().status).toBe("signed_out");
  });
  it("rejects a delayed response after another account signs in", async () => {
    const { session } = await signedIn();
    const pending = Promise.withResolvers<Response>();
    const fetcher = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockReturnValue(pending.promise);
    const request = createAuthorisedFetch(
      session,
      fetcher,
    )("https://example.test/one");
    await session.signOut();
    await session.signIn({ ...credentials, username: "owner-1" });
    pending.resolve(new Response(null, { status: 200 }));
    await expect(request).rejects.toMatchObject({ code: "session_ended" });
    expect(session.getSnapshot()).toMatchObject({
      status: "signed_in",
      account: { displayName: "Khalid Al Suwaidi" },
    });
  });
});
describe("AC-13 sign-out boundaries", () => {
  it("runs every cleanup once and emits signed_out despite endpoint and task failures", async () => {
    const { session, client, store } = await signedIn();
    const endpoint = jest
      .spyOn(client, "signOut")
      .mockRejectedValue(new AuthError("network_unavailable"));
    const failed = jest.fn(() =>
      Promise.reject(new Error("Synthetic cleanup failure")),
    );
    const task = jest.fn();
    const event = jest.fn();
    const removeFailed = registerSignOutTask(failed);
    const removeTask = registerSignOutTask(task);
    const removeEvent = subscribe("signed_out", event);
    try {
      await Promise.all([session.signOut(), session.signOut()]);
      expect(endpoint).toHaveBeenCalledTimes(1);
      expect(failed).toHaveBeenCalledTimes(1);
      expect(task).toHaveBeenCalledTimes(1);
      expect(event).toHaveBeenCalledTimes(1);
      expect(await store.getRefreshToken()).toBeNull();
      expect(await store.getActiveCompanyId()).toBeNull();
      expect(() => session.getAccessToken()).toThrow(AuthError);
      expect(session.getSnapshot()).toEqual({ status: "signed_out" });
    } finally {
      removeFailed();
      removeTask();
      removeEvent();
    }
  });
});
