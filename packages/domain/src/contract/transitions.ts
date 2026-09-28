import {
  checkExpectedVersion,
  refuse,
  requireReason,
  type DomainError,
} from "../errors";
import { ownerGate } from "../owner-gate/index";
import { ok, type Result } from "../result";
import { validateRegistrationEvidence } from "../tawtheeq/evidence";
import { addDays, localDate } from "../time";
import {
  fieldProvenance,
  type ApprovalSlot,
  type ContractCancelKind,
  type ContractStatus,
} from "../vocabulary";
import {
  approvedSlot,
  hasContractOverlap,
  validateAcceptance,
  validateContractSchedule,
  validateContractTerms,
} from "./guards";
import type {
  ContractCommand,
  ContractContext,
  ContractDecision,
  ContractEffect,
  ContractErrorCode,
  ContractSnapshot,
  NewContract,
} from "./types";

type Outcome = Result<ContractDecision, DomainError<ContractErrorCode>>;
type CommandOf<T extends ContractCommand["type"]> = Extract<
  ContractCommand,
  { readonly type: T }
>;

/** Describes an inspectable row of the contract lifecycle. */
export interface ContractTransitionRow {
  readonly id: string;
  readonly from: ContractStatus | null;
  readonly to: ContractStatus;
  readonly command: ContractCommand["type"];
  readonly actor: ApprovalSlot;
  readonly gate?: boolean;
}

/** Lists every allowed T1 to T13 row, including both withdrawal source states. */
export const contractTransitions: readonly ContractTransitionRow[] = [
  { id: "T1", from: null, to: "draft", command: "create", actor: "manager" },
  { id: "T2", from: "draft", to: "draft", command: "edit", actor: "manager" },
  {
    id: "T3",
    from: "draft",
    to: "awaiting_owner_approval",
    command: "submit",
    actor: "manager",
    gate: true,
  },
  {
    id: "T4",
    from: "draft",
    to: "awaiting_tenant_acceptance",
    command: "submit",
    actor: "manager",
    gate: false,
  },
  {
    id: "T5",
    from: "awaiting_owner_approval",
    to: "awaiting_tenant_acceptance",
    command: "approve_owner",
    actor: "owner",
  },
  {
    id: "T6",
    from: "awaiting_owner_approval",
    to: "cancelled",
    command: "return_owner",
    actor: "owner",
  },
  {
    id: "T7",
    from: "awaiting_tenant_acceptance",
    to: "concluded",
    command: "accept_tenant",
    actor: "tenant",
  },
  {
    id: "T8",
    from: "awaiting_tenant_acceptance",
    to: "cancelled",
    command: "return_tenant",
    actor: "tenant",
  },
  {
    id: "T9",
    from: "awaiting_owner_approval",
    to: "cancelled",
    command: "withdraw",
    actor: "manager",
  },
  {
    id: "T9",
    from: "awaiting_tenant_acceptance",
    to: "cancelled",
    command: "withdraw",
    actor: "manager",
  },
  {
    id: "T10",
    from: "draft",
    to: "cancelled",
    command: "cancel_draft",
    actor: "manager",
  },
  {
    id: "T11",
    from: "cancelled",
    to: "draft",
    command: "revise",
    actor: "manager",
  },
  {
    id: "T12",
    from: null,
    to: "concluded",
    command: "conclude_retroactive",
    actor: "manager",
  },
  {
    id: "T13",
    from: "concluded",
    to: "ended",
    command: "end",
    actor: "manager",
  },
];

/** Lists the minimum confirmed extraction fields required by IN8R. */
export const retroactiveConfirmationFields = [
  "unt_number",
  "owner_id_number",
  "tenant_id_number",
  "term_start",
  "term_end",
  "total_fils",
  "vat_bp",
  "payment_schedule",
] as const;

function decision(
  status: ContractStatus,
  events: readonly string[],
  effects: readonly ContractEffect[],
): Outcome {
  return ok({ status, events, effects });
}

function approval(
  context: ContractContext,
  hash: string,
  kind: "contract_approval" | "retroactive_confirmation" = "contract_approval",
): ContractEffect {
  return {
    type: "record_approval",
    approval: {
      slot: context.actor.role,
      kind,
      status: "approved",
      subjectHash: hash,
      approverAccountId: context.actor.accountId,
      sessionAccountId: context.actor.sessionAccountId,
    },
  };
}

