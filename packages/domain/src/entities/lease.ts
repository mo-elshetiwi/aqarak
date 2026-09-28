import { z } from "zod";
import * as ids from "../ids";
import { basisPoints, nonNegativeFils, positiveFils } from "../money";
import { localDate, utcInstant } from "../time";
import * as vocabulary from "../vocabulary";
import { jsonValue, sha256, standardFields, subjectId, text } from "./shared";

/** Records a contract's lifecycle and renewal or revision relationship. */
export const contractRecord = z
  .strictObject({
    ...standardFields(ids.contractId),
    contractNo: text,
    tenantId: ids.tenantId,
    status: vocabulary.contractStatus,
    origin: vocabulary.contractOrigin,
    cancelKind: vocabulary.contractCancelKind.nullable(),
    cancelReason: text.nullable(),
    endReason: vocabulary.contractEndReason.nullable(),
    renewalOfId: ids.contractId.nullable(),
    revisionOfId: ids.contractId.nullable(),
    currentVersionId: ids.contractVersionId.nullable(),
  })
  .refine(
    (record) =>
      (record.status === "cancelled") === (record.cancelKind !== null),
    {
      message: "A cancellation kind is required exactly when cancelled",
      path: ["cancelKind"],
    },
  )
  .refine(
    (record) =>
      (record.status === "cancelled") === (record.cancelReason !== null),
    {
      message: "A cancellation reason is required exactly when cancelled",
      path: ["cancelReason"],
    },
  )
  .refine(
    (record) => (record.status === "ended") === (record.endReason !== null),
    {
      message: "An end reason is required exactly when ended",
      path: ["endReason"],
    },
  )
  .refine(
    (record) => record.renewalOfId === null || record.revisionOfId === null,
    {
      message: "A contract cannot be both a renewal and a revision",
      path: ["revisionOfId"],
    },
  );
/** Represents a stored contract and its lifecycle. */
export type ContractRecord = z.infer<typeof contractRecord>;

/** Records a unit's occupancy interval under a contract. */
export const contractUnitRecord = z
  .strictObject({
    ...standardFields(ids.contractUnitId),
    contractId: ids.contractId,
    unitId: ids.unitId,
    occupancyFrom: localDate,
    occupancyTo: localDate,
    blocksUnit: z.boolean(),
  })
  .refine((record) => record.occupancyTo >= record.occupancyFrom, {
    message: "Occupancy cannot end before it starts",
    path: ["occupancyTo"],
  });
/** Represents a stored contract occupancy interval. */
export type ContractUnitRecord = z.infer<typeof contractUnitRecord>;

/** Records versioned contract terms and an atomic submission snapshot. */
export const contractVersionRecord = z
  .strictObject({
    ...standardFields(ids.contractVersionId),
    contractId: ids.contractId,
    versionNo: z.int().min(1),
    kind: vocabulary.contractVersionKind,
    termStart: localDate,
    termEnd: localDate,
    graceDays: z.int().min(0).max(365),
    annualRentFils: positiveFils,
    totalFils: positiveFils,
    depositFils: nonNegativeFils,
    vatBp: basisPoints,
    services: z.array(text),
    templateCode: text,
    templateVersion: z.int().min(1),
    renderedBodySha256: sha256.nullable(),
    contentHash: sha256.nullable(),
    frozenOwnerGate: z.boolean().nullable(),
    submittedAt: utcInstant.nullable(),
  })
  .refine((record) => record.termEnd > record.termStart, {
    message: "A contract term must end after it starts",
    path: ["termEnd"],
  })
  .refine(
    (record) =>
      [record.contentHash, record.frozenOwnerGate, record.submittedAt].every(
        (value) => (value === null) === (record.contentHash === null),
      ),
    {
      message: "Submission fields must be all null or all set",
      path: ["submittedAt"],
    },
  );
/** Represents a stored version of contract terms. */
export type ContractVersionRecord = z.infer<typeof contractVersionRecord>;

/** Records a positioned bilingual clause within a contract version. */
export const contractVersionClauseRecord = z.strictObject({
  ...standardFields(subjectId.brand<"ContractVersionClauseId">()),
  contractVersionId: ids.contractVersionId,
  position: z.int().min(1),
  clauseKey: text,
  source: z.enum(["library", "company", "special"]),
  textEn: z.string().min(1).max(4000),
  textAr: z.string().min(1).max(4000),
  modelTranslated: z.boolean(),
});
/** Represents a stored clause within a contract version. */
export type ContractVersionClauseRecord = z.infer<
  typeof contractVersionClauseRecord
>;

