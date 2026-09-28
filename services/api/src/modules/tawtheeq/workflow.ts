import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  classifyDiscrepancy,
  transitionTawtheeq,
  portalStatusOf,
  localDateOf,
  utcInstant,
  type TawtheeqCommand,
  type TawtheeqDecision,
  type TawtheeqEffect,
  type ContractApproval,
  type TawtheeqAdoptionVersion,
} from "@aqarak/domain";
import {
  coverTransactionVersions,
  writeAuditEvent,
  expectVersion,
  type CommandContext,
} from "../audit/kernel";
import { execute, parameters } from "./storage";
import { snapshotOf, type LoadedRecord } from "./repository";
import { domainRefusal } from "./problems";
import { contractContentHash } from "./comparison";

export async function commandEvent(
  ctx: CommandContext,
  recordId: string,
  eventType: string,
  options: {
    before?: number | null;
    after?: number | null;
    reason?: string | null;
    details?: Record<string, unknown>;
    cover?: boolean;
  } = {},
): Promise<void> {
  const event = await writeAuditEvent(ctx.tx, ctx.companyId, {
    eventType,
    actorAccountId: ctx.actor.account_id,
    actorRole: ctx.actor.roles.includes("manager") ? "manager" : "owner",
    initiator: "person",
    channel: ctx.channel,
    subjectType: "tawtheeq_record",
    subjectId: recordId,
    versionBefore: options.before ?? null,
    versionAfter: options.after ?? null,
    reason: options.reason ?? null,
    details: options.details ?? {},
    traceId: ctx.traceId,
    idempotencyKey: ctx.idempotencyKey,
    visibility: "parties",
  });
  if (options.cover !== false)
    await coverTransactionVersions(ctx.tx, ctx.companyId, event.eventId);
}
export async function notify(
  ctx: CommandContext,
  data: LoadedRecord,
  recipient: string,
  template: string,
): Promise<void> {
  await execute(
    ctx.tx,
    "insert into ops.outbox(company_id,topic,payload,dedupe_key) values (:company::uuid,'notification.tawtheeq',:payload::jsonb,:dedupe)",
    {
      company: ctx.companyId,
      payload: JSON.stringify({
        companyId: ctx.companyId,
        recordId: data.record.id,
        recipientRole: recipient,
        template,
      }),
      dedupe: `tawtheeq:${data.record.id}:${template}:${String(data.record.version + 1)}`,
    },
  );
}
export function adoptionTerms(
  data: LoadedRecord,
  values: Readonly<Record<string, unknown>>,
): Record<string, import("@aqarak/domain").CanonicalValue> {
  return {
    term_start: data.current.term_start,
    term_end: data.current.term_end,
    annual_rent_fils: data.current.annual_rent_fils,
    total_fils: data.current.total_fils,
    deposit_fils: data.current.deposit_fils,
    grace_days: data.current.grace_days,
    vat_bp: data.current.vat_bp,
    services: data.current.services,
    template_code: data.current.template_code,
    template_version: data.current.template_version,
    contract_type: data.basis.contract_type,
    owner_name: data.basis.owner_name,
    tenant_name: data.basis.tenant_name,
    ...Object.fromEntries(
      Object.entries(values).filter(
        (entry): entry is [string, string | number] =>
          typeof entry[1] === "string" || typeof entry[1] === "number",
      ),
    ),
  };
}
async function createAdoption(
  ctx: CommandContext,
  data: LoadedRecord,
  adoption: TawtheeqAdoptionVersion,
): Promise<string> {
  const id = randomUUID();
  const terms = adoptionTerms(data, adoption.values);
  if (contractContentHash(terms) !== adoption.contentHash)
    throw domainRefusal("STALE_SUBJECT_HASH", data.record.id);
  const result = await ctx.tx.execute(
    `insert into lease.contract_version(id,company_id,contract_id,version_no,kind,term_start,term_end,annual_rent_fils,total_fils,deposit_fils,grace_days,vat_bp,services,template_code,template_version,content_hash,frozen_owner_gate)
    select :id::uuid,:company::uuid,:contract::uuid,coalesce(max(version_no),0)+1,'tawtheeq_adoption',:start::date,:end::date,:rent::bigint,:total::bigint,:deposit::bigint,:grace::integer,:vat::integer,:services::jsonb,:template,:templateVersion::integer,:hash,:gate from lease.contract_version where company_id=:company::uuid and contract_id=:contract::uuid returning version_no`,
    parameters({
      id,
      company: ctx.companyId,
      contract: data.contract.id,
      start: z.iso.date().parse(terms.term_start),
      end: z.iso.date().parse(terms.term_end),
      rent: Number(terms.annual_rent_fils),
      total: Number(terms.total_fils),
      deposit: Number(terms.deposit_fils),
      grace: Number(terms.grace_days),
      vat: Number(terms.vat_bp),
      services: JSON.stringify(terms.services),
      template: data.current.template_code,
      templateVersion: data.current.template_version,
      hash: adoption.contentHash,
      gate: data.current.frozen_owner_gate,
    }),
  );
  const p = { company: ctx.companyId, source: data.current.id, target: id };
  await execute(
    ctx.tx,
    "insert into lease.contract_version_clause(company_id,contract_version_id,position,clause_key,source,text_en,text_ar,model_translated) select company_id,:target::uuid,position,clause_key,source,text_en,text_ar,model_translated from lease.contract_version_clause where company_id=:company::uuid and contract_version_id=:source::uuid",
    p,
  );
  await execute(
    ctx.tx,
    "insert into lease.occupant(company_id,contract_version_id,full_name,relationship,eid_number) select company_id,:target::uuid,full_name,relationship,eid_number from lease.occupant where company_id=:company::uuid and contract_version_id=:source::uuid",
    p,
  );
  await execute(
    ctx.tx,
    "update lease.contract_version set submitted_at=:on::timestamptz where company_id=:company::uuid and id=:target::uuid",
    { ...p, on: ctx.now.toISOString() },
  );
  if (!data.review)
    throw domainRefusal("REGISTRATION_EVIDENCE_MISSING", data.record.id);
  const metadata = {
    contractVersionId: id,
    sourceVersionId: data.current.id,
    versionNo: Number(result.rows[0]?.version_no),
    contentHash: adoption.contentHash,
    terms,
    values: adoption.values,
    changedFields: adoption.changedFields,
  };
  await execute(
    ctx.tx,
    "update lease.tawtheeq_review set fields=jsonb_set(fields,'{_adoption}',:metadata::jsonb) where company_id=:company::uuid and id=:review::uuid",
    {
      company: ctx.companyId,
      review: data.review.id,
      metadata: JSON.stringify(metadata),
    },
  );
  return id;
}
async function saveApproval(
  ctx: CommandContext,
  data: LoadedRecord,
  approval: ContractApproval,
  versionId: string | null,
): Promise<void> {
  const p = {
    company: ctx.companyId,
    subject: versionId ?? data.record.id,
    account: approval.approverAccountId,
    hash: approval.subjectHash,
    slot: approval.slot,
    kind: approval.kind,
  };
  const existing = await ctx.tx.execute(
    "update lease.approval set status='approved' where company_id=:company::uuid and subject_id=:subject::uuid and slot=:slot and kind=:kind and subject_hash=:hash and approver_account_id=:account::uuid and status='requested' returning id",
    parameters(p),
  );
  if (existing.rows.length) return;
  await execute(
    ctx.tx,
    "update lease.approval set status='voided',reason='Replaced by a new registration decision' where company_id=:company::uuid and subject_id=:subject::uuid and slot=:slot and status in ('requested','approved')",
    p,
  );
  await execute(
    ctx.tx,
    "insert into lease.approval(company_id,contract_version_id,tawtheeq_record_id,slot,kind,approver_account_id,subject_hash,status) values (:company::uuid,:version::uuid,:record::uuid,:slot,:kind,:account::uuid,:hash,'approved')",
    { ...p, version: versionId, record: versionId ? null : data.record.id },
  );
}
interface EffectContext {
  ctx: CommandContext;
  data: LoadedRecord;
  command: TawtheeqCommand;
  adoptionId: string | null;
  patch: Record<string, string | number | boolean | null>;
}
// eslint-disable-next-line complexity -- I keep the domain effect union exhaustive in one transaction dispatcher.
async function applyEffect(
  input: EffectContext,
  effect: TawtheeqEffect,
): Promise<void> {
  const { ctx, data, command, patch, adoptionId } = input;
  const p = {
    company: ctx.companyId,
    record: data.record.id,
    document: data.record.tawtheeq_document_version_id,
  };
  switch (effect.type) {
    case "set_path":
      patch.path = effect.path;
      break;
    case "record_portal_attestation":
      patch.attested_on = effect.on;
      patch.attested_by = effect.accountId;
      break;
    case "record_reason":
      patch[command.type === "skip" ? "skip_reason" : "return_reason"] =
        effect.reason;
      break;
    case "record_skip_confirmation":
      break;
    case "link_document":
      patch.tawtheeq_document_version_id = effect.documentVersionId;
      break;
    case "record_document":
      patch.tawtheeq_number = effect.document.tawtheeqNumber;
      patch.registered_on = effect.document.registeredOn;
      break;
    case "clear_review":
      await execute(
        ctx.tx,
        `update lease.discrepancy set status='superseded' where company_id=:company::uuid and tawtheeq_record_id=:record::uuid and ${command.type === "upload" ? "status in ('open','resolved')" : "status='open'"}`,
        p,
      );
      patch.tawtheeq_number = null;
      patch.registered_on = null;
      if (command.type !== "reject_identity") {
        await execute(
          ctx.tx,
          "update doc.document_version set review_status='superseded' where company_id=:company::uuid and id=:document::uuid and review_status<>'superseded'",
          p,
        );
        patch.tawtheeq_document_version_id = null;
      }
      break;
    case "reject_upload":
      await execute(
        ctx.tx,
        "update doc.document_version set review_status='rejected',reject_reason=:reason where company_id=:company::uuid and id=:document::uuid",
        { ...p, reason: `Identity mismatch: ${effect.field}` },
      );
      break;
    case "record_discrepancies":
      for (const item of effect.discrepancies)
        await execute(
          ctx.tx,
          "insert into lease.discrepancy(company_id,tawtheeq_record_id,document_version_id,field_key,app_value,tawtheeq_value,class,status) values (:company::uuid,:record::uuid,:document::uuid,:field,:prior::jsonb,:registered::jsonb,:class,'open')",
          {
            ...p,
            field: item.field,
            prior: JSON.stringify(item.priorValue),
            registered: JSON.stringify(item.registeredValue),
            class: classifyDiscrepancy(item.field),
          },
        );
      break;
    case "record_resolutions":
      for (const item of effect.resolutions)
        await execute(
          ctx.tx,
          "update lease.discrepancy set resolution=:kind,reason=:reason,status='resolved' where company_id=:company::uuid and tawtheeq_record_id=:record::uuid and document_version_id=:document::uuid and field_key=:field and status='open'",
          {
            ...p,
            field: item.field,
            kind: item.resolution.kind,
            reason: item.resolution.reason,
          },
        );
      break;
    case "create_adoption_version":
      break;
    case "record_approval":
      await saveApproval(ctx, data, effect.approval, adoptionId);
      break;
    case "request_owner_reapproval":
      await execute(
        ctx.tx,
        "insert into lease.approval(company_id,contract_version_id,slot,kind,approver_account_id,subject_hash,status) values (:company::uuid,:adoption::uuid,'owner','owner_reapproval',:account::uuid,:hash,'requested')",
        {
          company: ctx.companyId,
          adoption: adoptionId,
          account: effect.accountId,
          hash: effect.subjectHash,
        },
      );
      break;
    case "return_owner_reapproval":
      await execute(
        ctx.tx,
        "update lease.approval set status='voided',reason=:reason where company_id=:company::uuid and contract_version_id=:adoption::uuid and kind='owner_reapproval' and status='requested'",
        { ...p, adoption: adoptionId, reason: effect.reason },
      );
      await execute(
        ctx.tx,
        "update lease.discrepancy set status='open',resolution=null,reason=null where company_id=:company::uuid and tawtheeq_record_id=:record::uuid and document_version_id=:document::uuid and status='resolved'",
        p,
      );
      if (data.review)
        await execute(
          ctx.tx,
          "update lease.tawtheeq_review set fields=fields-'_adoption' where company_id=:company::uuid and id=:review::uuid",
          { ...p, review: data.review.id },
        );
      break;
    case "move_current_version":
      await execute(
        ctx.tx,
        "update lease.contract set current_version_id=:adoption::uuid where company_id=:company::uuid and id=:contract::uuid and status='concluded'",
        { ...p, contract: data.contract.id, adoption: adoptionId },
      );
      break;
    case "record_document_acceptance":
      await execute(
        ctx.tx,
        "update doc.document_version set review_status='accepted',reject_reason=null where company_id=:company::uuid and id=:document::uuid",
        { ...p, document: effect.documentVersionId },
      );
      break;
    case "notify":
      await notify(ctx, data, effect.recipient, effect.template);
      break;
    case "record_close":
      patch.closure_kind = effect.closureKind;
      patch.closure_reason = effect.reason;
      break;
  }
}
export function decide(
  ctx: CommandContext,
  data: LoadedRecord,
  command: TawtheeqCommand,
): TawtheeqDecision {
  expectVersion(data.record.version, command.expectedVersion, {
    type: "tawtheeq_record",
    id: data.record.id,
  });
  const result = transitionTawtheeq(snapshotOf(data), command, {
    actor: {
      role:
        command.type === "owner_reapprove" || command.type === "owner_return"
          ? "owner"
          : "manager",
      accountId: ctx.actor.account_id,
      sessionAccountId: ctx.actor.account_id,
    },
    on: localDateOf(utcInstant.parse(ctx.now.toISOString())),
  });
  if (!result.ok) throw domainRefusal(result.error.code, data.record.id);
  return result.value;
}
function transitionVersions(
  version: number,
  eventIndex: number,
): { before: number | null; after: number | null } {
  // I assign version coverage once; related semantic events do not write another version.
  return eventIndex === 0
    ? { before: version, after: version + 1 }
    : { before: null, after: null };
}
export async function applyDecision(
  ctx: CommandContext,
  data: LoadedRecord,
  command: TawtheeqCommand,
  decision: TawtheeqDecision,
): Promise<void> {
  const patch: EffectContext["patch"] = {
    workflow_state: decision.state,
    portal_status: portalStatusOf(decision.state, {
      isRenewal: data.contract.renewal_of_id !== null,
    }),
  };
  const adoptionEffect = decision.effects.find(
    (effect) => effect.type === "create_adoption_version",
  );
  const adoptionId = adoptionEffect
    ? await createAdoption(ctx, data, adoptionEffect.version)
    : (data.review?.fields._adoption?.contractVersionId ?? null);
  for (const effect of decision.effects)
    await applyEffect({ ctx, data, command, adoptionId, patch }, effect);
  if (command.type === "reject_identity") {
    patch.tawtheeq_number = command.document.tawtheeqNumber;
    patch.registered_on = command.document.registeredOn;
  }
  if (command.type === "skip")
    await notify(ctx, data, "owner", "tawtheeq_skipped");
  const casts: Record<string, string> = {
    attested_on: "::date",
    attested_by: "::uuid",
    registered_on: "::date",
    tawtheeq_document_version_id: "::uuid",
  };
  await execute(
    ctx.tx,
    `update lease.tawtheeq_record set ${Object.keys(patch)
      .map((key) => `${key}=:${key}${casts[key] ?? ""}`)
      .join(",")} where company_id=:company::uuid and id=:record::uuid`,
    { ...patch, company: ctx.companyId, record: data.record.id },
  );
  const rejection = decision.effects.find(
    (effect) => effect.type === "reject_upload",
  );
  const reason =
    "reason" in command
      ? command.reason
      : rejection
        ? `Identity mismatch: ${rejection.field}`
        : null;
  for (const [index, eventType] of decision.events.entries())
    await commandEvent(ctx, data.record.id, eventType, {
      ...transitionVersions(data.record.version, index),
      reason,
      cover: index === 0,
    });
  for (const effect of decision.effects) {
    if (effect.type !== "record_resolutions") continue;
    for (const item of effect.resolutions)
      await commandEvent(ctx, data.record.id, "tawtheeq.discrepancy_resolved", {
        reason: item.resolution.reason,
        cover: false,
        details: {
          field: item.field,
          contractValue: item.priorValue,
          registeredValue: item.registeredValue,
          resolution: item.resolution.kind,
          basis:
            item.resolution.kind === "mark_equivalent"
              ? item.resolution.basis
              : null,
        },
      });
  }
}