function validateNew(
  contract: NewContract,
  context: ContractContext,
): Result<void, DomainError<ContractErrorCode>> {
  if (!context.tenantExists) return refuse("TENANT_REQUIRED");
  if (
    contract.terms.unitIds.some((unit) => context.blockedUnitIds.includes(unit))
  )
    return refuse("UNIT_BLOCKED");
  if (contract.contentHash.trim() === "")
    return refuse("INVALID_INPUT", "content_hash");
  if (contract.revisionOfId !== null && contract.renewalOfId !== null)
    return refuse("INVALID_INPUT", "revision_of_id");
  return validateContractTerms(contract.terms);
}

function create(
  contract: NewContract,
  context: ContractContext,
  predecessor: ContractSnapshot | null,
): Outcome {
  if (predecessor?.successorId !== null && predecessor !== null)
    return refuse("SUCCESSOR_EXISTS");
  const valid = validateNew(contract, context);
  if (!valid.ok) return valid;
  if (predecessor !== null && contract.id === predecessor.id)
    return refuse("INVALID_INPUT", "id");
  const created =
    predecessor === null
      ? contract
      : { ...contract, revisionOfId: predecessor.id, renewalOfId: null };
  const effects: readonly ContractEffect[] = [
    { type: "create_contract", contract: created, origin: "app" },
    {
      type: "create_version",
      number: 1,
      terms: created.terms,
      contentHash: created.contentHash,
    },
    { type: "set_blocks_unit", value: false },
  ];
  return decision(
    "draft",
    ["contract.created"],
    predecessor === null
      ? effects
      : [
          ...effects,
          {
            type: "link_revision",
            revisionOfId: predecessor.id,
            successorId: contract.id,
          },
        ],
  );
}

function edit(state: ContractSnapshot, command: CommandOf<"edit">): Outcome {
  if (state.version.submitted) return refuse("INVALID_TRANSITION");
  const valid = validateContractTerms(command.terms);
  if (!valid.ok) return valid;
  if (command.contentHash.trim() === "")
    return refuse("INVALID_INPUT", "content_hash");
  return decision(
    "draft",
    ["contract.updated"],
    [
      {
        type: "create_version",
        number: state.version.number + 1,
        terms: command.terms,
        contentHash: command.contentHash,
      },
    ],
  );
}

function submit(
  state: ContractSnapshot,
  context: ContractContext,
  gate: boolean,
): Outcome {
  if (state.version.submitted) return refuse("INVALID_TRANSITION");
  const schedule = validateContractSchedule(state.version.terms);
  if (!schedule.ok) return schedule;
  if (!context.tenantDocumentsAccepted)
    return refuse("TENANT_DOCUMENTS_REQUIRED");
  if (gate && (state.ownerAccountId === null || !context.ownerAccountActive))
    return refuse("OWNER_ACCOUNT_REQUIRED");
  if (hasContractOverlap(state.id, state.version.terms, context))
    return refuse("OVERLAPPING_CONTRACT");
  if (state.version.contentHash.trim() === "")
    return refuse("INVALID_INPUT", "content_hash");
  const recipient = gate ? "owner" : "tenant";
  const accountId = gate ? state.ownerAccountId : state.tenantAccountId;
  if (accountId === null) return refuse("OWNER_ACCOUNT_REQUIRED");
  const status = gate
    ? "awaiting_owner_approval"
    : "awaiting_tenant_acceptance";
  return decision(
    status,
    [`contract.${status}`, "approval.approved"],
    [
      {
        type: "freeze_version",
        contentHash: state.version.contentHash,
        frozenOwnerGate: gate,
      },
      approval(context, state.version.contentHash),
      {
        type: "request_approval",
        slot: recipient,
        subjectHash: state.version.contentHash,
        accountId,
      },
      { type: "set_blocks_unit", value: true },
      {
        type: "notify",
        recipient,
        template: "contract_approval_requested",
        accountId,
      },
    ],
  );
}

function approveOwner(
  state: ContractSnapshot,
  context: ContractContext,
): Outcome {
  const manager = approvedSlot(state, "manager");
  if (manager === undefined || state.version.frozenOwnerGate !== true)
    return refuse("APPROVALS_REQUIRED");
  if (manager.approverAccountId === context.actor.accountId)
    return refuse("APPROVER_NOT_DISTINCT");
  return decision(
    "awaiting_tenant_acceptance",
    ["approval.approved", "contract.awaiting_tenant_acceptance"],
    [
      approval(context, state.version.contentHash),
      {
        type: "request_approval",
        slot: "tenant",
        subjectHash: state.version.contentHash,
        accountId: state.tenantAccountId,
      },
      {
        type: "notify",
        recipient: "tenant",
        template: "contract_approval_requested",
        accountId: state.tenantAccountId,
      },
    ],
  );
}

