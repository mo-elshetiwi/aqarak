import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Alert, Linking } from "react-native";
import { getMessages } from "@aqarak/i18n";
import { LocaleProvider } from "@/features/locale/locale-provider";
import { captureTestFiles } from "@/testing/file-system";
import { emitSessionEvent } from "@/features/auth/session-events";
import { CaptureStorage } from "./storage";
import { VoiceNoteCapture } from "./voice-note";
import { VoiceRecording, type VoiceRecorder } from "./voice-recording";
import { validateCapturedMedia } from "./media";
const uri = "file:///private-cache/audio/note.m4a";
let mockActive = false;
let mockStarted = 0;
const mockRecorder: VoiceRecorder = {
  uri,
  prepareToRecordAsync: jest.fn(() => {
    captureTestFiles.set(uri, 2048);
    return Promise.resolve();
  }),
  record: jest.fn(() => {
    mockActive = true;
    mockStarted = Date.now();
  }),
  stop: jest.fn(() => {
    mockActive = false;
    return Promise.resolve();
  }),
  getStatus: jest.fn(() => ({
    canRecord: true,
    isRecording: mockActive,
    durationMillis: mockActive ? Date.now() - mockStarted : 0,
    metering: -30,
    mediaServicesDidReset: false,
    url: uri,
  })),
};
const mockGetPermission = jest.fn<Promise<{ granted: boolean }>, []>();
const mockRequestPermission = jest.fn<Promise<{ granted: boolean }>, []>();
const mockPlayer = {
  pause: jest.fn(),
  play: jest.fn(),
  replace: jest.fn(),
  seekTo: jest.fn(() => Promise.resolve()),
};
jest.mock("expo-audio", () => ({
  RecordingPresets: { HIGH_QUALITY: {} },
  useAudioRecorder: () => mockRecorder,
  useAudioPlayer: () => mockPlayer,
  getRecordingPermissionsAsync: () => mockGetPermission(),
  requestRecordingPermissionsAsync: () => mockRequestPermission(),
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock("expo-router/react-navigation", () => ({
  usePreventRemove: jest.fn(),
}));
jest.mock("expo-router", () => {
  const actual =
    jest.requireActual<typeof import("expo-router")>("expo-router");
  return { ...actual, useNavigation: () => ({ dispatch: jest.fn() }) };
});
beforeEach(() => {
  jest.useFakeTimers();
  mockActive = false;
  mockGetPermission.mockResolvedValue({ granted: true });
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllTimers();
  jest.useRealTimers();
});
async function owner(): Promise<CaptureStorage> {
  const storage = new CaptureStorage();
  await storage.activate("account:company");
  return storage;
}
async function mount(
  locale: "en" | "ar" = "en",
): Promise<{ result: jest.Mock; close: jest.Mock }> {
  const result = jest.fn();
  const close = jest.fn();
  await render(
    <LocaleProvider initialLocale={locale}>
      <VoiceNoteCapture
        storage={await owner()}
        onResult={result}
        onClose={close}
      />
    </LocaleProvider>,
  );
  return { result, close };
}
it.each(["en", "ar"] as const)(
  "AC-5 %s starts and stops once, previews and retains duration with Western elapsed digits",
  async (locale) => {
    const { result } = await mount(locale);
    expect(mockGetPermission).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId("voice-note-toggle"));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByTestId("voice-note-elapsed")).toHaveTextContent("00:03");
    expect(screen.getByRole("progressbar")).toHaveProp("accessibilityValue", {
      min: 0,
      max: 100,
      now: 50,
    });
    await fireEvent.press(screen.getByTestId("voice-note-toggle"));
    expect(mockRecorder.record).toHaveBeenCalledTimes(1);
    expect(mockRecorder.stop).toHaveBeenCalledTimes(1);
    await fireEvent.press(
      screen.getByText(getMessages(locale).Mobile.Capture.playRecording),
    );
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId("voice-note-use"));
    await fireEvent.press(screen.getByTestId("voice-note-use"));
    expect(result).toHaveBeenCalledTimes(1);
    expect(result.mock.calls).toMatchObject([
      [
        {
          ok: true,
          value: { kind: "voice_note", sizeBytes: 2048, durationMs: 3000 },
        },
      ],
    ]);
    expect([...captureTestFiles.keys()]).toEqual([
      expect.stringContaining("/capture/"),
    ]);
  },
);
it("AC-5 automatically stops at five minutes", async () => {
  await mount();
  await fireEvent.press(screen.getByTestId("voice-note-toggle"));
  await act(async () => {
    await jest.advanceTimersByTimeAsync(300_000);
  });
  expect(mockRecorder.record).toHaveBeenCalledWith({ forDuration: 300 });
  expect(mockRecorder.stop).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("voice-note-elapsed")).toHaveTextContent("05:00");
  expect(screen.getByTestId("voice-note-use")).toBeTruthy();
});
it.each(["en", "ar"] as const)(
  "AC-5 %s requests permission only after the rationale Continue and offers settings after denial",
  async (locale) => {
    mockGetPermission.mockResolvedValue({ granted: false });
    mockRequestPermission.mockResolvedValue({ granted: false });
    const settings = jest.spyOn(Linking, "openSettings").mockResolvedValue();
    await mount(locale);
    await fireEvent.press(screen.getByTestId("voice-note-toggle"));
    expect(
      screen.getByText(getMessages(locale).Mobile.Capture.microphoneRationale),
    ).toBeTruthy();
    expect(mockRequestPermission).not.toHaveBeenCalled();
    expect(mockRecorder.record).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId("permission-continue"));
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId("permission-open-settings"));
    expect(settings).toHaveBeenCalledTimes(1);
  },
);
it("leaving asks before discarding an unsaved voice note", async () => {
  const alert = jest.spyOn(Alert, "alert");
  const { close } = await mount();
  await fireEvent.press(screen.getByTestId("voice-note-toggle"));
  await fireEvent.press(screen.getByText("Close"));
  expect(close).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith(
    "Discard voice note?",
    "Leaving discards your unsaved voice note.",
    expect.any(Array),
  );
  await act(async () => {
    alert.mock.calls[0]?.[2]?.[1]?.onPress?.();
    await Promise.resolve();
  });
  expect(close).toHaveBeenCalledTimes(1);
  expect(captureTestFiles.size).toBe(0);
});
it.each(["signed_out", "context_changed"] as const)(
  "AC-6 %s wipes retained voice notes",
  async (type) => {
    const storage = await owner();
    const unbind = storage.bind();
    const recording = new VoiceRecording(mockRecorder, storage);
    await recording.start();
    await jest.advanceTimersByTimeAsync(1000);
    await recording.stop();
    expect((await recording.retain()).ok).toBe(true);
    expect(captureTestFiles.size).toBe(1);
    await emitSessionEvent({
      type,
      accountId: "account",
      previousCompanyId: "company",
      companyId: null,
    });
    expect(captureTestFiles.size).toBe(0);
    unbind();
  },
);
it("voice notes refuse excessive size and duration with named bilingual limits", () => {
  const media = {
    kind: "voice_note",
    uri,
    mimeType: "audio/mp4",
    sizeBytes: 0,
    durationMs: 0,
  };
  for (const [over, code, limit] of [
    [{ sizeBytes: 26 * 1024 * 1024 }, "too_large", "25"],
    [{ durationMs: 300001 }, "too_long", "5"],
  ] as const) {
    const result = validateCapturedMedia({ ...media, ...over });
    if (result.ok) throw new Error("Expected refusal");
    expect(result.error.code).toBe(code);
    expect(result.error.message.en).toContain(limit);
    expect(result.error.message.ar).toContain(limit);
  }
});
it("departure during native preparation erases the late temporary without starting", async () => {
  let finish: (() => void) | undefined;
  jest.mocked(mockRecorder.prepareToRecordAsync).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const recording = new VoiceRecording(mockRecorder, await owner());
  const start = recording.start();
  const discard = recording.discard();
  captureTestFiles.set(uri, 512);
  finish?.();
  await start;
  await discard;
  expect(mockRecorder.record).not.toHaveBeenCalled();
  expect(captureTestFiles.size).toBe(0);
});
