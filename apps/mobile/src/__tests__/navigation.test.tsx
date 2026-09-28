// Load the native shell before timing interactions on the shared runner.
import "../app/_layout";
import { renderRouter, screen, fireEvent } from "expo-router/testing-library";
import { act } from "@testing-library/react-native";
import { router } from "expo-router";
import fs from "node:fs";
import path from "node:path";
import * as SecureStore from "expo-secure-store";
import * as fixture from "../features/auth/fixture-auth-client";
import { AuthError } from "../features/auth/auth-client";
import {
  subscribe,
  registerSignOutTask,
} from "../features/auth/session-events";
import { roleTabs, type MobileRole } from "../features/auth/role";
function routes(directory: string): string[] {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory()
        ? routes(path.join(directory, entry.name))
        : [path.join(directory, entry.name)],
    );
}
beforeEach(async () => {
  await SecureStore.setItemAsync("aqarak.locale", "en");
  jest.clearAllMocks();
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});
async function signIn(username: string): Promise<void> {
  await renderRouter("./src/app");
  await fireEvent.changeText(
    await screen.findByTestId("sign-in-username"),
    username,
  );
  await fireEvent.changeText(
    screen.getByTestId("sign-in-password"),
    "synthetic",
  );
  await fireEvent.press(screen.getByTestId("sign-in-submit"));
}
describe("AC-18 real route tree", () => {
  it.each(["manager", "owner", "tenant", "technician"] satisfies MobileRole[])(
    "AC-6 AC-14 shows the ordered %s tabs",
    async (role) => {
      await signIn(`${role}-1`);
      await screen.findByTestId(`tab-${roleTabs[role][0]}`);
      const tabs = screen.getAllByTestId(/^tab-/);
      expect(tabs).toHaveLength(roleTabs[role].length);
      tabs.forEach((tab, index) => {
        expect(tab).toHaveProp("testID", `tab-${roleTabs[role][index] ?? ""}`);
      });
      expect(
        await SecureStore.getItemAsync("aqarak.refresh_token"),
      ).toBeTruthy();
      expect(
        jest
          .mocked(SecureStore.setItemAsync)
          .mock.calls.some(([, value]) => value.startsWith("fixture-access")),
      ).toBe(false);
    },
  );
  it("AC-14 shows no-mobile-role for an administrator", async () => {
    await signIn("admin-1");
    expect(await screen.findByTestId("no-mobile-role")).toBeTruthy();
    expect(screen.getByTestId("sign-out")).toBeTruthy();
  });
  it("AC-14 rejects an owner deep link in a manager session", async () => {
    await signIn("manager-1");
    await screen.findByTestId("tab-records");
    await act(() => {
      router.navigate("/owner/home");
    });
    expect(screen.queryByTestId("tab-portfolio")).toBeNull();
    expect(screen.getByTestId("tab-records")).toBeTruthy();
  });
  it("AC-13 returns from account sign-out and replaces the prior person", async () => {
    const client = fixture.createFixtureAuthClient();
    jest.spyOn(fixture, "createFixtureAuthClient").mockReturnValue(client);
    const endpoint = jest
      .spyOn(client, "signOut")
      .mockRejectedValue(new AuthError("network_unavailable"));
    const cleanup = jest.fn();
    const event = jest.fn();
    const removeTask = registerSignOutTask(cleanup);
    const removeEvent = subscribe("signed_out", event);
    await signIn("manager-1");
    await fireEvent.press(await screen.findByTestId("account-button"));
    expect(await screen.findByText("Layla Haddad")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("sign-out"));
    expect(endpoint).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(event).toHaveBeenCalledTimes(1);
    expect(await SecureStore.getItemAsync("aqarak.refresh_token")).toBeNull();
    expect(
      await SecureStore.getItemAsync("aqarak.active_company_id"),
    ).toBeNull();
    removeTask();
    removeEvent();
    await fireEvent.changeText(
      await screen.findByTestId("sign-in-username"),
      "owner-1",
    );
    await fireEvent.changeText(
      screen.getByTestId("sign-in-password"),
      "synthetic",
    );
    await fireEvent.press(screen.getByTestId("sign-in-submit"));
    expect(await screen.findByTestId("tab-portfolio")).toBeTruthy();
    expect(screen.queryByText("Layla Haddad")).toBeNull();
  });
  it("AC-15 changes company and role from the real account route and restores the choice", async () => {
    const event = jest.fn();
    const remove = subscribe("context_changed", event);
    try {
      await signIn("multi-1");
      await fireEvent.press(await screen.findByTestId("account-button"));
      expect(screen.getByTestId("company-switch")).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Aqarak Demo Properties" }),
      ).toHaveProp(
        "accessibilityState",
        expect.objectContaining({ selected: true, disabled: true }),
      );
      await fireEvent.press(
        screen.getByRole("button", { name: "Gulf Crest Trading LLC" }),
      );
      expect(await screen.findByTestId("tab-payments")).toBeTruthy();
      expect(screen.getByText("Gulf Crest Trading LLC · Tenant")).toBeTruthy();
      expect(event).toHaveBeenCalledTimes(1);
      await screen.unmount();
      await renderRouter("./src/app");
      expect(await screen.findByTestId("tab-payments")).toBeTruthy();
      expect(screen.getByText("Gulf Crest Trading LLC · Tenant")).toBeTruthy();
    } finally {
      remove();
    }
  });
  it("AC-17 gives every real route a unique pathname", () => {
    const root = path.resolve(__dirname, "../app");
    const paths = routes(root)
      .filter((file) => file.endsWith(".tsx") && !file.endsWith("_layout.tsx"))
      .map((file) =>
        path
          .relative(root, file)
          .replace(/\([^/]+\)\//g, "")
          .replace(/\.tsx$/, "")
          .replace(/(^|\/)index$/, ""),
      );
    expect(new Set(paths).size).toBe(paths.length);
  });
});