/** Records a company or standard contract template by its body digest. */
export const contractTemplateRecord = z.strictObject({
  ...standardFields(ids.contractTemplateId),
  companyId: ids.companyId.nullable(),
  code: text,
  templateVersion: z.int().min(1),
  bodySha256: sha256,
  status: z.enum(["active", "retired"]),
});
/** Represents a stored contract template digest. */
export type ContractTemplateRecord = z.infer<typeof contractTemplateRecord>;

/** Records a reusable bilingual clause in a company or shared library. */
export const clauseRecord = z.strictObject({
  ...standardFields(ids.clauseId),
  companyId: ids.companyId.nullable(),
  clauseKey: text,
  category: text,
  textEn: text,
  textAr: text,
  comment: text.nullable(),
});
/** Represents a stored reusable bilingual clause. */
export type ClauseRecord = z.infer<typeof clauseRecord>;

/** Records an approval decision bound to a specific subject digest. */
export const approvalRecord = z
  .strictObject({
    ...standardFields(ids.approvalId),
    subjectType: z.enum([
      "contract_version",
      "quote",
      "tawtheeq_record",
      "discrepancy",
    ]),
    subjectId,
    slot: vocabulary.approvalSlot,
    kind: vocabulary.approvalKind,
    approverAccountId: ids.personAccountId.nullable(),
    onBehalfOfPartyId: subjectId.nullable(),
    subjectHash: sha256,
    status: vocabulary.approvalStatus,
    reason: text.nullable(),
  })
  .refine(
    (record) =>
      (record.status !== "returned" && record.status !== "voided") ||
      record.reason !== null,
    {
      message: "Returned or voided approvals require a reason",
      path: ["reason"],
    },
  )
  .refine(
    (record) =>
      record.status === "requested" || record.approverAccountId !== null,
    {
      message: "An approval decision requires an approver",
      path: ["approverAccountId"],
    },
  );
/** Represents a stored approval decision. */
export type ApprovalRecord = z.infer<typeof approvalRecord>;

/** Records Tawtheeq workflow state and registration evidence. */
export const tawtheeqRecord = z
  .strictObject({
    ...standardFields(ids.tawtheeqRecordId),
    contractId: ids.contractId,
    path: vocabulary.tawtheeqPath,
    workflowState: vocabulary.tawtheeqWorkflowState,
    tawtheeqNumber: text.nullable(),
    registeredOn: localDate.nullable(),
    tawtheeqDocumentVersionId: ids.documentVersionId.nullable(),
    skipReason: text.nullable(),
  })
  .refine(
    (record) =>
      record.workflowState !== "registered" ||
      [
        record.tawtheeqNumber,
        record.registeredOn,
        record.tawtheeqDocumentVersionId,
      ].every((value) => value !== null),
    {
      message: "Registration requires its number, date and document",
      path: ["tawtheeqNumber"],
    },
  )
  .refine(
    (record) =>
      record.workflowState !== "skipped" || record.skipReason !== null,
    {
      message: "Skipping registration requires a reason",
      path: ["skipReason"],
    },
  );
/** Represents a stored Tawtheeq workflow record. */
export type TawtheeqRecord = z.infer<typeof tawtheeqRecord>;

/** Records a compared Tawtheeq field and its explained resolution. */
export const discrepancyRecord = z
  .strictObject({
    ...standardFields(ids.discrepancyId),
    tawtheeqRecordId: ids.tawtheeqRecordId,
    documentVersionId: ids.documentVersionId,
    fieldKey: text,
    appValue: jsonValue,
    tawtheeqValue: jsonValue,
    class: vocabulary.discrepancyClass,
    resolution: vocabulary.discrepancyResolution.nullable(),
    reason: text.nullable(),
    status: vocabulary.discrepancyStatus,
  })
  .refine((record) => record.resolution === null || record.reason !== null, {
    message: "A discrepancy resolution requires a reason",
    path: ["reason"],
  })
  .refine(
    (record) => (record.status === "resolved") === (record.resolution !== null),
    {
      message: "A discrepancy is resolved exactly when a resolution is set",
      path: ["resolution"],
    },
  );
/** Represents a stored discrepancy and its resolution. */
export type DiscrepancyRecord = z.infer<typeof discrepancyRecord>;

/** Records a dated unit handover with exact decimal meter readings. */
export const handoverRecord = z.strictObject({
  ...standardFields(ids.handoverId),
  contractId: ids.contractId,
  unitId: ids.unitId,
  kind: vocabulary.handoverKind,
  occurredOn: localDate,
  meterReadings: z.record(text, z.string().regex(/^-?[0-9]+(?:\.[0-9]+)?$/)),
});
/** Represents a stored handover and its meter readings. */
export type HandoverRecord = z.infer<typeof handoverRecord>;
