import {
  checkExpectedVersion,
  refuse,
  requireReason,
  type DomainError,
} from "../errors";
import type { ContractApproval } from "../contract/types";
import { ok, type Result } from "../result";
import type { TawtheeqWorkflowState } from "../vocabulary";
import {
  createAdoptionVersion,
  requiresOwnerReapproval,
  resolveDiscrepancies,
  type ResolvedDiscrepancy,
} from "./discrepancies";
import { identityMismatch, type TawtheeqErrorCode } from "./evidence";
import {
  linkedRegistrationEvidence,
  mayMoveCurrentVersion,
  validateRegistration,
} from "./registration";
import type {
  TawtheeqCommand,
  TawtheeqContext,
  TawtheeqDecision,
  TawtheeqEffect,
  TawtheeqSnapshot,
} from "./types";

type Outcome = Result<TawtheeqDecision, DomainError<TawtheeqErrorCode>>;
type CommandOf<T extends TawtheeqCommand["type"]> = Extract<
  TawtheeqCommand,
  { readonly type: T }
>;

/** Describes one inspectable registration workflow row. */
export interface TawtheeqTransitionRow {
  readonly from: TawtheeqWorkflowState;
  readonly to: TawtheeqWorkflowState;
  readonly command: TawtheeqCommand["type"];
  readonly actor: "manager" | "owner";
}

/** Lists the normal, skip and post-registration transition rows. */
export const tawtheeqTransitions: readonly TawtheeqTransitionRow[] = [
  {
    from: "awaiting_registration",
    to: "submitted_on_portal",
    command: "attest_portal",
    actor: "manager",
  },
  {
    from: "submitted_on_portal",
    to: "awaiting_registration",
    command: "portal_return",
    actor: "manager",
  },
  {
    from: "awaiting_registration",
    to: "skipped",
    command: "skip",
    actor: "manager",
  },
  {
    from: "skipped",
    to: "awaiting_registration",
    command: "resume",
    actor: "manager",
  },
  {
    from: "awaiting_registration",
    to: "under_review",
    command: "upload",
    actor: "manager",
  },
  {
    from: "submitted_on_portal",
    to: "under_review",
    command: "upload",
    actor: "manager",
  },
  {
    from: "under_review",
    to: "awaiting_registration",
    command: "reject_identity",
    actor: "manager",
  },
  {
    from: "under_review",
    to: "registered",
    command: "confirm_matches",
    actor: "manager",
  },
  {
    from: "under_review",
    to: "discrepancies_open",
    command: "open_discrepancies",
    actor: "manager",
  },
  {
    from: "discrepancies_open",
    to: "awaiting_registration",
    command: "reregister",
    actor: "manager",
  },
  {
    from: "discrepancies_open",
    to: "awaiting_owner_reapproval",
    command: "prepare_adoption",
    actor: "manager",
  },
  {
    from: "discrepancies_open",
    to: "registered",
    command: "register_resolved",
    actor: "manager",
  },
  {
    from: "awaiting_owner_reapproval",
    to: "registered",
    command: "owner_reapprove",
    actor: "owner",
  },
  {
    from: "awaiting_owner_reapproval",
    to: "discrepancies_open",
    command: "owner_return",
    actor: "owner",
  },
  {
    from: "registered",
    to: "under_review",
    command: "upload",
    actor: "manager",
  },
  { from: "registered", to: "closed", command: "close", actor: "manager" },
];

function decision(
  state: TawtheeqWorkflowState,
  effects: readonly TawtheeqEffect[],
  events: readonly string[] = [`tawtheeq_record.${state}`],
): Outcome {
  return ok({ state, effects, events });
}

function approved(
  context: TawtheeqContext,
  subjectHash: string,
): ContractApproval {
  return {
    slot: context.actor.role,
    kind:
      context.actor.role === "owner" ? "owner_reapproval" : "contract_approval",
    status: "approved",
    subjectHash,
    approverAccountId: context.actor.accountId,
    sessionAccountId: context.actor.sessionAccountId,
  };
}

function skip(state: TawtheeqSnapshot, command: CommandOf<"skip">): Outcome {
  const reason = requireReason(command.reason);
  if (!reason.ok) return reason;
  const confirmation = command.ownerConfirmation;
  if (
    state.frozenOwnerGate &&
    (confirmation?.slot !== "owner" ||
      confirmation.kind !== "skip_confirmation" ||
      confirmation.status !== "approved" ||
      confirmation.subjectHash !== state.contractContentHash ||
      confirmation.approverAccountId !== state.ownerAccountId ||
      confirmation.sessionAccountId !== confirmation.approverAccountId)
  )
    return refuse("OWNER_CONFIRMATION_REQUIRED");
  const effects: readonly TawtheeqEffect[] = [
    { type: "set_path", path: "skip" },
    { type: "record_reason", reason: reason.value },
  ];
  return decision(
    "skipped",
    confirmation !== null && state.frozenOwnerGate
      ? [
          ...effects,
          { type: "record_skip_confirmation", approval: confirmation },
        ]
      : effects,
  );
}

