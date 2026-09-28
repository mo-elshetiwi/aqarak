import type { AudioRecorder } from "expo-audio";
import { err, type Result } from "@aqarak/domain";
import {
  captureError,
  captureLimits,
  type CapturedMedia,
  type CaptureError,
} from "./media";
import type { CaptureStorage, CaptureLease } from "./storage";
/** Native operations remain injectable for deterministic recording and boundary tests. */
export type VoiceRecorder = Pick<
  AudioRecorder,
  "prepareToRecordAsync" | "record" | "stop" | "getStatus" | "uri"
>;
/** One recording owns its temporary file until it is retained or discarded. */
export class VoiceRecording {
  private lease: CaptureLease | undefined;
  private starting: Promise<void> | undefined;
  private stopping: Promise<void> | undefined;
  private disposed = false;
  private active = false;
  private elapsed = 0;
  private retained: CapturedMedia | undefined;
  constructor(
    private readonly recorder: VoiceRecorder,
    private readonly storage: CaptureStorage,
  ) {}
  /** Capture the context before native preparation so late results cannot cross it. */
  async start(): Promise<void> {
    if (this.starting || this.active || this.disposed) return;
    const lease = this.storage.begin();
    if (!lease.ok) throw new Error("Capture context unavailable");
    this.lease = lease.value;
    this.starting = this.prepare();
    try {
      await this.starting;
    } finally {
      this.starting = undefined;
    }
  }
  private async prepare(): Promise<void> {
    await this.recorder.prepareToRecordAsync();
    if (this.disposed) return;
    this.recorder.record({ forDuration: captureLimits.audioDurationMs / 1000 });
    this.active = true;
  }
  /** Remember native duration before stop because some platforms reset it afterwards. */
  sample(): { durationMs: number; metering: number; recording: boolean } {
    const status = this.recorder.getStatus();
    this.elapsed = Math.max(this.elapsed, Math.round(status.durationMillis));
    return {
      durationMs: this.elapsed,
      metering: status.metering ?? -160,
      recording: status.isRecording,
    };
  }
  /** Concurrent user, timer and lifecycle stops share one native operation. */
  async stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    if (!this.active) return;
    this.sample();
    this.active = false;
    this.stopping = this.recorder.getStatus().isRecording
      ? this.recorder.stop()
      : Promise.resolve();
    await this.stopping;
  }
  private isDisposed(): boolean {
    return this.disposed;
  }
  /** Validation and copying use the same private owner as photo, video and documents. */
  async retain(): Promise<Result<CapturedMedia, CaptureError>> {
    await this.stop();
    if (this.retained) return err(captureError("cancelled", "voice_note"));
    const uri = this.recorder.uri;
    if (!uri || !this.lease || this.disposed)
      return err(captureError("capture_failed", "voice_note"));
    const result = await this.storage.store(
      {
        kind: "voice_note",
        uri,
        mimeType: "audio/mp4",
        sizeBytes: 0,
        durationMs: this.elapsed,
      },
      this.lease,
    );
    if (result.ok) {
      if (this.isDisposed()) {
        this.storage.discard(result.value.uri);
        return err(captureError("cancelled", "voice_note"));
      }
      this.retained = result.value;
    }
    return result;
  }
  /** Cleanup also waits for preparation so no late temporary survives departure. */
  async discard(): Promise<void> {
    this.disposed = true;
    try {
      await this.starting;
      await this.stop();
    } finally {
      if (this.recorder.uri) this.storage.removeTemporary(this.recorder.uri);
    }
  }
}
/** Western digits and a fixed two-part display keep elapsed time unambiguous. */
export function voiceElapsed(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
