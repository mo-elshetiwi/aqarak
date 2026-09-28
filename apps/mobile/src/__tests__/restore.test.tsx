import { renderRouter, screen, fireEvent } from "expo-router/testing-library";
import { act } from "@testing-library/react-native";
import { AppState } from "react-native";
import * as SecureStore from "expo-secure-store";
import * as SplashScreen from "expo-splash-screen";
import * as fixture from "../features/auth/fixture-auth-client";
import { AuthError } from "../features/auth/auth-client";
import type { RefreshTokens } from "../features/auth/contract";
beforeEach(async () => {
  await SecureStore.setItemAsync("aqarak.locale", "en");
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});
async function prepare(): Promise<
  ReturnType<typeof fixture.createFixtureAuthClient>
> {
  const client = fixture.createFixtureAuthClient();
  const tokens = await client.signIn({
    username: "manager-1",
    password: "synthetic",
  });
  await SecureStore.setItemAsync("aqarak.refresh_token", tokens.refreshToken);
  jest.spyOn(fixture, "createFixtureAuthClient").mockReturnValue(client);
  return client;
}
describe("AC-11 AC-18 real startup routes", () => {
  it("AC-12 renews when the app becomes active and removes the listener on unmount", async () => {
    const client = await prepare();
    const refresh = jest.spyOn(client, "refresh");
    const remove = jest.fn();
    const listen = jest
      .spyOn(AppState, "addEventListener")
      .mockReturnValue({ remove });
    await renderRouter("./src/app");
    await screen.findByTestId("tab-records");
    refresh.mockClear();
    const handler = listen.mock.calls.find(
      ([event]) => event === "change",
    )?.[1];
    expect(handler).toBeDefined();
    await act(() => {
      handler?.("active");
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    await screen.unmount();
    expect(remove).toHaveBeenCalled();
  });
  it("keeps the splash visible until restore loads the role home", async () => {
    const client = await prepare();
    const original = client.refresh.bind(client);
    const pending = Promise.withResolvers<RefreshTokens>();
    jest.spyOn(client, "refresh").mockReturnValue(pending.promise);
    const hide = jest.mocked(SplashScreen.hideAsync);
    hide.mockClear();
    await renderRouter("./src/app");
    expect(hide).not.toHaveBeenCalled();
    expect(screen.queryByTestId("sign-in-screen")).toBeNull();
    const stored = await SecureStore.getItemAsync("aqarak.refresh_token");
    if (!stored) throw new Error("Expected synthetic session");
    await act(async () => {
      pending.resolve(await original(stored));
    });
    expect(await screen.findByTestId("tab-records")).toBeTruthy();
    expect(hide).toHaveBeenCalled();
  });
  it("shows the session-ended message after rejecting a stored session", async () => {
    const client = await prepare();
    jest
      .spyOn(client, "refresh")
      .mockRejectedValue(new AuthError("session_ended"));
    await renderRouter("./src/app");
    expect(
      await screen.findByText("Your session ended. Sign in again."),
    ).toBeTruthy();
    expect(await SecureStore.getItemAsync("aqarak.refresh_token")).toBeNull();
  });
  it("offers Retry and Sign out after a network failure and retries successfully", async () => {
    const client = await prepare();
    jest
      .spyOn(client, "refresh")
      .mockRejectedValueOnce(new AuthError("network_unavailable"));
    await renderRouter("./src/app");
    expect(await screen.findByTestId("restore-failed")).toBeTruthy();
    expect(screen.getByTestId("sign-out")).toBeTruthy();
    expect(await SecureStore.getItemAsync("aqarak.refresh_token")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("restore-retry"));
    expect(await screen.findByTestId("tab-records")).toBeTruthy();
  });
});