function documentCommand(
  state: TawtheeqSnapshot,
  command: CommandOf<
    "reject_identity" | "confirm_matches" | "open_discrepancies"
  >,
): Outcome {
  if (state.documentVersionId !== command.document.documentVersionId)
    return refuse("REGISTRATION_EVIDENCE_MISSING", "document_version_id");
  if (command.type === "reject_identity") {
    const mismatch = identityMismatch(
      command.document.identity,
      state.linkedIdentity,
    );
    if (mismatch === undefined) return refuse("INVALID_INPUT", "identity");
    return decision(
      "awaiting_registration",
      [{ type: "clear_review" }, { type: "reject_upload", field: mismatch }],
      [
        "tawtheeq_record.upload_rejected",
        "tawtheeq_record.awaiting_registration",
      ],
    );
  }
  const withDocument = { ...state, document: command.document };
  const evidence = linkedRegistrationEvidence(withDocument);
  if (!evidence.ok) return evidence;
  if (command.type === "confirm_matches") {
    if (state.discrepancies.length !== 0)
      return refuse("DISCREPANCIES_UNRESOLVED");
    return register(withDocument, [
      { type: "record_document", document: command.document },
    ]);
  }
  if (
    command.discrepancies.length === 0 ||
    new Set(command.discrepancies.map((item) => item.field)).size !==
      command.discrepancies.length
  )
    return refuse("INVALID_INPUT", "discrepancies");
  const identity = command.discrepancies.find((item) =>
    ["unt_number", "owner_id_number", "tenant_id_number"].includes(item.field),
  );
  if (identity !== undefined)
    return refuse("IDENTITY_MISMATCH", identity.field);
  return decision("discrepancies_open", [
    { type: "record_document", document: command.document },
    { type: "record_discrepancies", discrepancies: command.discrepancies },
  ]);
}

function register(
  state: TawtheeqSnapshot,
  effects: readonly TawtheeqEffect[],
): Outcome {
  const evidence = validateRegistration(state);
  if (!evidence.ok) return evidence;
  if (
    state.candidateVersion !== null ||
    state.resolutions.some((item) => item.resolution.kind === "adopt")
  ) {
    if (!mayMoveCurrentVersion(state))
      return refuse("REGISTRATION_EVIDENCE_MISSING", "adoption_approval_set");
    return decision(
      "registered",
      [
        ...effects,
        { type: "move_current_version", contentHash: state.subjectHash },
        {
          type: "record_document_acceptance",
          documentVersionId: evidence.value.documentVersionId,
          subjectHash: state.subjectHash,
        },
        {
          type: "notify",
          recipient: "tenant",
          template: "tawtheeq_adoption_registered",
        },
      ],
      ["tawtheeq_record.registered", "contract.updated", "approval.approved"],
    );
  }
  return decision("registered", effects);
}

function adoptionState(
  state: TawtheeqSnapshot,
  resolutions: readonly ResolvedDiscrepancy[],
  subjectHash: string,
  context: TawtheeqContext,
): Result<TawtheeqSnapshot, DomainError<TawtheeqErrorCode>> {
  const hasAdoption = resolutions.some(
    (item) => item.resolution.kind === "adopt",
  );
  if (hasAdoption && state.contractStatus !== "concluded")
    return refuse("INVALID_TRANSITION");
  if (hasAdoption && subjectHash === state.contractContentHash)
    return refuse("STALE_SUBJECT_HASH", "subject_hash");
  if (!hasAdoption && subjectHash !== state.contractContentHash)
    return refuse("STALE_SUBJECT_HASH", "subject_hash");
  const version = createAdoptionVersion(
    state.priorValues,
    resolutions,
    subjectHash,
  );
  if (!version.ok) return version;
  return ok({
    ...state,
    subjectHash,
    resolutions,
    candidateVersion: hasAdoption ? version.value : null,
    managerApproval: approved(context, subjectHash),
    ownerApproval: null,
  });
}

