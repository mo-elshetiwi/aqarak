import { randomUUID } from "node:crypto";
import {
  GetObjectCommand,
  GetObjectTaggingCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { documentVersionId, tawtheeqTransitions } from "@aqarak/domain";
import { z } from "zod";
import {
  expectVersion,
  Refusal,
  type CommandContext,
  type QueryContext,
} from "../audit/kernel";
import type { TawtheeqDependencies } from "./dependencies";
import { documentSchema, type LoadedRecord } from "./repository";
import { execute, one, rows } from "./storage";
import { uploadBody } from "./schemas";
import { applyDecision, commandEvent, decide } from "./workflow";
import { domainRefusal } from "./problems";

export async function initiateUpload(
  ctx: CommandContext,
  deps: TawtheeqDependencies,
  data: LoadedRecord,
  raw: unknown,
): Promise<unknown> {
  const input = uploadBody.parse(raw);
  if (
    !tawtheeqTransitions.some(
      (row) =>
        row.from === data.record.workflow_state && row.command === "upload",
    )
  )
    throw domainRefusal("INVALID_TRANSITION", data.record.id);
  const result = await initiateDocumentUpload(
    ctx,
    deps,
    {
      subjectType: "contract",
      subjectId: data.contract.id,
      storageId: data.record.id,
    },
    input,
  );
  await commandEvent(ctx, data.record.id, "document.upload_requested");
  return result;
}
/** I share signed upload creation across contract and intake documents. */
export async function initiateDocumentUpload(
  ctx: CommandContext,
  deps: TawtheeqDependencies,
  target: {
    subjectType: "contract" | "drafted_action";
    subjectId: string;
    storageId: string;
  },
  input: z.infer<typeof uploadBody>,
): Promise<{
  documentVersionId: string;
  upload: {
    url: string;
    method: string;
    headers: Record<string, string>;
    expiresAt: string;
  };
}> {
  const bucket = deps.buckets.documents;
  if (!bucket) throw new Refusal("UNAVAILABLE", null);
  const existing = await rows(
    ctx.tx,
    "select id from doc.document where company_id=:company::uuid and subject_type=:subjectType and subject_id=:subject::uuid and doc_type='tawtheeq' order by created_at,id limit 1",
    z.object({ id: z.uuid() }),
    {
      company: ctx.companyId,
      subject: target.subjectId,
      subjectType: target.subjectType,
    },
  );
  const documentId = existing[0]?.id ?? randomUUID();
  if (!existing.length)
    await execute(
      ctx.tx,
      "insert into doc.document(id,company_id,subject_type,subject_id,doc_type,sensitivity,title) values (:id::uuid,:company::uuid,:subjectType,:subject::uuid,'tawtheeq','general',:title)",
      {
        id: documentId,
        company: ctx.companyId,
        subject: target.subjectId,
        subjectType: target.subjectType,
        title: input.fileName,
      },
    );
  const id = randomUUID();
  const key = `${deps.keyPrefix}companies/${ctx.companyId}/tawtheeq/${target.storageId}/${id}`;
  await execute(
    ctx.tx,
    "insert into doc.document_version(id,company_id,document_id,version_no,bucket,s3_key,sha256,byte_size,content_type,processing_status,uploaded_via) select :id::uuid,:company::uuid,:document::uuid,coalesce(max(version_no),0)+1,:bucket,:key,:hash,:size::bigint,:type,'awaiting_upload',:via from doc.document_version where company_id=:company::uuid and document_id=:document::uuid",
    {
      id,
      company: ctx.companyId,
      document: documentId,
      bucket,
      key,
      hash: input.sha256,
      size: input.byteSize,
      type: input.contentType,
      via: ctx.channel === "mobile_form" ? "mobile" : "web",
    },
  );
  const checksum = Buffer.from(input.sha256, "hex").toString("base64");
  const headers = {
    "Content-Type": input.contentType,
    "Content-Length": String(input.byteSize),
    "x-amz-checksum-sha256": checksum,
  };
  const url = await getSignedUrl(
    deps.s3,
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: input.contentType,
      ContentLength: input.byteSize,
      ChecksumSHA256: checksum,
    }),
    {
      expiresIn: 300,
      signableHeaders: new Set([
        "content-type",
        "content-length",
        "x-amz-checksum-sha256",
      ]),
      unhoistableHeaders: new Set(["x-amz-checksum-sha256"]),
    },
  );
  return {
    documentVersionId: id,
    upload: {
      url,
      method: "PUT",
      headers,
      expiresAt: new Date(ctx.now.getTime() + 300000).toISOString(),
    },
  };
}
export function magicMatches(contentType: string, bytes: Uint8Array): boolean {
  const prefix = Buffer.from(bytes).toString("hex");
  return contentType === "image/jpeg"
    ? prefix.startsWith("ffd8ff")
    : contentType === "image/png"
      ? prefix.startsWith("89504e47")
      : contentType === "application/pdf" && prefix.startsWith("25504446");
}
async function inspectObject(
  deps: TawtheeqDependencies,
  version: z.infer<typeof documentSchema>,
  pinned: { Bucket: string; Key: string; VersionId: string },
): Promise<{
  status: "scan_rejected" | "scan_clean" | "uploaded";
  scan: string | undefined;
  integrity: boolean;
}> {
  const head = await deps.s3.send(
    new HeadObjectCommand({ ...pinned, ChecksumMode: "ENABLED" }),
  );
  const prefix = await deps.s3.send(
    new GetObjectCommand({ ...pinned, Range: "bytes=0-15" }),
  );
  const bytes = await prefix.Body?.transformToByteArray();
  const integrity =
    head.ContentLength === version.byte_size &&
    head.ContentType === version.content_type &&
    head.ChecksumSHA256 ===
      Buffer.from(version.sha256, "hex").toString("base64") &&
    bytes !== undefined &&
    magicMatches(version.content_type, bytes);
  const tags = await deps.s3.send(new GetObjectTaggingCommand(pinned));
  const scan = tags.TagSet?.find(
    (tag) => tag.Key === "GuardDutyMalwareScanStatus",
  )?.Value;
  const status =
    !integrity || (scan !== undefined && scan !== "NO_THREATS_FOUND")
      ? "scan_rejected"
      : scan === "NO_THREATS_FOUND"
        ? "scan_clean"
        : "uploaded";
  return { status, scan, integrity };
}
/** I pin and inspect the same object version before either workflow accepts it. */
export async function inspectUploadedDocument(
  deps: TawtheeqDependencies,
  version: z.infer<typeof documentSchema>,
): Promise<Awaited<ReturnType<typeof inspectObject>> & { versionId: string }> {
  const location = {
    Bucket: version.bucket,
    Key: version.s3_key,
    ...(version.s3_version_id ? { VersionId: version.s3_version_id } : {}),
  };
  const head = await deps.s3.send(
    new HeadObjectCommand({ ...location, ChecksumMode: "ENABLED" }),
  );
  if (!head.VersionId || head.VersionId === "null")
    throw new Refusal(
      "UNAVAILABLE",
      null,
      "Document storage must have versioning enabled.",
    );
  const pinned = {
    Bucket: version.bucket,
    Key: version.s3_key,
    VersionId: head.VersionId,
  };
  return {
    ...(await inspectObject(deps, version, pinned)),
    versionId: head.VersionId,
  };
}
export type UploadInspection = Awaited<
  ReturnType<typeof inspectUploadedDocument>
