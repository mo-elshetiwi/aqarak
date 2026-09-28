import type { CameraView } from "expo-camera";
import { err, type Result } from "@aqarak/domain";
import {
  captureError,
  captureLimits,
  type CapturedMedia,
  type CaptureError,
} from "./media";
import type { CaptureStorage } from "./storage";
/** Camera operations are injected so validation never needs a physical camera in tests. */
export type CaptureCamera = Pick<
  CameraView,
  "takePictureAsync" | "recordAsync" | "stopRecording"
>;
/** Photos omit EXIF and are retained only by the private storage owner. */
export async function takePhoto(
  camera: CaptureCamera,
  storage: CaptureStorage,
): Promise<Result<CapturedMedia, CaptureError>> {
  const lease = storage.begin();
  if (!lease.ok) return lease;
  try {
    const photo = await camera.takePictureAsync({ exif: false });
    return await storage.store(
      { kind: "photo", uri: photo.uri, mimeType: "image/jpeg", sizeBytes: 0 },
      lease.value,
    );
  } catch {
    return err(captureError("capture_failed", "photo"));
  }
}
/** Native duration and size bounds stop video; elapsed time is an estimate bounded by the native maximum. */
export async function recordVideo(
  camera: CaptureCamera,
  storage: CaptureStorage,
  clock: () => number = Date.now,
): Promise<Result<CapturedMedia, CaptureError>> {
  const lease = storage.begin();
  if (!lease.ok) return lease;
  const started = clock();
  try {
    const video = await camera.recordAsync({
      maxDuration: 60,
      maxFileSize: captureLimits.videoBytes,
    });
    if (!video) return err(captureError("cancelled", "video"));
    return await storage.store(
      {
        kind: "video",
        uri: video.uri,
        mimeType: video.uri.toLowerCase().endsWith(".mov")
          ? "video/quicktime"
          : "video/mp4",
        sizeBytes: 0,
        durationMs: Math.min(
          captureLimits.videoDurationMs,
          Math.max(0, Math.round(clock() - started)),
        ),
      },
      lease.value,
    );
  } catch {
    return err(captureError("capture_failed", "video"));
  }
}
