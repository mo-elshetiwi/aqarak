import * as SecureStore from "expo-secure-store";
import { createTokenStore } from "./token-store";
import { demoCompanyId } from "./fixture-auth-client";
describe("secure session storage", () => {
  it("AC-6 persists only the refresh credential and active company", async () => {
    const store = createTokenStore();
    await store.setRefreshToken("synthetic-refresh");
    await store.setActiveCompanyId(demoCompanyId);
    expect(await store.getRefreshToken()).toBe("synthetic-refresh");
    expect(await store.getActiveCompanyId()).toBe(demoCompanyId);
    expect(
      jest.mocked(SecureStore.setItemAsync).mock.calls.map(([key]) => key),
    ).toEqual(["aqarak.refresh_token", "aqarak.active_company_id"]);
  });
  it("deletes malformed persisted values and preserves the locale on sign-out", async () => {
    await SecureStore.setItemAsync("aqarak.refresh_token", "");
    await SecureStore.setItemAsync("aqarak.active_company_id", "invalid");
    await SecureStore.setItemAsync("aqarak.locale", "ar");
    const store = createTokenStore();
    expect(await store.getRefreshToken()).toBeNull();
    expect(await store.getActiveCompanyId()).toBeNull();
    await store.deleteSessionKeys();
    expect(await SecureStore.getItemAsync("aqarak.locale")).toBe("ar");
  });
  it("serialises pending writes before deleting both session keys", async () => {
    const store = createTokenStore();
    await Promise.all([
      store.setRefreshToken("synthetic-refresh"),
      store.setActiveCompanyId(demoCompanyId),
      store.deleteSessionKeys(),
    ]);
    expect(await store.getRefreshToken()).toBeNull();
    expect(await store.getActiveCompanyId()).toBeNull();
  });
});
