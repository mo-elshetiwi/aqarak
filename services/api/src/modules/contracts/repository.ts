import { z } from "zod";
import {
  localDate,
  ownerGate,
  propertyId,
  personAccountId,
  contractId,
  unitId,
  companyKind,
  contractStatus,
  contractOrigin,
  approvalSlot,
  approvalKind,
  approvalStatus,
  type ContractContext,
  type ContractSnapshot,
  type OwnerGateMandate,
} from "./runtime/domain";
import type { CompanyTransaction, Row } from "./runtime/db";
import {
  first,
  rows,
  string,
  nullableString,
  integer,
  boolean,
} from "./runtime/sql";
import { WorkflowProblem } from "./runtime/problem";
import type { RequestContext } from "./runtime/request";
import { draftSchema, terms, type DraftInput } from "./schema";
export const documentsAcceptedSql = `exists (select 1 from doc.document d join doc.document_version dv on dv.id=d.current_version_id and dv.company_id=d.company_id where d.subject_type='tenant' and d.subject_id=t.id and d.doc_type=case when t.kind='individual' then 'emirates_id' else 'trade_licence' end and dv.review_status='accepted')`;
export interface Parties {
  tenant: Row;
  unit: Row;
  property: Row;
  owner: Row | null;
  mandate: OwnerGateMandate | null;
}
export async function loadParties(
  tx: CompanyTransaction,
  input: { tenantId: string; unitId: string; on: string },
): Promise<Parties> {
  const tenant = await first(
    tx,
    `select t.*,${documentsAcceptedSql} as documents_accepted from party.tenant t where t.id=:id::uuid`,
    { id: input.tenantId },
  );
  if (!tenant) throw new WorkflowProblem("TENANT_REQUIRED", "tenantId");
  return { tenant, ...(await loadUnitParties(tx, input)) };
}
export async function loadUnitParties(
  tx: CompanyTransaction,
  input: { unitId: string; on: string },
): Promise<Omit<Parties, "tenant">> {
  const unit = await first(tx, "select * from estate.unit where id=:id::uuid", {
    id: input.unitId,
  });
  if (!unit) throw new WorkflowProblem("NOT_FOUND");
  const property = await first(
    tx,
    "select * from estate.property where id=:id::uuid",
    { id: string(unit, "property_id") },
  );
  if (!property) throw new WorkflowProblem("NOT_FOUND");
  const owners = await rows(
    tx,
    `select p.*,o.is_representative from estate.ownership o join party.owner p on p.id=o.owner_id and p.company_id=o.company_id where o.property_id=:id::uuid order by p.id`,
    { id: string(property, "id") },
  );
  const representatives = owners.filter((o) => boolean(o, "is_representative"));
  const owner =
    (representatives.length === 1
      ? representatives[0]
      : owners.length === 1
        ? owners[0]
        : null) ?? null;
  const mandateRow = owner
    ? await first(
        tx,
        `select m.* from estate.owner_mandate m join estate.mandate_property p on p.mandate_id=m.id and p.company_id=m.company_id where p.property_id=:property::uuid and m.owner_id=:owner::uuid and m.status='active' and m.starts_on<=:on::date and (m.ends_on is null or m.ends_on>=:on::date) order by m.starts_on desc,m.id limit 1`,
        {
          property: string(property, "id"),
          owner: string(owner, "id"),
          on: input.on,
        },
      )
    : undefined;
  const mandate: OwnerGateMandate | null = mandateRow
    ? {
        status: "active",
        propertyIds: [propertyId.parse(property.id)],
        startsOn: localDate.parse(mandateRow.starts_on),
        endsOn: mandateRow.ends_on ? localDate.parse(mandateRow.ends_on) : null,
        ownerGate: z.boolean().nullable().parse(mandateRow.owner_gate),
      }
    : null;
  return { unit, property, owner, mandate };
}
export function dubaiDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export async function loadDraft(
  tx: CompanyTransaction,
  contract: Row,
  version: Row,
  unit: Row,
): Promise<DraftInput> {
  const instalments = await rows(
    tx,
    `select i.*,c.cheque_no,c.bank_name from money.instalment i left join money.cheque c on c.instalment_id=i.id and c.company_id=i.company_id where i.contract_version_id=:id::uuid order by i.seq_no`,
    { id: string(version, "id") },
  );
  const clauses = await rows(
    tx,
    "select * from lease.contract_version_clause where contract_version_id=:id::uuid order by position",
    { id: string(version, "id") },
  );
  return draftSchema.parse({
    tenantId: contract.tenant_id,
    unitId: unit.unit_id ?? unit.id,
    termStart: version.term_start,
    termEnd: version.term_end,
    graceDays: integer(version, "grace_days"),
    annualRentFils: integer(version, "annual_rent_fils"),
    totalFils: integer(version, "total_fils"),
    depositFils: integer(version, "deposit_fils"),
    vatBp: integer(version, "vat_bp"),
    instalments: instalments.map((i) => ({
      seqNo: integer(i, "seq_no"),
      dueOn: i.due_on,
      amountFils: integer(i, "amount_fils"),
      vatFils: integer(i, "vat_fils"),
      cheque: i.cheque_no
        ? { chequeNo: i.cheque_no, bankName: i.bank_name }
        : null,
    })),
    specialClauses: clauses.map((c) => ({
      textEn: c.text_en,
      textAr: c.text_ar,
      modelTranslated: c.model_translated,
    })),
  });
}
export interface LoadedContract {
  contract: Row;
  version: Row;
  unitLink: Row;
  parties: Parties;
  draft: DraftInput;
  approvals: Row[];
  successorId: string | null;
}
export async function loadContract(
  context: RequestContext,
  id: string,
  lock = false,
): Promise<LoadedContract> {
  const contract = await first(
    context.tx,
    `select * from lease.contract where id=:id::uuid${lock ? " for update" : ""}`,
    { id },
  );
  if (!contract) throw new WorkflowProblem("NOT_FOUND");
  const version = await first(
    context.tx,
    "select * from lease.contract_version where id=:id::uuid",
    { id: nullableString(contract, "current_version_id") },
  );
  const unitLink = await first(
    context.tx,
    "select * from lease.contract_unit where contract_id=:id::uuid order by id limit 1",
    { id },
  );
  if (!version || !unitLink) throw new WorkflowProblem("UNAVAILABLE");
  const parties = await loadParties(context.tx, {
    tenantId: string(contract, "tenant_id"),
    unitId: string(unitLink, "unit_id"),
    on: dubaiDate(context.dependencies.clock()),
  });
  const draft = await loadDraft(context.tx, contract, version, unitLink);
  const approvals = await rows(
    context.tx,
    "select * from lease.approval where contract_version_id=:id::uuid order by created_at,id",
    { id: string(version, "id") },
  );
  const successor = await first(
    context.tx,
    "select id from lease.contract where revision_of_id=:id::uuid",
    { id },
  );
  return {
    contract,
    version,
    unitLink,
    parties,
    draft,
    approvals,
    successorId: successor ? string(successor, "id") : null,
  };
}
export async function domainContext(
  context: RequestContext,
  parties: Parties,
): Promise<ContractContext> {
  const blocked = await rows(
    context.tx,
    "select id from estate.unit where status='blocked' and id=:id::uuid",
    { id: string(parties.unit, "id") },
  );
  const blocking = await rows(
    context.tx,
    "select contract_id,unit_id,occupancy_start,occupancy_end from lease.contract_unit where blocks_unit=true and unit_id=:id::uuid",
    { id: string(parties.unit, "id") },
  );
  return {
    actor: {
      accountId: personAccountId.parse(context.actor.accountId),
      sessionAccountId: personAccountId.parse(context.actor.accountId),
      role: context.audit.role ?? "manager",
    },
    on: localDate.parse(dubaiDate(context.dependencies.clock())),
    company: {
      kind: companyKind.parse(context.company.kind),
      defaultOwnerGate: boolean(context.company, "default_owner_gate"),
    },
    property: {
      id: propertyId.parse(parties.property.id),
      ownerGateOverride: z
        .boolean()
        .nullable()
        .parse(parties.property.owner_gate_override),
    },
    mandate: parties.mandate,
    blockedUnitIds: blocked.map((r) => unitId.parse(r.id)),
    blockingContracts: blocking.map((r) => ({
      id: contractId.parse(r.contract_id),
      unitIds: [unitId.parse(r.unit_id)],
      termStart: localDate.parse(r.occupancy_start),
      termEnd: localDate.parse(r.occupancy_end),
      blocksUnit: true,
    })),
    tenantExists: true,
    tenantDocumentsAccepted: boolean(parties.tenant, "documents_accepted"),
    ownerAccountActive: parties.owner?.linked_account_id != null,
  };
}
export function snapshot(loaded: LoadedContract): ContractSnapshot {
  const tenantAccount = nullableString(
    loaded.parties.tenant,
    "linked_account_id",
  );
  if (!tenantAccount) throw new WorkflowProblem("TENANT_REQUIRED", "tenantId");
  return {
    id: contractId.parse(loaded.contract.id),
    status: contractStatus.parse(loaded.contract.status),
    origin: contractOrigin.parse(loaded.contract.origin),
    version: {
      number: integer(loaded.version, "version_no"),
      contentHash: string(loaded.version, "content_hash"),
      submitted: loaded.version.submitted_at != null,
      frozenOwnerGate: z
        .boolean()
        .nullable()
        .parse(loaded.version.frozen_owner_gate),
      terms: terms(loaded.draft),
    },
    ownerAccountId: loaded.parties.owner?.linked_account_id
      ? personAccountId.parse(loaded.parties.owner.linked_account_id)
      : null,
    tenantAccountId: personAccountId.parse(tenantAccount),
    tenantSignatoryAccountIds: [],
    approvals: loaded.approvals.map((a) => ({
      slot: approvalSlot.parse(a.slot),
      kind: approvalKind.parse(a.kind),
      status: approvalStatus.parse(a.status),
      subjectHash: string(a, "subject_hash"),
      approverAccountId: personAccountId.parse(a.approver_account_id),
      sessionAccountId: personAccountId.parse(a.approver_account_id),
    })),
    successorId: loaded.successorId
      ? contractId.parse(loaded.successorId)
      : null,
  };
}

export function currentGate(
  context: RequestContext,
  parties: Omit<Parties, "tenant">,
): boolean {
  return ownerGate(
    {
      kind: companyKind.parse(context.company.kind),
      defaultOwnerGate: boolean(context.company, "default_owner_gate"),
    },
    {
      id: propertyId.parse(parties.property.id),
      ownerGateOverride: z
        .boolean()
        .nullable()
        .parse(parties.property.owner_gate_override),
    },
    parties.mandate,
    localDate.parse(dubaiDate(context.dependencies.clock())),
  );
}
