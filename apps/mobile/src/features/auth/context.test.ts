import { createFixtureAuthClient, demoCompanyId } from "./fixture-auth-client";
import { SessionController } from "./session-controller";
import { createTokenStore } from "./token-store";
import { subscribe } from "./session-events";
import { createAuthorisedFetch } from "./authorised-fetch";
const secondCompany = "10000000-0000-4000-8000-000000000002";
async function multi(): Promise<SessionController> {
  const session = new SessionController({
    client: createFixtureAuthClient(),
    store: createTokenStore(),
  });
  await session.signIn({ username: "multi-1", password: "synthetic" });
  return session;
}
describe("AC-15 company boundaries", () => {
  it("rejects responses started while company cleanup is still pending", async () => {
    const session = await multi();
    const cleanup = Promise.withResolvers<undefined>();
    const remove = subscribe("context_changed", () => cleanup.promise);
    const switching = session.switchContext(secondCompany);
    await Promise.resolve();
    const pending = Promise.withResolvers<Response>();
    const fetcher = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockReturnValue(pending.promise);
    const request = createAuthorisedFetch(
      session,
      fetcher,
    )("https://example.test/records");
    cleanup.resolve(undefined);
    await switching;
    remove();
    pending.resolve(new Response(null, { status: 200 }));
    await expect(request).rejects.toMatchObject({ code: "session_ended" });
  });
  it("emits before publishing, persists the chosen company and restores it after restart", async () => {
    const session = await multi();
    const event = jest.fn(() => {
      expect(session.getSnapshot()).toMatchObject({
        activeCompanyId: demoCompanyId,
      });
    });
    const remove = subscribe("context_changed", event);
    try {
      await session.switchContext(secondCompany);
    } finally {
      remove();
    }
    expect(event).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "context_changed",
        previousCompanyId: demoCompanyId,
        companyId: secondCompany,
      }),
    );
    expect(session.queryScope()[1]).toBe(secondCompany);
    const restored = new SessionController({
      client: createFixtureAuthClient(),
      store: createTokenStore(),
    });
    await restored.restore();
    expect(restored.getSnapshot()).toMatchObject({
      activeCompanyId: secondCompany,
    });
  });
  it("rejects unavailable contexts and ignores selection of the current company", async () => {
    const session = await multi();
    const event = jest.fn();
    const remove = subscribe("context_changed", event);
    try {
      await session.switchContext(demoCompanyId);
      await expect(
        session.switchContext("10000000-0000-4000-8000-000000000099"),
      ).rejects.toMatchObject({ code: "unexpected_response" });
      expect(event).not.toHaveBeenCalled();
      expect(session.queryScope()[1]).toBe(demoCompanyId);
    } finally {
      remove();
    }
  });
  it("falls back to the first company when the stored company is no longer available", async () => {
    await multi();
    const store = createTokenStore();
    await store.setActiveCompanyId("10000000-0000-4000-8000-000000000099");
    const restored = new SessionController({
      client: createFixtureAuthClient(),
      store,
    });
    await restored.restore();
    expect(restored.queryScope()[1]).toBe(demoCompanyId);
    expect(await store.getActiveCompanyId()).toBe(demoCompanyId);
  });
  it("rejects an in-flight company response after switching context", async () => {
    const session = await multi();
    const pending = Promise.withResolvers<Response>();
    const fetcher = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockReturnValue(pending.promise);
    const request = createAuthorisedFetch(
      session,
      fetcher,
    )("https://example.test/records");
    await session.switchContext(secondCompany);
    pending.resolve(new Response(null, { status: 200 }));
    await expect(request).rejects.toMatchObject({ code: "session_ended" });
    expect(session.queryScope()[1]).toBe(secondCompany);
  });
  it("does not persist a delayed company change after sign-out", async () => {
    const session = await multi();
    const pending = Promise.withResolvers<undefined>();
    const remove = subscribe("context_changed", () => pending.promise);
    const switching = session.switchContext(secondCompany);
    await Promise.resolve();
    await session.signOut();
    pending.resolve(undefined);
    await switching;
    remove();
    expect(await createTokenStore().getActiveCompanyId()).toBeNull();
    expect(session.getSnapshot().status).toBe("signed_out");
  });
});
