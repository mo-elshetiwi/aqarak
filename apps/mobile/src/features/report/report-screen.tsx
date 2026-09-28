import { useRef, useState, type ReactNode } from "react";
import { Modal, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "use-intl";
import type { Result } from "@aqarak/domain";
import { config } from "@/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useSession } from "@/features/auth/session-provider";
import { CameraCapture } from "@/features/capture/camera-capture";
import { VoiceNoteCapture } from "@/features/capture/voice-note";
import { useCaptureStorage } from "@/features/capture/capture-provider";
import type { CapturedMedia, CaptureError } from "@/features/capture/media";
import { useLocale } from "@/features/locale/locale-provider";
import { companyQueryKey } from "@/features/query/cache";
import { useOnlineRequirement } from "@/features/query/connectivity";
import { asReportError, commandKey, type ReportErrorCode } from "./client";
import {
  useReportClient,
  useReportScope,
  useReportUnits,
  useReportLifetime,
} from "./hooks";
import { uploadCapturedMedia, readCaptureBytes } from "./upload";
import {
  ReportFailure,
  ReportPhotos,
  SafetyBanner,
  VoicePlayback,
  reportButtonClass,
} from "./presentation";

/** I retain input and captures through every failed upload or intake attempt. */
export function ReportScreen(): ReactNode {
  const t = useTranslations("Report");
  const { locale, direction } = useLocale();
  const { state } = useSession();
  const { companyId } = useReportScope();
  const client = useReportClient();
  const active = useReportLifetime();
  const units = useReportUnits();
  const cache = useQueryClient();
  const storage = useCaptureStorage();
  const router = useRouter();
  const { allowed } = useOnlineRequirement();
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [voice, setVoice] = useState<CapturedMedia | null>(null);
  const [photos, setPhotos] = useState<CapturedMedia[]>([]);
  const [capture, setCapture] = useState<"photo" | "voice_note" | null>(null);
  const [failure, setFailure] = useState<ReportErrorCode | null>(null);
  const [progress, setProgress] = useState<
    { done: number; total: number } | "analysing" | null
  >(null);
  const locked = useRef(false);
  const intakeCommand = useRef<{ signature: string; key: string } | null>(null);
  const unitId =
    selectedUnit ?? (units.data?.length === 1 ? units.data[0]?.id : null);
  const valid = Boolean(
    unitId && (voice !== null || photos.length > 0 || text.trim().length > 0),
  );
  function captured(result: Result<CapturedMedia, CaptureError>): void {
    if (!result.ok) {
      if (result.error.code !== "cancelled") setFailure("could_not_load");
      return;
    }
    if (result.value.kind === "voice_note") setVoice(result.value);
    else if (result.value.kind === "photo")
      setPhotos((current) => [...current, result.value].slice(0, 3));
    else {
      setFailure("UNSUPPORTED_TYPE");
      return;
    }
    setCapture(null);
  }
  function canCheck(): boolean {
    return active() && !locked.current && allowed && valid;
  }
  async function check(): Promise<void> {
    if (!canCheck() || !unitId) return;
    locked.current = true;
    setFailure(null);
    const captures = [...(voice ? [voice] : []), ...photos];
    try {
      const media = [];
      setProgress({ done: 0, total: captures.length });
      for (const capture of captures) {
        media.push(
          await uploadCapturedMedia(
            client,
            companyId,
            unitId,
            capture,
            readCaptureBytes,
          ),
        );
        if (!active()) return;
        setProgress({ done: media.length, total: captures.length });
      }
      setProgress("analysing");
      const body = {
        unitId,
        language: locale,
        voiceMediaId:
          media.find((item) => item.kind === "voice_note")?.id ?? null,
        photoMediaIds: media
          .filter((item) => item.kind === "photo")
          .map((item) => item.id),
        typedText: text.trim() || null,
      };
      const signature = JSON.stringify(body);
      if (intakeCommand.current?.signature !== signature)
        intakeCommand.current = { signature, key: commandKey() };
      const intake = await client.createIntake(
        companyId,
        body,
        intakeCommand.current.key,
      );
      if (!active()) return;
      cache.setQueryData(
        companyQueryKey(state, ["report", "captures", intake.id]),
        captures,
      );
      router.push({
        pathname: "/report/[intakeId]",
        params: { intakeId: intake.id },
      });
    } catch (error) {
      setFailure(asReportError(error).code);
    } finally {
      locked.current = false;
      setProgress(null);
    }
  }
  const busy = progress !== null;
  const unitFailure = units.error ? asReportError(units.error).code : null;
  function captureControls(): ReactNode {
    return (
      <>
        {units.isPending && (
          <Text accessibilityLiveRegion="polite">{t("loadingUnits")}</Text>
        )}
        {unitFailure && (
          <ReportFailure
            code={unitFailure}
            onRetry={() => {
              void units.refetch();
            }}
          />
        )}
        {units.data?.length === 0 && <Text>{t("noUnits")}</Text>}
        <Text variant="label">{t("unit")}</Text>
        {units.data?.map((unit) => (
          <Button
            key={unit.id}
            testID={`report-unit-${unit.id}`}
            variant="secondary"
            className={reportButtonClass}
            label={unit.label}
            accessibilityState={{ selected: unitId === unit.id }}
            disabled={busy}
            onPress={() => {
              setSelectedUnit(unit.id);
            }}
          />
        ))}
        <Button
          variant="secondary"
          className={reportButtonClass}
          label={t("recordVoice")}
          disabled={busy}
          onPress={() => {
            setCapture("voice_note");
          }}
        />
        {voice && (
          <View className="gap-2">
            <Text>
              {t("duration", {
                seconds: Math.ceil((voice.durationMs ?? 0) / 1000),
              })}
            </Text>
            <VoicePlayback uri={voice.uri} />
            <Button
              variant="ghost"
              className={reportButtonClass}
              label={t("removeVoice")}
              disabled={busy}
              onPress={() => {
                setVoice(null);
              }}
            />
          </View>
        )}
        <ReportPhotos
          photos={photos}
          {...(busy
            ? {}
            : {
                onRemove: (index: number) => {
                  setPhotos((current) =>
                    current.filter((_, position) => position !== index),
                  );
                },
              })}
        />
        <Button
          variant="secondary"
          className={reportButtonClass}
          label={t("addPhoto")}
          disabled={busy || photos.length >= 3}
          onPress={() => {
            setCapture("photo");
          }}
        />
      </>
    );
  }
  function screenContent(): ReactNode {
    return (
      <SafeAreaView
        edges={["top", "left", "right", "bottom"]}
        className="flex-1 bg-background"
        style={{ direction }}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 16, gap: 16 }}
        >
          <SafetyBanner />
          <Text variant="h1">{t("title")}</Text>
          {config.adapter === "fixture" && <Text>{t("synthetic")}</Text>}
          {!allowed && <Text accessibilityRole="alert">{t("offline")}</Text>}
          {captureControls()}
          <Text nativeID="report-description-label" variant="label">
            {t("typedText")}
          </Text>
          <Input
            testID="report-text"
            accessibilityLabel={t("typedText")}
            accessibilityLabelledBy="report-description-label"
            multiline
            maxLength={2000}
            className="h-auto min-h-24 py-3"
            value={text}
            onChangeText={setText}
            editable={!busy}
          />
          {failure && (
            <ReportFailure
              code={failure}
              onRetry={() => {
                void check();
              }}
            />
          )}
          {progress && (
            <Text accessibilityRole="alert" accessibilityLiveRegion="polite">
              {progress === "analysing"
                ? t("analysing")
                : t("uploading", progress)}
            </Text>
          )}
          <Button
            testID="report-check"
            className={reportButtonClass}
            label={t("check")}
            loading={busy}
            disabled={!valid || !allowed || Boolean(unitFailure)}
            onPress={() => {
              void check();
            }}
          />
          <Button
            variant="ghost"
            className={reportButtonClass}
            label={t("back")}
            disabled={busy}
            onPress={() => {
              router.replace("/tenant/maintenance");
            }}
          />
        </ScrollView>
        {capture && (
          <Modal
            visible
            animationType="none"
            onRequestClose={() => {
              if (capture === "photo") setCapture(null);
            }}
          >
            <SafeAreaView
              className="flex-1 bg-background"
              style={{ direction }}
            >
              <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
                {capture === "voice_note" ? (
                  <VoiceNoteCapture
                    storage={storage}
                    onResult={captured}
                    onClose={() => {
                      setCapture(null);
                    }}
                  />
                ) : (
                  <>
                    <CameraCapture
                      storage={storage}
                      initialMode="photo"
                      onResult={captured}
                    />
                    <Button
                      variant="secondary"
                      className={reportButtonClass}
                      label={t("close")}
                      onPress={() => {
                        setCapture(null);
                      }}
                    />
                  </>
                )}
              </ScrollView>
            </SafeAreaView>
          </Modal>
        )}
      </SafeAreaView>
    );
  }
  return screenContent();
}
