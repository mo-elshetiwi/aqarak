import { randomUUID } from "node:crypto";
import { requestSha256 } from "@aqarak/domain";
import { z } from "zod";
import {
  audit,
  authorise,
  parameter,
  requireUnit,
  transaction,
  uuid,
  type RequestScope,
} from "../maintenance/access";
import { completeBodySchema } from "../maintenance/contract";
import {
  claim,
  idempotencyKey,
  replay,
  storeResponse,
  type CommandResponse,
} from "../maintenance/idempotency";
import { Problem } from "../maintenance/problem";
import { jsonBody, parseInput, type Runtime } from "../maintenance/runtime";
import {
  mediaRowSchema,
  mediaView,
  requireMedia,
  type MediaRow,
} from "./records";
import { mediaKey } from "./storage";
import { validateUpload } from "./validation";

export async function uploadSlot(
  runtime: Runtime,
  scope: RequestScope,
  request: Request,
): Promise<CommandResponse> {
  const keyValue = idempotencyKey(request);
  const raw = await jsonBody(request);
  const body = validateUpload(raw);
  scope.channel = body.kind === "voice_note" ? "voice" : "mobile_form";
  const key = {
    key: keyValue,
    command: "media.upload_requested",
    hash: requestSha256({
      pathParams: { companyId: scope.companyId },
      body: z.json().parse(raw),
    }),
  };
  const db = runtime.db();
  const saved = await transaction(db, scope, async (tx) => {
    const access = await authorise(tx, "write");
    await requireUnit(tx, access, body.unitId);
    return replay(tx, key);
  });
  if (saved) return saved;
  const id = randomUUID();
  const location = runtime.location();
  const s3Key = mediaKey(location.prefix, scope.companyId, id);
  const upload = await runtime.storage().upload({
    bucket: location.bucket,
    key: s3Key,
    contentType: body.contentType,
    byteSize: body.byteSize,
    sha256: body.sha256,
  });
  return transaction(db, scope, async (tx) => {
    const access = await authorise(tx, "write");
    await requireUnit(tx, access, body.unitId);
    const duplicate = await claim(tx, key);
    if (duplicate) return duplicate;
    const inserted = await tx.execute(
      `insert into maint.media
      (id, company_id, created_by, unit_id, kind, uploaded_by_account_id, bucket, s3_key, sha256, byte_size, content_type, duration_ms, upload_expires_at)
      values (:id, :company, :account, :unit, :kind, :account, :bucket, :s3key, :sha, :size, :type, :duration, cast(:expires as timestamptz)) returning *`,
      [
        uuid("id", id),
        uuid("company", scope.companyId),
        uuid("account", tx.accountId),
        uuid("unit", body.unitId),
        parameter("kind", body.kind),
        parameter("bucket", location.bucket),
        parameter("s3key", s3Key),
        parameter("sha", body.sha256),
        parameter("size", body.byteSize),
        parameter("type", body.contentType),
        parameter("duration", body.durationMs ?? null),
        parameter("expires", upload.expiresAt),
      ],
    );
    const media = mediaView(mediaRowSchema.parse(inserted.rows[0]));
    await audit(tx, {
      event: "media.upload_requested",
      subjectType: "media",
      subjectId: id,
      versionAfter: media.version,
      key: key.key,
    });
    const response = { status: 201, body: { media, upload } };
    await storeResponse(tx, key, response);
    return response;
  });
}
function requireVersion(row: MediaRow, expectedVersion: number): void {
  if (row.version !== expectedVersion)
    throw new Problem(409, "STALE_VERSION", "The record has changed.", {
      currentVersion: row.version,
    });
  if (row.processing_status !== "awaiting_upload")
    throw new Problem(
      409,
      "UPLOAD_ALREADY_COMPLETED",
      "The upload has already been completed.",
    );
}
export async function completeUpload(
  runtime: Runtime,
  scope: RequestScope,
  request: Request,
  mediaId: string | undefined,
): Promise<CommandResponse> {
  const keyValue = idempotencyKey(request);
  const id = parseInput(z.uuid(), mediaId);
  const raw = await jsonBody(request);
  const body = parseInput(completeBodySchema, raw);
  const key = {
    key: keyValue,
    command: "media.complete",
    hash: requestSha256({
      pathParams: { companyId: scope.companyId, mediaId: id },
      body: z.json().parse(raw),
    }),
  };
  const db = runtime.db();
  const preflight = await transaction(db, scope, async (tx) => {
    const access = await authorise(tx, "write");
    const row = await requireMedia(tx, access, { id, completion: true });
    scope.channel = row.kind === "voice_note" ? "voice" : "mobile_form";
    const saved = await replay(tx, key);
    if (!saved) requireVersion(row, body.expectedVersion);
    return { row, saved };
  });
  if (preflight.saved) return preflight.saved;
  const head = await runtime
    .storage()
    .head({ bucket: preflight.row.bucket, key: preflight.row.s3_key });
  if (!head)
    throw new Problem(
      409,
      "UPLOAD_NOT_FOUND",
      "The uploaded object was not found.",
    );
  const mismatch =
    head.byteSize !== preflight.row.byte_size
      ? "size_mismatch"
      : head.checksum !==
          Buffer.from(preflight.row.sha256, "hex").toString("base64")
        ? "checksum_mismatch"
        : null;
  if (!mismatch && (!head.versionId || head.versionId === "null"))
    throw new Problem(
      503,
      "SERVICE_UNAVAILABLE",
      "Object versioning is required.",
    );
  return transaction(db, scope, async (tx) => {
    const access = await authorise(tx, "write");
    await requireMedia(tx, access, { id, completion: true });
    const duplicate = await claim(tx, key);
    if (duplicate) return duplicate;
    const row = await requireMedia(tx, access, {
      id,
      completion: true,
      lock: true,
    });
    requireVersion(row, body.expectedVersion);
    const updated = await tx.execute(
      "update maint.media set processing_status = :status, s3_version_id = :s3version where company_id = :company and id = :id returning *",
      [
        parameter("status", mismatch ? "scan_rejected" : "uploaded"),
        parameter("s3version", head.versionId),
        uuid("company", scope.companyId),
        uuid("id", id),
      ],
    );
    const media = mediaView(mediaRowSchema.parse(updated.rows[0]));
    await audit(tx, {
      event: mismatch ? "media.upload_rejected" : "media.uploaded",
      subjectType: "media",
      subjectId: id,
      versionBefore: row.version,
      versionAfter: media.version,
      key: key.key,
      ...(mismatch ? { reason: mismatch } : {}),
    });
    const response = mismatch
      ? {
          status: 422,
          body: new Problem(
            422,
            "UPLOAD_MISMATCH",
            mismatch === "size_mismatch"
              ? "The uploaded size does not match."
              : "The uploaded checksum does not match.",
          ).body,
        }
      : { status: 200, body: { media } };
    await storeResponse(tx, key, response);
    return response;
  });
}
export async function downloadMedia(
  runtime: Runtime,
  scope: RequestScope,
  mediaId: string | undefined,
): Promise<CommandResponse> {
  const id = parseInput(z.uuid(), mediaId);
  const row = await transaction(runtime.db(), scope, async (tx) => {
    const access = await authorise(tx, "read");
    return requireMedia(tx, access, { id, completion: false });
  });
  if (row.processing_status !== "uploaded" || !row.s3_version_id)
    throw new Problem(
      409,
      "UPLOAD_NOT_READY",
      "The upload is not ready for download.",
    );
  return {
    status: 200,
    body: await runtime.storage().download({
      bucket: row.bucket,
      key: row.s3_key,
      versionId: row.s3_version_id,
    }),
  };
}