function acceptTenant(
  state: ContractSnapshot,
  context: ContractContext,
): Outcome {
  const valid = validateAcceptance(state, context);
  if (!valid.ok) return valid;
  if (hasContractOverlap(state.id, state.version.terms, context))
    return refuse("OVERLAPPING_CONTRACT");
  return decision(
    "concluded",
    [
      "approval.approved",
      "contract.concluded",
      "tawtheeq_record.awaiting_registration",
    ],
    [
      approval(context, state.version.contentHash),
      {
        type: "create_tawtheeq_record",
        path: "normal",
        state: "awaiting_registration",
      },
      { type: "activate_schedule" },
    ],
  );
}

function cancel(
  state: ContractSnapshot,
  command: CommandOf<
    "return_owner" | "return_tenant" | "withdraw" | "cancel_draft"
  >,
): Outcome {
  const reason = requireReason(command.reason);
  if (!reason.ok) return reason;
  const kinds: Readonly<Record<typeof command.type, ContractCancelKind>> = {
    return_owner: "returned_by_owner",
    return_tenant: "returned_by_tenant",
    withdraw: "withdrawn_by_manager",
    cancel_draft: "cancelled_draft",
  };
  const recipients: readonly ApprovalSlot[] =
    command.type === "withdraw"
      ? [
          ...new Set(
            state.approvals
              .filter(
                (item) =>
                  item.slot !== "manager" &&
                  (item.status === "requested" || item.status === "approved"),
              )
              .map((item) => item.slot),
          ),
        ]
      : command.type === "cancel_draft"
        ? []
        : ["manager"];
  return decision(
    "cancelled",
    ["contract.cancelled", "approval.voided"],
    [
      {
        type: "set_cancel_kind",
        cancelKind: kinds[command.type],
        reason: reason.value,
      },
      {
        type: "void_live_approvals",
        reason: "contract_cancelled",
        statuses: ["requested", "approved"],
      },
      { type: "set_blocks_unit", value: false },
      ...recipients.map((recipient): ContractEffect => ({
        type: "notify",
        recipient,
        template: "contract_cancelled",
      })),
    ],
  );
}

function retroactive(
  command: CommandOf<"conclude_retroactive">,
  context: ContractContext,
): Outcome {
  const valid = validateNew(command.contract, context);
  if (!valid.ok) return valid;
  const confirmation = command.managerConfirmation;
  if (confirmation?.contentHash !== command.contract.contentHash)
    return refuse("RETROACTIVE_EVIDENCE_MISSING", "manager_confirmation");
  const fields = [
    ...retroactiveConfirmationFields,
    ...confirmation.requiredFields,
    ...Object.keys(confirmation.fields),
  ];
  if (
    fields.some(
      (field) => !fieldProvenance.safeParse(confirmation.fields[field]).success,
    )
  )
    return refuse("RETROACTIVE_EVIDENCE_MISSING", "manager_confirmation");
  const evidence = validateRegistrationEvidence(
    command.document,
    command.contract.linkedIdentity,
  );
  if (!evidence.ok)
    return evidence.error.code === "IDENTITY_MISMATCH"
      ? refuse("IDENTITY_MISMATCH", evidence.error.field)
      : refuse("RETROACTIVE_EVIDENCE_MISSING", "registered_document");
  if (confirmation.sourceDocumentVersionId !== evidence.value.documentVersionId)
    return refuse("RETROACTIVE_EVIDENCE_MISSING", "manager_confirmation");
  const recipients = command.notifications;
  if (
    recipients?.owner !== command.contract.ownerAccountId ||
    recipients.tenant !== command.contract.tenantAccountId
  )
    return refuse("RETROACTIVE_EVIDENCE_MISSING", "party_notifications");
  if (hasContractOverlap(command.contract.id, command.contract.terms, context))
    return refuse("OVERLAPPING_CONTRACT");
  return decision(
    "concluded",
    [
      "contract.created",
      "approval.approved",
      "contract.concluded",
      "tawtheeq_record.registered",
    ],
    [
      {
        type: "create_contract",
        contract: command.contract,
        origin: "retroactive",
      },
      {
        type: "create_version",
        number: 1,
        terms: command.contract.terms,
        contentHash: command.contract.contentHash,
      },
      { type: "record_retroactive_confirmation", confirmation },
      approval(
        context,
        command.contract.contentHash,
        "retroactive_confirmation",
      ),
      { type: "set_blocks_unit", value: true },
      {
        type: "create_tawtheeq_record",
        path: "retroactive",
        state: "registered",
        document: evidence.value,
      },
      { type: "activate_schedule" },
      {
        type: "notify",
        recipient: "owner",
        template: "retroactive_contract_recorded",
        accountId: recipients.owner,
      },
      {
        type: "notify",
        recipient: "tenant",
        template: "retroactive_contract_recorded",
        accountId: recipients.tenant,
      },
    ],
  );
}

