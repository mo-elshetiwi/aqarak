import { randomUUID } from "node:crypto";
import type { Row } from "@aqarak/db/data-api";
import {
  checkUploadRequest,
  documentId,
  documentVersionId,
  documentType,
  documentProcessingStatus,
  documentReviewStatus,
  localDate,
  transitionDocumentReview,
  type DocumentVersionSnapshot,
  type ReviewCommand,
} from "./domain";
import type { RequestScope } from "./runtime";
import type { CommandResponse } from "./idempotency";
import type { StoragePort } from "./storage";
import { estateStorage, documentKey } from "./storage";
import { estateConfig } from "./config";
import {
  rows,
  uuid,
  param,
  one,
  text,
  number,
  nullableText,
  checkVersion,
} from "./sql";
import { fail } from "./problem";
import { insert, update, auditRow } from "./mutations";
import { versionItem } from "./read-model";
import { checkStoredHead, scanDecision } from "./document-check";
import {
  uploadSchema,
  acceptDocumentSchema,
  rejectDocumentSchema,
  ownerDocumentTypes,
  propertyDocumentTypes,
} from "./document-schemas";
function subject(scope: RequestScope): {
  type: "owner" | "property";
  id: string;
} {
  return {
    type: scope.params.ownerId ? "owner" : "property",
    id: text(one(scope.root ? [scope.root] : []), "id"),
  };
}
export async function createDocument(
  scope: RequestScope,
  input: unknown,
  storage: StoragePort = estateStorage(),
): Promise<CommandResponse> {
  const body = uploadSchema.parse(input);
  const target = subject(scope);
  const allowed: readonly string[] =
    target.type === "owner" ? ownerDocumentTypes : propertyDocumentTypes;
  if (!allowed.includes(body.docType))
    fail(422, "DOC_TYPE_NOT_ALLOWED", "docType");
  const upload = checkUploadRequest(body);
  if (!upload.ok)
    fail(
      422,
      upload.error.code,
      upload.error.code === "UPLOAD_TOO_LARGE" ? "byteSize" : "contentType",
      upload.error.field,
    );
  let document = (
    await rows(
      scope.tx,
      "select * from doc.document where company_id=:c and subject_type=:type and subject_id=:id and doc_type=:docType for update",
      [
        uuid("c", scope.audit.companyId),
        param("type", target.type),
        uuid("id", target.id),
        param("docType", body.docType),
      ],
    )
  )[0];
  if (!document) {
    document = await insert(scope, "doc.document", {
      subject_type: target.type,
      subject_id: target.id,
      doc_type: body.docType,
      sensitivity: ["emirates_id", "passport"].includes(body.docType)
        ? "identity"
        : "general",
    });
    await auditRow(scope, { row: document, type: "document.created" });
  }
  const id = text(document, "id");
  const versionId = randomUUID();
  const existing = await rows(
    scope.tx,
    "select coalesce(max(version_no),0)+1 as next from doc.document_version where company_id=:c and document_id=:id",
    [uuid("c", scope.audit.companyId), uuid("id", id)],
  );
  const versionNo = number(one(existing), "next");
  const config = estateConfig();
  if (!config.bucket) fail(503, "UNAVAILABLE");
  const key = documentKey({
    prefix: config.keyPrefix,
    companyId: scope.audit.companyId,
    documentId: id,
    versionId,
  });
  const version = await insert(scope, "doc.document_version", {
    id: versionId,
    document_id: id,
    version_no: versionNo,
    bucket: config.bucket,
    s3_key: key,
    sha256: body.sha256,
    byte_size: String(body.byteSize),
    content_type: body.contentType,
    processing_status: "awaiting_upload",
    review_status: "pending_review",
    uploaded_via: scope.audit.channel === "mobile_form" ? "mobile" : "web",
  });
  await auditRow(scope, { row: version, type: "document_version.created" });
  return {
    status: 201,
    body: {
      documentId: id,
      documentVersionId: versionId,
      versionNo,
      upload: await storage.presign({ key, ...body }),
    },
  };
}
async function targetVersion(
  scope: RequestScope,
): Promise<{ document: Row; version: Row }> {
  const target = subject(scope);
  const params = [
    uuid("c", scope.audit.companyId),
    uuid("subject", target.id),
    param("type", target.type),
    uuid("document", scope.params.documentId ?? null),
    uuid("version", scope.params.versionId ?? null),
  ];
  const document = one(
    await rows(
      scope.tx,
      "select * from doc.document where company_id=:c and id=:document and subject_type=:type and subject_id=:subject for update",
      params,
    ),
  );
  const version = one(
    await rows(
      scope.tx,
      "select * from doc.document_version where company_id=:c and id=:version and document_id=:document for update",
      params,
    ),
  );
  return { document, version };
}
async function processingUpdate(
  scope: RequestScope,
  prior: Row,
  change: { status: string; scanResult: string | null; versionId?: string },
): Promise<Row> {
  const fields = {
    processing_status: change.status,
    scan_result: change.scanResult,
    ...(change.versionId ? { s3_version_id: change.versionId } : {}),
  };
  const row = await update(
    scope,
    "doc.document_version",
    { id: text(prior, "id"), expected: number(prior, "version") },
    fields,
  );
  await auditRow(scope, {
    row,
    type: `document_version.${change.status}`,
    before: number(prior, "version"),
    fields: Object.keys(fields),
    ...(change.status === "scan_rejected"
      ? { reason: change.scanResult ?? "scan_rejected" }
      : {}),
  });
  return row;
}
export async function checkDocument(
  scope: RequestScope,
  _input: unknown,
  storage: StoragePort = estateStorage(),
): Promise<CommandResponse> {
  let { version } = await targetVersion(scope);
  if (
    !["awaiting_upload", "uploaded"].includes(
      text(version, "processing_status"),
    )
  )
    return {
      status: 200,
      body: { version: versionItem(version), scanPending: false },
    };
  const key = text(version, "s3_key");
  if (version.processing_status === "awaiting_upload") {
    const head = checkStoredHead(
      {
        sha256: text(version, "sha256"),
        byteSize: number(version, "byte_size"),
      },
      await storage.head(key),
    );
    if (head.rejected) {
      version = await processingUpdate(scope, version, {
        status: "scan_rejected",
        scanResult: "checksum_mismatch",
      });
      return {
        status: 200,
        body: { version: versionItem(version), scanPending: false },
      };
    }
    version = await processingUpdate(scope, version, {
      status: "uploaded",
      scanResult: null,
      versionId: head.versionId,
    });
  }
  const versionId = text(version, "s3_version_id");
  const head = await storage.firstBytes(key, versionId);
  const content = scanDecision({
    contentType: text(version, "content_type"),
    head,
    tag: null,
  });
  const decision =
    content.status === "scan_rejected"
      ? content
      : scanDecision({
          contentType: text(version, "content_type"),
          head,
          tag: await storage.scanTag(key, versionId),
        });
  if (decision.status !== "uploaded")
    version = await processingUpdate(scope, version, {
      status: decision.status,
      scanResult: decision.result,
    });
  return {
    status: 200,
    body: {
      version: versionItem(version),
      scanPending: decision.status === "uploaded",
    },
  };
}
function snapshot(row: Row, type: string): DocumentVersionSnapshot {
  const expiry = nullableText(row, "expiry_date");
  return {
    id: documentVersionId.parse(row.id),
    documentId: documentId.parse(row.document_id),
    versionNumber: number(row, "version_no"),
    documentType: documentType.parse(type),
    expiryDate: expiry ? localDate.parse(expiry) : null,
    processing_status: documentProcessingStatus.parse(row.processing_status),
    review_status: documentReviewStatus.parse(row.review_status),
    recordedSha256: text(row, "sha256"),
    recordedByteSize: number(row, "byte_size"),
  };
}
async function supersedeCurrent(
  scope: RequestScope,
  document: Row,
  newer: Row,
): Promise<void> {
  const current = nullableText(document, "current_version_id");
  if (!current || current === newer.id) return;
  const old = one(
    await rows(
      scope.tx,
      "select * from doc.document_version where company_id=:c and id=:id for update",
      [uuid("c", scope.audit.companyId), uuid("id", current)],
    ),
  );
  const decision = transitionDocumentReview(
    snapshot(old, text(document, "doc_type")),
    {
      type: "supersede",
      newerVersion: snapshot(newer, text(document, "doc_type")),
    },
    "person",
  );
  if (!decision.ok) fail(409, "INVALID_TRANSITION");
  const row = await update(
    scope,
    "doc.document_version",
    { id: current, expected: number(old, "version") },
    { review_status: decision.value.version.review_status },
  );
  await auditRow(scope, {
    row,
    type: "document_version.superseded",
    before: number(old, "version"),
    fields: ["review_status"],
  });
}
export async function acceptDocument(
  scope: RequestScope,
  input: unknown,
): Promise<CommandResponse> {
  const body = acceptDocumentSchema.parse(input);
  const { document, version } = await targetVersion(scope);
  checkVersion(version, body.expectedVersion);
  if (version.processing_status !== "scan_clean") fail(409, "SCAN_NOT_CLEAN");
  if (body.issueDate && body.expiryDate && body.issueDate > body.expiryDate)
    fail(422, "EXPIRY_BEFORE_ISSUE", "expiryDate");
  const type = text(document, "doc_type");
  if (
    (ownerDocumentTypes as readonly string[]).includes(type) &&
    !body.expiryDate
  )
    fail(422, "EXPIRY_REQUIRED", "expiryDate");
  const decision = transitionDocumentReview(
    snapshot(version, type),
    {
      type: "accept",
      documentType: documentType.parse(type),
      expiryDate: body.expiryDate ? localDate.parse(body.expiryDate) : null,
      typeConfirmed: true,
      datesConfirmed: true,
    },
    "person",
  );
  if (!decision.ok) fail(409, "INVALID_TRANSITION");
  const fields = {
    review_status: decision.value.version.review_status,
    issue_date: body.issueDate ?? null,
    expiry_date: body.expiryDate ?? null,
  };
  const row = await update(
    scope,
    "doc.document_version",
    { id: text(version, "id"), expected: body.expectedVersion },
    fields,
  );
  await auditRow(scope, {
    row,
    type: "document_version.accepted",
    before: body.expectedVersion,
    fields: Object.keys(fields),
  });
  await supersedeCurrent(scope, document, row);
  const updated = await update(
    scope,
    "doc.document",
    { id: text(document, "id"), expected: number(document, "version") },
    { current_version_id: text(row, "id") },
  );
  await auditRow(scope, {
    row: updated,
    type: "document.updated",
    before: number(document, "version"),
    fields: ["current_version_id"],
  });
  return { status: 200, body: { version: versionItem(row) } };
}
export async function rejectDocument(
  scope: RequestScope,
  input: unknown,
): Promise<CommandResponse> {
  const body = rejectDocumentSchema.parse(input);
  const { document, version } = await targetVersion(scope);
  checkVersion(version, body.expectedVersion);
  // The API permits free-text reasons, which the domain transition validates as nonempty at runtime.
  const reason = body.reason as Extract<
    ReviewCommand,
    { type: "reject" }
  >["reason"];
  const decision = transitionDocumentReview(
    snapshot(version, text(document, "doc_type")),
    { type: "reject", reason },
    "person",
  );
  if (!decision.ok) fail(409, "INVALID_TRANSITION");
  const fields = {
    review_status: decision.value.version.review_status,
    reject_reason: body.reason,
  };
  const row = await update(
    scope,
    "doc.document_version",
    { id: text(version, "id"), expected: body.expectedVersion },
    fields,
  );
  await auditRow(scope, {
    row,
    type: "document_version.rejected",
    before: body.expectedVersion,
    fields: Object.keys(fields),
    reason: body.reason,
  });
  return { status: 200, body: { version: versionItem(row) } };
}
