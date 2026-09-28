import { fireEvent, render, screen } from "@testing-library/react-native";
import { getMessages } from "@aqarak/i18n";
import GalleryScreen from "@/app/gallery";
import AccountScreen from "@/app/account";
import { LocaleProvider } from "@/features/locale/locale-provider";
import { createFixtureAuthClient } from "@/features/auth/fixture-auth-client";
import { useSession } from "@/features/auth/session-provider";
import { useCaptureStorage } from "@/features/capture/capture-provider";
import { CaptureStorage } from "@/features/capture/storage";
jest.mock("@/features/auth/session-provider", () => ({
  useSession: jest.fn(),
}));
jest.mock("@/features/capture/capture-provider", () => ({
  useCaptureStorage: jest.fn(),
}));
jest.mock("@/features/capture/capture-sheet", () => ({
  CaptureSheet: () => null,
}));
jest.mock("expo-router", () => {
  const actual =
    jest.requireActual<typeof import("expo-router")>("expo-router");
  const React = jest.requireActual<typeof import("react")>("react");
  const { Text } =
    jest.requireActual<typeof import("react-native")>("react-native");
  return {
    ...actual,
    Redirect: ({ href }: { href: string }) =>
      React.createElement(Text, { testID: "redirect" }, href),
  };
});
const originalDev = __DEV__;
beforeEach(async () => {
  const client = createFixtureAuthClient();
  const tokens = await client.signIn({
    username: "manager-1",
    password: "synthetic",
  });
  const me = await client.getMe(tokens.accessToken);
  jest.mocked(useSession).mockReturnValue({
    state: {
      status: "signed_in",
      ...me,
      activeCompanyId: me.contexts[0]?.companyId ?? null,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    },
    signIn: jest.fn(),
    signOut: jest.fn(),
    switchContext: jest.fn(),
    retryRestore: jest.fn(),
    authorisedFetch: jest.fn(),
  });
  const storage = new CaptureStorage();
  await storage.activate("account:company");
  jest.mocked(useCaptureStorage).mockReturnValue(storage);
});
afterEach(() => {
  Object.defineProperty(globalThis, "__DEV__", {
    value: originalDev,
    configurable: true,
  });
});
it("AC-12 production gallery redirects and account has no gallery link", async () => {
  Object.defineProperty(globalThis, "__DEV__", {
    value: false,
    configurable: true,
  });
  await render(
    <LocaleProvider initialLocale="en">
      <GalleryScreen />
    </LocaleProvider>,
  );
  expect(screen.getByTestId("redirect")).toHaveTextContent("/");
  await screen.unmount();
  await render(
    <LocaleProvider initialLocale="en">
      <AccountScreen />
    </LocaleProvider>,
  );
  expect(screen.queryByTestId("gallery-link")).toBeNull();
});
it.each(["en", "ar"] as const)(
  "AC-12 %s signed-in development gallery renders every section and opens both reviews",
  async (locale) => {
    Object.defineProperty(globalThis, "__DEV__", {
      value: true,
      configurable: true,
    });
    const t = getMessages(locale).Mobile.Gallery;
    await render(
      <LocaleProvider initialLocale={locale}>
        <GalleryScreen />
      </LocaleProvider>,
    );
    expect(screen.getByTestId("gallery")).toBeTruthy();
    expect(screen.getByText(t.synthetic)).toBeTruthy();
    for (const title of [
      t.states,
      t.statuses,
      t.formatting,
      t.drafts,
      t.approvals,
      t.gateOff,
    ])
      expect(screen.getByText(title)).toBeTruthy();
    await fireEvent.press(screen.getByText(t.ownerReview));
    expect(screen.getByTestId("approval-review")).toBeTruthy();
    await fireEvent.press(
      screen.getByText(getMessages(locale).Mobile.Capture.close),
    );
    await fireEvent.press(screen.getByText(t.tenantReview));
    expect(
      screen.getByText(getMessages(locale).Mobile.Approval.effect.tenant),
    ).toBeTruthy();
    await screen.unmount();
    await render(
      <LocaleProvider initialLocale={locale}>
        <AccountScreen />
      </LocaleProvider>,
    );
    expect(screen.getByTestId("gallery-link")).toBeTruthy();
  },
);
it("AC-12 signed-out people cannot enter the development gallery", async () => {
  Object.defineProperty(globalThis, "__DEV__", {
    value: true,
    configurable: true,
  });
  jest
    .mocked(useSession)
    .mockReturnValue({ ...useSession(), state: { status: "signed_out" } });
  await render(
    <LocaleProvider initialLocale="en">
      <GalleryScreen />
    </LocaleProvider>,
  );
  expect(screen.getByTestId("redirect")).toHaveTextContent("/");
});
