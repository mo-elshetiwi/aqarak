import { useContext, type ReactNode } from "react";
import { TextLocaleContext } from "./typography";
import { View } from "react-native";
import { vars, useColorScheme } from "nativewind";
import { ThemeProvider as NavigationThemeProvider } from "expo-router";
import { fontFamilies } from "@aqarak/ui-tokens";
import { colorTokens } from "@aqarak/ui-tokens/color";
import { navigationColors, themeVariables } from "./colors";
/** Supplies semantic colours to native styles and utility classes together. */
export function ThemeProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const { colorScheme } = useColorScheme();
  const scheme = colorScheme === "dark" ? "dark" : "light";
  const locale = useContext(TextLocaleContext);
  const family = fontFamilies[locale === "ar" ? "arabic" : "latin"];
  return (
    <View
      style={[
        vars(themeVariables(scheme)),
        { flex: 1, backgroundColor: colorTokens[scheme].background },
      ]}
    >
      <NavigationThemeProvider
        value={{
          dark: scheme === "dark",
          colors: navigationColors(scheme),
          fonts: {
            regular: { fontFamily: family[400], fontWeight: "400" },
            medium: { fontFamily: family[500], fontWeight: "500" },
            bold: { fontFamily: family[600], fontWeight: "600" },
            heavy: { fontFamily: family[600], fontWeight: "600" },
          },
        }}
      >
        {children}
      </NavigationThemeProvider>
    </View>
  );
}
