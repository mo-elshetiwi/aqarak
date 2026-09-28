import { Directory, File, Paths } from "expo-file-system";
import { ok, err, type Result } from "@aqarak/domain";
import { registerSignOutTask, subscribe } from "@/features/auth/session-events";
import {
  captureError,
  validateCapturedMedia,
  type CapturedMedia,
  type CaptureError,
} from "./media";

/** A lease prevents late picker and native results from crossing account or company boundaries. */
export interface CaptureLease {
  readonly generation: number;
}
/** One private cache folder owns retained media and drains pending copies before boundary cleanup. */
export class CaptureStorage {
  private readonly folder = new Directory(Paths.cache, "capture");
  private generation = 0;
  private scope: string | null = null;
  private counter = 0;
  private pending = new Set<Promise<Result<CapturedMedia, CaptureError>>>();

  /** Startup and context changes erase leftovers before enabling a new scope. */
  async activate(scope: string | null): Promise<void> {
    if (scope !== null && this.scope === scope) return;
    const generation = ++this.generation;
    this.scope = null;
    await Promise.allSettled([...this.pending]);
    if (generation !== this.generation) return;
    if (this.folder.exists) this.folder.delete();
    this.scope = scope;
  }
  /** Acquiring a lease requires an active signed-in context. */
  begin(): Result<CaptureLease, CaptureError> {
    return this.scope
      ? ok({ generation: this.generation })
      : err(captureError("cancelled"));
  }
  private current(lease: CaptureLease): boolean {
    return this.scope !== null && lease.generation === this.generation;
  }
  /** Every identity event invalidates leases before awaiting file deletion. */
  bind(): () => void {
    const wipe = (): Promise<void> => this.activate(null);
    const remove = [
      subscribe("signed_out", wipe),
      subscribe("context_changed", wipe),
      registerSignOutTask(wipe),
    ];
    return () => {
      remove.forEach((stop) => {
        stop();
      });
      void wipe().catch(() => undefined);
    };
  }
  /** Only temporary files inside this app's cache are removed; original provider documents remain untouched. */
  removeTemporary(uri: string): void {
    const canonical = new URL(uri).href;
    if (!canonical.startsWith(`${Paths.cache.uri.replace(/\/$/, "")}/`)) return;
    const file = new File(canonical);
    if (file.exists) file.delete();
  }
  /** A retained item can be removed only from this storage owner's private folder. */
  discard(uri: string): Result<void, CaptureError> {
    try {
      if (
        !new URL(uri).href.startsWith(`${this.folder.uri.replace(/\/$/, "")}/`)
      )
        return err(captureError("capture_failed"));
      this.removeTemporary(uri);
      return ok(undefined);
    } catch {
      return err(captureError("capture_failed"));
    }
  }
  /** Copies an owned native temporary into capture and returns only validated metadata. */
  async store(
    input: CapturedMedia,
    lease: CaptureLease,
  ): Promise<Result<CapturedMedia, CaptureError>> {
    const operation = this.copy(input, lease);
    this.pending.add(operation);
    try {
      return await operation;
    } finally {
      this.pending.delete(operation);
    }
  }
  private async copy(
    input: CapturedMedia,
    lease: CaptureLease,
  ): Promise<Result<CapturedMedia, CaptureError>> {
    let destination: File | undefined;
    let result: Result<CapturedMedia, CaptureError> = err(
      captureError("capture_failed"),
    );
    try {
      result = await this.copyValidated(input, lease, (file) => {
        destination = file;
      });
    } catch {
      result = err(captureError("capture_failed", input.kind));
    }
    try {
      this.removeTemporary(input.uri);
      if (!result.ok && destination?.exists) destination.delete();
    } catch {
      if (destination?.exists) {
        try {
          destination.delete();
        } catch {
          /* Boundary cleanup retries deletion before the next context is enabled. */
        }
      }
      return err(captureError("capture_failed", input.kind));
    }
    return result;
  }
  private async copyValidated(
    input: CapturedMedia,
    lease: CaptureLease,
    remember: (file: File) => void,
  ): Promise<Result<CapturedMedia, CaptureError>> {
    if (!this.current(lease)) return err(captureError("cancelled"));
    const source = new File(input.uri);
    if (!source.exists) return err(captureError("capture_failed", input.kind));
    const checked = validateCapturedMedia({
      ...input,
      sizeBytes: Math.max(source.size, input.sizeBytes),
    });
    if (!checked.ok) return checked;
    this.folder.create({ intermediates: true, idempotent: true });
    this.counter += 1;
    const extension =
      input.mimeType === "application/pdf"
        ? "pdf"
        : (input.mimeType.split("/")[1] ?? "media");
    const destination = new File(
      this.folder,
      `${String(this.generation)}-${String(this.counter)}.${extension}`,
    );
    remember(destination);
    await source.copy(destination);
    if (!this.current(lease)) return err(captureError("cancelled"));
    return validateCapturedMedia({
      ...checked.value,
      uri: destination.uri,
      sizeBytes: destination.size,
    });
  }
}