function end(state: ContractSnapshot, command: CommandOf<"end">): Outcome {
  if (
    command.evidenceDocumentVersionId === null &&
    command.moveOutHandoverId === null
  )
    return refuse("END_EVIDENCE_MISSING");
  if (
    !localDate.safeParse(command.effectiveOn).success ||
    command.effectiveOn < state.version.terms.termStart ||
    command.effectiveOn === "9999-12-31"
  )
    return refuse("INVALID_INPUT", "effective_on");
  return decision(
    "ended",
    ["contract.ended"],
    [
      {
        type: "record_end",
        endReason: command.endReason,
        effectiveOn: command.effectiveOn,
        evidenceDocumentVersionId: command.evidenceDocumentVersionId,
        moveOutHandoverId: command.moveOutHandoverId,
      },
      {
        type: "set_blocks_unit",
        value: false,
        effectiveOn: addDays(command.effectiveOn, 1),
      },
    ],
  );
}

function validateActor(
  state: ContractSnapshot | null,
  context: ContractContext,
): Result<void, DomainError<ContractErrorCode>> {
  if (context.actor.accountId !== context.actor.sessionAccountId)
    return refuse("NOT_OWN_SESSION");
  if (state === null) return ok(undefined);
  if (
    context.actor.role === "owner" &&
    context.actor.accountId !== state.ownerAccountId
  )
    return refuse("NOT_NAMED_PARTY");
  if (
    context.actor.role === "tenant" &&
    context.actor.accountId !== state.tenantAccountId &&
    !state.tenantSignatoryAccountIds.includes(context.actor.accountId)
  )
    return refuse("NOT_NAMED_PARTY");
  return ok(undefined);
}

function transitionExisting(
  state: ContractSnapshot,
  command: Exclude<
    ContractCommand,
    CommandOf<"create" | "conclude_retroactive">
  >,
  context: ContractContext,
  gate: boolean,
): Outcome {
  const version = checkExpectedVersion(
    state.version.number,
    command.expectedVersion,
  );
  if (!version.ok) return version;
  if (
    "subjectHash" in command &&
    command.subjectHash !== state.version.contentHash
  )
    return refuse("STALE_SUBJECT_HASH", "subject_hash");
  switch (command.type) {
    case "edit":
      return edit(state, command);
    case "submit":
      return submit(state, context, gate);
    case "approve_owner":
      return approveOwner(state, context);
    case "accept_tenant":
      return acceptTenant(state, context);
    case "return_owner":
    case "return_tenant":
    case "withdraw":
    case "cancel_draft":
      return cancel(state, command);
    case "revise":
      return create(command.contract, context, state);
    case "end":
      return end(state, command);
  }
}

/** Applies the table and guards, returning an atomic decision or a refusal with no writes. */
export function transitionContract(
  state: ContractSnapshot | null,
  command: ContractCommand,
  context: ContractContext,
): Outcome {
  const gate =
    command.type === "submit" &&
    ownerGate(context.company, context.property, context.mandate, context.on);
  const row = contractTransitions.find(
    (entry) =>
      entry.from === (state?.status ?? null) &&
      entry.command === command.type &&
      entry.actor === context.actor.role &&
      (entry.gate === undefined || entry.gate === gate),
  );
  if (row === undefined) return refuse("INVALID_TRANSITION");
  const actor = validateActor(state, context);
  if (!actor.ok) return actor;
  if (command.type === "create") return create(command.contract, context, null);
  if (command.type === "conclude_retroactive")
    return retroactive(command, context);
  if (state === null) return refuse("INVALID_TRANSITION");
  return transitionExisting(state, command, context, gate);
}
