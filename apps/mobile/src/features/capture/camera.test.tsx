import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Linking } from "react-native";
import { LocaleProvider } from "@/features/locale/locale-provider";
import { captureTestFiles } from "@/testing/file-system";
import { CaptureStorage } from "./storage";
import { CameraCapture } from "./camera-capture";
import { takePhoto, recordVideo, type CaptureCamera } from "./camera";
const mockCamera: CaptureCamera = {
  takePictureAsync: jest.fn(),
  recordAsync: jest.fn(),
  stopRecording: jest.fn(),
};
const mockRequestCamera = jest.fn();
const mockRequestMicrophone = jest.fn();
let mockCameraAllowed = false;
let mockMicrophoneAllowed = false;
jest.mock("expo-camera", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View } =
    jest.requireActual<typeof import("react-native")>("react-native");
  return {
    CameraView: React.forwardRef<
      CaptureCamera,
      { onCameraReady: () => void; mute: boolean; mode: string }
    >(function CameraViewMock(props, ref) {
      React.useImperativeHandle(ref, () => mockCamera);
      return React.createElement(View, {
        testID: "camera-preview",
        onLayout: props.onCameraReady,
        accessibilityLabel: props.mode,
        accessibilityState: { selected: !props.mute },
      });
    }),
    useCameraPermissions: () => [
      { granted: mockCameraAllowed },
      mockRequestCamera,
    ],
    useMicrophonePermissions: () => [
      { granted: mockMicrophoneAllowed },
      mockRequestMicrophone,
    ],
  };
});
beforeEach(() => {
  mockCameraAllowed = false;
  mockMicrophoneAllowed = false;
  jest.useFakeTimers();
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
it.each(["en", "ar"] as const)(
  "AC-4 %s shows the rationale before requesting and offers settings on denial",
  async (locale) => {
    mockRequestCamera.mockResolvedValue({ granted: false });
    const settings = jest.spyOn(Linking, "openSettings").mockResolvedValue();
    await render(
      <LocaleProvider initialLocale={locale}>
        <CameraCapture storage={await owner()} onResult={jest.fn()} />
      </LocaleProvider>,
    );
    expect(mockRequestCamera).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        locale === "en"
          ? "Aqarak uses the camera to take your photo. Nothing is captured until you tap Take photo."
          : "يستخدم عقارك الكاميرا لالتقاط صورتك. لا يُلتقط شيء حتى تضغط على التقاط صورة.",
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByTestId("permission-continue"));
    expect(mockRequestCamera).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId("permission-open-settings"));
    expect(settings).toHaveBeenCalledTimes(1);
    expect(mockRequestMicrophone).not.toHaveBeenCalled();
  },
);
it("AC-4 the shutter takes a photo without EXIF and retains it only in capture", async () => {
  mockCameraAllowed = true;
  const uri = "file:///private-cache/camera/photo.jpg";
  captureTestFiles.set(uri, 2 * 1024 * 1024);
  jest
    .mocked(mockCamera.takePictureAsync)
    .mockResolvedValue({ uri, width: 100, height: 100, format: "jpg" });
  const result = jest.fn();
  await render(
    <LocaleProvider initialLocale="en">
      <CameraCapture storage={await owner()} onResult={result} />
    </LocaleProvider>,
  );
  expect(screen.getByTestId("camera-shutter")).toBeDisabled();
  await fireEvent(screen.getByTestId("camera-preview"), "layout");
  await fireEvent.press(screen.getByTestId("camera-shutter"));
  expect(mockCamera.takePictureAsync).toHaveBeenCalledWith({ exif: false });
  expect(result).toHaveBeenCalledTimes(1);
  expect(captureTestFiles.has(uri)).toBe(false);
  expect(
    [...captureTestFiles.keys()].every((key) => key.includes("/capture/")),
  ).toBe(true);
});
it("AC-4 video mode asks for the microphone then records with audio and a 60 second maximum", async () => {
  mockCameraAllowed = true;
  mockRequestMicrophone.mockResolvedValue({ granted: true });
  const uri = "file:///private-cache/camera/video.mp4";
  captureTestFiles.set(uri, 1024);
  let finish: ((value: { uri: string }) => void) | undefined;
  jest.mocked(mockCamera.recordAsync).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await render(
    <LocaleProvider initialLocale="en">
      <CameraCapture storage={await owner()} onResult={jest.fn()} />
    </LocaleProvider>,
  );
  await fireEvent.press(screen.getByTestId("camera-mode-video"));
  expect(mockRequestMicrophone).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId("permission-continue"));
  expect(mockRequestMicrophone).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("camera-preview")).toHaveProp(
    "accessibilityState",
    { selected: true },
  );
  await fireEvent(screen.getByTestId("camera-preview"), "layout");
  await fireEvent.press(screen.getByTestId("camera-shutter"));
  expect(mockCamera.recordAsync).toHaveBeenCalledWith({
    maxDuration: 60,
    maxFileSize: 100 * 1024 * 1024,
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(2000);
  });
  await fireEvent.press(screen.getByTestId("camera-shutter"));
  expect(mockCamera.stopRecording).toHaveBeenCalledTimes(1);
  await act(() => {
    finish?.({ uri });
  });
});
it("leaving an active camera view stops video and discards its late result", async () => {
  mockCameraAllowed = true;
  mockMicrophoneAllowed = true;
  const storage = await owner();
  const result = jest.fn();
  let finish: ((value: { uri: string }) => void) | undefined;
  jest.mocked(mockCamera.recordAsync).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await render(
    <LocaleProvider initialLocale="en">
      <CameraCapture initialMode="video" storage={storage} onResult={result} />
    </LocaleProvider>,
  );
  await fireEvent(screen.getByTestId("camera-preview"), "layout");
  await fireEvent.press(screen.getByTestId("camera-shutter"));
  await screen.unmount();
  expect(mockCamera.stopRecording).toHaveBeenCalledTimes(1);
  const uri = "file:///private-cache/camera/video.mp4";
  captureTestFiles.set(uri, 1024);
  await act(() => {
    finish?.({ uri });
  });
  expect(result).not.toHaveBeenCalled();
  expect(captureTestFiles.size).toBe(0);
});
it("camera failures and cancelled native recordings return typed refusals", async () => {
  const storage = await owner();
  jest
    .mocked(mockCamera.takePictureAsync)
    .mockRejectedValue(new Error("Synthetic camera failure"));
  expect(await takePhoto(mockCamera, storage)).toMatchObject({
    ok: false,
    error: { code: "capture_failed" },
  });
  jest.mocked(mockCamera.recordAsync).mockResolvedValue(undefined);
  expect(await recordVideo(mockCamera, storage)).toMatchObject({
    ok: false,
    error: { code: "cancelled" },
  });
});