>;
export type UploadDocument = z.infer<typeof documentSchema>;

export async function completionDocument(
  ctx: QueryContext,
  data: LoadedRecord,
  id: string,
): Promise<UploadDocument> {
  return one(
    ctx.tx,
    "select v.* from doc.document_version v join doc.document d on d.company_id=v.company_id and d.id=v.document_id where v.company_id=:company::uuid and v.id=:document::uuid and d.subject_type='contract' and d.subject_id=:contract::uuid and d.doc_type='tawtheeq'",
    documentSchema,
    {
      company: ctx.companyId,
      document: z.uuid().parse(id),
      contract: data.contract.id,
    },
  );
}

function matchesInspection(
  current: UploadDocument,
  inspected: UploadDocument,
  result: UploadInspection,
): boolean {
  return (
    ["id", "bucket", "s3_key", "sha256", "byte_size", "content_type"].every(
      (key) =>
        current[key as keyof UploadDocument] ===
        inspected[key as keyof UploadDocument],
    ) &&
    (current.s3_version_id === null ||
      current.s3_version_id === result.versionId)
  );
}

function scanEvidence(result: UploadInspection): {
  eventType: string;
  reason: string | null;
} {
  if (result.status === "scan_rejected")
    return {
      eventType: "document.scan_rejected",
      reason: result.integrity
        ? "Malware scan did not report a clean result"
        : "Object integrity did not match the declaration",
    };
  return {
    eventType:
      result.status === "uploaded"
        ? "document.uploaded"
        : "document.scan_completed",
    reason: null,
  };
}

