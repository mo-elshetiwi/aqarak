import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  transitionContract,
  validateContractSchedule,
  contractId,
  unitId,
  propertyId,
  personAccountId,
  draftedActionId,
  localDate,
  localDateOf,
  utcInstant,
  nonNegativeFils,
  basisPoints,
  companyKind,
  type ContractContext,
  type ContractCommand,
  type ContractDecision,
  type ContractEffect,
  type CanonicalValue,
  type FieldProvenance,
} from "@aqarak/domain";
import {
  writeAuditEvent,
  coverTransactionVersions,
  type CommandContext,
} from "../audit/kernel";
import { execute, rows, one, number } from "./storage";
import { contractContentHash } from "./comparison";
import { freshView } from "./views";
import {
  draftDocument,
  requireDraftVersion,
  type IntakeDraft,
} from "./retroactive-repository";
import {
  IntakeRefusal,
  parseConfirmation,
  provenanceValues,
  requiredFields,
  type ConfirmBody,
} from "./retroactive-schemas";

const party = z.object({
  id: z.uuid(),
  eid_number: z.string().nullable(),
  linked_account_id: personAccountId.nullable(),
});
const unit = z.object({
  id: unitId,
  unt_number: z.string().nullable(),
  property_id: propertyId,
  status: z.string(),
});
interface MatchedRecords {
  owner: z.infer<typeof party>;
  tenant: z.infer<typeof party>;
  unit: z.infer<typeof unit>;
}
async function matchRecords(
  ctx: CommandContext,
  draftId: string,
  input: ConfirmBody,
): Promise<MatchedRecords> {
  const p = { company: ctx.companyId };
  const owners = await rows(
    ctx.tx,
    "select id,eid_number,linked_account_id from party.owner where company_id=:company::uuid and id=:id::uuid for share",
    party,
    { ...p, id: input.ownerId },
  );
  const tenants = await rows(
    ctx.tx,
    "select id,eid_number,linked_account_id from party.tenant where company_id=:company::uuid and id=:id::uuid for share",
    party,
    { ...p, id: input.tenantId },
  );
  const units = await rows(
    ctx.tx,
    "select id,unt_number,property_id,status from estate.unit where company_id=:company::uuid and id=:id::uuid for share",
    unit,
    { ...p, id: input.unitId },
  );
  const owner = owners[0],
    tenant = tenants[0],
    matchedUnit = units[0];
  if (!owner || !tenant || !matchedUnit)
    throw new IntakeRefusal(
      "RETROACTIVE_EVIDENCE_MISSING",
      draftId,
      "matched_records",
      [
        ...(!owner ? ["owner"] : []),
        ...(!tenant ? ["tenant"] : []),
        ...(!matchedUnit ? ["unit"] : []),
      ],
    );
  const identity = {
    unt_number: matchedUnit.unt_number,
    owner_id_number: owner.eid_number,
    tenant_id_number: tenant.eid_number,
  };
  for (const field of [
    "unt_number",
    "owner_id_number",
    "tenant_id_number",
  ] as const)
    if (identity[field] !== input.fields[field].value)
      throw new IntakeRefusal("IDENTITY_MISMATCH", draftId, field);
  const ownerships = await rows(
    ctx.tx,
    "select owner_id,is_representative from estate.ownership where company_id=:company::uuid and property_id=:property::uuid for share",
    z.object({ owner_id: z.uuid(), is_representative: z.boolean() }),
    { ...p, property: matchedUnit.property_id },
  );
  const representatives = ownerships.filter((item) => item.is_representative);
  const representative =
    representatives.length === 1
      ? representatives[0]
      : ownerships.length === 1
        ? ownerships[0]
        : undefined;
  if (representative?.owner_id !== owner.id)
    throw new IntakeRefusal(
      "RETROACTIVE_EVIDENCE_MISSING",
      draftId,
      "unit_owner",
      ["unit_owner"],
    );
  return { owner, tenant, unit: matchedUnit };
}
async function requireRecipients(
  ctx: CommandContext,
  draftId: string,
  matched: MatchedRecords,
): Promise<{
  owner: z.infer<typeof personAccountId>;
  tenant: z.infer<typeof personAccountId>;
}> {
  const { owner, tenant } = matched;
  if (!owner.linked_account_id || !tenant.linked_account_id)
    throw new IntakeRefusal(
      "RETROACTIVE_EVIDENCE_MISSING",
      draftId,
      "party_notifications",
    );
  const links = await rows(
    ctx.tx,
    "select account_id,kind from core.account_company_link where company_id=:company::uuid and status='active' and ((account_id=:owner::uuid and kind='owner') or (account_id=:tenant::uuid and kind='tenant')) for share",
    z.object({ account_id: personAccountId, kind: z.string() }),
    {
      company: ctx.companyId,
      owner: owner.linked_account_id,
      tenant: tenant.linked_account_id,
    },
  );
  if (
    !links.some(
      (link) =>
        link.kind === "owner" && link.account_id === owner.linked_account_id,
    ) ||
    !links.some(
      (link) =>
        link.kind === "tenant" && link.account_id === tenant.linked_account_id,
    )
  )
    throw new IntakeRefusal(
      "RETROACTIVE_EVIDENCE_MISSING",
      draftId,
      "party_notifications",
    );
  return { owner: owner.linked_account_id, tenant: tenant.linked_account_id };
}
async function contractContext(
  ctx: CommandContext,
  matched: MatchedRecords,
): Promise<ContractContext> {
  const company = await one(
    ctx.tx,
    "select kind,default_owner_gate from core.company where id=:company::uuid",
    z.object({ kind: companyKind, default_owner_gate: z.boolean() }),
    { company: ctx.companyId },
  );
  const property = await one(
    ctx.tx,
    "select owner_gate_override from estate.property where company_id=:company::uuid and id=:id::uuid",
    z.object({ owner_gate_override: z.boolean().nullable() }),
    { company: ctx.companyId, id: matched.unit.property_id },
  );
  const blocking = await rows(
    ctx.tx,
    "select contract_id,occupancy_start,occupancy_end from lease.contract_unit where company_id=:company::uuid and unit_id=:unit::uuid and blocks_unit",
    z.object({
      contract_id: contractId,
      occupancy_start: localDate,
      occupancy_end: localDate,
    }),
    { company: ctx.companyId, unit: matched.unit.id },
  );
  return {
    actor: {
      role: "manager",
      accountId: ctx.actor.account_id,
      sessionAccountId: ctx.actor.account_id,
    },
    on: localDateOf(utcInstant.parse(ctx.now.toISOString())),
    company: {
      kind: company.kind,
      defaultOwnerGate: company.default_owner_gate,
    },
    property: {
      id: matched.unit.property_id,
      ownerGateOverride: property.owner_gate_override,
    },
    mandate: null,
    blockedUnitIds: matched.unit.status === "blocked" ? [matched.unit.id] : [],
    blockingContracts: blocking.map((row) => ({
      id: row.contract_id,
      unitIds: [matched.unit.id],
      termStart: row.occupancy_start,
      termEnd: row.occupancy_end,
      blocksUnit: true,
    })),
    tenantExists: true,
    tenantDocumentsAccepted: true,
    ownerAccountActive: true,
  };
}
interface Confirmation {
  input: ConfirmBody;
  command: Extract<ContractCommand, { type: "conclude_retroactive" }>;
  decision: ContractDecision;
  fieldProvenance: Record<string, FieldProvenance>;
  hashTerms: Record<string, CanonicalValue>;
}
async function decideConfirmation(
  ctx: CommandContext,
  draft: IntakeDraft,
  raw: unknown,
): Promise<Confirmation> {
  const input = parseConfirmation(raw, draft.id);
  requireDraftVersion(draft, input.expectedVersion);
  const matched = await matchRecords(ctx, draft.id, input);
  const notifications = await requireRecipients(ctx, draft.id, matched);
  const document = await draftDocument(ctx, draft);
  if (
    !document?.s3_version_id ||
    (input.documentVersionId !== undefined &&
      document.id !== input.documentVersionId)
  )
    throw new IntakeRefusal(
      "RETROACTIVE_EVIDENCE_MISSING",
      draft.id,
      "registered_document",
    );
  const fields = input.fields;
  const terms = {
    unitIds: [matched.unit.id],
    termStart: localDate.parse(fields.term_start.value),
    termEnd: localDate.parse(fields.term_end.value),
    totalFils: nonNegativeFils.parse(fields.total_fils.value),
    vatBp: basisPoints.parse(fields.vat_bp.value),
    instalments: fields.payment_schedule.value.map((line) => ({
      seqNo: line.seqNo,
      amountFils: nonNegativeFils.parse(line.amountFils),
      vatFils: nonNegativeFils.parse(line.vatFils),
    })),
  };
  if (terms.termEnd <= terms.termStart)
    throw new IntakeRefusal("INVALID_INPUT", draft.id, "term_end");
  const schedule = validateContractSchedule(terms);
  if (!schedule.ok)
    throw new IntakeRefusal(
      schedule.error.code,
      draft.id,
      schedule.error.field,
    );
  const hashTerms: Record<string, CanonicalValue> = {
    unit_ids: [matched.unit.id],
    owner_id: matched.owner.id,
    tenant_id: matched.tenant.id,
    ...Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key, value.value]),
    ),
  };
  const contentHash = contractContentHash(hashTerms);
  const fieldProvenance = Object.fromEntries(
    Object.entries(fields).map(([key, field]) => [
      key,
      provenanceValues[field.provenance],
    ]),
  );
  const command: Confirmation["command"] = {
    type: "conclude_retroactive",
    contract: {
      id: contractId.parse(randomUUID()),
      ownerAccountId: notifications.owner,
      tenantAccountId: notifications.tenant,
      tenantSignatoryAccountIds: [],
      terms,
      contentHash,
      linkedIdentity: {
        unt_number: matched.unit.unt_number ?? "",
        owner_id_number: matched.owner.eid_number ?? "",
        tenant_id_number: matched.tenant.eid_number ?? "",
      },
      revisionOfId: null,
      renewalOfId: null,
    },
    managerConfirmation: {
      draftedActionId: draftedActionId.parse(draft.id),
      sourceDocumentVersionId: document.id,
      contentHash,
      requiredFields,
      fields: fieldProvenance,
    },
    document: {
      documentVersionId: document.id,
      processingStatus: document.processing_status,
      reviewStatus: "accepted",
      tawtheeqNumber: fields.tawtheeq_number.value,
      registeredOn: localDate.parse(fields.registered_on.value),
      identity: {
        unt_number: fields.unt_number.value,
        owner_id_number: fields.owner_id_number.value,
        tenant_id_number: fields.tenant_id_number.value,
      },
    },
    notifications,
  };
  const result = transitionContract(
    null,
    command,
    await contractContext(ctx, matched),
  );
  if (!result.ok)
    throw new IntakeRefusal(result.error.code, draft.id, result.error.field);
  return { input, command, decision: result.value, fieldProvenance, hashTerms };
}
interface EffectContext {
  ctx: CommandContext;
  draft: IntakeDraft;
  confirmation: Confirmation;
  versionId: string;
  recordId: string;
  approvalId: string;
  contractNo: string;
}
// eslint-disable-next-line complexity -- I apply the closed domain effect union in one transaction dispatcher.
async function applyEffect(
  data: EffectContext,
  effect: ContractEffect,
): Promise<void> {
  const { ctx, draft, confirmation, versionId, recordId, approvalId } = data;
  const { input, command } = confirmation;
  const p = {
    company: ctx.companyId,
    contract: command.contract.id,
    version: versionId,
    record: recordId,
    draft: draft.id,
  };
  switch (effect.type) {
    case "create_contract":
      await execute(
        ctx.tx,
        "insert into lease.contract(id,company_id,contract_no,tenant_id,status,origin) values (:contract::uuid,:company::uuid,:number,:tenant::uuid,:status,:origin)",
        {
          ...p,
          number: data.contractNo,
          tenant: input.tenantId,
          status: confirmation.decision.status,
          origin: effect.origin,
        },
      );
      break;
    case "create_version":
      await execute(
        ctx.tx,
        "insert into lease.contract_version(id,company_id,contract_id,version_no,kind,term_start,term_end,annual_rent_fils,total_fils,deposit_fils,vat_bp,content_hash,frozen_owner_gate,submitted_at) values (:version::uuid,:company::uuid,:contract::uuid,:number,'standard',:start::date,:end::date,:total::bigint,:total::bigint,0,:vat::integer,:hash,false,:now::timestamptz)",
        {
          ...p,
          number: effect.number,
          start: effect.terms.termStart,
          end: effect.terms.termEnd,
          total: effect.terms.totalFils,
          vat: effect.terms.vatBp,
          hash: effect.contentHash,
          now: ctx.now.toISOString(),
        },
      );
      await execute(
        ctx.tx,
        "update lease.contract set current_version_id=:version::uuid where company_id=:company::uuid and id=:contract::uuid",
        p,
      );
      break;
    case "record_retroactive_confirmation":
      await execute(
        ctx.tx,
        "update ai.drafted_action set status='committed',payload=:payload::jsonb,field_provenance=:provenance::jsonb where company_id=:company::uuid and id=:draft::uuid",
        {
          ...p,
          payload: JSON.stringify({
            ...draft.payload,
            confirmation: input,
            confirmedTerms: confirmation.hashTerms,
            contentHash: effect.confirmation.contentHash,
            contractId: command.contract.id,
            recordId,
            scheduleActivation: "deferred_to_payments",
          }),
          provenance: JSON.stringify(confirmation.fieldProvenance),
        },
      );
      break;
    case "record_approval":
      await execute(
        ctx.tx,
        "insert into lease.approval(id,company_id,contract_version_id,slot,kind,approver_account_id,subject_hash,status) values (:approval::uuid,:company::uuid,:version::uuid,:slot,:kind,:account::uuid,:hash,:status)",
        {
          ...p,
          approval: approvalId,
          slot: effect.approval.slot,
          kind: effect.approval.kind,
          account: effect.approval.approverAccountId,
          hash: effect.approval.subjectHash,
          status: effect.approval.status,
        },
      );
      break;
    case "set_blocks_unit":
      await execute(
        ctx.tx,
        "insert into lease.contract_unit(company_id,contract_id,unit_id,occupancy_start,occupancy_end,blocks_unit) values (:company::uuid,:contract::uuid,:unit::uuid,:start::date,:end::date,:blocks)",
        {
          ...p,
          unit: input.unitId,
          start: command.contract.terms.termStart,
          end: command.contract.terms.termEnd,
          blocks: effect.value,
        },
      );
      break;
    case "create_tawtheeq_record":
      if (!effect.document)
        throw new IntakeRefusal(
          "RETROACTIVE_EVIDENCE_MISSING",
          draft.id,
          "registered_document",
        );
      await execute(
        ctx.tx,
        "insert into lease.tawtheeq_record(id,company_id,contract_id,path,workflow_state,portal_status,tawtheeq_number,registered_on,tawtheeq_document_version_id) values (:record::uuid,:company::uuid,:contract::uuid,:path,:state,'registered',:number,:on::date,:document::uuid)",
        {
          ...p,
          path: effect.path,
          state: effect.state,
          number: effect.document.tawtheeqNumber,
          on: effect.document.registeredOn,
          document: effect.document.documentVersionId,
        },
      );
      await execute(
        ctx.tx,
        "update doc.document_version set review_status='accepted',reject_reason=null where company_id=:company::uuid and id=:document::uuid",
        { ...p, document: effect.document.documentVersionId },
      );
      break;
    case "activate_schedule":
      // I retain the confirmed schedule in the drafted action; payments records past instalments separately.
      break;
    case "notify":
      if (!effect.accountId)
        throw new IntakeRefusal(
          "RETROACTIVE_EVIDENCE_MISSING",
          draft.id,
          "party_notifications",
        );
      await execute(
        ctx.tx,
        "insert into ops.outbox(company_id,topic,payload,dedupe_key) values (:company::uuid,'notification.tawtheeq',:payload::jsonb,:dedupe)",
        {
          ...p,
          payload: JSON.stringify({
            companyId: ctx.companyId,
            contractId: command.contract.id,
            recordId,
            recipientAccountId: effect.accountId,
            recipientRole: effect.recipient,
            template: effect.template,
          }),
          dedupe: `retroactive:${command.contract.id}:${effect.recipient}`,
        },
      );
      break;
    case "freeze_version":
    case "request_approval":
    case "void_live_approvals":
    case "set_cancel_kind":
    case "link_revision":
    case "record_end":
      throw new IntakeRefusal("INVALID_TRANSITION", draft.id, effect.type);
  }
}
async function auditDecision(data: EffectContext): Promise<void> {
  const { ctx, draft, confirmation } = data;
  for (const [index, eventType] of confirmation.decision.events.entries()) {
    const subject =
      eventType === "approval.approved"
        ? { type: "approval", id: data.approvalId }
        : eventType === "tawtheeq_record.registered"
          ? { type: "tawtheeq_record", id: data.recordId }
          : { type: "contract", id: confirmation.command.contract.id };
    const event = await writeAuditEvent(ctx.tx, ctx.companyId, {
      eventType,
      actorAccountId: ctx.actor.account_id,
      actorRole: "manager",
      initiator: "person",
      channel: ctx.channel,
      subjectType: subject.type,
      subjectId: subject.id,
      versionBefore: null,
      versionAfter: index === 0 ? 2 : null,
      draftedActionId: draft.id,
      fieldProvenance: index === 0 ? confirmation.fieldProvenance : null,
      traceId: ctx.traceId,
      idempotencyKey: ctx.idempotencyKey,
      visibility: "parties",
      details: {
        contractId: confirmation.command.contract.id,
        recordId: data.recordId,
        scheduleActivation: "deferred_to_payments",
      },
    });
    if (index === 0)
      await coverTransactionVersions(ctx.tx, ctx.companyId, event.eventId);
  }
}
/** I validate IN8R before applying every decision effect and covering all writes atomically. */
export async function confirmIntake(
  ctx: CommandContext,
  draft: IntakeDraft,
  raw: unknown,
): Promise<Record<string, unknown>> {
  const confirmation = await decideConfirmation(ctx, draft, raw);
  const year = localDateOf(utcInstant.parse(ctx.now.toISOString())).slice(0, 4);
  // I allocate while the kernel holds the company lock; the database also enforces company uniqueness.
  const next = await one(
    ctx.tx,
    "select coalesce(max(right(contract_no,6)::integer),0)+1 as number from lease.contract where company_id=:company::uuid and contract_no ~ :pattern",
    z.object({ number }),
    { company: ctx.companyId, pattern: `^RC-${year}-[0-9]{6}$` },
  );
  if (next.number > 999999)
    throw new IntakeRefusal("INVALID_TRANSITION", draft.id, "contract_no");
  const data: EffectContext = {
    ctx,
    draft,
    confirmation,
    versionId: randomUUID(),
    recordId: randomUUID(),
    approvalId: randomUUID(),
    contractNo: `RC-${year}-${String(next.number).padStart(6, "0")}`,
  };
  for (const effect of confirmation.decision.effects)
    await applyEffect(data, effect);
  await auditDecision(data);
  return {
    ...(await freshView(ctx, data.recordId)),
    draftId: draft.id,
    scheduleActivation: "deferred_to_payments",
  };
}
