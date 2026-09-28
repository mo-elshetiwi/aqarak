import { useColorScheme } from "nativewind";
import { colorTokens } from "@aqarak/ui-tokens/color";

/** Appearance schemes supported by the shared semantic tokens. */
export type ColorScheme = keyof typeof colorTokens;
/** Converts shared camelCase names to the public utility vocabulary. */
export function utilityName(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
/** RGB channels keep NativeWind opacity modifiers available. */
export function themeVariables(scheme: ColorScheme): Record<string, string> {
  const variables = Object.fromEntries(
    Object.entries(colorTokens[scheme]).map(([name, value]) => [
      `--${utilityName(name)}`,
      [1, 3, 5]
        .map((offset) => parseInt(value.slice(offset, offset + 2), 16))
        .join(" "),
    ]),
  );
  variables["--overlay-alpha"] = String(
    parseInt(colorTokens[scheme].overlay.slice(7, 9), 16) / 255,
  );
  return variables;
}
/** All navigation surfaces are derived from the same semantic scheme. */
export function navigationColors(scheme: ColorScheme): {
  primary: string;
  background: string;
  card: string;
  text: string;
  border: string;
  notification: string;
} {
  const c = colorTokens[scheme];
  return {
    primary: c.brand,
    background: c.background,
    card: c.card,
    text: c.foreground,
    border: c.border,
    notification: c.destructive,
  };
}

/** Imperative native properties use the active semantic scheme. */
export function useThemeColors():
  typeof colorTokens.light | typeof colorTokens.dark {
  const { colorScheme } = useColorScheme();
  return colorTokens[colorScheme === "dark" ? "dark" : "light"];
}
