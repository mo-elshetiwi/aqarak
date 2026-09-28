import type {
  Upload,
  Outcome,
  VersionDetail,
  UploadInput,
} from "./j3-contract";
import type { TenantRoute, ReviewRoute } from "./routes";
export const captureSteps = [
  "uploading",
  "checking",
  "scanning",
  "reading",
  "ready",
] as const;
export type CaptureStep = (typeof captureSteps)[number];
export interface CaptureAttempt {
  uploadKey: string;
  completeKey: string;
  extractionKey: string;
  upload?: Upload;
  transferred?: boolean;
  completed?: boolean;
}
export function newCaptureAttempt(): CaptureAttempt {
  return {
    uploadKey: crypto.randomUUID(),
    completeKey: crypto.randomUUID(),
    extractionKey: crypto.randomUUID(),
  };
}
export interface CaptureDependencies {
  request: (
    input: TenantRoute & { key: string; upload: UploadInput },
  ) => Promise<Outcome<Upload>>;
  complete: (
    input: ReviewRoute & { key: string },
  ) => Promise<Outcome<{ version: VersionDetail }>>;
  extract: (
    input: ReviewRoute & { key: string },
  ) => Promise<Outcome<{ version: VersionDetail }>>;
  put: typeof fetch;
  digest: (file: File) => Promise<string>;
  delay: () => Promise<void>;
  step: (step: CaptureStep) => void;
}
export type CaptureResult = Outcome<{
  route: ReviewRoute;
  manual: boolean;
  storedPdf: boolean;
}> & { reason?: string };
async function waitForScan(
  run: () => Promise<Outcome<{ version: VersionDetail }>>,
  deps: CaptureDependencies,
): Promise<Outcome<{ version: VersionDetail }>> {
  for (let retry = 0; retry <= 40; retry += 1) {
    const result = await run();
    const extracting =
      result.ok && result.version.processingStatus === "extracting";
    if (!extracting && (result.ok || result.code !== "SCAN_PENDING"))
      return result;
    if (retry === 40)
      return extracting ? { ok: false, code: "UNAVAILABLE" } : result;
    deps.step(extracting ? "reading" : "scanning");
    await deps.delay();
  }
  return { ok: false, code: "SCAN_PENDING" };
}
export async function captureIdentity(
  file: File,
  route: TenantRoute,
  attempt: CaptureAttempt,
  deps: CaptureDependencies,
): Promise<CaptureResult> {
  if (!["image/jpeg", "image/png", "application/pdf"].includes(file.type))
    return { ok: false, code: "UNSUPPORTED_TYPE" };
  if (file.size > 20 * 1024 * 1024)
    return { ok: false, code: "UPLOAD_TOO_LARGE" };
  if (!file.size) return { ok: false, code: "VALIDATION_FAILED" };
  try {
    deps.step("uploading");
    if (!attempt.upload) {
      const result = await deps.request({
        ...route,
        key: attempt.uploadKey,
        upload: {
          subjectType: "tenant",
          subjectId: route.tenantId,
          docType: "emirates_id",
          fileName: file.name,
          contentType: file.type as UploadInput["contentType"],
          byteSize: file.size,
          sha256: await deps.digest(file),
          uploadedVia: "web",
        },
      });
      if (!result.ok) return result;
      attempt.upload = result;
    }
    if (!attempt.transferred) {
      const put = await deps.put(attempt.upload.upload.url, {
        method: "PUT",
        headers: attempt.upload.upload.headers,
        body: file,
        redirect: "error",
      });
      if (!put.ok) return { ok: false, code: "UNAVAILABLE" };
      attempt.transferred = true;
    }
    const ref = {
      ...route,
      documentId: attempt.upload.document.id,
      versionId: attempt.upload.version.id,
    };
    deps.step("checking");
    deps.step("scanning");
    const completed = await waitForScan(
      () => deps.complete({ ...ref, key: attempt.completeKey }),
      deps,
    );
    if (!completed.ok) return completed;
    if (rejectedVersion(completed.version))
      return {
        ok: false,
        code: "SCAN_REJECTED",
        ...(completed.version.rejectReason
          ? { reason: completed.version.rejectReason }
          : {}),
      };
    attempt.completed = true;
    if (file.type === "application/pdf")
      return { ok: true, route: ref, manual: true, storedPdf: true };
    deps.step("reading");
    const extracted = await waitForScan(
      () => deps.extract({ ...ref, key: attempt.extractionKey }),
      deps,
    );
    if (!extracted.ok) return extracted;
    if (extracted.version.rejectReason)
      return {
        ok: false,
        code: "SCAN_REJECTED",
        reason: extracted.version.rejectReason,
      };
    deps.step("ready");
    return {
      ok: true,
      route: ref,
      manual: extracted.version.processingStatus === "extraction_failed",
      storedPdf: false,
    };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}
export async function sha256(file: File): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function rejectedVersion(version: VersionDetail): boolean {
  return (
    Boolean(version.rejectReason) ||
    version.processingStatus === "scan_rejected"
  );
}
