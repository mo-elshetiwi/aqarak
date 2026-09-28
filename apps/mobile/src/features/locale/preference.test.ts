import * as SecureStore from "expo-secure-store";
import { getLocales } from "expo-localization";
import { I18nManager } from "react-native";
import { reloadAppAsync } from "expo";
import {
  loadLocale,
  saveLocale,
  needsDirectionReload,
  resolveLocale,
} from "./preference";
beforeEach(async () => {
  jest.clearAllMocks();
  await SecureStore.deleteItemAsync("aqarak.locale");
  await SecureStore.deleteItemAsync("aqarak.locale_reload_guard");
  Object.defineProperty(I18nManager, "isRTL", {
    value: false,
    configurable: true,
  });
  jest.spyOn(I18nManager, "forceRTL").mockImplementation(() => undefined);
  jest.spyOn(I18nManager, "allowRTL").mockImplementation(() => undefined);
});
describe("AC-4 initial interface language", () => {
  it("selects Arabic from the device and corrects direction", async () => {
    jest.mocked(getLocales).mockReturnValue([
      {
        languageCode: "ar",
        languageScriptCode: null,
        languageRegionCode: "AE",
        languageCurrencyCode: "AED",
        languageCurrencySymbol: "د.إ",
        languageTag: "ar-AE",
        textDirection: "rtl",
        digitGroupingSeparator: ",",
        decimalSeparator: ".",
        measurementSystem: "metric",
        currencyCode: "AED",
        currencySymbol: "د.إ",
        regionCode: "AE",
        temperatureUnit: "celsius",
      },
    ]);
    expect(await loadLocale()).toBe("ar");
    expect(I18nManager.forceRTL).toHaveBeenCalledWith(true);
  });
  it("uses English preference ahead of an Arabic device", async () => {
    await SecureStore.setItemAsync("aqarak.locale", "en");
    Object.defineProperty(I18nManager, "isRTL", {
      value: true,
      configurable: true,
    });
    expect(await loadLocale()).toBe("en");
    expect(I18nManager.allowRTL).toHaveBeenCalledWith(false);
    expect(I18nManager.forceRTL).toHaveBeenCalledWith(false);
    expect(resolveLocale(null, "en")).toBe("en");
  });
});
describe("AC-5 language direction changes", () => {
  it("stores Arabic and reloads only once across repeated startup corrections", async () => {
    await saveLocale("ar");
    await loadLocale();
    expect(await SecureStore.getItemAsync("aqarak.locale")).toBe("ar");
    expect(I18nManager.forceRTL).toHaveBeenCalledWith(true);
    expect(reloadAppAsync).toHaveBeenCalledTimes(1);
  });
  it("does not reload between left-to-right languages", () => {
    expect(needsDirectionReload("ltr", "ltr")).toBe(false);
  });
});
