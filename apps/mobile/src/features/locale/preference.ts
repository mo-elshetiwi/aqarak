import * as SecureStore from "expo-secure-store";
import { getLocales } from "expo-localization";
import { I18nManager } from "react-native";
import { reloadAppAsync } from "expo";
import { getDirection, isLocale, type Locale } from "@aqarak/i18n";
// These preferences contain no personal data and survive sign-out.
const localeKey = "aqarak.locale";
const reloadGuardKey = "aqarak.locale_reload_guard";
/** A supported stored preference wins over the device language. */
export function resolveLocale(stored: unknown, device: unknown): Locale {
  return isLocale(stored) ? stored : device === "ar" ? "ar" : "en";
}
/** Direction changes alone require restarting native layout. */
export function needsDirectionReload(
  current: "ltr" | "rtl",
  next: "ltr" | "rtl",
): boolean {
  return current !== next;
}
/** A persistent attempt marker prevents unsupported runtimes from reloading forever. */
export async function applyDirection(locale: Locale): Promise<void> {
  const direction = getDirection(locale);
  I18nManager.allowRTL(direction === "rtl");
  I18nManager.forceRTL(direction === "rtl");
  if (!needsDirectionReload(I18nManager.isRTL ? "rtl" : "ltr", direction)) {
    await SecureStore.deleteItemAsync(reloadGuardKey);
    return;
  }
  const attempted = await SecureStore.getItemAsync(reloadGuardKey);
  if (attempted === locale) return;
  await SecureStore.setItemAsync(reloadGuardKey, locale);
  await reloadAppAsync();
}
/** Invalid stored preferences are removed before selecting the device default. */
export async function loadLocale(): Promise<Locale> {
  const stored = await SecureStore.getItemAsync(localeKey);
  if (stored !== null && !isLocale(stored))
    await SecureStore.deleteItemAsync(localeKey);
  const locale = resolveLocale(stored, getLocales()[0].languageCode);
  await applyDirection(locale);
  return locale;
}
/** Saving the preference before reload makes the next launch deterministic. */
export async function saveLocale(locale: Locale): Promise<void> {
  await SecureStore.setItemAsync(localeKey, locale);
  await applyDirection(locale);
}
