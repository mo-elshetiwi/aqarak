import { z } from "zod";
import {
  createMockActivity,
  recordActivity,
  recordSuggestionActivity,
  notificationList,
  readNotification,
  type MockActivity,
} from "./mock-activity";
/* eslint-disable max-params -- Mock methods mirror the transport contract and its explicit session and replay key. */
import { createHash, randomUUID } from "node:crypto";
import {
  basisPoints,
  encodeCanonical,
  contractId,
  err,
  fils,
  localDate,
  ok,
  personAccountId,
  propertyId,
  transitionContract,
  unitId,
  type ContractApproval,
  type ContractEffect,
  type ContractCommand,
  type ContractContext,
  type ContractSnapshot,
  type ContractTerms,
  type NewContract,
  type Result,
} from "@aqarak/domain";
import { getMessages, type Locale } from "@aqarak/i18n";
import { createMockApi } from "@/lib/api/mock-adapter";
import {
  MOCK_ACCOUNTS,
  MOCK_ACCOUNT_IDS,
  MOCK_COMPANY_A_ID,
  MOCK_PARTY_IDS,
} from "@/lib/api/mock-fixtures";
import type { AqarakApi } from "@/lib/api/contract";
import type { ContractsApi } from "./contracts-api";
import {
  detailSchema,
  suggestionInputSchema,
  type ClauseSuggestion,
  draftInputSchema,
  problemCodeSchema,
  type AllowedAction,
  type ContractDetail,
  type DraftInput,
  type DraftingOptions,
  type Problem,
  type TermsInput,
} from "./schemas";

