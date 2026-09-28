import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Row } from "./database";
import { checkUploadRequest } from "./domain";
import type { RequestContext } from "./context";
import { authorize } from "./context";
import { appendAuditEvent } from "./audit";
import { one, rows, str, num } from "./sql";
import { Problem } from "./problem";
import { loadVersion, versionDetail } from "./read";
import type { Outcome } from "./http";
import type { BoundObject } from "./storage";

export const uploadSchema = z.strictObject({
  subjectType: z.literal("tenant"),
  subjectId: z.uuid(),
  docType: z.enum(["emirates_id", "passport"]),
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1).max(100),
  byteSize: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  uploadedVia: z.enum(["web", "mobile"]),
});
export async function requestUpload(
  ctx: RequestContext,
  body: z.infer<typeof uploadSchema>,
): Promise<Outcome> {
  const tenant = (
    await rows(
      ctx.tx,
      `select id from party.tenant where company_id=cast(:company as uuid) and id=cast(:id as uuid) and kind='individual' for update`,
      { company: ctx.companyId, id: body.subjectId },
    )
  )[0];
  if (!tenant) throw new Problem(404, "NOT_FOUND");
  authorize(ctx, {
    operation: "write",
    capability: "identity_documents",
    tenant: body.subjectId,
  });
  const check = checkUploadRequest(body);
  if (!check.ok) throw new Problem(422, check.error.code);
  if (
    !["image/jpeg", "image/png", "application/pdf"].includes(body.contentType)
  )
    throw new Problem(422, "UNSUPPORTED_TYPE");
  let doc = (
    await rows(
      ctx.tx,
      `select * from doc.document where company_id=cast(:company as uuid) and subject_type='tenant' and subject_id=cast(:tenant as uuid) and doc_type=:type for update`,
      { company: ctx.companyId, tenant: body.subjectId, type: body.docType },
    )
  )[0];
  if (!doc) {
    doc = await one(
      ctx.tx,
      `insert into doc.document(company_id,subject_type,subject_id,doc_type,sensitivity,created_by)
      values(cast(:company as uuid),'tenant',cast(:tenant as uuid),:type,'identity',cast(:account as uuid)) returning *`,
      {
        company: ctx.companyId,
        tenant: body.subjectId,
        type: body.docType,
        account: ctx.accountId,
      },
    );
    await appendAuditEvent(ctx.tx, {
      companyId: ctx.companyId,
      accountId: ctx.accountId,
      type: "document.created",
      subjectType: "document",
      subjectId: str(doc, "id"),
      versionAfter: num(doc, "version"),
    });
  }
  const documentId = str(doc, "id");
  const versionId = randomUUID();
  const sequence = await one(
    ctx.tx,
    `select coalesce(max(version_no),0)+1 as next from doc.document_version where company_id=cast(:company as uuid) and document_id=cast(:document as uuid)`,
    { company: ctx.companyId, document: documentId },
  );
  const key = `${ctx.deps.storage.keyPrefix}c/${ctx.companyId}/doc/${documentId}/v/${versionId}/original`;
  const version = await one(
    ctx.tx,
    `insert into doc.document_version(id,company_id,document_id,version_no,bucket,s3_key,sha256,byte_size,content_type,uploaded_via,file_name,created_by)
    values(cast(:id as uuid),cast(:company as uuid),cast(:document as uuid),:sequence,:bucket,:key,:sha,:size,:type,:via,:file,cast(:account as uuid)) returning version`,
    {
      id: versionId,
      company: ctx.companyId,
      document: documentId,
      sequence: num(sequence, "next"),
      bucket: ctx.deps.storage.bucket,
      key,
      sha: body.sha256,
      size: body.byteSize,
      type: body.contentType,
      via: body.uploadedVia,
      file: body.fileName,
      account: ctx.accountId,
    },
  );
  const upload = await ctx.deps.storage.presignPut({
    bucket: ctx.deps.storage.bucket,
    key,
    sha256: body.sha256,
    byteSize: body.byteSize,
    contentType: body.contentType,
  });
  await appendAuditEvent(ctx.tx, {
    companyId: ctx.companyId,
    accountId: ctx.accountId,
    type: "document_version.created",
    subjectType: "document_version",
    subjectId: versionId,
    versionAfter: num(version, "version"),
  });
  return {
    status: 201,
    body: {
      document: { id: documentId, docType: body.docType },
      version: await versionDetail(ctx, versionId),
      upload,
    },
  };
}
export function boundObject(row: Row): BoundObject {
  const versionId = str(row, "s3_version_id");
  if (!versionId) throw new Problem(409, "INVALID_STATE");
  return { bucket: str(row, "bucket"), key: str(row, "s3_key"), versionId };
}
export async function transition(
  ctx: RequestContext,
  row: Row,
  input: {
    readonly status: string;
    readonly event: string;
    readonly reason?: string;
    readonly scanResult?: string;
  },
): Promise<Row> {
  const updated = await one(
    ctx.tx,
    `update doc.document_version set processing_status=:status,scan_result=coalesce(:scan,scan_result),reject_reason=:reason
    where company_id=cast(:company as uuid) and id=cast(:id as uuid) returning *`,
    {
      company: ctx.companyId,
      id: str(row, "id"),
      status: input.status,
      scan: input.scanResult ?? null,
      reason: input.reason ?? null,
    },
  );
  await appendAuditEvent(ctx.tx, {
    companyId: ctx.companyId,
    accountId: ctx.accountId,
    type: input.event,
    subjectType: "document_version",
    subjectId: str(row, "id"),
    versionBefore: num(row, "version"),
    versionAfter: num(updated, "version"),
    ...(input.reason ? { reason: input.reason } : {}),
  });
  return { ...row, ...updated };
}
export async function completeUpload(ctx: RequestContext): Promise<Outcome> {
  const row = await loadVersion(ctx, "write");
  if (row.processing_status !== "awaiting_upload")
    throw new Problem(409, "INVALID_STATE");
  const head = await ctx.deps.storage.head({
    bucket: str(row, "bucket"),
    key: str(row, "s3_key"),
  });
  if (!head) throw new Problem(409, "UPLOAD_MISSING");
  const valid =
    head.byteSize === num(row, "byte_size") &&
    head.checksum === Buffer.from(str(row, "sha256"), "hex").toString("base64");
  const updated = await one(
    ctx.tx,
    `update doc.document_version set s3_version_id=:s3version,processing_status=:status,reject_reason=:reason,uploaded_at=cast(:uploaded as timestamptz)
    where company_id=cast(:company as uuid) and id=cast(:id as uuid) returning version`,
    {
      company: ctx.companyId,
      id: str(row, "id"),
      s3version: head.versionId,
      status: valid ? "uploaded" : "scan_rejected",
      reason: valid ? null : "checksum_mismatch",
      uploaded: ctx.deps.now().toISOString(),
    },
  );
  await appendAuditEvent(ctx.tx, {
    companyId: ctx.companyId,
    accountId: ctx.accountId,
    type: valid
      ? "document_version.uploaded"
      : "document_version.scan_rejected",
    subjectType: "document_version",
    subjectId: str(row, "id"),
    versionBefore: num(row, "version"),
    versionAfter: num(updated, "version"),
    ...(!valid ? { reason: "checksum_mismatch" } : {}),
  });
  return {
    status: 200,
    body: { version: await versionDetail(ctx, str(row, "id")) },
  };
}
export async function scanGate(ctx: RequestContext, row: Row): Promise<Row> {
  if (row.processing_status === "scan_rejected")
    throw new Problem(409, "SCAN_REJECTED");
  if (row.processing_status !== "uploaded") return row;
  const status = await ctx.deps.storage.scanStatus(boundObject(row));
  if (!status) throw new Problem(409, "SCAN_PENDING");
  return transition(
    ctx,
    row,
    status === "NO_THREATS_FOUND"
      ? {
          status: "scan_clean",
          event: "document_version.scan_clean",
          scanResult: status,
        }
      : {
          status: "scan_rejected",
          event: "document_version.scan_rejected",
          scanResult: status,
          reason: `malware_scan_${status.toLowerCase()}`,
        },
  );
}
export async function content(ctx: RequestContext): Promise<Outcome> {
  const row = await scanGate(ctx, await loadVersion(ctx));
  if (row.processing_status === "scan_rejected")
    return {
      status: 409,
      body: new Problem(409, "SCAN_REJECTED").body(),
      refusal: new Problem(409, "SCAN_REJECTED"),
    };
  if (
    !["scan_clean", "extracting", "extracted", "extraction_failed"].includes(
      str(row, "processing_status"),
    )
  )
    throw new Problem(409, "INVALID_STATE");
  const signed = await ctx.deps.storage.presignGet(boundObject(row));
  await appendAuditEvent(ctx.tx, {
    companyId: ctx.companyId,
    accountId: ctx.accountId,
    type: "document.viewed",
    subjectType: "document_version",
    subjectId: str(row, "id"),
  });
  return {
    status: 200,
    body: { ...signed, contentType: str(row, "content_type") },
  };
}
export const rejectionSchema = z.strictObject({
  reason: z.enum(["wrong_type", "illegible", "other"]),
  note: z.string().max(2000).optional(),
});
export async function rejectVersion(
  ctx: RequestContext,
  body: z.infer<typeof rejectionSchema>,
): Promise<Outcome> {
  const row = await loadVersion(ctx, "write", true);
  if (
    row.review_status !== "pending_review" ||
    row.processing_status === "extracting"
  )
    throw new Problem(409, "INVALID_STATE");
  const reason = body.note?.trim()
    ? `${body.reason}: ${body.note.trim()}`
    : body.reason;
  const updated = await one(
    ctx.tx,
    `update doc.document_version set review_status='rejected',reject_reason=:reason where company_id=cast(:company as uuid) and id=cast(:id as uuid) returning version`,
    { company: ctx.companyId, id: str(row, "id"), reason },
  );
  await appendAuditEvent(ctx.tx, {
    companyId: ctx.companyId,
    accountId: ctx.accountId,
    type: "document_version.rejected",
    subjectType: "document_version",
    subjectId: str(row, "id"),
    versionBefore: num(row, "version"),
    versionAfter: num(updated, "version"),
    reason,
  });
  return {
    status: 200,
    body: { version: await versionDetail(ctx, str(row, "id")) },
  };
}
