import { useEffect, useRef, useState, type ReactNode } from "react";
import { Modal, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Camera, Image, Mic, Paperclip, X } from "lucide-react-native";
import { useTranslations } from "use-intl";
import type { Result } from "@aqarak/domain";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/features/locale/locale-provider";
import { useThemeColors } from "@/theme/colors";
import { CameraCapture } from "./camera-capture";
import { VoiceNoteCapture, type VoiceNoteHandle } from "./voice-note";
import { pickDocument } from "./document";
import type { CaptureStorage } from "./storage";
import type { CapturedMedia, CaptureError } from "./media";
/** One private capture entry point shares document, camera and tap-recording ownership. */
export function CaptureSheet({
  visible,
  storage,
  onCapture,
  onClose,
}: {
  visible: boolean;
  storage: CaptureStorage;
  onCapture: (media: CapturedMedia) => void;
  onClose: () => void;
}): ReactNode {
  const t = useTranslations("Mobile.Capture");
  const { locale } = useLocale();
  const colors = useThemeColors();
  const [mode, setMode] = useState<"photo" | "video" | "voice_note" | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<CaptureError | null>(null);
  const voice = useRef<VoiceNoteHandle>(null);
  const mounted = useRef(true);
  const busy = useRef(false);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  function close(): void {
    setMode(null);
    setFailure(null);
    onClose();
  }
  function requestClose(): void {
    if (busy.current) return;
    if (mode === "voice_note") voice.current?.requestClose();
    else close();
  }
  function result(value: Result<CapturedMedia, CaptureError>): void {
    if (!mounted.current) {
      if (value.ok) storage.discard(value.value.uri);
      return;
    }
    if (value.ok) {
      onCapture(value.value);
      close();
    } else if (value.error.code !== "cancelled") setFailure(value.error);
  }
  async function document(): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setFailure(null);
    try {
      result(await pickDocument(storage));
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }
  const options = [
    {
      mode: "photo",
      id: "photo",
      icon: Camera,
      label: "photo",
      accepts: "acceptsPhoto",
    },
    {
      mode: "video",
      id: "video",
      icon: Image,
      label: "video",
      accepts: "acceptsVideo",
    },
    {
      mode: "voice_note",
      id: "voice-note",
      icon: Mic,
      label: "voiceNote",
      accepts: "acceptsVoice",
    },
  ] as const;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={requestClose}
    >
      <View className="flex-1 justify-end bg-overlay">
        <SafeAreaView
          edges={["bottom"]}
          testID="capture-sheet"
          accessibilityViewIsModal
          className="rounded-t-lg bg-background"
          style={{ maxHeight: "90%" }}
        >
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 16, gap: 16 }}
          >
            <View className="flex-row items-center gap-2">
              <Text variant="h2" className="flex-1">
                {t("title")}
              </Text>
              {mode !== "voice_note" && (
                <>
                  <X
                    size={24}
                    color={colors.mutedForeground}
                    accessible={false}
                  />
                  <Button
                    variant="ghost"
                    label={t("close")}
                    disabled={pending}
                    onPress={requestClose}
                  />
                </>
              )}
            </View>
            {mode === "voice_note" ? (
              <VoiceNoteCapture
                ref={voice}
                storage={storage}
                onResult={result}
                onClose={close}
              />
            ) : mode ? (
              <CameraCapture
                key={mode}
                initialMode={mode}
                storage={storage}
                onResult={result}
              />
            ) : (
              <>
                {options.map((option) => (
                  <View key={option.id} className="gap-1">
                    <View className="flex-row items-center gap-2">
                      <option.icon
                        size={24}
                        color={colors.mutedForeground}
                        accessible={false}
                      />
                      <Button
                        className="h-auto min-h-12 flex-1 py-3"
                        testID={`capture-option-${option.id}`}
                        variant="secondary"
                        label={t(option.label)}
                        disabled={pending}
                        onPress={() => {
                          setFailure(null);
                          setMode(option.mode);
                        }}
                      />
                    </View>
                    <Text variant="body">{t(option.accepts)}</Text>
                  </View>
                ))}
                <View className="gap-1">
                  <View className="flex-row items-center gap-2">
                    <Paperclip
                      size={24}
                      color={colors.mutedForeground}
                      accessible={false}
                    />
                    <Button
                      className="h-auto min-h-12 flex-1 py-3"
                      testID="capture-option-document"
                      variant="secondary"
                      label={t("file")}
                      loading={pending}
                      onPress={() => {
                        void document();
                      }}
                    />
                  </View>
                  <Text variant="body">{t("acceptsDocument")}</Text>
                </View>
                <Text>{t("goodDocument")}</Text>
                <Text>{t("refusedDocument")}</Text>
              </>
            )}
            {failure && (
              <Text accessibilityRole="alert">{failure.message[locale]}</Text>
            )}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}