/** I persist scan evidence before linking only a clean certificate. */
export async function completeUpload(
  ctx: CommandContext,
  data: LoadedRecord,
  input: { expectedVersion: number; documentVersionId: string },
  inspected: { document: UploadDocument; result: UploadInspection | null },
): Promise<"scan_clean" | "scan_rejected" | "uploaded"> {
  expectVersion(data.record.version, input.expectedVersion, {
    type: "tawtheeq_record",
    id: data.record.id,
  });
  const version = await completionDocument(ctx, data, input.documentVersionId);
  if (version.processing_status === "scan_rejected") return "scan_rejected";
  const linked = data.record.tawtheeq_document_version_id === version.id;
  if (linked && version.processing_status !== "uploaded") return "scan_clean";
  if (!["awaiting_upload", "uploaded"].includes(version.processing_status))
    throw domainRefusal("INVALID_TRANSITION", data.record.id);
  const { result, document } = inspected;
  if (!result || !matchesInspection(version, document, result))
    throw domainRefusal("VERSION_CONFLICT", data.record.id);
  const command = {
    type: "upload" as const,
    expectedVersion: input.expectedVersion,
    documentVersionId: documentVersionId.parse(version.id),
  };
  // I recheck the domain transition after inspection, under the command lock.
  const decision = linked ? null : decide(ctx, data, command);
  const { status, scan, integrity, versionId } = result;
  await execute(
    ctx.tx,
    "update doc.document_version set processing_status=:status,s3_version_id=:version,scan_result=:scan where company_id=:company::uuid and id=:document::uuid",
    {
      company: ctx.companyId,
      document: version.id,
      status,
      version: versionId,
      scan: integrity ? (scan ?? null) : "INTEGRITY_MISMATCH",
    },
  );
  if (status === "scan_clean") {
    await execute(
      ctx.tx,
      "update doc.document set current_version_id=:document::uuid where company_id=:company::uuid and id=:id::uuid",
      { company: ctx.companyId, document: version.id, id: version.document_id },
    );
    if (decision) await applyDecision(ctx, data, command, decision);
  }
  const evidence = scanEvidence(result);
  await commandEvent(ctx, data.record.id, evidence.eventType, {
    reason: evidence.reason,
    details: {
      documentVersionId: version.id,
      processingStatus: status,
      scanResult: integrity ? (scan ?? null) : "INTEGRITY_MISMATCH",
    },
  });
  return status;
}
export function requireClean(
  data: LoadedRecord,
): NonNullable<LoadedRecord["document"]> {
  if (data.document?.processing_status === "scan_rejected")
    throw domainRefusal("SCAN_REJECTED", data.record.id);
  if (
    !data.document ||
    !["scan_clean", "extracting", "extracted", "extraction_failed"].includes(
      data.document.processing_status,
    ) ||
    !data.document.s3_version_id
  )
    throw domainRefusal("SCAN_PENDING", data.record.id);
  return data.document;
}
export async function documentUrl(
  ctx: QueryContext,
  deps: TawtheeqDependencies,
  data: LoadedRecord,
): Promise<unknown> {
  const document = requireClean(data);
  const url = await getSignedUrl(
    deps.s3,
    new GetObjectCommand({
      Bucket: document.bucket,
      Key: document.s3_key,
      VersionId: document.s3_version_id ?? undefined,
    }),
    { expiresIn: 300 },
  );
  return {
    url,
    expiresAt: new Date(ctx.now.getTime() + 300000).toISOString(),
    contentType: document.content_type,
  };
}
