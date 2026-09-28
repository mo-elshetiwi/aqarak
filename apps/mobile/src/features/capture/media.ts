import { z } from "zod";
import { ok, err, type Result } from "@aqarak/domain";
import { getMessages } from "@aqarak/i18n";

/** Validated local media metadata contains no upload or shared-library destination. */
export const capturedMediaSchema = z.strictObject({
  kind: z.enum(["photo", "video", "voice_note", "document"]),
  uri: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  durationMs: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER)
    .optional(),
  fileName: z.string().min(1).optional(),
});
/** Media is kept private until a future upload flow explicitly consumes it. */
export type CapturedMedia = z.infer<typeof capturedMediaSchema>;
/** Expected refusals use stable codes, never native exception text. */
export const captureErrorCodeSchema = z.enum([
  "permission_denied",
  "cancelled",
  "too_large",
  "too_long",
  "unsupported_type",
  "capture_failed",
]);
/** Both interface languages travel with every expected capture refusal. */
export interface CaptureError {
  code: z.infer<typeof captureErrorCodeSchema>;
  message: { en: string; ar: string };
}
/** Limits use binary megabytes consistently for validation and tests. */
export const captureLimits = {
  imageBytes: 20 * 1024 * 1024,
  audioBytes: 25 * 1024 * 1024,
  videoBytes: 100 * 1024 * 1024,
  audioDurationMs: 5 * 60_000,
  videoDurationMs: 60_000,
} as const;
const documentTypes: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
};
/** Lower-cased extensions and MIME types must agree when both are supplied. */
export function documentMimeType(
  fileName: string,
  mimeType?: string,
): string | null {
  const extension = /\.([^.]+)$/.exec(fileName)?.[1]?.toLowerCase() ?? "";
  const expected = documentTypes[extension];
  if (!expected || (mimeType && mimeType.toLowerCase() !== expected))
    return null;
  return expected;
}
/** Refusals name the applicable size or duration limit in both catalogues. */
export function captureError(
  code: CaptureError["code"],
  kind: CapturedMedia["kind"] = "document",
): CaptureError {
  const sizeKey =
    kind === "video"
      ? "video_size"
      : kind === "voice_note"
        ? "audio_size"
        : "image_size";
  const durationKey = kind === "video" ? "video_duration" : "audio_duration";
  const key =
    code === "too_large" ? sizeKey : code === "too_long" ? durationKey : code;
  return {
    code,
    message: {
      en: getMessages("en").Mobile.Capture.errors[key],
      ar: getMessages("ar").Mobile.Capture.errors[key],
    },
  };
}
function supported(media: CapturedMedia): boolean {
  if (media.kind === "document")
    return (
      documentMimeType(media.fileName ?? media.uri, media.mimeType) !== null
    );
  if (media.kind === "photo")
    return ["image/jpeg", "image/png", "image/heic"].includes(media.mimeType);
  if (media.kind === "video")
    return ["video/mp4", "video/quicktime"].includes(media.mimeType);
  return ["audio/mp4", "audio/aac", "audio/m4a"].includes(media.mimeType);
}
/** Validation runs before and after copying so picker metadata cannot hide an oversized file. */
export function validateCapturedMedia(
  input: unknown,
): Result<CapturedMedia, CaptureError> {
  const parsed = capturedMediaSchema.safeParse(input);
  if (!parsed.success) return err(captureError("capture_failed"));
  const media = parsed.data;
  if (!supported(media))
    return err(captureError("unsupported_type", media.kind));
  const sizeLimit =
    media.kind === "video"
      ? captureLimits.videoBytes
      : media.kind === "voice_note"
        ? captureLimits.audioBytes
        : captureLimits.imageBytes;
  if (media.sizeBytes > sizeLimit)
    return err(captureError("too_large", media.kind));
  if (media.kind === "video" || media.kind === "voice_note") {
    if (media.durationMs === undefined)
      return err(captureError("capture_failed", media.kind));
    const limit =
      media.kind === "video"
        ? captureLimits.videoDurationMs
        : captureLimits.audioDurationMs;
    if (media.durationMs > limit)
      return err(captureError("too_long", media.kind));
  }
  return ok(media);
}
