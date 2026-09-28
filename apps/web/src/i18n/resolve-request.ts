import { getMessages, locales, type Locale, type Messages } from "@aqarak/i18n";
import { hasLocale } from "next-intl";
/** Refuses unsupported locale input and loads messages for a supported language. */
export function resolveRequestLocale(
  value: unknown,
): { locale: Locale; messages: Messages } | undefined {
  if (typeof value !== "string" || !hasLocale(locales, value)) return undefined;
  return { locale: value, messages: getMessages(value) };
}