const PROPERTY_ID = "40000000-0000-4000-8000-000000000001";
const propertyName = {
  en: "Al Waha Residence, Building 7",
  ar: "واحة السكنية، المبنى 7",
};
function fixtureName(handle: string): { en: string; ar: string } {
  const account = MOCK_ACCOUNTS.find((entry) => entry.handle === handle);
  if (!account) throw new Error("Missing synthetic fixture");
  return account.name;
}
export const mockDraftingOptions: DraftingOptions = {
  tenants: [
    {
      id: MOCK_PARTY_IDS["tenant-1"],
      name: fixtureName("tenant-1"),
      kind: "individual",
      documentsAccepted: true,
    },
  ],
  units: [104, 105].map((number, index) => ({
    id: `50000000-0000-4000-8000-00000000000${String(index + 1)}`,
    unitNo: String(number),
    propertyId: PROPERTY_ID,
    propertyName,
    status: "vacant",
    ownerGate: true,
    owner: {
      id: MOCK_PARTY_IDS["owner-1"],
      name: fixtureName("owner-1"),
      hasAccount: true,
    },
  })),
};
interface Stored {
  detail: ContractDetail;
  input: DraftInput;
  snapshot: ContractSnapshot;
  companyId: string;
}
interface Replay {
  fingerprint: string;
  result: Result<ContractDetail, Problem>;
}
export interface ContractsMockState {
  contracts: Map<string, Stored>;
  replays: Map<string, Replay>;
  activity: MockActivity;
  suggestions: Map<
    string,
    {
      fingerprint: string;
      value: ClauseSuggestion;
      companyId: string;
      contractId: string;
      accountId: string;
    }
  >;
}
export function createContractsMockState(): ContractsMockState {
  return {
    contracts: new Map(),
    replays: new Map(),
    activity: createMockActivity(),
    suggestions: new Map(),
  };
}
const processState = globalThis as typeof globalThis & {
  aqarakContractsMock?: ContractsMockState;
};
interface Viewer {
  slot: ContractDetail["viewer"]["slot"];
  accountId: string;
  name: string;
}
const refusal = (
  code: Problem["code"],
  status = refusalStatus(code),
  field?: string,
): Result<never, Problem> => err({ status, code, ...(field ? { field } : {}) });
function refusalStatus(code: Problem["code"]): number {
  if (
    [
      "REASON_REQUIRED",
      "IDEMPOTENCY_KEY_REUSED",
      "SCHEDULE_TOTAL_MISMATCH",
      "TENANT_DOCUMENTS_REQUIRED",
      "OWNER_ACCOUNT_REQUIRED",
      "UNIT_BLOCKED",
      "INVALID_INPUT",
    ].includes(code)
  )
    return 422;
  return 409;
}
function terms(input: DraftInput): ContractTerms {
  return {
    unitIds: [unitId.parse(input.unitId)],
    termStart: localDate.parse(input.termStart),
    termEnd: localDate.parse(input.termEnd),
    totalFils: fils.parse(input.totalFils),
    vatBp: basisPoints.parse(input.vatBp),
    instalments: input.instalments.map((item) => ({
      seqNo: item.seqNo,
      amountFils: fils.parse(item.amountFils),
      vatFils: fils.parse(item.vatFils),
    })),
  };
}
function render(input: DraftInput): ContractDetail["rendered"] {
  const unit = mockDraftingOptions.units.find(
    (item) => item.id === input.unitId,
  );
  const tenant = mockDraftingOptions.tenants.find(
    (item) => item.id === input.tenantId,
  );
  if (!unit || !tenant) throw new Error("Invalid synthetic terms");
  function language(locale: Locale): ContractDetail["rendered"]["en"] {
    const t = getMessages(locale).Contracts.template;
    const values: Record<string, string> = {
      owner: unit?.owner?.name[locale] ?? "",
      unit: unit?.unitNo ?? "",
      property: propertyName[locale],
      tenant: tenant?.name[locale] ?? "",
      start: input.termStart,
      end: input.termEnd,
      total: (input.totalFils / 100).toFixed(2),
      deposit: (input.depositFils / 100).toFixed(2),
      grace: String(input.graceDays),
      vat: String(input.vatBp / 100),
      count: String(input.instalments.length),
    };
    const fill = (text: string): string =>
      text.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
    return {
      title: t.title,
      sections: [
        {
          number: 1,
          heading: t.parties,
          body: fill(t.partiesBody),
          special: false,
        },
        {
          number: 2,
          heading: t.terms,
          body: fill(t.termsBody),
          special: false,
        },
        {
          number: 3,
          heading: t.schedule,
          body: fill(t.scheduleBody),
          special: false,
        },
        ...input.specialClauses.map((clause, index) => ({
          number: index + 4,
          heading: t.special,
          body: locale === "ar" ? clause.textAr : clause.textEn,
          special: true,
        })),
      ],
    };
  }
  return { en: language("en"), ar: language("ar") };
}
function contentHash(input: DraftInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        templateCode: "residential-fixed",
        templateVersion: 1,
        input,
        rendered: render(input),
      }),
    )
    .digest("hex");
}
function newContract(id: string, input: DraftInput): NewContract {
  return {
    id: contractId.parse(id),
    ownerAccountId: personAccountId.parse(MOCK_ACCOUNT_IDS["owner-1"]),
    tenantAccountId: personAccountId.parse(MOCK_ACCOUNT_IDS["tenant-1"]),
    tenantSignatoryAccountIds: [],
    terms: terms(input),
    contentHash: contentHash(input),
    linkedIdentity: {
      unt_number: input.unitId,
      owner_id_number: "synthetic-owner",
      tenant_id_number: "synthetic-tenant",
    },
    revisionOfId: null,
    renewalOfId: null,
  };
}
function allowed(stored: Stored, viewer: Viewer): AllowedAction[] {
  const status = stored.detail.contract.status;
  if (viewer.slot === "manager") {
    if (status === "draft")
      return ["edit", "submit", "cancel_draft", "suggest_clause"];
    if (
      status === "awaiting_owner_approval" ||
      status === "awaiting_tenant_acceptance"
    )
      return ["withdraw"];
    if (status === "cancelled" && !stored.detail.contract.successorId)
      return ["revise"];
  }
  if (viewer.slot === "owner" && status === "awaiting_owner_approval")
    return ["approve_owner", "return_owner"];
  if (viewer.slot === "tenant" && status === "awaiting_tenant_acceptance")
    return ["accept_tenant", "return_tenant"];
  return [];
}
function present(stored: Stored, viewer: Viewer): ContractDetail {
  return detailSchema.parse({
    ...structuredClone(stored.detail),
    deliveries:
      viewer.slot === "manager"
        ? structuredClone(stored.detail.deliveries)
        : [],
    viewer: { slot: viewer.slot, allowedActions: allowed(stored, viewer) },
  });
}
function makeStored(
  id: string,
  companyId: string,
  input: DraftInput,
  now: string,
  sequence: number,
): Stored {
  const unit = mockDraftingOptions.units.find(
    (item) => item.id === input.unitId,
  );
  const tenant = mockDraftingOptions.tenants.find(
    (item) => item.id === input.tenantId,
  );
  if (!unit || !tenant) throw new Error("Invalid synthetic terms");
  const fresh = newContract(id, input);
  const hash = fresh.contentHash;
  const detail: ContractDetail = {
    contract: {
      id,
      contractNo: `SYN-${String(sequence).padStart(4, "0")}`,
      status: "draft",
      origin: "app",
      cancelKind: null,
      cancelReason: null,
      revisionOfId: null,
      successorId: null,
      currentVersionNo: 1,
      createdAt: now,
      updatedAt: now,
    },
    version: {
      id: randomUUID(),
      versionNo: 1,
      submittedAt: null,
      contentHash: hash,
      frozenOwnerGate: null,
      ...input,
      templateCode: "residential-fixed",
      templateVersion: 1,
      specialClauses: input.specialClauses.map((clause, index) => ({
        position: index + 1,
        textEn: clause.textEn,
        textAr: clause.textAr,
        modelTranslated: clause.modelTranslated,
        suggestion: null,
      })),
    },
    unit: { id: unit.id, unitNo: unit.unitNo },
    property: { id: PROPERTY_ID, name: propertyName },
    owner: unit.owner,
    tenant: { id: tenant.id, name: tenant.name, kind: tenant.kind },
    ownerGate: { value: unit.ownerGate, frozen: false },
    rendered: render(input),
    approvals: [],
    versions: [
      { versionNo: 1, contentHash: hash, submittedAt: null, createdAt: now },
    ],
    predecessor: null,
    tawtheeq: null,
    deliveries: [],
    viewer: { slot: "manager", allowedActions: [] },
  };
  return {
    companyId,
    input,
    detail: detailSchema.parse(detail),
    snapshot: {
      id: fresh.id,
      status: "draft",
      origin: "app",
      version: {
        number: 1,
        contentHash: hash,
        submitted: false,
        frozenOwnerGate: null,
        terms: fresh.terms,
      },
      ownerAccountId: fresh.ownerAccountId,
      tenantAccountId: fresh.tenantAccountId,
      tenantSignatoryAccountIds: [],
      approvals: [],
      successorId: null,
    },
  };
}
interface CommandBody {
  expectedVersion?: number;
  subjectHash?: string;
  reason?: string;
  terms?: DraftInput | TermsInput;
}
function domainCommandFor(
  type: ContractCommand["type"],
  body: CommandBody,
  input: DraftInput,
  freshId: string,
): ContractCommand | null {
  const version = body.expectedVersion ?? 1;

  if (type === "create") return { type, contract: newContract(freshId, input) };
  else if (type === "revise")
    return {
      type,
      expectedVersion: version,
      contract: newContract(freshId, input),
    };
  else if (type === "edit")
    return {
      type,
      expectedVersion: version,
      terms: terms(input),
      contentHash: contentHash(input),
    };
  else if (type === "submit") return { type, expectedVersion: version };
  else if (type === "approve_owner" || type === "accept_tenant")
    return {
      type,
      expectedVersion: version,
      subjectHash: body.subjectHash ?? "",
    };
  else if (
    type === "return_owner" ||
    type === "return_tenant" ||
    type === "withdraw" ||
    type === "cancel_draft"
  )
    return {
      type,
      expectedVersion: version,
      reason: body.reason ?? null,
    };
  else return null;
}
function applyDraftEdit(
  target: Stored,
  input: DraftInput,
  settings: {
    company: string;
    now: string;
    sequence: number;
    type: ContractCommand["type"];
  },
): void {
  if (settings.type !== "edit") return;
  const { company, now, sequence } = settings;

  const replacement = makeStored(
    target.detail.contract.id,
    company,
    input,
    now,
    sequence,
  );
  const nextVersion = target.detail.version.versionNo + 1;
  target.input = input;
  target.detail.version = {
    ...replacement.detail.version,
    versionNo: nextVersion,
  };
  target.detail.unit = replacement.detail.unit;
  target.detail.tenant = replacement.detail.tenant;
  target.detail.owner = replacement.detail.owner;
  target.detail.ownerGate = replacement.detail.ownerGate;
  target.detail.rendered = replacement.detail.rendered;
  target.detail.contract.currentVersionNo = nextVersion;
  target.detail.versions.push({
    versionNo: nextVersion,
    contentHash: replacement.detail.version.contentHash,
    submittedAt: null,
    createdAt: now,
  });
  target.snapshot = {
    ...target.snapshot,
    version: { ...replacement.snapshot.version, number: nextVersion },
  };
}
function applyApproval(
  target: Stored,
  effect: Extract<
    ContractEffect,
    { type: "record_approval" | "request_approval" }
  >,
  settings: {
    now: string;
    personFor: (slot: "manager" | "owner" | "tenant") => string;
    approvals: ContractApproval[];
  },
): ContractApproval[] {
  const { now, personFor, approvals } = settings;
  const slot =
    effect.type === "record_approval" ? effect.approval.slot : effect.slot;
  const decided = effect.type === "record_approval";
  const old = target.detail.approvals.find((item) => item.slot === slot);
  target.detail.approvals = target.detail.approvals.filter(
    (item) => item.slot !== slot,
  );
  target.detail.approvals.push({
    id: old?.id ?? randomUUID(),
    slot,
    status: decided ? "approved" : "requested",
    personName: personFor(slot),
    requestedAt: old?.requestedAt ?? now,
    decidedAt: decided ? now : null,
    subjectHash: target.detail.version.contentHash,
    reason: null,
    channel: decided ? "web" : null,
    device: decided ? "browser" : null,
  });
  if (effect.type === "record_approval")
    return [...approvals.filter((item) => item.slot !== slot), effect.approval];
  return approvals;
}
function cancelledApproval(
  item: ContractDetail["approvals"][number],
  context: {
    actor: Viewer;
    type: ContractCommand["type"];
    reason: string | undefined;
    now: string;
  },
): ContractDetail["approvals"][number] {
  const returned =
    item.slot === context.actor.slot && context.type.startsWith("return_");
  return {
    ...item,
    status: returned ? "returned" : "voided",
    reason: returned ? (context.reason ?? null) : item.reason,
    decidedAt: returned ? context.now : item.decidedAt,
    channel: returned ? "web" : item.channel,
    device: returned ? "browser" : item.device,
  };
}
function applyEffects(
  target: Stored,
  effects: readonly ContractEffect[],
  settings: {
    actor: Viewer;
    type: ContractCommand["type"];
    body: CommandBody;
    now: string;
    stored: Stored | undefined;
  },
): ContractApproval[] {
  const { actor, type, body, now, stored } = settings;
  const personFor = (slot: "manager" | "owner" | "tenant"): string =>
    slot === actor.slot
      ? actor.name
      : fixtureName(
          slot === "owner"
            ? "owner-1"
            : slot === "tenant"
              ? "tenant-1"
              : "manager-1",
        ).en;
  let approvals: ContractApproval[] = [...target.snapshot.approvals];
  for (const effect of effects) {
    if (effect.type === "freeze_version") {
      target.detail.version.submittedAt = now;
      target.detail.version.frozenOwnerGate = effect.frozenOwnerGate;
      target.detail.ownerGate = {
        value: effect.frozenOwnerGate,
        frozen: true,
      };
      const current = target.detail.versions.find(
        (item) => item.versionNo === target.detail.version.versionNo,
      );
      if (current) current.submittedAt = now;
      target.snapshot = {
        ...target.snapshot,
        version: {
          ...target.snapshot.version,
          submitted: true,
          frozenOwnerGate: effect.frozenOwnerGate,
        },
      };
    }
    if (effect.type === "record_approval" || effect.type === "request_approval")
      approvals = applyApproval(target, effect, { now, personFor, approvals });
    if (effect.type === "void_live_approvals") {
      target.detail.approvals = target.detail.approvals.map((item) =>
        cancelledApproval(item, { actor, type, reason: body.reason, now }),
      );
      approvals = approvals.map((item) => ({ ...item, status: "voided" }));
    }
    if (effect.type === "set_cancel_kind") {
      target.detail.contract.cancelKind = effect.cancelKind;
      target.detail.contract.cancelReason = effect.reason;
    }
    if (effect.type === "create_tawtheeq_record")
      target.detail.tawtheeq = {
        workflowState: effect.state,
        portalStatus: null,
      };
    if (effect.type === "link_revision" && stored) {
      stored.detail.contract.successorId = target.detail.contract.id;
      stored.snapshot = {
        ...stored.snapshot,
        successorId: contractId.parse(target.detail.contract.id),
      };
      target.detail.contract.revisionOfId = stored.detail.contract.id;
      target.detail.predecessor = {
        id: stored.detail.contract.id,
        contractNo: stored.detail.contract.contractNo,
        version: stored.detail.version.versionNo,
      };
    }
  }
  return approvals;
}
function validateDraft(inputValue: unknown): Result<DraftInput, Problem> {
  const parsed = draftInputSchema.safeParse(inputValue);
  if (!parsed.success)
    return refusal(
      "INVALID_INPUT",
      400,
      parsed.error.issues[0]?.path.join("."),
    );
  const input = parsed.data;
  if (!mockDraftingOptions.units.some((unit) => unit.id === input.unitId))
    return refusal("INVALID_INPUT", 400, "unitId");
  if (
    !mockDraftingOptions.tenants.some((tenant) => tenant.id === input.tenantId)
  )
    return refusal("INVALID_INPUT", 400, "tenantId");
  return ok(input);
}

