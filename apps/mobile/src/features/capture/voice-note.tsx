import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { Alert, AppState, Pressable, View } from "react-native";
import { useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import {
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  RecordingPresets,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioRecorder,
} from "expo-audio";
import { Mic, Play, Square } from "lucide-react-native";
import { useTranslations } from "use-intl";
import type { Result } from "@aqarak/domain";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useLocale } from "@/features/locale/locale-provider";
import { useThemeColors } from "@/theme/colors";
import {
  captureError,
  captureLimits,
  type CapturedMedia,
  type CaptureError,
} from "./media";
import type { CaptureStorage } from "./storage";
import { PermissionRationale } from "./permission-rationale";
import { VoiceRecording, voiceElapsed } from "./voice-recording";
/** A sheet can route hardware dismissal through the same unsaved-recording guard. */
export interface VoiceNoteHandle {
  requestClose: () => void;
}
/** Tap recording, explicit permission rationale and private playback share one lifecycle owner. */
export function VoiceNoteCapture({
  storage,
  onResult,
  onClose,
  ref,
}: {
  storage: CaptureStorage;
  onResult: (result: Result<CapturedMedia, CaptureError>) => void;
  onClose: () => void;
  ref?: Ref<VoiceNoteHandle>;
}): ReactNode {
  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  });
  const player = useAudioPlayer(null);
  const [recording] = useState(() => new VoiceRecording(recorder, storage));
  const [phase, setPhase] = useState<"idle" | "recording" | "preview">("idle");
  const [rationale, setRationale] = useState(false);
  const [denied, setDenied] = useState(false);
  const [pending, setPending] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [duration, setDuration] = useState(0);
  const [level, setLevel] = useState(0);
  const [failure, setFailure] = useState<CaptureError | null>(null);
  const busy = useRef(false);
  const mounted = useRef(true);
  const used = useRef(false);
  const t = useTranslations("Mobile.Capture");
  const { locale } = useLocale();
  const navigation = useNavigation();
  const colors = useThemeColors();
  const fail = useCallback((): void => {
    if (mounted.current)
      setFailure(captureError("capture_failed", "voice_note"));
  }, []);
  async function discard(): Promise<void> {
    player.pause();
    await recording.discard();
    await setAudioModeAsync({ allowsRecording: false });
    if (mounted.current) setDirty(false);
  }
  function requestClose(close: () => void): void {
    if (!dirty) {
      close();
      return;
    }
    Alert.alert(t("discardTitle"), t("discardNotice"), [
      { text: t("keepRecording"), style: "cancel" },
      {
        text: t("discard"),
        style: "destructive",
        onPress: () => {
          void discard().then(close).catch(fail);
        },
      },
    ]);
  }
  useImperativeHandle(ref, () => ({
    requestClose: () => {
      requestClose(onClose);
    },
  }));
  usePreventRemove(dirty, ({ data }) => {
    requestClose(() => {
      navigation.dispatch(data.action);
    });
  });
  const stop = useCallback(async (): Promise<void> => {
    if (busy.current || phase !== "recording") return;
    busy.current = true;
    setPending(true);
    try {
      await recording.stop();
      await setAudioModeAsync({ allowsRecording: false });
      if (!stillMounted()) return;
      setDuration(recording.sample().durationMs);
      if (recorder.uri) player.replace(recorder.uri);
      setPhase("preview");
    } catch {
      fail();
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }, [phase, recording, recorder, player, fail]);
  useEffect(() => {
    if (phase !== "recording") return;
    const timer = setInterval(() => {
      const sample = recording.sample();
      setDuration(sample.durationMs);
      setLevel(Math.max(0, Math.min(1, (sample.metering + 60) / 60)));
      if (
        sample.durationMs >= captureLimits.audioDurationMs ||
        !sample.recording
      )
        void stop();
    }, 100);
    const limit = setTimeout(() => {
      void stop();
    }, captureLimits.audioDurationMs);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") void stop();
    });
    return () => {
      clearInterval(timer);
      clearTimeout(limit);
      subscription.remove();
    };
  }, [phase, recording, stop]);
  useEffect(
    () => () => {
      mounted.current = false;
      void recording.discard().catch(() => undefined);
      void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    },
    [recording],
  );
  function stillMounted(): boolean {
    return mounted.current;
  }
  async function start(continued: boolean): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const permission = continued
        ? await requestRecordingPermissionsAsync()
        : await getRecordingPermissionsAsync();
      if (!stillMounted()) return;
      if (!permission.granted) {
        setRationale(true);
        setDenied(continued);
        return;
      }
      setRationale(false);
      setDirty(true);
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        shouldPlayInBackground: false,
      });
      if (!stillMounted()) return;
      await recording.start();
      if (stillMounted()) setPhase("recording");
    } catch {
      fail();
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }
  async function saveRecording(): Promise<void> {
    if (busy.current || used.current) return;
    busy.current = true;
    setPending(true);
    try {
      player.pause();
      const result = await recording.retain();
      if (!stillMounted()) return;
      if (result.ok) {
        used.current = true;
        setSaved(true);
        setDirty(false);
      } else setFailure(result.error);
      onResult(result);
    } catch {
      fail();
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }
  const label =
    phase === "recording" ? t("stopVoiceNote") : t("recordVoiceNote");
  return (
    <View className="gap-4">
      <Text variant="h3">{t("voiceNote")}</Text>
      {rationale ? (
        <PermissionRationale
          rationale={t("microphoneRationale")}
          denied={denied}
          pending={pending}
          onContinue={() => {
            void start(true);
          }}
          onSettingsFailure={() => {
            setDenied(true);
          }}
        />
      ) : (
        <>
          {phase !== "preview" && (
            <Pressable
              testID="voice-note-toggle"
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ disabled: pending, busy: pending }}
              disabled={pending}
              className="h-16 w-16 items-center justify-center self-center rounded-full bg-primary"
              onPress={() => {
                void (phase === "recording" ? stop() : start(false));
              }}
            >
              {phase === "recording" ? (
                <Square
                  size={24}
                  color={colors.primaryForeground}
                  accessible={false}
                />
              ) : (
                <Mic
                  size={24}
                  color={colors.primaryForeground}
                  accessible={false}
                />
              )}
            </Pressable>
          )}
          <Text
            testID="voice-note-elapsed"
            style={{ writingDirection: "ltr", fontVariant: ["tabular-nums"] }}
          >
            {voiceElapsed(duration)}
          </Text>
          {phase === "recording" && (
            <View
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel={t("level")}
              accessibilityValue={{
                min: 0,
                max: 100,
                now: Math.round(level * 100),
              }}
              className="h-4 flex-row overflow-hidden rounded bg-muted"
            >
              <View
                testID="voice-note-level"
                className="h-4 bg-brand"
                style={{ flex: level }}
              />
              <View style={{ flex: 1 - level }} />
            </View>
          )}
          {phase === "preview" && (
            <>
              <View className="flex-row items-center gap-2">
                <Play
                  size={24}
                  color={colors.mutedForeground}
                  accessible={false}
                />
                <Button
                  variant="secondary"
                  label={t("playRecording")}
                  disabled={pending}
                  onPress={() => {
                    void player
                      .seekTo(0)
                      .then(() => {
                        player.play();
                      })
                      .catch(fail);
                  }}
                />
              </View>
              <Button
                testID="voice-note-use"
                label={t("useRecording")}
                loading={pending}
                disabled={saved}
                onPress={() => {
                  void saveRecording();
                }}
              />
            </>
          )}
          {dirty && (
            <Button
              testID="voice-note-discard"
              variant="ghost"
              label={t("discard")}
              disabled={pending}
              onPress={() => {
                void discard().then(onClose).catch(fail);
              }}
            />
          )}
        </>
      )}
      <Button
        variant="ghost"
        label={t("close")}
        disabled={pending}
        onPress={() => {
          requestClose(onClose);
        }}
      />
      {failure && (
        <Text accessibilityRole="alert">{failure.message[locale]}</Text>
      )}
    </View>
  );
}
