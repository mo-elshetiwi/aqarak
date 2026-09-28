import { useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, Pressable, View } from "react-native";
import { CameraView } from "expo-camera";
import { Camera, Square } from "lucide-react-native";
import { useTranslations } from "use-intl";
import type { Result } from "@aqarak/domain";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/features/locale/locale-provider";
import { useThemeColors } from "@/theme/colors";
import { type CapturedMedia, type CaptureError, captureError } from "./media";
import type { CaptureStorage } from "./storage";
import { takePhoto, recordVideo } from "./camera";
import { CameraPermission } from "./camera-permission";
/** An explicit camera mode switch retains media privately and stops recording on departure. */
export function CameraCapture({
  storage,
  initialMode = "photo",
  onResult,
}: {
  storage: CaptureStorage;
  initialMode?: "photo" | "video";
  onResult: (result: Result<CapturedMedia, CaptureError>) => void;
}): ReactNode {
  const [mode, setMode] = useState(initialMode);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<CaptureError | null>(null);
  const camera = useRef<CameraView>(null);
  const recordingCamera = useRef<CameraView | null>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const t = useTranslations("Mobile.Capture");
  const { locale } = useLocale();
  const colors = useThemeColors();
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") recordingCamera.current?.stopRecording();
    });
    return () => {
      mounted.current = false;
      recordingCamera.current?.stopRecording();
      subscription.remove();
    };
  }, []);
  async function capture(): Promise<void> {
    if (!camera.current || !ready) return;
    if (busyRef.current) {
      if (mode === "video") camera.current.stopRecording();
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setFailure(null);
    if (mode === "video") recordingCamera.current = camera.current;
    const result =
      mode === "photo"
        ? await takePhoto(camera.current, storage)
        : await recordVideo(camera.current, storage);
    recordingCamera.current = null;
    busyRef.current = false;
    if (!mounted.current) {
      if (result.ok) storage.discard(result.value.uri);
      return;
    }
    setBusy(false);
    if (!result.ok) setFailure(result.error);
    onResult(result);
  }
  function switchMode(next: "photo" | "video"): void {
    if (busyRef.current) return;
    setReady(false);
    setMode(next);
    setFailure(null);
  }
  const label =
    mode === "photo"
      ? t("takePhoto")
      : busy
        ? t("stopVideo")
        : t("recordVideo");
  return (
    <View className="gap-4">
      <View className="flex-row gap-2">
        <Button
          variant="secondary"
          label={t("photo")}
          disabled={busy || mode === "photo"}
          onPress={() => {
            switchMode("photo");
          }}
        />
        <Button
          testID="camera-mode-video"
          variant="secondary"
          label={t("video")}
          disabled={busy || mode === "video"}
          onPress={() => {
            switchMode("video");
          }}
        />
      </View>
      <CameraPermission key={mode} mode={mode}>
        <View className="overflow-hidden rounded-lg bg-muted">
          <CameraView
            key={mode}
            ref={camera}
            style={{ height: 320, width: "100%" }}
            mode={mode === "photo" ? "picture" : "video"}
            mute={false}
            videoQuality="720p"
            onCameraReady={() => {
              setReady(true);
            }}
            onMountError={() => {
              setReady(false);
              setFailure(captureError("capture_failed", mode));
            }}
          />
        </View>
        <Pressable
          testID="camera-shutter"
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{
            disabled: !ready || (busy && mode === "photo"),
            busy,
          }}
          disabled={!ready || (busy && mode === "photo")}
          onPress={() => {
            void capture();
          }}
          className="h-16 w-16 items-center justify-center self-center rounded-full bg-primary"
        >
          {busy && mode === "video" ? (
            <Square
              size={24}
              color={colors.primaryForeground}
              accessible={false}
            />
          ) : (
            <Camera
              size={24}
              color={colors.primaryForeground}
              accessible={false}
            />
          )}
        </Pressable>
        <Text className="text-center">{label}</Text>
      </CameraPermission>
      {failure && (
        <Text accessibilityRole="alert">{failure.message[locale]}</Text>
      )}
    </View>
  );
}
