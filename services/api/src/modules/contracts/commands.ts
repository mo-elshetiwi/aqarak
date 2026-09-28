import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  contractId,
  personAccountId,
  transitionContract,
  type ContractCommand,
  type NewContract,
  type CanonicalValue,
  type ContractDecision,
} from "./runtime/domain";
import type { RequestContext } from "./runtime/request";
import { json } from "./runtime/request";
import { commandRole, requireContractScope } from "./runtime/actor";
import { claimIdempotency, completeIdempotency } from "./runtime/idempotency";
import { flushAudit, type EventInput } from "./runtime/audit";
import { first, string, integer, nullableString } from "./runtime/sql";
import {
  insertBusiness,
  updateBusiness,
  type WriteContext,
} from "./runtime/mutations";
import { WorkflowProblem } from "./runtime/problem";
import {
  draftSchema,
  editSchema,
  approvalSchema,
  reasonSchema,
  versionSchema,
  terms,
  contentHash,
  type DraftInput,
} from "./schema";
import {
  loadContract,
  loadParties,
  domainContext,
  snapshot,
  dubaiDate,
  type LoadedContract,
  type Parties,
} from "./repository";
import { detail, canonical } from "./queries";
import { saveVersion } from "./version-writer";
import {
  applyExistingEffect,
  notify,
  rowIdentity,
  type EffectContext,
} from "./effects";
export type CommandName =
  | "create"
  | "edit"
  | "submit"
  | "approve_owner"
  | "accept_tenant"
  | "return_owner"
  | "return_tenant"
  | "withdraw"
  | "cancel_draft"
  | "revise";