function resolve(
  state: TawtheeqSnapshot,
  command: CommandOf<"reregister" | "prepare_adoption" | "register_resolved">,
  context: TawtheeqContext,
): Outcome {
  const resolved = resolveDiscrepancies(state.discrepancies, command.choices);
  if (!resolved.ok) return resolved;
  const resolutions = resolved.value;
  const cancelled = resolutions.some(
    (item) => item.resolution.kind === "cancel_and_reregister",
  );
  if (command.type === "reregister") {
    return cancelled
      ? decision("awaiting_registration", [
          {
            type: "record_resolutions",
            resolutions,
            subjectHash: state.subjectHash,
          },
          { type: "clear_review" },
        ])
      : refuse("INVALID_INPUT", "resolutions");
  }
  if (cancelled) return refuse("DISCREPANCIES_UNRESOLVED");
  const prepared = adoptionState(
    state,
    resolutions,
    command.subjectHash,
    context,
  );
  if (!prepared.ok) return prepared;
  const next = prepared.value;
  const effects: readonly TawtheeqEffect[] = [
    {
      type: "record_resolutions",
      resolutions,
      subjectHash: command.subjectHash,
    },
    {
      type: "record_approval",
      approval: approved(context, command.subjectHash),
    },
    ...(next.candidateVersion === null
      ? []
      : [
          {
            type: "create_adoption_version",
            version: next.candidateVersion,
          } satisfies TawtheeqEffect,
        ]),
  ];
  if (command.type === "prepare_adoption") {
    if (!requiresOwnerReapproval(state.frozenOwnerGate, resolutions))
      return refuse("INVALID_TRANSITION");
    const evidence = linkedRegistrationEvidence(next);
    if (!evidence.ok) return evidence;
    return decision(
      "awaiting_owner_reapproval",
      [
        ...effects,
        {
          type: "request_owner_reapproval",
          subjectHash: command.subjectHash,
          accountId: state.ownerAccountId,
        },
        {
          type: "notify",
          recipient: "owner",
          template: "tawtheeq_reapproval_requested",
        },
      ],
      ["tawtheeq_record.awaiting_owner_reapproval", "approval.approved"],
    );
  }
  return register(next, effects);
}

function ownerReapprove(
  state: TawtheeqSnapshot,
  command: CommandOf<"owner_reapprove">,
  context: TawtheeqContext,
): Outcome {
  if (command.subjectHash !== state.subjectHash)
    return refuse("STALE_SUBJECT_HASH", "subject_hash");
  if (context.actor.accountId === state.managerApproval?.approverAccountId)
    return refuse("APPROVER_NOT_DISTINCT");
  const ownerApproval = approved(context, command.subjectHash);
  return register({ ...state, ownerApproval }, [
    { type: "record_approval", approval: ownerApproval },
  ]);
}

function withReason(
  command: CommandOf<"portal_return" | "owner_return" | "close">,
): Outcome {
  const reason = requireReason(command.reason);
  if (!reason.ok) return reason;
  switch (command.type) {
    case "portal_return":
      return decision("awaiting_registration", [
        { type: "record_reason", reason: reason.value },
      ]);
    case "owner_return":
      return decision("discrepancies_open", [
        { type: "return_owner_reapproval", reason: reason.value },
        {
          type: "notify",
          recipient: "manager",
          template: "tawtheeq_reapproval_returned",
        },
      ]);
    case "close":
      return decision("closed", [
        {
          type: "record_close",
          closureKind: command.closureKind,
          reason: reason.value,
        },
      ]);
  }
}

function dispatch(
  state: TawtheeqSnapshot,
  command: TawtheeqCommand,
  context: TawtheeqContext,
): Outcome {
  switch (command.type) {
    case "attest_portal":
      return decision("submitted_on_portal", [
        {
          type: "record_portal_attestation",
          accountId: context.actor.accountId,
          on: context.on,
        },
      ]);
    case "portal_return":
    case "owner_return":
    case "close":
      return withReason(command);
    case "skip":
      return skip(state, command);
    case "resume":
      return decision("awaiting_registration", [
        { type: "set_path", path: "normal" },
        { type: "clear_review" },
      ]);
    case "upload":
      return decision("under_review", [
        { type: "clear_review" },
        { type: "link_document", documentVersionId: command.documentVersionId },
      ]);
    case "reject_identity":
    case "confirm_matches":
    case "open_discrepancies":
      return documentCommand(state, command);
    case "reregister":
    case "prepare_adoption":
    case "register_resolved":
      return resolve(state, command, context);
    case "owner_reapprove":
      return ownerReapprove(state, command, context);
  }
}

/** Applies the registration table, concurrency guard and named person's own-session guard. */
export function transitionTawtheeq(
  state: TawtheeqSnapshot,
  command: TawtheeqCommand,
  context: TawtheeqContext,
): Outcome {
  const row = tawtheeqTransitions.find(
    (entry) =>
      entry.from === state.state &&
      entry.command === command.type &&
      entry.actor === context.actor.role,
  );
  if (row === undefined) return refuse("INVALID_TRANSITION");
  const version = checkExpectedVersion(state.version, command.expectedVersion);
  if (!version.ok) return version;
  if (context.actor.accountId !== context.actor.sessionAccountId)
    return refuse("NOT_OWN_SESSION");
  if (
    context.actor.role === "owner" &&
    context.actor.accountId !== state.ownerAccountId
  )
    return refuse("NOT_NAMED_PARTY");
  return dispatch(state, command, context);
}
