import {
  can,
  daysBetween,
  localDateOf,
  utcInstant,
  tawtheeqTransitions,
} from "@aqarak/domain";
import { z } from "zod";
import type { QueryContext } from "../audit/kernel";
import {
  compareFields,
  type ComparedField,
  type FieldValue,
} from "./comparison";
import { storedExtraction, unpackFields } from "./extraction";
import { loadRecord, subjectOf, type LoadedRecord } from "./repository";
import { rows, jsonValue } from "./storage";
export function daysPending(data: LoadedRecord, now: Date): number | null {
  return ["registered", "skipped", "closed"].includes(
    data.record.workflow_state,
  )
    ? null
    : Math.max(
        0,
        daysBetween(
          localDateOf(utcInstant.parse(data.record.created_at)),
          localDateOf(utcInstant.parse(now.toISOString())),
        ),
      );
}
function mask(value: FieldValue, manager: boolean): FieldValue {
  return value === null || manager ? value : `••••${String(value).slice(-4)}`;
}
export function registeredValues(
  data: LoadedRecord,
): Partial<Record<ComparedField, FieldValue>> {
  if (!data.review) return {};
  return Object.fromEntries(
    Object.entries(data.review.fields).flatMap(([key, field]) =>
      field && "value" in field ? [[key, field.value]] : [],
    ),
  );
}
function maskExtraction(
  fields: ReturnType<typeof unpackFields>,
  manager: boolean,
): void {
  if (!manager)
    for (const field of ["owner_id_number", "tenant_id_number"]) {
      const value = fields[field];
      if (value)
        fields[field] = {
          ...value,
          value: value.value === null ? null : String(mask(value.value, false)),
          evidence: null,
        };
    }
}
export async function recordView(
  ctx: QueryContext,
  data: LoadedRecord,
): Promise<Record<string, unknown>> {
  const manager = can(ctx.actor, "write", "tawtheeq", subjectOf(data)).ok;
  const owner =
    can(ctx.actor, "approve", "approval_steps", {
      ...subjectOf(data),
      approval_step: "reapproval",
    }).ok && data.owner.linked_account_id === ctx.actor.account_id;
  const record = data.record;
  const extractionRows = data.document
    ? await rows(
        ctx.tx,
        "select e.id,e.fields,m.registry_entry from ai.extraction e join ai.model_call m on m.company_id=e.company_id and m.id=e.model_call_id where e.company_id=:company::uuid and e.document_version_id=:document::uuid order by e.created_at desc,e.id desc limit 1",
        storedExtraction,
        { company: ctx.companyId, document: data.document.id },
      )
    : [];
  const extraction = extractionRows[0];
  const comparison = data.review
    ? compareFields(data.basis, registeredValues(data)).map((item) =>
        item.class === "identity"
          ? {
              ...item,
              contractValue: mask(item.contractValue, manager),
              registeredValue: mask(item.registeredValue, manager),
            }
          : item,
      )
    : [];
  const resolutionEvents = await rows(
    ctx.tx,
    "select details from audit.audit_event where company_id=:company::uuid and subject_id=:record::uuid and event_type='tawtheeq.discrepancy_resolved' order by seq desc",
    z.object({
      details: jsonValue.pipe(
        z.object({ field: z.string(), basis: z.string().nullable() }),
      ),
    }),
    { company: ctx.companyId, record: record.id },
  );
  const adoption = data.review?.fields._adoption;
  const approval = adoption
    ? data.approvals.find(
        (item) =>
          item.contract_version_id === adoption.contractVersionId &&
          item.kind === "owner_reapproval",
      )
    : null;
  const fields = extraction ? unpackFields(extraction) : {};
  maskExtraction(fields, manager);
  const allowedActions = tawtheeqTransitions
    .filter(
      (row) =>
        row.from === record.workflow_state &&
        (row.actor === "manager" ? manager : owner),
    )
    .map((row) => row.command);
  if (
    owner &&
    data.approvals.some(
      (item) =>
        item.kind === "skip_confirmation" &&
        item.status === "requested" &&
        item.subject_hash === data.current.content_hash,
    )
  )
    allowedActions.push("skip_confirmation" as (typeof allowedActions)[number]);
  return {
    id: record.id,
    version: record.version,
    contractId: record.contract_id,
    path: record.path,
    workflowState: record.workflow_state,
    portalStatus: record.portal_status,
    tawtheeqNumber: record.tawtheeq_number,
    registeredOn: record.registered_on,
    skipReason: record.skip_reason,
    returnReason: record.return_reason,
    attestedOn: record.attested_on,
    daysPending: daysPending(data, ctx.now),
    contract: {
      contractNo: data.contract.contract_no,
      status: data.contract.status,
      currentVersionId: data.current.id,
      versionNo: data.current.version_no,
      contentHash: data.current.content_hash,
      frozenOwnerGate: data.current.frozen_owner_gate,
      termStart: data.current.term_start,
      termEnd: data.current.term_end,
      annualRentFils: data.current.annual_rent_fils,
      depositFils: data.current.deposit_fils,
      totalFils: data.current.total_fils,
      graceDays: data.current.grace_days,
      unit: {
        id: data.unit.id,
        unitNo: data.unit.unit_no,
        untNumber: data.unit.unt_number,
      },
      owner: {
        partyId: data.owner.id,
        nameEn: data.owner.full_name_en,
        nameAr: data.owner.full_name_ar,
        idNumberMasked: mask(data.owner.eid_number, manager),
      },
      tenant: {
        partyId: data.tenant.id,
        nameEn: data.tenant.full_name_en,
        nameAr: data.tenant.full_name_ar,
        idNumberMasked: mask(data.tenant.eid_number, manager),
      },
    },
    document: data.document
      ? {
          documentVersionId: data.document.id,
          versionNo: data.document.version_no,
          contentType: data.document.content_type,
          byteSize: data.document.byte_size,
          processingStatus: data.document.processing_status,
          reviewStatus: data.document.review_status,
          rejectReason: data.document.reject_reason,
          createdAt: data.document.created_at,
        }
      : null,
    extraction: extraction
      ? {
          extractionId: extraction.id,
          status: "succeeded",
          registryEntry: extraction.registry_entry,
          confidenceLabel: "uncalibrated",
          fields,
        }
      : null,
    comparison,
    discrepancies: data.discrepancies.map((item) => ({
      id: item.id,
      field: item.field_key,
      class: item.class,
      contractValue: item.app_value,
      registeredValue: item.tawtheeq_value,
      status: item.status,
      resolution: item.resolution
        ? {
            kind: item.resolution,
            basis:
              resolutionEvents.find(
                (event) => event.details.field === item.field_key,
              )?.details.basis ?? null,
            reason: item.reason,
          }
        : null,
    })),
    adoption: adoption
      ? {
          contractVersionId: adoption.contractVersionId,
          versionNo: adoption.versionNo,
          contentHash: adoption.contentHash,
          changedFields: adoption.changedFields,
          ownerApproval: approval
            ? { status: approval.status, reason: approval.reason }
            : null,
        }
      : null,
    allowedActions,
  };
}
export async function freshView(
  ctx: QueryContext,
  recordId: string,
): Promise<Record<string, unknown>> {
  return recordView(ctx, await loadRecord(ctx, recordId));
}
