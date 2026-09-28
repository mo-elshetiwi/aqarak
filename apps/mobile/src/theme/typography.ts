import { createContext } from "react";
import { fontFamilies, typeRoles } from "@aqarak/ui-tokens";
import type { TextStyle } from "react-native";
/** Language is available to base text before other application providers. */
export const TextLocaleContext = createContext<"en" | "ar">("en");
/** Shared type role names for mobile content. */
export type TypeRole = keyof typeof typeRoles;
/** Native text requires explicit alignment and an exact family for each weight. */
export function textStyle(locale: "en" | "ar", role: TypeRole): TextStyle {
  const script = locale === "ar" ? "arabic" : "latin";
  const type = typeRoles[role][script];
  return {
    fontFamily:
      role === "mono"
        ? fontFamilies.mono[400]
        : fontFamilies[script][type.weight],
    fontSize: type.sizePx,
    lineHeight: type.lineHeightPx,
    textAlign: "left",
    writingDirection: locale === "ar" ? "rtl" : "ltr",
  };
}
