import { render } from "@testing-library/react-native";
import { ThemeProvider as NavigationThemeProvider } from "expo-router";
import { LocaleProvider } from "@/features/locale/locale-provider";
import { ThemeProvider } from "./theme-provider";
jest.mock("expo-router", () => ({
  LocaleProvider: ({ children }: { children: React.ReactNode }) => children,
  ThemeProvider: jest.fn(
    ({ children }: { children: React.ReactNode }) => children,
  ),
}));
it.each([
  ["en", "IBMPlexSans_400Regular"],
  ["ar", "IBMPlexSansArabic_400Regular"],
] as const)(
  "D04 navigation uses the %s interface font",
  async (locale, family) => {
    await render(
      <LocaleProvider initialLocale={locale}>
        <ThemeProvider>{null}</ThemeProvider>
      </LocaleProvider>,
    );
    const theme = jest.mocked(NavigationThemeProvider).mock.calls[0]?.[0].value;
    expect(theme?.fonts.regular.fontFamily).toBe(family);
  },
);