export function createContractsMock(
  options: {
    state?: ContractsMockState;
    auth?: Pick<AqarakApi, "getMe">;
    now?: () => Date;
  } = {},
): ContractsApi {
  const state =
    options.state ??
    (processState.aqarakContractsMock ??= createContractsMockState());
  const auth = options.auth ?? createMockApi();
  const clock = options.now ?? (() => new Date());
  async function viewer(
    session: string,
    company: string,
    inbox = false,
  ): Promise<Result<Viewer, Problem>> {
    const me = await auth.getMe(session);
    if (!me.ok)
      return refusal(
        me.error.code === "SESSION_INVALID" ? "SESSION_INVALID" : "UNAVAILABLE",
        me.error.code === "SESSION_INVALID" ? 401 : 503,
      );
    const context = me.value.contexts.find(
      (entry) => entry.companyId === company,
    );
    if (!context || (!inbox && company !== MOCK_COMPANY_A_ID))
      return refusal("NOT_FOUND", 404);
    const account = me.value.account;
    const slot = context.staffRoles.includes("manager")
      ? "manager"
      : context.staffRoles.some(
            (role) => role === "company_administrator" || role === "accountant",
          )
        ? "reader"
        : context.partyLinks.some((link) => link.role === "owner")
          ? "owner"
          : context.partyLinks.some((link) => link.role === "tenant")
            ? "tenant"
            : null;
    if (!slot && !inbox) return refusal("NOT_FOUND", 404);
    return ok({
      slot: slot ?? "reader",
      accountId: account.id,
      name: account.displayName,
    });
  }
  function scoped(
    id: string,
    company: string,
    actor: Viewer,
  ): Stored | undefined {
    const stored = state.contracts.get(id);
    if (stored?.companyId !== company) return undefined;
    if (
      actor.slot === "owner" &&
      stored.snapshot.ownerAccountId !== actor.accountId
    )
      return undefined;
    if (
      actor.slot === "tenant" &&
      stored.snapshot.tenantAccountId !== actor.accountId
    )
      return undefined;
    return stored;
  }
  function context(actor: Viewer, input: DraftInput): ContractContext {
    const unit = mockDraftingOptions.units.find(
      (entry) => entry.id === input.unitId,
    );
    return {
      actor: {
        role: actor.slot === "reader" ? "manager" : actor.slot,
        accountId: personAccountId.parse(actor.accountId),
        sessionAccountId: personAccountId.parse(actor.accountId),
      },
      on: localDate.parse(clock().toISOString().slice(0, 10)),
      company: { kind: "management_company", defaultOwnerGate: true },
      property: {
        id: propertyId.parse(PROPERTY_ID),
        ownerGateOverride: unit?.ownerGate ?? null,
      },
      mandate: null,
      blockedUnitIds: [],
      blockingContracts: [...state.contracts.values()].map((item) => ({
        id: item.snapshot.id,
        ...item.snapshot.version.terms,
        blocksUnit: [
          "awaiting_owner_approval",
          "awaiting_tenant_acceptance",
          "concluded",
        ].includes(item.snapshot.status),
      })),
      tenantExists: true,
      tenantDocumentsAccepted:
        mockDraftingOptions.tenants.find((entry) => entry.id === input.tenantId)
          ?.documentsAccepted ?? false,
      ownerAccountActive: unit?.owner?.hasAccount ?? false,
    };
  }
  function execute(
    actor: Viewer,
    company: string,
    request: {
      id: string | null;
      type: ContractCommand["type"];
      body: CommandBody;
    },
  ): Result<ContractDetail, Problem> {
    const { id, type, body } = request;
    const stored = id === null ? undefined : scoped(id, company, actor);
    if (id !== null && !stored) return refusal("NOT_FOUND", 404);
    const parsed = validateDraft({ ...stored?.input, ...body.terms });
    if (!parsed.ok) return parsed;
    const input = parsed.value;
    const provenance = resolveSuggestions(state, input, {
      company,
      id,
      actor,
      type,
    });
    if (!provenance.ok) return provenance;
    const freshId = randomUUID();
    const domainCommand = domainCommandFor(type, body, input, freshId);
    if (!domainCommand) return refusal("INVALID_TRANSITION");
    const decision = transitionContract(
      stored?.snapshot ?? null,
      domainCommand,
      context(actor, input),
    );
    if (!decision.ok) {
      const code = problemCodeSchema.safeParse(decision.error.code);
      return refusal(
        code.success ? code.data : "FORBIDDEN",
        refusalStatus(code.success ? code.data : "FORBIDDEN"),
        decision.error.field,
      );
    }
    const now = clock().toISOString();
    const target = ["create", "revise"].includes(type)
      ? makeStored(freshId, company, input, now, state.contracts.size + 1)
      : stored;
    if (!target) return refusal("NOT_FOUND", 404);
    applyDraftEdit(target, input, {
      type,
      company,
      now,
      sequence: state.contracts.size,
    });
    applySuggestionMetadata(target, type, provenance.value);
    const approvals = applyEffects(target, decision.value.effects, {
      actor: actor,
      type,
      body,
      now,
      stored,
    });
    target.detail.contract.status = decision.value.status;
    target.detail.contract.updatedAt = now;
    target.snapshot = {
      ...target.snapshot,
      status: decision.value.status,
      approvals,
    };
    recordActivity(state.activity, target.detail, {
      companyId: company,
      accountId: actor.accountId,
      slot: actor.slot,
      now,
      reason: body.reason,
      decision: decision.value,
    });
    state.contracts.set(target.detail.contract.id, target);
    return ok(present(target, actor));
  }
  async function command(
    session: string,
    company: string,
    id: string | null,
    type: ContractCommand["type"],
    body: {
      expectedVersion?: number;
      subjectHash?: string;
      reason?: string;
      terms?: DraftInput | TermsInput;
    },
    key: string,
  ): Promise<Result<ContractDetail, Problem>> {
    const actor = await viewer(session, company);
    if (!actor.ok) return actor;
    if (actor.value.slot === "reader") return refusal("FORBIDDEN", 403);
    const requiredSlot = ["approve_owner", "return_owner"].includes(type)
      ? "owner"
      : ["accept_tenant", "return_tenant"].includes(type)
        ? "tenant"
        : "manager";
    if (actor.value.slot !== requiredSlot) return refusal("FORBIDDEN", 403);
    if (!/^[A-Za-z0-9_-]{32}$/.test(key))
      return refusal("VALIDATION_FAILED", 400);
    const replayKey = `${actor.value.accountId}:${company}:${type}:${key}`;
    const fingerprint = encodeCanonical(z.json().parse({ id, type, body }));
    const previous = state.replays.get(replayKey);
    if (previous)
      return previous.fingerprint === fingerprint
        ? structuredClone(previous.result)
        : refusal("IDEMPOTENCY_KEY_REUSED");
    const result = execute(actor.value, company, { id, type, body });
    if (result.ok)
      state.replays.set(replayKey, {
        fingerprint,
        result: structuredClone(result),
      });
    return result;
  }
  const api: ContractsApi = {
    async list(s, c, query = {}) {
      const actor = await viewer(s, c);
      if (!actor.ok) return actor;
      const rows = [...state.contracts.values()].filter(
        (item) =>
          scoped(item.detail.contract.id, c, actor.value) &&
          (!query.status || item.detail.contract.status === query.status),
      );
      const offset = Number(query.cursor ?? 0);
      const limit = query.limit ?? 50;
      const items = rows.slice(offset, offset + limit).map(({ detail: d }) => ({
        id: d.contract.id,
        contractNo: d.contract.contractNo,
        status: d.contract.status,
        unit: { ...d.unit, propertyName: d.property.name },
        tenant: { id: d.tenant.id, name: d.tenant.name },
        termStart: d.version.termStart,
        termEnd: d.version.termEnd,
        annualRentFils: d.version.annualRentFils,
        currentVersionNo: d.version.versionNo,
        nextActor:
          d.contract.status === "awaiting_owner_approval"
            ? ("owner" as const)
            : d.contract.status === "awaiting_tenant_acceptance"
              ? ("tenant" as const)
              : d.contract.status === "draft"
                ? ("manager" as const)
                : null,
        updatedAt: d.contract.updatedAt,
      }));
      return ok({
        items,
        nextCursor:
          offset + limit < rows.length ? String(offset + limit) : null,
      });
    },
    async get(s, c, id) {
      const actor = await viewer(s, c);
      if (!actor.ok) return actor;
      const stored = scoped(id, c, actor.value);
      return stored
        ? ok(present(stored, actor.value))
        : refusal("NOT_FOUND", 404);
    },
    async draftingOptions(s, c) {
      const actor = await viewer(s, c);
      return !actor.ok
        ? actor
        : actor.value.slot === "manager"
          ? ok(structuredClone(mockDraftingOptions))
          : refusal("FORBIDDEN", 403);
    },
    create: (s, c, input, key) =>
      command(s, c, null, "create", { terms: input }, key),
    edit: (s, c, id, input, key) => command(s, c, id, "edit", input, key),
    submit: (s, c, id, input, key) => command(s, c, id, "submit", input, key),
    approveOwner: (s, c, id, input, key) =>
      command(s, c, id, "approve_owner", input, key),
    returnOwner: (s, c, id, input, key) =>
      command(s, c, id, "return_owner", input, key),
    acceptTenant: (s, c, id, input, key) =>
      command(s, c, id, "accept_tenant", input, key),
    returnTenant: (s, c, id, input, key) =>
      command(s, c, id, "return_tenant", input, key),
    withdraw: (s, c, id, input, key) =>
      command(s, c, id, "withdraw", input, key),
    cancel: (s, c, id, input, key) =>
      command(s, c, id, "cancel_draft", input, key),
    revise: (s, c, id, input, key) => command(s, c, id, "revise", input, key),
    async listApprovals(s, c) {
      const actor = await viewer(s, c, true);
      if (!actor.ok) return actor;
      return ok({
        items: [...state.contracts.values()]
          .filter((item) => scoped(item.detail.contract.id, c, actor.value))
          .flatMap(({ detail: d }) =>
            d.approvals
              .filter(
                (a) => a.slot === actor.value.slot && a.status === "requested",
              )
              .map((a) => ({
                approvalId: a.id,
                slot: a.slot,
                contractId: d.contract.id,
                contractNo: d.contract.contractNo,
                unit: { unitNo: d.unit.unitNo, propertyName: d.property.name },
                versionNo: d.version.versionNo,
                subjectHash: a.subjectHash,
                requestedAt: a.requestedAt,
                submittedBy:
                  d.approvals.find((item) => item.slot === "manager")
                    ?.personName ?? fixtureName("manager-1").en,
              })),
          ),
      });
    },
    async listNotifications(s, c, limit) {
      const actor = await viewer(s, c, true);
      return actor.ok
        ? ok(
            notificationList(
              state.activity,
              { accountId: actor.value.accountId, companyId: c },
              limit,
            ),
          )
        : actor;
    },
    async markNotificationRead(s, c, id, key) {
      const actor = await viewer(s, c, true);
      return actor.ok
        ? readNotification(
            state.activity,
            { accountId: actor.value.accountId, companyId: c },
            { id, key, now: clock().toISOString() },
          )
        : actor;
    },
    async suggestClause(s, c, id, input, key) {
      const result = await api.get(s, c, id);
      if (!result.ok) return result;
      if (result.value.viewer.slot !== "manager")
        return refusal("FORBIDDEN", 403);
      if (result.value.contract.status !== "draft")
        return refusal("INVALID_TRANSITION", 409);
      const parsed = suggestionInputSchema.safeParse(input);
      if (!parsed.success || !/^[A-Za-z0-9_-]{32}$/.test(key))
        return refusal("VALIDATION_FAILED", 400);
      const actor = await viewer(s, c);
      if (!actor.ok) return actor;
      const replayKey = `${actor.value.accountId}:${c}:${key}`;
      const fingerprint = JSON.stringify({ id, textEn: parsed.data.textEn });
      const previous = state.suggestions.get(replayKey);
      if (previous)
        return previous.fingerprint === fingerprint
          ? ok(structuredClone(previous.value))
          : refusal("IDEMPOTENCY_KEY_REUSED", 422);
      if (/\bunavailable\b/i.test(parsed.data.textEn))
        return refusal("MODEL_UNAVAILABLE", 503);
      const textAr = getMessages("ar").Contracts.suggestion.synthetic;
      const value: ClauseSuggestion = {
        suggestionId: randomUUID(),
        suggestion: { textAr, warnings: [] },
        provenance: {
          registryEntry: "synthetic-clause-translation",
          promptVersion: "1",
          outputSha256: createHash("sha256")
            .update(JSON.stringify({ textAr, warnings: [] }))
            .digest("hex"),
          ranAt: clock().toISOString(),
        },
      };
      state.suggestions.set(replayKey, {
        fingerprint,
        companyId: c,
        contractId: id,
        accountId: actor.value.accountId,
        value: structuredClone(value),
      });
      recordSuggestionActivity(
        state.activity,
        {
          companyId: c,
          accountId: actor.value.accountId,
          now: clock().toISOString(),
          key,
        },
        value,
      );
      return ok(value);
    },
  };
  return api;
}

