import * as SecureStore from "expo-secure-store";
import { AuthError } from "./auth-client";
import { createFixtureAuthClient, demoCompanyId } from "./fixture-auth-client";
import { SessionController } from "./session-controller";
import { createTokenStore } from "./token-store";
const credentials = { username: "manager-1", password: "synthetic" };
describe("secure session restore", () => {
  it("AC-6 signs in without passing the access credential to secure storage", async () => {
    const client = createFixtureAuthClient();
    const controller = new SessionController({
      client,
      store: createTokenStore(),
    });
    await controller.signIn(credentials);
    expect(controller.getSnapshot()).toMatchObject({
      status: "signed_in",
      activeCompanyId: demoCompanyId,
    });
    const writes = jest.mocked(SecureStore.setItemAsync).mock.calls;
    expect(writes.map(([key]) => key)).toEqual([
      "aqarak.refresh_token",
      "aqarak.active_company_id",
    ]);
    expect(writes.some(([, value]) => value.startsWith("fixture-access"))).toBe(
      false,
    );
    expect(JSON.stringify(controller.getSnapshot())).not.toContain(
      "fixture-access",
    );
  });
  it("AC-11 refreshes and loads the person on restart", async () => {
    const store = createTokenStore();
    await new SessionController({
      client: createFixtureAuthClient(),
      store,
    }).signIn(credentials);
    const client = createFixtureAuthClient();
    const refresh = jest.spyOn(client, "refresh");
    const getMe = jest.spyOn(client, "getMe");
    const restored = new SessionController({ client, store });
    await Promise.all([restored.restore(), restored.restore()]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(getMe).toHaveBeenCalledTimes(1);
    expect(restored.getSnapshot()).toMatchObject({
      status: "signed_in",
      account: { displayName: "Layla Haddad" },
    });
  });
  it("AC-11 deletes an ended session and retains the localised reason", async () => {
    const store = createTokenStore();
    await store.setRefreshToken("expired-synthetic");
    const controller = new SessionController({
      client: createFixtureAuthClient(),
      store,
    });
    await controller.restore();
    expect(controller.getSnapshot()).toEqual({
      status: "signed_out",
      reason: "session_ended",
    });
    expect(await store.getRefreshToken()).toBeNull();
  });
  it("AC-11 keeps the rotated credential when loading the person fails, then retries", async () => {
    const store = createTokenStore();
    const client = createFixtureAuthClient();
    await store.setRefreshToken(
      (await client.signIn(credentials)).refreshToken,
    );
    jest
      .spyOn(client, "getMe")
      .mockRejectedValueOnce(new AuthError("network_unavailable"));
    const controller = new SessionController({ client, store });
    await controller.restore();
    expect(controller.getSnapshot()).toEqual({ status: "restore_failed" });
    expect(await store.getRefreshToken()).toBeTruthy();
    await controller.restore();
    expect(controller.getSnapshot().status).toBe("signed_in");
  });
  it("does not resurrect a session when a delayed restore finishes after sign-out", async () => {
    const store = createTokenStore();
    const client = createFixtureAuthClient();
    const tokens = await client.signIn(credentials);
    await store.setRefreshToken(tokens.refreshToken);
    const pending = Promise.withResolvers<typeof tokens>();
    jest.spyOn(client, "refresh").mockReturnValue(pending.promise);
    const controller = new SessionController({ client, store });
    const restoring = controller.restore();
    await Promise.resolve();
    await controller.signOut();
    pending.resolve(tokens);
    await restoring;
    expect(controller.getSnapshot().status).toBe("signed_out");
    expect(await store.getRefreshToken()).toBeNull();
    expect(await store.getActiveCompanyId()).toBeNull();
  });
});
