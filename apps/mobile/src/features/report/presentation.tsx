import type { ReactNode } from "react";
import { Image, View } from "react-native";
import { useTranslations } from "use-intl";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import type { CapturedMedia } from "@/features/capture/media";
import type { ReportErrorCode } from "./client";
export const reportButtonClass = "h-auto min-h-12 py-3";
/** I put the emergency instruction before the screen title and all report controls. */
export function SafetyBanner(): ReactNode {
  const t = useTranslations("Report");
  return (
    <View
      testID="report-safety"
      accessibilityRole="alert"
      className="rounded-lg border border-status-danger-border bg-status-danger-bg p-4"
    >
      <Text className="text-status-danger-fg">{t("safety")}</Text>
    </View>
  );
}
const errorKeys = {
  UNAUTHENTICATED: "unavailable",
  NOT_FOUND: "unavailable",
  NOT_AUTHORISED: "unavailable",
  INVALID_INPUT: "invalidInput",
  INVALID_REQUEST: "invalidInput",
  UPLOAD_ALREADY_COMPLETED: "couldNotLoad",
  UPLOAD_NOT_READY: "couldNotLoad",
  LIMIT_EXCEEDED: "limitExceeded",
  UNSUPPORTED_TYPE: "unsupportedType",
  MEDIA_NOT_READY: "mediaNotReady",
  MEDIA_IN_USE: "mediaInUse",
  UPLOAD_MISMATCH: "uploadMismatch",
  UPLOAD_NOT_FOUND: "uploadNotFound",
  STALE_VERSION: "stale",
  EXPIRED: "expired",
  ALREADY_DECIDED: "couldNotLoad",
  IDEMPOTENCY_KEY_REUSED: "keyReused",
  unexpected_response: "couldNotLoad",
  network_unavailable: "couldNotLoad",
  upload_failed: "uploadFailed",
  could_not_load: "couldNotLoad",
} as const satisfies Record<ReportErrorCode, string>;
/** I pair each recoverable error with a nearby action while leaving the input mounted. */
export function ReportFailure({
  code,
  onRetry,
}: {
  code: ReportErrorCode;
  onRetry?: () => void;
}): ReactNode {
  const t = useTranslations("Report");
  return (
    <View className="gap-2" accessibilityLiveRegion="polite">
      <Text accessibilityRole="alert">{t(errorKeys[code])}</Text>
      {onRetry && (
        <Button
          variant="secondary"
          className={reportButtonClass}
          label={t(
            code === "STALE_VERSION"
              ? "reload"
              : code === "EXPIRED"
                ? "restart"
                : "retry",
          )}
          onPress={onRetry}
        />
      )}
    </View>
  );
}
/** I reuse the installed audio playback primitive for privately retained recordings. */
export function VoicePlayback({ uri }: { uri: string }): ReactNode {
  const t = useTranslations("Report");
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  return (
    <Button
      variant="secondary"
      className={reportButtonClass}
      label={t(status.playing ? "pause" : "play")}
      onPress={() => {
        if (status.playing) player.pause();
        else {
          if (status.didJustFinish)
            void player.seekTo(0).then(() => {
              player.play();
            });
          else player.play();
        }
      }}
    />
  );
}
/** I render local photos without inventing a download URL absent from the API contract. */
export function ReportPhotos({
  photos,
  onRemove,
}: {
  photos: CapturedMedia[];
  onRemove?: (index: number) => void;
}): ReactNode {
  const t = useTranslations("Report");
  return (
    <View className="flex-row flex-wrap gap-3">
      {photos.map((photo, index) => (
        <View key={photo.uri} className="gap-2">
          <Image
            source={{ uri: photo.uri }}
            style={{ width: 96, height: 96 }}
            accessibilityLabel={t("photo", { number: index + 1 })}
            accessible
          />
          {onRemove && (
            <Button
              variant="ghost"
              className={reportButtonClass}
              label={t("removePhoto", { number: index + 1 })}
              onPress={() => {
                onRemove(index);
              }}
            />
          )}
        </View>
      ))}
    </View>
  );
}
