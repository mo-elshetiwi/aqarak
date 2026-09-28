import { z } from "zod";
import {
  contractTransitions,
  storedIdempotency,
  type CanonicalValue,
} from "./runtime/domain";
import type { RequestContext } from "./runtime/request";
import { first, rows, string, integer, instant } from "./runtime/sql";
import { requireContractScope } from "./runtime/actor";
import { WorkflowProblem } from "./runtime/problem";
import {
  loadContract,
  loadUnitParties,
  currentGate,
  documentsAcceptedSql,
  dubaiDate,
  type LoadedContract,
} from "./repository";
import { name, renderContract } from "./render";
import { contractDeliveries } from "./deliveries";
import type { listSchema } from "./schema";
export function canonical(value: unknown): CanonicalValue {
  return storedIdempotency.parse({
    request_sha256: "",
    response: value,
    created_at: "",
  }).response;
}
export async function detail(
  context: RequestContext,
  id: string,
): Promise<CanonicalValue> {
  const loaded = await loadContract(context, id);
  await requireContractScope(context.tx, context.actor, loaded.contract);
  const template = await first(
    context.tx,
    "select * from lease.contract_template where company_id is null and code='standard_residential' and template_version=1",
  );
  if (!template) throw new WorkflowProblem("UNAVAILABLE");
  const c = loaded.contract;
  const v = loaded.version;
  const p = loaded.parties;
  const gate = v.frozen_owner_gate ?? currentGate(context, loaded.parties);
  const extras = await detailExtras(context, loaded);
  return canonical({
    contract: {
      id: c.id,
      contractNo: c.contract_no,
      status: c.status,
      origin: c.origin,
      cancelKind: c.cancel_kind,
      cancelReason: c.cancel_reason,
      revisionOfId: c.revision_of_id,
      successorId: loaded.successorId,
      currentVersionNo: integer(v, "version_no"),
      createdAt: instant(c.created_at),
      updatedAt: instant(c.updated_at ?? c.created_at),
    },
    version: {
      id: v.id,
      versionNo: integer(v, "version_no"),
      submittedAt: v.submitted_at ? instant(v.submitted_at) : null,
      contentHash: v.content_hash,
      frozenOwnerGate: v.frozen_owner_gate,
      termStart: v.term_start,
      termEnd: v.term_end,
      graceDays: loaded.draft.graceDays,
      annualRentFils: loaded.draft.annualRentFils,
      totalFils: loaded.draft.totalFils,
      depositFils: loaded.draft.depositFils,
      vatBp: loaded.draft.vatBp,
      templateCode: v.template_code,
      templateVersion: integer(v, "template_version"),
      instalments: loaded.draft.instalments,
      specialClauses: (
        await rows(
          context.tx,
          `select c.position,c.text_en,c.text_ar,c.model_translated,e.registry_entry,e.prompt_version,
          e.field_provenance->>('clause_' || c.position::text) as confirmation
          from lease.contract_version_clause c
          left join audit.event_subject s on s.company_id=c.company_id and s.subject_type='contract_version' and s.subject_id=c.contract_version_id and s.subject_version=1
          left join audit.audit_event e on e.company_id=s.company_id and e.event_id=s.event_id
          where c.contract_version_id=:id::uuid order by c.position`,
          { id: string(v, "id") },
        )
      ).map((clause) => ({
        position: integer(clause, "position"),
        textEn: clause.text_en,
        textAr: clause.text_ar,
        modelTranslated: clause.model_translated,
        suggestion:
          (clause.confirmation === "ai_confirmed" ||
            clause.confirmation === "ai_edited") &&
          clause.registry_entry &&
          clause.prompt_version
            ? {
                registryEntry: clause.registry_entry,
                promptVersion: clause.prompt_version,
                confirmation: clause.confirmation,
              }
            : null,
      })),
    },
    unit: { id: p.unit.id, unitNo: p.unit.unit_no },
    property: { id: p.property.id, name: name(p.property, "name") },
    owner: p.owner
      ? {
          id: p.owner.id,
          name: name(p.owner),
          hasAccount: p.owner.linked_account_id != null,
        }
      : null,
    tenant: { id: p.tenant.id, name: name(p.tenant), kind: p.tenant.kind },
    ownerGate: { value: gate, frozen: v.submitted_at != null },
    rendered: renderContract({
      template,
      company: context.company,
      parties: p,
      draft: loaded.draft,
      contractNo: string(c, "contract_no"),
    }),
    ...extras,
    viewer: viewer(context, loaded),
  });
}
function viewer(
  context: RequestContext,
  loaded: LoadedContract,
): { slot: string; allowedActions: string[] } {
  const slots: string[] = [];
  if (context.actor.manager) slots.push("manager");
  if (loaded.parties.owner?.linked_account_id === context.actor.accountId)
    slots.push("owner");
  if (loaded.parties.tenant.linked_account_id === context.actor.accountId)
    slots.push("tenant");
  const allowedActions: string[] = [
    ...new Set(
      contractTransitions
        .filter(
          (r) =>
            r.from === loaded.contract.status &&
            slots.includes(r.actor) &&
            !["end", "conclude_retroactive"].includes(r.command) &&
            !(r.command === "revise" && loaded.successorId),
        )
        .map((r) => r.command),
    ),
  ];
  if (context.actor.manager && loaded.contract.status === "draft")
    allowedActions.push("suggest_clause");
  return { slot: slots[0] ?? "reader", allowedActions };
}
async function detailExtras(
  context: RequestContext,
  loaded: LoadedContract,
): Promise<Record<string, unknown>> {
  const id = string(loaded.contract, "id");
  const approvals = await rows(
    context.tx,
    `select a.*,p.display_name,ac.channel,ac.device from lease.approval a left join core.person_account p on p.id=a.approver_account_id left join lease.approval_context ac on ac.approval_id=a.id and ac.company_id=a.company_id where a.contract_version_id=:id::uuid order by a.created_at,a.id`,
    { id: string(loaded.version, "id") },
  );
  const versions = await rows(
    context.tx,
    "select version_no,content_hash,submitted_at,created_at from lease.contract_version where contract_id=:id::uuid order by version_no desc",
    { id },
  );
  const predecessor = loaded.contract.revision_of_id
    ? await first(
        context.tx,
        `select c.id,c.contract_no,v.version_no from lease.contract c join lease.contract_version v on v.id=c.current_version_id and v.company_id=c.company_id where c.id=:id::uuid`,
        { id: string(loaded.contract, "revision_of_id") },
      )
    : undefined;
  const tawtheeq = await first(
    context.tx,
    "select workflow_state,portal_status from lease.tawtheeq_record where contract_id=:id::uuid",
    { id },
  );
  const deliveries = context.actor.manager
    ? await contractDeliveries(context.tx, id)
    : [];
  return {
    approvals: approvals.map((a) => ({
      id: a.id,
      slot: a.slot,
      status: a.status,
      personName: a.display_name ?? "",
      requestedAt: instant(a.created_at),
      decidedAt:
        a.status === "requested" ? null : instant(a.updated_at ?? a.created_at),
      subjectHash: a.subject_hash,
      reason: a.reason,
      channel: a.channel,
      device: a.device,
    })),
    versions: versions.map((v) => ({
      versionNo: integer(v, "version_no"),
      contentHash: v.content_hash,
      submittedAt: v.submitted_at ? instant(v.submitted_at) : null,
      createdAt: instant(v.created_at),
    })),
    predecessor: predecessor
      ? {
          id: predecessor.id,
          contractNo: predecessor.contract_no,
          version: integer(predecessor, "version_no"),
        }
      : null,
    tawtheeq: tawtheeq
      ? {
          workflowState: tawtheeq.workflow_state,
          portalStatus: tawtheeq.portal_status,
        }
      : null,
    deliveries,
  };
}
export async function listContracts(
  context: RequestContext,
  input: z.infer<typeof listSchema>,
): Promise<CanonicalValue> {
  if (
    !context.actor.manager &&
    !context.actor.reader &&
    !context.actor.ownerIds.length &&
    !context.actor.tenantIds.length
  )
    throw new WorkflowProblem("NOT_FOUND");
  let cursor: string | null = null;
  if (input.cursor) {
    const parsed = z
      .uuid()
      .safeParse(Buffer.from(input.cursor, "base64url").toString());
    if (!parsed.success)
      throw new WorkflowProblem("VALIDATION_FAILED", "cursor");
    cursor = parsed.data;
  }
  const all = await rows(
    context.tx,
    `select c.id from lease.contract c where (:status::text is null or c.status=:status) and (:cursor::uuid is null or c.id>:cursor::uuid)
    and (:staff::boolean or exists(select 1 from party.tenant t where t.id=c.tenant_id and t.company_id=c.company_id and t.linked_account_id=:account::uuid)
    or exists(select 1 from lease.contract_unit cu join estate.unit u on u.id=cu.unit_id and u.company_id=cu.company_id join estate.ownership o on o.property_id=u.property_id and o.company_id=u.company_id join party.owner p on p.id=o.owner_id and p.company_id=o.company_id where cu.contract_id=c.id and cu.company_id=c.company_id and p.linked_account_id=:account::uuid)) order by c.id limit :limit`,
    {
      status: input.status ?? null,
      cursor,
      staff: context.actor.manager || context.actor.reader,
      account: context.actor.accountId,
      limit: input.limit + 1,
    },
  );
  const items = [];
  for (const row of all.slice(0, input.limit)) {
    const l = await loadContract(context, string(row, "id"));
    items.push({
      id: l.contract.id,
      contractNo: l.contract.contract_no,
      status: l.contract.status,
      unit: {
        id: l.parties.unit.id,
        unitNo: l.parties.unit.unit_no,
        propertyName: name(l.parties.property, "name"),
      },
      tenant: { id: l.parties.tenant.id, name: name(l.parties.tenant) },
      termStart: l.draft.termStart,
      termEnd: l.draft.termEnd,
      annualRentFils: l.draft.annualRentFils,
      currentVersionNo: integer(l.version, "version_no"),
      nextActor: nextActor(string(l.contract, "status")),
      updatedAt: instant(l.contract.updated_at ?? l.contract.created_at),
    });
  }
  const last = all[input.limit - 1];
  return canonical({
    items,
    nextCursor:
      all.length > input.limit && last
        ? Buffer.from(string(last, "id")).toString("base64url")
        : null,
  });
}
function nextActor(status: string): string | null {
  if (status === "draft") return "manager";
  if (status === "awaiting_owner_approval") return "owner";
  if (status === "awaiting_tenant_acceptance") return "tenant";
  return null;
}
export async function draftingOptions(
  context: RequestContext,
): Promise<CanonicalValue> {
  if (!context.actor.manager) throw new WorkflowProblem("FORBIDDEN");
  const tenants = await rows(
    context.tx,
    `select t.*,${documentsAcceptedSql} as documents_accepted from party.tenant t order by t.id`,
  );
  const unitRows = await rows(
    context.tx,
    "select u.*,p.name_en,p.name_ar from estate.unit u join estate.property p on p.id=u.property_id and p.company_id=u.company_id order by u.id",
  );
  const units = [];
  for (const unit of unitRows) {
    const p = await loadUnitParties(context.tx, {
      unitId: string(unit, "id"),
      on: dubaiDate(context.dependencies.clock()),
    });
    units.push({
      id: unit.id,
      unitNo: unit.unit_no,
      propertyId: unit.property_id,
      propertyName: name(unit, "name"),
      status: unit.status,
      ownerGate: currentGate(context, p),
      owner: p.owner
        ? {
            id: p.owner.id,
            name: name(p.owner),
            hasAccount: p.owner.linked_account_id != null,
          }
        : null,
    });
  }
  return canonical({
    tenants: tenants.map((t) => ({
      id: t.id,
      name: name(t),
      kind: t.kind,
      documentsAccepted: t.documents_accepted,
    })),
    units,
  });
}
