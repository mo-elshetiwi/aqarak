import { defineRouting } from "next-intl/routing";
import { locales, defaultLocale } from "@aqarak/i18n";
/** Keeps every public route prefixed by a supported locale. */
export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: "always",
});
