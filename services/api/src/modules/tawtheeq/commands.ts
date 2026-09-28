import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  documentVersionId,
  localDate,
  classifyDiscrepancy,
  resolveDiscrepancies,
  requiresOwnerReapproval,
  type TawtheeqCommand,
  type DiscrepancyResolutionInput,
  type RegisteredDocument,
} from "@aqarak/domain";
import { expectVersion, Refusal, type CommandContext } from "../audit/kernel";
import { reviewBody, resolutionBody, skipBody, ownerDecision } from "./schemas";
import {
  approvalValue,
  loadRecord,
  snapshotOf,
  type LoadedRecord,
} from "./repository";
import {
  applyDecision,
  decide,
  commandEvent,
  adoptionTerms,
  notify,
} from "./workflow";
import { compareFields, contractContentHash, digits } from "./comparison";
import { execute, rows } from "./storage";
import { storedExtraction, proposedValues, unpackFields } from "./extraction";
import { requireClean } from "./uploads";
import { domainRefusal } from "./problems";

function validateProvenance(
  fields: z.infer<typeof reviewBody>["fields"],
  proposals: Record<string, string | number | null | undefined>,
  recordId: string,
): void {
  for (const [key, field] of Object.entries(fields)) {
    if (!field) continue;
    const proposal = proposals[key];
    const present = proposal !== undefined && proposal !== null;
    const required = present
      ? proposal === field.value
        ? "extracted"
        : "edited"
      : "manual";
    if (field.provenance !== required)
      throw domainRefusal("INVALID_INPUT", recordId);
  }
}
export async function review(
  ctx: CommandContext,
  data: LoadedRecord,
  raw: unknown,
): Promise<void> {
  const input = reviewBody.parse(raw);
  expectVersion(data.record.version, input.expectedVersion, {
    type: "tawtheeq_record",
    id: data.record.id,
  });
  const document = requireClean(data);
  if (document.id !== input.documentVersionId)
    throw domainRefusal("REGISTRATION_EVIDENCE_MISSING", data.record.id);
  const extractions = input.extractionId
    ? await rows(
        ctx.tx,
        "select e.id,e.fields,m.registry_entry from ai.extraction e join ai.model_call m on m.company_id=e.company_id and m.id=e.model_call_id where e.company_id=:company::uuid and e.id=:id::uuid and e.document_version_id=:document::uuid",
        storedExtraction,
        {
          company: ctx.companyId,
          id: input.extractionId,
          document: document.id,
        },
      )
    : [];
  if (input.extractionId && !extractions.length)
    throw domainRefusal("INVALID_INPUT", data.record.id);
  const extraction = extractions[0];
  const proposals = extraction
    ? (proposedValues(unpackFields(extraction)) as Record<
        string,
        string | number | null | undefined
      >)
    : {};
  validateProvenance(input.fields, proposals, data.record.id);
  const values = Object.fromEntries(
    Object.entries(input.fields).flatMap(([key, field]) =>
      field ? [[key, field.value]] : [],
    ),
  );
  const comparison = compareFields(data.basis, values);
  const mismatch = comparison.find(
    (item) => item.class === "identity" && item.status !== "match",
  );
  const differences = comparison.filter(
    (item) =>
      item.class !== "identity" &&
      item.status !== "match" &&
      item.registeredValue !== null,
  );
  const evidence: RegisteredDocument = {
    documentVersionId: documentVersionId.parse(document.id),
    processingStatus: document.processing_status,
    reviewStatus: "accepted",
    tawtheeqNumber: input.fields.tawtheeq_number.value,
    registeredOn: localDate.parse(input.fields.registered_on.value),
    identity: {
      unt_number: digits(input.fields.unt_number.value),
      owner_id_number: digits(input.fields.owner_id_number.value),
      tenant_id_number: digits(input.fields.tenant_id_number.value),
    },
  };
  const command: TawtheeqCommand = mismatch
    ? {
        type: "reject_identity",
        expectedVersion: input.expectedVersion,
        document: evidence,
      }
    : differences.length
      ? {
          type: "open_discrepancies",
          expectedVersion: input.expectedVersion,
          document: evidence,
          discrepancies: differences.map((item) => ({
            field: item.field,
            priorValue: item.contractValue ?? "",
            registeredValue: item.registeredValue ?? "",
          })),
        }
      : {
          type: "confirm_matches",
          expectedVersion: input.expectedVersion,
          document: evidence,
        };
  const decision = decide(ctx, data, command);
  await execute(
    ctx.tx,
    "insert into lease.tawtheeq_review(company_id,tawtheeq_record_id,document_version_id,extraction_id,fields,outcome,reviewed_by) values (:company::uuid,:record::uuid,:document::uuid,:extraction::uuid,:fields::jsonb,:outcome,:account::uuid)",
    {
      company: ctx.companyId,
      record: data.record.id,
      document: document.id,
      extraction: input.extractionId,
      fields: JSON.stringify(input.fields),
      outcome: mismatch
        ? "identity_rejected"
        : differences.length
          ? "discrepancies"
          : "matched",
      account: ctx.actor.account_id,
    },
  );
  await execute(
    ctx.tx,
    "update doc.document_version set review_status=:status,reject_reason=:reason where company_id=:company::uuid and id=:document::uuid",
    {
      company: ctx.companyId,
      document: document.id,
      status: mismatch ? "rejected" : "accepted",
      reason: mismatch ? `Identity mismatch: ${mismatch.field}` : null,
    },
  );
  await applyDecision(ctx, data, command, decision);
}
export async function resolve(
  ctx: CommandContext,
  data: LoadedRecord,
  raw: unknown,
): Promise<void> {
  const input = resolutionBody.parse(raw);
  const choices: DiscrepancyResolutionInput[] = input.choices.map((choice) => {
    const discrepancy = data.discrepancies.find(
      (item) => item.id === choice.discrepancyId && item.status === "open",
    );
    if (!discrepancy)
      throw domainRefusal("DISCREPANCIES_UNRESOLVED", data.record.id);
    if (choice.kind === "mark_equivalent") {
      if (
        classifyDiscrepancy(discrepancy.field_key) !== "minor" ||
        !choice.basis
      )
        throw domainRefusal("MARK_EQUIVALENT_NOT_ALLOWED", data.record.id);
      return {
        field: discrepancy.field_key,
        choice: {
          kind: choice.kind,
          basis: choice.basis,
          reason: choice.reason ?? null,
        },
      };
    }
    return {
      field: discrepancy.field_key,
      choice: { kind: choice.kind, reason: choice.reason ?? null },
    };
  });
  const state = snapshotOf(data);
  const resolved = resolveDiscrepancies(state.discrepancies, choices);
  if (!resolved.ok) throw domainRefusal(resolved.error.code, data.record.id);
  const cancelled = choices.some(
    (choice) => choice.choice.kind === "cancel_and_reregister",
  );
  const adopted = Object.fromEntries(
    resolved.value
      .filter((item) => item.resolution.kind === "adopt")
      .map((item) => [item.field, item.registeredValue]),
  );
  const hasAdoption = Object.keys(adopted).length > 0;
  const subjectHash = hasAdoption
    ? contractContentHash(
        adoptionTerms(data, { ...state.priorValues, ...adopted }),
      )
    : state.contractContentHash;
  const command: TawtheeqCommand = {
    type: cancelled
      ? "reregister"
      : requiresOwnerReapproval(state.frozenOwnerGate, resolved.value)
        ? "prepare_adoption"
        : "register_resolved",
    expectedVersion: input.expectedVersion,
    choices,
    subjectHash,
  };
  await applyDecision(ctx, data, command, decide(ctx, data, command));
}
export async function skip(
  ctx: CommandContext,
  data: LoadedRecord,
  raw: unknown,
): Promise<void> {
  const input = skipBody.parse(raw);
  expectVersion(data.record.version, input.expectedVersion, {
    type: "tawtheeq_record",
    id: data.record.id,
  });
  if (!input.reason?.trim())
    throw domainRefusal("REASON_REQUIRED", data.record.id);
  if (input.requestOwnerConfirmation && data.current.frozen_owner_gate) {
    if (
      data.record.workflow_state !== "awaiting_registration" ||
      !data.owner.linked_account_id
    )
      throw domainRefusal("INVALID_TRANSITION", data.record.id);
    const pending = data.approvals.find(
      (a) =>
        a.kind === "skip_confirmation" &&
        ["requested", "approved"].includes(a.status),
    );
    if (pending) throw domainRefusal("INVALID_TRANSITION", data.record.id);
    await execute(
      ctx.tx,
      "insert into lease.approval(company_id,tawtheeq_record_id,slot,kind,approver_account_id,subject_hash,status) values (:company::uuid,:record::uuid,'owner','skip_confirmation',:owner::uuid,:hash,'requested')",
      {
        company: ctx.companyId,
        record: data.record.id,
        owner: data.owner.linked_account_id,
        hash: data.current.content_hash,
      },
    );
    await execute(
      ctx.tx,
      "update lease.tawtheeq_record set skip_reason=:reason where company_id=:company::uuid and id=:record::uuid",
      {
        company: ctx.companyId,
        record: data.record.id,
        reason: input.reason.trim(),
      },
    );
    await notify(ctx, data, "owner", "tawtheeq_skip_confirmation_requested");
    await commandEvent(ctx, data.record.id, "approval.requested", {
      before: data.record.version,
      after: data.record.version + 1,
      reason: input.reason.trim(),
    });
    return;
  }
  const command: TawtheeqCommand = {
    type: "skip",
    expectedVersion: input.expectedVersion,
    reason: input.reason,
    ownerConfirmation: approvalValue(
      data.approvals.find(
        (a) =>
          a.kind === "skip_confirmation" &&
          a.status === "approved" &&
          a.subject_hash === data.current.content_hash,
      ),
    ),
  };
  await applyDecision(ctx, data, command, decide(ctx, data, command));
}
export async function skipConfirmation(
  ctx: CommandContext,
  data: LoadedRecord,
  raw: unknown,
): Promise<void> {
  const input = ownerDecision.parse(raw);
  const pending = data.approvals.find(
    (a) =>
      a.kind === "skip_confirmation" &&
      a.status === "requested" &&
      a.subject_hash === data.current.content_hash &&
      a.approver_account_id === ctx.actor.account_id,
  );
  if (!pending || data.record.workflow_state !== "awaiting_registration")
    throw domainRefusal("INVALID_TRANSITION", data.record.id);
  if (input.decision === "return" && !input.reason?.trim())
    throw domainRefusal("REASON_REQUIRED", data.record.id);
  await execute(
    ctx.tx,
    "update lease.approval set status=:status,reason=:reason where company_id=:company::uuid and id=:approval::uuid",
    {
      company: ctx.companyId,
      approval: pending.id,
      status: input.decision === "approve" ? "approved" : "voided",
      reason: input.reason?.trim() ?? null,
    },
  );
  await execute(
    ctx.tx,
    "update lease.tawtheeq_record set return_reason=:reason where company_id=:company::uuid and id=:record::uuid",
    {
      company: ctx.companyId,
      record: data.record.id,
      reason:
        input.decision === "return" ? (input.reason?.trim() ?? null) : null,
    },
  );
  await commandEvent(
    ctx,
    data.record.id,
    input.decision === "approve" ? "approval.approved" : "approval.voided",
    {
      before: data.record.version,
      after: data.record.version + 1,
      reason: input.reason?.trim() ?? null,
    },
  );
}
export async function openRecord(
  ctx: CommandContext,
  raw: unknown,
): Promise<LoadedRecord> {
  const input = z.strictObject({ contractId: z.uuid() }).parse(raw);
  const contracts = await rows(
    ctx.tx,
    "select id,status from lease.contract where company_id=:company::uuid and id=:contract::uuid",
    z.object({ id: z.uuid(), status: z.string() }),
    { company: ctx.companyId, contract: input.contractId },
  );
  if (!contracts.length) throw new Refusal("NOT_FOUND", null);
  if (contracts[0]?.status !== "concluded")
    throw new Refusal("INVALID_TRANSITION", null);
  const existing = await rows(
    ctx.tx,
    "select id from lease.tawtheeq_record where company_id=:company::uuid and contract_id=:contract::uuid",
    z.object({ id: z.uuid() }),
    { company: ctx.companyId, contract: input.contractId },
  );
  if (existing.length) throw new Refusal("INVALID_TRANSITION", null);
  const id = randomUUID();
  await execute(
    ctx.tx,
    "insert into lease.tawtheeq_record(id,company_id,contract_id,path,workflow_state,portal_status) values (:id::uuid,:company::uuid,:contract::uuid,'normal','awaiting_registration','not_started')",
    { id, company: ctx.companyId, contract: input.contractId },
  );
  await commandEvent(ctx, id, "tawtheeq_record.awaiting_registration", {
    after: 1,
  });
  return loadRecord(ctx, id);
}