export async function command(
  context: RequestContext,
  input: {
    type: CommandName;
    body: CanonicalValue;
    params: Record<string, string>;
  },
): Promise<Response> {
  const id = input.params.contractId;
  const loaded = id ? await loadContract(context, id, true) : null;
  if (loaded)
    await requireContractScope(context.tx, context.actor, loaded.contract);
  context.audit.role = commandRole(context.actor, input.type);
  if (loaded) requireNamedParty(context, loaded);
  const replay = await claimIdempotency(context.tx, {
    actor: context.audit,
    command: input.type,
    pathParams: input.params,
    body: input.body,
    now: context.dependencies.clock().toISOString(),
  });
  if (replay) return json(replay.body, replay.status);
  const draft = commandDraft(input, loaded);
  const provenance = await clauseProvenance(context, draft, input);
  const parties =
    loaded?.parties ??
    (await loadParties(context.tx, {
      tenantId: draft.tenantId,
      unitId: draft.unitId,
      on: dubaiDate(context.dependencies.clock()),
    }));
  const nextId =
    input.type === "create" || input.type === "revise"
      ? randomUUID()
      : z.uuid().parse(id);
  const dc = await domainContext(context, parties);
  requireAvailableUnit(input.type, dc.blockedUnitIds, draft.unitId);
  const domainCommand = makeCommand(input, { id: nextId, draft, parties });
  const decision = transitionContract(
    loaded ? snapshot(loaded) : null,
    domainCommand,
    dc,
  );
  if (!decision.ok)
    throw new WorkflowProblem(decision.error.code, decision.error.field);
  const write = await persistDecision(context, {
    type: input.type,
    loaded,
    draft,
    parties,
    nextId,
    decision: decision.value,
  });
  await flushAudit(context.tx, context.audit, {
    events: decision.value.events,
    mutations: write.mutations,
    contractId: nextId,
    reason: "reason" in domainCommand ? domainCommand.reason : null,
    provenance,
  });
  const body = await detail(context, nextId);
  const status = input.type === "create" || input.type === "revise" ? 201 : 200;
  await completeIdempotency(context.tx, {
    actor: context.audit,
    command: input.type,
    response: { status, body },
  });
  return json(body, status);
}
function requireNamedParty(
  context: RequestContext,
  loaded: LoadedContract,
): void {
  if (
    context.audit.role === "owner" &&
    loaded.parties.owner?.linked_account_id !== context.actor.accountId
  )
    throw new WorkflowProblem("FORBIDDEN");
  if (
    context.audit.role === "tenant" &&
    loaded.parties.tenant.linked_account_id !== context.actor.accountId
  )
    throw new WorkflowProblem("FORBIDDEN");
}
function commandDraft(
  input: { type: CommandName; body: CanonicalValue },
  loaded: LoadedContract | null,
): DraftInput {
  if (input.type === "create") return draftSchema.parse(input.body);
  if (!loaded) throw new WorkflowProblem("NOT_FOUND");
  if (input.type === "edit")
    return {
      ...editSchema.parse(input.body).terms,
      tenantId: loaded.draft.tenantId,
      unitId: loaded.draft.unitId,
    };
  return loaded.draft;
}
function newContract(input: {
  id: string;
  draft: DraftInput;
  parties: Parties;
}): NewContract {
  const tenant = nullableString(input.parties.tenant, "linked_account_id");
  if (!tenant) throw new WorkflowProblem("TENANT_REQUIRED", "tenantId");
  return {
    id: contractId.parse(input.id),
    ownerAccountId: input.parties.owner?.linked_account_id
      ? personAccountId.parse(input.parties.owner.linked_account_id)
      : null,
    tenantAccountId: personAccountId.parse(tenant),
    tenantSignatoryAccountIds: [],
    terms: terms(input.draft),
    contentHash: contentHash(input.draft),
    linkedIdentity: {
      unt_number: nullableString(input.parties.unit, "unt_number") ?? "",
      owner_id_number: input.parties.owner
        ? (nullableString(input.parties.owner, "eid_number") ?? "")
        : "",
      tenant_id_number:
        nullableString(input.parties.tenant, "eid_number") ??
        nullableString(input.parties.tenant, "trade_licence_no") ??
        "",
    },
    revisionOfId: null,
    renewalOfId: null,
  };
}
function makeCommand(
  input: { type: CommandName; body: CanonicalValue },
  state: { id: string; draft: DraftInput; parties: Parties },
): ContractCommand {
  switch (input.type) {
    case "create":
      return { type: "create", contract: newContract(state) };
    case "revise":
      return {
        type: "revise",
        expectedVersion: versionSchema.parse(input.body).expectedVersion,
        contract: newContract(state),
      };
    case "edit":
      return {
        type: "edit",
        expectedVersion: editSchema.parse(input.body).expectedVersion,
        terms: terms(state.draft),
        contentHash: contentHash(state.draft),
      };
    case "submit":
      return { type: "submit", ...versionSchema.parse(input.body) };
    case "approve_owner":
    case "accept_tenant":
      return { type: input.type, ...approvalSchema.parse(input.body) };
    case "return_owner":
    case "return_tenant":
    case "withdraw":
    case "cancel_draft": {
      const b = reasonSchema.parse(input.body);
      return {
        type: input.type,
        expectedVersion: b.expectedVersion,
        reason: b.reason ?? null,
      };
    }
  }
}
async function createDraft(
  write: WriteContext,
  input: {
    id: string;
    draft: DraftInput;
    parties: Parties;
    predecessor: LoadedContract | null;
    eventType: string;
  },
): Promise<void> {
  await write.tx.execute(
    "select pg_advisory_xact_lock(hashtextextended(:company,0))",
    [{ name: "company", value: write.companyId }],
  );
  const number = await first(
    write.tx,
    "select coalesce(max(substring(contract_no from 3)::bigint),0)+1 as number from lease.contract where contract_no ~ '^C-[0-9]+$'",
  );
  if (!number) throw new WorkflowProblem("UNAVAILABLE");
  const contractNo = `C-${String(integer(number, "number")).padStart(2, "0")}`;
  await insertBusiness(write, {
    table: "lease.contract",
    eventType: input.eventType,
    values: {
      id: input.id,
      contract_no: contractNo,
      tenant_id: input.draft.tenantId,
      status: "draft",
      origin: "app",
      revision_of_id: input.predecessor
        ? string(input.predecessor.contract, "id")
        : null,
    },
  });
  await saveVersion(write, {
    contract: rowIdentity(input.id),
    draft: input.draft,
    number: 1,
    hash: contentHash(input.draft),
    eventType: input.eventType,
    unitLink: null,
    tenant: input.parties.tenant,
  });
}
async function clauseProvenance(
  context: RequestContext,
  draft: DraftInput,
  input: { type: CommandName; params: Record<string, string> },
): Promise<
  Pick<EventInput, "registryEntry" | "promptVersion" | "fieldProvenance">
