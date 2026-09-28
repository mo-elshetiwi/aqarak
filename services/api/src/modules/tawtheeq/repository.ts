import { z } from "zod";
import {
  createAdoptionVersion,
  can,
  companyId,
  ownerId,
  tenantId,
  personAccountId,
  documentVersionId,
  localDate,
  contractStatus,
  tawtheeqPath,
  tawtheeqWorkflowState,
  documentProcessingStatus,
  documentReviewStatus,
  approvalKind,
  approvalSlot,
  approvalStatus,
  type ContractApproval,
  type ContractFieldValues,
  type TawtheeqSnapshot,
  type TawtheeqDiscrepancy,
  type ResolvedDiscrepancy,
  type PermissionSubject,
} from "@aqarak/domain";
import type { QueryContext, CompanyActor } from "../audit/kernel";
import { Refusal } from "../audit/kernel";
import { one, rows, number, timestamp, jsonValue } from "./storage";
import {
  digits,
  comparedFields,
  type ComparedField,
  type FieldValue,
} from "./comparison";
import { reviewFields } from "./schemas";
const id = z.uuid();
export const recordSchema = z.object({
  id,
  company_id: companyId,
  version: number,
  contract_id: id,
  path: tawtheeqPath,
  workflow_state: tawtheeqWorkflowState,
  portal_status: z.string(),
  tawtheeq_number: z.string().nullable(),
  registered_on: z.string().nullable(),
  tawtheeq_document_version_id: documentVersionId.nullable(),
  skip_reason: z.string().nullable(),
  return_reason: z.string().nullable(),
  attested_on: z.string().nullable(),
  created_at: timestamp,
  updated_at: timestamp.nullable(),
});
export const termsSchema = z.object({
  term_start: z.iso.date(),
  term_end: z.iso.date(),
  annual_rent_fils: number,
  total_fils: number,
  deposit_fils: number,
  grace_days: number,
  vat_bp: number,
  services: jsonValue,
  template_code: z.string().nullable(),
  template_version: number.nullable(),
});
const versionSchema = termsSchema.extend({
  kind: z.enum(["standard", "tawtheeq_adoption"]),
  id,
  version_no: number,
  content_hash: z.string(),
  frozen_owner_gate: z.boolean(),
  submitted_at: z.string().nullable(),
});
const partySchema = z.object({
  id,
  full_name_en: z.string().nullable(),
  full_name_ar: z.string().nullable(),
  eid_number: z.string().nullable(),
  linked_account_id: personAccountId.nullable(),
});
export const documentSchema = z.object({
  id: documentVersionId,
  document_id: id,
  version_no: number,
  content_type: z.string(),
  byte_size: number,
  processing_status: documentProcessingStatus,
  review_status: documentReviewStatus,
  reject_reason: z.string().nullable(),
  created_at: timestamp,
  bucket: z.string(),
  s3_key: z.string(),
  s3_version_id: z.string().nullable(),
  sha256: z.string(),
});
const adoptionSchema = z.object({
  contractVersionId: id,
  sourceVersionId: id,
  versionNo: number,
  contentHash: z.string(),
  terms: z.record(z.string(), z.json()),
  changedFields: z.record(z.string(), z.union([z.string(), z.number()])),
  values: z.record(z.string(), z.union([z.string(), z.number()])),
});
const storedFields = reviewFields.extend({
  _adoption: adoptionSchema.optional(),
});
const reviewSchema = z.object({
  id,
  document_version_id: id,
  extraction_id: id.nullable(),
  fields: z.preprocess(
    (value) =>
      typeof value === "string" ? (JSON.parse(value) as unknown) : value,
    storedFields,
  ),
  outcome: z.string(),
});
const discrepancySchema = z.object({
  id,
  field_key: z.enum(comparedFields),
  class: z.enum(["identity", "material", "minor"]),
  app_value: jsonValue,
  tawtheeq_value: jsonValue,
  status: z.enum(["open", "resolved", "superseded"]),
  resolution: z
    .enum(["adopt", "cancel_and_reregister", "mark_equivalent"])
    .nullable(),
  reason: z.string().nullable(),
});
const approvalSchema = z.object({
  id,
  slot: approvalSlot,
  kind: approvalKind,
  status: approvalStatus,
  subject_hash: z.string(),
  approver_account_id: personAccountId,
  updated_by: personAccountId.nullable(),
  reason: z.string().nullable(),
  contract_version_id: id.nullable(),
});
export interface LoadedRecord {
  record: z.infer<typeof recordSchema>;
  contract: {
    id: string;
    contract_no: string;
    current_version_id: string;
    status: z.infer<typeof contractStatus>;
    renewal_of_id: string | null;
  };
  current: z.infer<typeof versionSchema>;
  unit: { id: string; unit_no: string; unt_number: string | null; use: string };
  owner: z.infer<typeof partySchema>;
  tenant: z.infer<typeof partySchema>;
  ownerIds: string[];
  document: z.infer<typeof documentSchema> | null;
  review: z.infer<typeof reviewSchema> | null;
  discrepancies: z.infer<typeof discrepancySchema>[];
  approvals: z.infer<typeof approvalSchema>[];
  basis: Record<ComparedField, FieldValue>;
}
export function subjectOf(data: LoadedRecord): PermissionSubject {
  return {
    company_id: data.record.company_id,
    owner_ids: data.ownerIds.map((v) => ownerId.parse(v)),
    tenant_ids: [tenantId.parse(data.tenant.id)],
  };
}
export function requireAccess(
  actor: CompanyActor,
  data: LoadedRecord,
  operation: "read" | "write" | "owner",
  step: "reapproval" | "skip_confirmation" = "reapproval",
): void {
  const subject = subjectOf(data);
  const grant =
    operation === "owner"
      ? can(actor, "approve", "approval_steps", {
          ...subject,
          approval_step: step,
        })
      : can(actor, operation, "tawtheeq", subject);
  if (!grant.ok)
    throw new Refusal(
      grant.error.code === "NOT_FOUND" ? "NOT_FOUND" : "NOT_PERMITTED",
      { type: "tawtheeq_record", id: data.record.id },
    );
  if (
    operation === "owner" &&
    data.owner.linked_account_id !== actor.account_id
  )
    throw new Refusal(
      "NOT_PERMITTED",
      { type: "tawtheeq_record", id: data.record.id },
      undefined,
      "NOT_NAMED_PARTY",
    );
}
export async function loadRecord(
  ctx: QueryContext,
  recordId: string,
): Promise<LoadedRecord> {
  const p = { company: ctx.companyId, record: id.parse(recordId) };
  const record = await one(
    ctx.tx,
    "select * from lease.tawtheeq_record where company_id=:company::uuid and id=:record::uuid",
    recordSchema,
    p,
  );
  const cp = { ...p, contract: record.contract_id };
  const contract = await one(
    ctx.tx,
    "select id,contract_no,current_version_id,status,renewal_of_id from lease.contract where company_id=:company::uuid and id=:contract::uuid",
    z.object({
      id,
      contract_no: z.string(),
      current_version_id: id,
      status: contractStatus,
      renewal_of_id: id.nullable(),
    }),
    cp,
  );
  const current = await one(
    ctx.tx,
    "select * from lease.contract_version where company_id=:company::uuid and id=:version::uuid",
    versionSchema,
    { ...p, version: contract.current_version_id },
  );
  const units = await rows(
    ctx.tx,
    "select u.id,u.unit_no,u.unt_number,u.use,u.property_id from estate.unit u join lease.contract_unit cu on cu.company_id=u.company_id and cu.unit_id=u.id where cu.company_id=:company::uuid and cu.contract_id=:contract::uuid order by u.id",
    z.object({
      id,
      unit_no: z.string(),
      unt_number: z.string().nullable(),
      use: z.string(),
      property_id: id,
    }),
    cp,
  );
  const unit = units[0];
  if (units.length !== 1 || !unit)
    throw new Refusal(
      "INVALID_TRANSITION",
      { type: "tawtheeq_record", id: recordId },
      "Tawtheeq requires one linked unit.",
    );
  const owners = await rows(
    ctx.tx,
    "select o.*,own.is_representative from party.owner o join estate.ownership own on own.company_id=o.company_id and own.owner_id=o.id where own.company_id=:company::uuid and own.property_id=:property::uuid order by o.id",
    partySchema.extend({ is_representative: z.boolean() }),
    { ...p, property: unit.property_id },
  );
  const representatives = owners.filter((owner) => owner.is_representative);
  const owner =
    representatives.length === 1
      ? representatives[0]
      : owners.length === 1
        ? owners[0]
        : undefined;
  if (!owner)
    throw new Refusal(
      "INVALID_TRANSITION",
      { type: "tawtheeq_record", id: recordId },
      "A single representative owner is required.",
    );
  const tenant = await one(
    ctx.tx,
    "select t.* from party.tenant t join lease.contract c on c.company_id=t.company_id and c.tenant_id=t.id where c.company_id=:company::uuid and c.id=:contract::uuid",
    partySchema,
    cp,
  );
  const document = record.tawtheeq_document_version_id
    ? await one(
        ctx.tx,
        "select * from doc.document_version where company_id=:company::uuid and id=:document::uuid",
        documentSchema,
        { ...p, document: record.tawtheeq_document_version_id },
      )
    : null;
  const reviews = await rows(
    ctx.tx,
    "select * from lease.tawtheeq_review where company_id=:company::uuid and tawtheeq_record_id=:record::uuid and document_version_id=:document::uuid order by created_at desc,id desc limit 1",
    reviewSchema,
    { ...p, document: record.tawtheeq_document_version_id },
  );
  const review = reviews[0] ?? null;
  const discrepancies = await rows(
    ctx.tx,
    "select * from lease.discrepancy where company_id=:company::uuid and tawtheeq_record_id=:record::uuid and document_version_id=:document::uuid and status<>'superseded' order by created_at,id",
    discrepancySchema,
    { ...p, document: record.tawtheeq_document_version_id },
  );
  const approvals = await rows(
    ctx.tx,
    "select a.* from lease.approval a left join lease.contract_version cv on cv.company_id=a.company_id and cv.id=a.contract_version_id where a.company_id=:company::uuid and (a.tawtheeq_record_id=:record::uuid or cv.contract_id=:contract::uuid) order by a.created_at desc,a.id desc",
    approvalSchema,
    cp,
  );
  const basis: Record<ComparedField, FieldValue> = {
    unt_number: unit.unt_number,
    owner_id_number: owner.eid_number,
    tenant_id_number: tenant.eid_number,
    term_start: current.term_start,
    term_end: current.term_end,
    annual_rent_fils: current.annual_rent_fils,
    deposit_fils: current.deposit_fils,
    contract_type: unit.use.toUpperCase(),
    owner_name: owner.full_name_en ?? owner.full_name_ar,
    tenant_name: tenant.full_name_en ?? tenant.full_name_ar,
  };
  if (current.kind === "tawtheeq_adoption") {
    const metadata = await one(
      ctx.tx,
      "select fields->'_adoption' as adoption from lease.tawtheeq_review where company_id=:company::uuid and fields->'_adoption'->>'contractVersionId'=:current order by created_at desc limit 1",
      z.object({
        adoption: z.preprocess(
          (value) =>
            typeof value === "string" ? (JSON.parse(value) as unknown) : value,
          adoptionSchema,
        ),
      }),
      { company: ctx.companyId, current: current.id },
    );
    for (const field of comparedFields) {
      const value = metadata.adoption.values[field];
      if (value !== undefined) basis[field] = value;
    }
  }
  return {
    record,
    contract,
    current,
    unit,
    owner,
    tenant,
    ownerIds: owners.map((item) => item.id),
    document,
    review,
    discrepancies,
    approvals,
    basis,
  };
}
export function approvalValue(
  row: z.infer<typeof approvalSchema> | undefined,
): ContractApproval | null {
  return row
    ? {
        slot: row.slot,
        kind: row.kind,
        status: row.status,
        subjectHash: row.subject_hash,
        approverAccountId: row.approver_account_id,
        sessionAccountId:
          row.status === "approved"
            ? (row.updated_by ?? row.approver_account_id)
            : row.approver_account_id,
      }
    : null;
}
export function priorValues(data: LoadedRecord): ContractFieldValues {
  return Object.fromEntries(
    Object.entries({
      ...data.basis,
      total_fils: data.current.total_fils,
      grace_days: data.current.grace_days,
    }).filter((entry): entry is [string, string | number] => entry[1] !== null),
  );
}
function candidateOf(
  data: LoadedRecord,
  resolutions: readonly ResolvedDiscrepancy[],
): TawtheeqSnapshot["candidateVersion"] {
  const adoption = data.review?.fields._adoption;
  if (!adoption || data.current.id === adoption.contractVersionId) return null;
  const candidate = createAdoptionVersion(
    priorValues(data),
    resolutions,
    adoption.contentHash,
  );
  if (!candidate.ok)
    throw new Refusal("INVALID_TRANSITION", {
      type: "tawtheeq_record",
      id: data.record.id,
    });
  return candidate.value;
}
export function snapshotOf(data: LoadedRecord): TawtheeqSnapshot {
  if (!data.owner.linked_account_id || !data.tenant.linked_account_id)
    throw new Refusal(
      "INVALID_TRANSITION",
      { type: "tawtheeq_record", id: data.record.id },
      "Linked party accounts are required.",
    );
  const adoption = data.review?.fields._adoption;
  const discrepancies: TawtheeqDiscrepancy[] = data.discrepancies.map(
    (item) => ({
      field: item.field_key,
      priorValue: z.union([z.string(), z.number()]).parse(item.app_value ?? ""),
      registeredValue: z
        .union([z.string(), z.number()])
        .parse(item.tawtheeq_value ?? ""),
    }),
  );
  const resolutions: ResolvedDiscrepancy[] = data.discrepancies.flatMap(
    (item, index) => {
      const discrepancy = discrepancies[index];
      if (!item.resolution || !discrepancy || !item.reason) return [];
      return [
        {
          ...discrepancy,
          resolution:
            item.resolution === "mark_equivalent"
              ? {
                  kind: item.resolution,
                  basis: "transliteration" as const,
                  reason: item.reason,
                }
              : { kind: item.resolution, reason: item.reason },
        },
      ];
    },
  );
  const linkedIdentity = {
    unt_number: digits(data.unit.unt_number ?? ""),
    owner_id_number: digits(data.owner.eid_number ?? ""),
    tenant_id_number: digits(data.tenant.eid_number ?? ""),
  };
  const fields = data.review?.fields;
  const subjectHash = adoption?.contentHash ?? data.current.content_hash;
  const candidate = candidateOf(data, resolutions);
  const active = data.approvals.filter(
    (a) => a.subject_hash === subjectHash && a.status === "approved",
  );
  return {
    state: data.record.workflow_state,
    path: data.record.path,
    version: data.record.version,
    contractStatus: data.contract.status,
    frozenOwnerGate: data.current.frozen_owner_gate,
    ownerAccountId: data.owner.linked_account_id,
    tenantAccountId: data.tenant.linked_account_id,
    contractContentHash: data.current.content_hash,
    subjectHash,
    priorValues: priorValues(data),
    linkedIdentity,
    documentVersionId: data.record.tawtheeq_document_version_id,
    document:
      data.document && fields
        ? {
            documentVersionId: data.document.id,
            processingStatus: data.document.processing_status,
            reviewStatus: data.document.review_status,
            tawtheeqNumber: fields.tawtheeq_number.value,
            registeredOn: localDate.parse(fields.registered_on.value),
            identity: {
              unt_number: digits(fields.unt_number.value),
              owner_id_number: digits(fields.owner_id_number.value),
              tenant_id_number: digits(fields.tenant_id_number.value),
            },
          }
        : null,
    discrepancies,
    resolutions,
    candidateVersion: candidate,
    managerApproval: approvalValue(
      active.find(
        (a) => a.slot === "manager" && a.kind === "contract_approval",
      ),
    ),
    ownerApproval: approvalValue(
      active.find((a) => a.slot === "owner" && a.kind === "owner_reapproval"),
    ),
  };
}
