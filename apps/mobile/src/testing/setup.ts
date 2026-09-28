import "../polyfills";
import * as SecureStore from "expo-secure-store";
import { resetCaptureTestFiles } from "./file-system";
// NativeWind's Metro transform handles this asset in the app runtime.
jest.mock("../../global.css", () => ({}));
jest.mock("expo-splash-screen", () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve(true)),
  hideAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock("expo-secure-store", () => {
  const values = new Map<string, string>();
  return {
    getItemAsync: jest.fn((key: string) =>
      Promise.resolve(values.get(key) ?? null),
    ),
    setItemAsync: jest.fn((key: string, value: string) => {
      values.set(key, value);
      return Promise.resolve();
    }),
    deleteItemAsync: jest.fn((key: string) => {
      values.delete(key);
      return Promise.resolve();
    }),
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: "when-unlocked",
  };
});
jest.mock("expo-localization", () => ({
  getLocales: jest.fn(() => [{ languageCode: "en" }]),
}));
jest.mock("expo-font", () => ({
  useFonts: jest.fn(() => [true, null]),
  isLoaded: jest.fn(() => true),
  loadAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock("@react-native-community/netinfo", () =>
  jest.requireActual<Record<string, unknown>>(
    "@react-native-community/netinfo/jest/netinfo-mock.js",
  ),
);
jest.mock("expo", () => {
  const actual = jest.requireActual<typeof import("expo")>("expo");
  return { ...actual, reloadAppAsync: jest.fn(() => Promise.resolve()) };
});
beforeEach(async () => {
  resetCaptureTestFiles();
  await SecureStore.deleteItemAsync("aqarak.refresh_token");
  await SecureStore.deleteItemAsync("aqarak.active_company_id");
  jest.clearAllMocks();
});

jest.mock("expo-file-system", () =>
  jest.requireActual<typeof import("./file-system")>("./file-system"),
);
jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));

jest.mock("expo-audio", () => ({
  RecordingPresets: { HIGH_QUALITY: {} },
  useAudioRecorder: jest.fn(),
  useAudioPlayer: jest.fn(),
  getRecordingPermissionsAsync: jest.fn(),
  requestRecordingPermissionsAsync: jest.fn(),
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
}));
