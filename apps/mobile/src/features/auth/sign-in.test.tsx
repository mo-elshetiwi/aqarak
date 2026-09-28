import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { I18nManager } from "react-native";
import { reloadAppAsync } from "expo";
import { getMessages, type Locale } from "@aqarak/i18n";
import SignInScreen from "../../app/(auth)/sign-in";
import { LocaleProvider } from "../locale/locale-provider";
import { SessionProvider } from "./session-provider";
import { createFixtureAuthClient } from "./fixture-auth-client";
import type { AuthClient } from "./auth-client";
import type { SignInTokens } from "./contract";
async function mount(client: AuthClient, locale: Locale = "en"): Promise<void> {
  await render(
    <LocaleProvider initialLocale={locale}>
      <SessionProvider client={client}>
        <SignInScreen />
      </SessionProvider>
    </LocaleProvider>,
  );
}
beforeEach(() => {
  jest.clearAllMocks();
});
describe("real bilingual sign-in route", () => {
  it("AC-5 stores Arabic and reloads once when the real language control is pressed", async () => {
    await SecureStore.deleteItemAsync("aqarak.locale_reload_guard");
    Object.defineProperty(I18nManager, "isRTL", {
      value: false,
      configurable: true,
    });
    const force = jest
      .spyOn(I18nManager, "forceRTL")
      .mockImplementation(() => undefined);
    await mount(createFixtureAuthClient());
    await fireEvent.press(screen.getByTestId("locale-switch"));
    expect(await SecureStore.getItemAsync("aqarak.locale")).toBe("ar");
    expect(force).toHaveBeenCalledWith(true);
    expect(reloadAppAsync).toHaveBeenCalledTimes(1);
    expect(screen.getByText("عقارك")).toBeTruthy();
    force.mockRestore();
  });
  it.each(["en", "ar"] as const)(
    "AC-7 keeps username and clears invalid password with identical %s errors",
    async (locale) => {
      const client = createFixtureAuthClient();
      await mount(client, locale);
      await fireEvent.changeText(
        screen.getByTestId("sign-in-username"),
        "unknown",
      );
      await fireEvent.changeText(
        screen.getByTestId("sign-in-password"),
        "synthetic",
      );
      await fireEvent.press(screen.getByTestId("sign-in-submit"));
      expect(
        screen.getAllByText(
          getMessages(locale).Mobile.errors.invalid_credentials,
        ),
      ).toHaveLength(2);
      expect(screen.getByTestId("sign-in-username").props.value).toBe(
        "unknown",
      );
      expect(screen.getByTestId("sign-in-password").props.value).toBe("");
      expect(screen.getByTestId("sign-in-submit")).not.toBeDisabled();
      expect(await SecureStore.getItemAsync("aqarak.refresh_token")).toBeNull();
      expect(
        await SecureStore.getItemAsync("aqarak.active_company_id"),
      ).toBeNull();
    },
  );
  it("AC-8 renders each empty-field error in the summary and inline without calling auth", async () => {
    const client = createFixtureAuthClient();
    const signIn = jest.spyOn(client, "signIn");
    await mount(client);
    await fireEvent.press(screen.getByTestId("sign-in-submit"));
    expect(screen.getByTestId("sign-in-error-summary")).toHaveTextContent(
      "Enter your username\nEnter your password",
    );
    expect(
      screen.getAllByText("Enter your username", { exact: false }),
    ).toHaveLength(2);
    expect(
      screen.getAllByText("Enter your password", { exact: false }),
    ).toHaveLength(2);
    expect(signIn).not.toHaveBeenCalled();
  });
  it("AC-9 permits only one request while pending and retains the pending label", async () => {
    const client = createFixtureAuthClient();
    const tokens = await client.signIn({
      username: "manager-1",
      password: "synthetic",
    });
    let complete: ((tokens: SignInTokens) => void) | undefined;
    const signIn = jest.spyOn(client, "signIn").mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    await mount(client);
    await fireEvent.changeText(
      screen.getByTestId("sign-in-username"),
      "manager-1",
    );
    await fireEvent.changeText(
      screen.getByTestId("sign-in-password"),
      "synthetic",
    );
    await fireEvent.press(screen.getByTestId("sign-in-submit"));
    await fireEvent.press(screen.getByTestId("sign-in-submit"));
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("sign-in-submit")).toBeDisabled();
    expect(screen.getByText("Signing in…")).toBeTruthy();
    await act(() => {
      complete?.(tokens);
    });
  });
  it("AC-4 renders Arabic messages with native reading-start alignment", async () => {
    await mount(createFixtureAuthClient(), "ar");
    expect(screen.getByText("عقارك")).toHaveStyle({ textAlign: "left" });
    expect(screen.getByTestId("sign-in-username")).toHaveProp(
      "accessibilityLabel",
      "اسم المستخدم",
    );
  });
});
