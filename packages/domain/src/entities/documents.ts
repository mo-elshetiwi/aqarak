import { z } from "zod";
import * as ids from "../ids";
import { localDate } from "../time";
import * as vocabulary from "../vocabulary";
import { sha256, standardFields, subjectId, subjectType, text } from "./shared";

/** Records document metadata and its current version reference. */
export const documentRecord = z.strictObject({
  ...standardFields(ids.documentId),
  subjectType,
  subjectId,
  docType: vocabulary.documentType,
  title: text,
  sensitivity: vocabulary.documentSensitivity,
  currentVersionId: ids.documentVersionId.nullable(),
});
/** Represents stored document metadata. */
export type DocumentRecord = z.infer<typeof documentRecord>;

/** Records a company scoped document object and its processing and review state. */
export const documentVersionRecord = z
  .strictObject({
    ...standardFields(ids.documentVersionId),
    documentId: ids.documentId,
    versionNo: z.int().min(1),
    bucket: text,
    s3Key: z.string().min(1).max(1024),
    s3VersionId: text.nullable(),
    sha256,
    byteSize: z.int().positive(),
    contentType: text,
    processingStatus: vocabulary.documentProcessingStatus,
    reviewStatus: vocabulary.documentReviewStatus,
    scanResult: text.nullable(),
    scanEventId: text.nullable(),
    issueDate: localDate.nullable(),
    expiryDate: localDate.nullable(),
    rejectReason: text.nullable(),
    uploadedVia: vocabulary.channel,
  })
  .refine((record) => record.s3Key.startsWith(`company/${record.companyId}/`), {
    message: "A document key must use its company prefix",
    path: ["s3Key"],
  })
  .refine(
    (record) =>
      record.issueDate === null ||
      record.expiryDate === null ||
      record.expiryDate >= record.issueDate,
    {
      message: "A document cannot expire before its issue date",
      path: ["expiryDate"],
    },
  )
  .refine(
    (record) =>
      (record.reviewStatus === "rejected") === (record.rejectReason !== null),
    {
      message: "A reject reason is required exactly when rejected",
      path: ["rejectReason"],
    },
  );
/** Represents a stored document version and its review state. */
export type DocumentVersionRecord = z.infer<typeof documentVersionRecord>;