type StoredSuggestion =
  ContractDetail["version"]["specialClauses"][number]["suggestion"];
function resolveSuggestions(
  state: ContractsMockState,
  input: DraftInput,
  scope: {
    company: string;
    id: string | null;
    actor: Viewer;
    type: ContractCommand["type"];
  },
): Result<StoredSuggestion[], Problem> {
  if (!["create", "edit", "revise"].includes(scope.type)) return ok([]);
  const resolved: StoredSuggestion[] = [];
  let registry: string | undefined;
  for (const [index, clause] of input.specialClauses.entries()) {
    clause.modelTranslated = false;
    if (scope.type === "revise") delete clause.suggestionId;
    if (!clause.suggestionId) {
      resolved.push(null);
      continue;
    }
    const saved = [...state.suggestions.values()].find(
      (entry) => entry.value.suggestionId === clause.suggestionId,
    );
    const field = `specialClauses.${String(index)}.suggestionId`;
    if (
      scope.type !== "edit" ||
      saved?.companyId !== scope.company ||
      saved.contractId !== scope.id ||
      saved.accountId !== scope.actor.accountId
    )
      return refusal("INVALID_INPUT", 422, field);
    const p = saved.value.provenance;
    const identity = `${p.registryEntry}:${p.promptVersion}`;
    if (registry && registry !== identity)
      return refusal("INVALID_INPUT", 422, field);
    registry = identity;
    clause.modelTranslated = true;
    resolved.push({
      registryEntry: p.registryEntry,
      promptVersion: p.promptVersion,
      confirmation:
        createHash("sha256").update(clause.textAr).digest("hex") ===
        createHash("sha256").update(saved.value.suggestion.textAr).digest("hex")
          ? "ai_confirmed"
          : "ai_edited",
    });
  }
  return ok(resolved);
}

function applySuggestionMetadata(
  target: Stored,
  type: ContractCommand["type"],
  values: StoredSuggestion[],
): void {
  if (!["create", "edit", "revise"].includes(type)) return;
  target.detail.version.specialClauses.forEach((clause, index) => {
    clause.suggestion = values[index] ?? null;
  });
}