> {
  if (!["create", "edit", "revise"].includes(input.type)) return {};
  const contractId =
    input.type === "edit" ? input.params.contractId : undefined;
  const provenance: Pick<
    EventInput,
    "registryEntry" | "promptVersion" | "fieldProvenance"
  > = {};
  const fieldProvenance: Record<string, string> = {};
  for (const [index, clause] of draft.specialClauses.entries()) {
    clause.modelTranslated = false;
    if (!clause.suggestionId) continue;
    const field = `specialClauses.${String(index)}.suggestionId`;
    if (!contractId) throw new WorkflowProblem("INVALID_INPUT", field);
    const suggestion = await first(
      context.tx,
      "select registry_entry,prompt_version,text_ar_sha256 from lease.clause_suggestion where id=:id::uuid and company_id=:company::uuid and contract_id=:contract::uuid and requested_by=:account::uuid",
      {
        id: clause.suggestionId,
        company: context.audit.companyId,
        contract: contractId,
        account: context.actor.accountId,
      },
    );
    if (!suggestion) throw new WorkflowProblem("INVALID_INPUT", field);
    const registryEntry = string(suggestion, "registry_entry");
    const promptVersion = string(suggestion, "prompt_version");
    if (
      provenance.registryEntry &&
      (provenance.registryEntry !== registryEntry ||
        provenance.promptVersion !== promptVersion)
    )
      throw new WorkflowProblem("INVALID_INPUT", field);
    provenance.registryEntry = registryEntry;
    provenance.promptVersion = promptVersion;
    clause.modelTranslated = true;
    fieldProvenance[`clause_${String(index + 1)}`] =
      sha256Hex(clause.textAr) === string(suggestion, "text_ar_sha256")
        ? "ai_confirmed"
        : "ai_edited";
  }
  return Object.keys(fieldProvenance).length
    ? { ...provenance, fieldProvenance }
    : {};
}
import { sha256Hex } from "./runtime/domain";
export function commandBody(value: unknown): CanonicalValue {
  return canonical(value);
}

async function persistDecision(
  context: RequestContext,
  input: {
    type: CommandName;
    loaded: LoadedContract | null;
    draft: DraftInput;
    parties: Parties;
    nextId: string;
    decision: ContractDecision;
  },
): Promise<WriteContext> {
  const { type, loaded, draft, parties, nextId, decision } = input;
  const write: WriteContext = {
    tx: context.tx,
    companyId: context.audit.companyId,
    accountId: context.actor.accountId,
    mutations: [],
  };
  const contractEvent =
    decision.events.find((e) => e.startsWith("contract.")) ??
    "contract.updated";
  if (type === "create" || type === "revise") {
    await createDraft(write, {
      id: nextId,
      draft,
      parties,
      predecessor: loaded,
      eventType: contractEvent,
    });
  } else if (loaded && type === "edit") {
    await saveVersion(write, {
      contract: loaded.contract,
      draft,
      number: integer(loaded.version, "version_no") + 1,
      hash: contentHash(draft),
      eventType: contractEvent,
      unitLink: loaded.unitLink,
      tenant: parties.tenant,
    });
  } else if (loaded) {
    const effects: EffectContext = {
      write,
      request: context,
      loaded,
      contractEvent,
      approvalEvent:
        decision.events.find((e) => e.startsWith("approval.")) ?? contractEvent,
      versionId: string(loaded.version, "id"),
    };
    for (const effect of decision.effects)
      await applyExistingEffect(effects, effect);
    if (loaded.contract.status !== decision.status)
      await updateBusiness(write, {
        table: "lease.contract",
        row: loaded.contract,
        eventType: contractEvent,
        values: { status: decision.status },
      });
    if (decision.status === "concluded") {
      await notify(effects, {
        recipient: "manager",
        template: "contract_concluded",
      });
      if (loaded.version.frozen_owner_gate === true)
        await notify(effects, {
          recipient: "owner",
          template: "contract_concluded",
        });
    }
  }
  return write;
}

function requireAvailableUnit(
  type: CommandName,
  blocked: readonly string[],
  unit: string,
): void {
  if (type === "submit" && blocked.includes(unit))
    throw new WorkflowProblem("UNIT_BLOCKED", "unitId");
}
