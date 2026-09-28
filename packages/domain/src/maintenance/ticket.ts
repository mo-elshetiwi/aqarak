import { refuse, requireReason, type DomainError } from "../errors";
import { nonNegativeFils } from "../money";
import { ok, type Result } from "../result";
import type { UtcInstant } from "../time";
import type { TicketStatus } from "../vocabulary";
import { costApprovalRoute, effectiveTicketPriority } from "./policy";
import type {
  MaintenanceErrorCode,
  TicketCommand,
  TicketContext,
  TicketDecision,
  TicketSnapshot,
} from "./types";

type Outcome = Result<TicketDecision, DomainError<MaintenanceErrorCode>>;
type Guard = Result<void, DomainError<MaintenanceErrorCode>>;

/** Describes one permitted ticket lifecycle step. */
export interface TicketTransitionRow {
  readonly from: TicketStatus | null;
  readonly command: TicketCommand["type"];
  readonly to: TicketStatus;
}
/** Defines every permitted ticket transition, with no exits from closed or cancelled. */
export const ticketTransitions: readonly TicketTransitionRow[] = [
  { from: null, command: "report", to: "reported" },
  { from: "reported", command: "triage", to: "triaged" },
  { from: "reported", command: "cancel", to: "cancelled" },
  { from: "triaged", command: "request_quote", to: "awaiting_quote" },
  {
    from: "triaged",
    command: "request_cost_approval",
    to: "awaiting_cost_approval",
  },
  { from: "triaged", command: "schedule", to: "scheduled" },
  {
    from: "awaiting_quote",
    command: "request_cost_approval",
    to: "awaiting_cost_approval",
  },
  { from: "awaiting_quote", command: "schedule", to: "scheduled" },
  { from: "awaiting_cost_approval", command: "approve_cost", to: "scheduled" },
  { from: "awaiting_cost_approval", command: "reject_cost", to: "triaged" },
  { from: "scheduled", command: "start_visit", to: "in_progress" },
  { from: "in_progress", command: "hold", to: "on_hold" },
  { from: "on_hold", command: "book_revisit", to: "scheduled" },
  { from: "in_progress", command: "complete", to: "work_completed" },
  { from: "work_completed", command: "reopen", to: "triaged" },
  { from: "work_completed", command: "close", to: "closed" },
];

const commandRoles: Readonly<
  Record<TicketCommand["type"], readonly TicketContext["actor"]["role"][]>
> = {
  report: ["tenant", "owner", "technician", "manager"],
  triage: ["manager"],
  cancel: ["manager"],
  request_quote: ["manager"],
  request_cost_approval: ["manager"],
  schedule: ["manager"],
  approve_cost: ["owner"],
  reject_cost: ["owner"],
  start_visit: ["manager", "technician"],
  hold: ["manager", "technician"],
  complete: ["manager", "technician"],
  book_revisit: ["manager"],
  reopen: ["tenant"],
  close: ["tenant", "manager"],
};

function authorised(
  state: TicketSnapshot,
  command: TicketCommand,
  context: TicketContext,
): Guard {
  const actor = context.actor;
  if (actor.accountId !== actor.sessionAccountId)
    return refuse("NOT_OWN_SESSION");
  if (!commandRoles[command.type].includes(actor.role))
    return refuse("NOT_AUTHORISED");
  if (
    (command.type === "approve_cost" || command.type === "reject_cost") &&
    actor.accountId !== state.ownerAccountId
  )
    return refuse("NOT_AUTHORISED");
  if (command.type === "reopen" && actor.accountId !== state.authorAccountId)
    return refuse("NOT_AUTHORISED");
  if (command.type === "close") return closeActor(state, command, context);
  return ok(undefined);
}

function closeActor(
  state: TicketSnapshot,
  command: Extract<TicketCommand, { readonly type: "close" }>,
  context: TicketContext,
): Guard {
  const actor = context.actor;
  const allowed =
    command.confirmation === "tenant_confirmed"
      ? actor.role === "tenant" && actor.accountId === state.authorAccountId
      : actor.role === "manager";
  return allowed ? ok(undefined) : refuse("NOT_AUTHORISED");
}

function validCost(context: TicketContext): Guard {
  const cost = context.cost;
  const values = [
    cost.costFils,
    cost.costThresholdFils,
    cost.emergencyLimitFils,
  ];
  if (
    values.some(
      (value) => value !== null && !nonNegativeFils.safeParse(value).success,
    )
  )
    return refuse("INVALID_INPUT", "cost_fils");
  if (
    !Number.isSafeInteger(cost.ownerContactAttempts) ||
    cost.ownerContactAttempts < 0
  )
    return refuse("INVALID_INPUT", "owner_contact_attempts");
  return ok(undefined);
}

function approvedByOwner(
  state: TicketSnapshot,
  context: TicketContext,
): boolean {
  const approval = context.ownerApproval;
  return (
    approval !== null &&
    approval.accountId === state.ownerAccountId &&
    approval.sessionAccountId === approval.accountId &&
    approval.costFils === context.cost.costFils
  );
}

function costGuard(
  state: TicketSnapshot,
  command: TicketCommand,
  context: TicketContext,
): Guard {
  const valid = validCost(context);
  if (!valid.ok) return valid;
  const route = costApprovalRoute({
    ...context.cost,
    safetyCritical: state.safetyFlags.length > 0,
  });
  if (command.type === "request_cost_approval") {
    return route.route === "manager"
      ? refuse("INVALID_INPUT", "cost_fils")
      : ok(undefined);
  }
  if (command.type === "schedule") {
    if (state.status === "awaiting_quote" && route.route !== "manager")
      return refuse("COST_APPROVAL_REQUIRED");
    if (route.route === "owner" && !approvedByOwner(state, context))
      return refuse("COST_APPROVAL_REQUIRED");
  }
  return ok(undefined);
}

function microseconds(instant: UtcInstant): bigint {
  const fractional = /\.(\d+)Z$/.exec(instant)?.[1] ?? "";
  return (
    BigInt(new Date(instant).getTime()) * 1000n +
    BigInt(fractional.padEnd(6, "0").slice(3))
  );
}

function evidenceGuard(
  state: TicketSnapshot,
  command: TicketCommand,
  context: TicketContext,
): Guard {
  if (
    command.type === "schedule" ||
    command.type === "request_cost_approval" ||
    command.type === "approve_cost"
  )
    return costGuard(state, command, context);
  if (command.type === "complete")
    return command.afterPhotos.length > 0
      ? ok(undefined)
      : refuse("AFTER_PHOTO_REQUIRED");
  if (command.type === "close") {
    if (!command.costAllocated) return refuse("COST_ALLOCATION_REQUIRED");
    if (
      command.confirmation === "window_lapsed" &&
      microseconds(context.now) < microseconds(context.confirmationDeadline)
    )
      return refuse("CONFIRMATION_REQUIRED");
  }
  return ok(undefined);
}

function report(
  command: Extract<TicketCommand, { readonly type: "report" }>,
  context: TicketContext,
): Outcome {
  if (context.actor.accountId !== context.actor.sessionAccountId)
    return refuse("NOT_OWN_SESSION");
  if (
    !command.confirmed ||
    command.report.authorAccountId !== context.actor.accountId ||
    command.report.authorRole !== context.actor.role
  )
    return refuse("NOT_AUTHORISED");
  if (command.report.linked_ticket_id === command.report.id)
    return refuse("INVALID_INPUT", "linked_ticket_id");
  return ok({
    ticket: {
      ...command.report,
      status: "reported",
      priority: effectiveTicketPriority(
        command.report.priority,
        command.report.safetyFlags,
      ),
      rating: null,
    },
    reason: null,
    notify_owner: false,
    charge_owner_afterwards: false,
  });
}

/** Applies ticket guards and returns a pure decision with immediate emergency obligations. */
export function transitionTicket(
  state: TicketSnapshot | null,
  command: TicketCommand,
  context: TicketContext,
): Outcome {
  const row = ticketTransitions.find(
    (entry) =>
      entry.from === (state?.status ?? null) && entry.command === command.type,
  );
  if (row === undefined) return refuse("INVALID_TRANSITION");
  if (command.type === "report") return report(command, context);
  if (state === null) return refuse("INVALID_TRANSITION");
  const actor = authorised(state, command, context);
  if (!actor.ok) return actor;
  const evidence = evidenceGuard(state, command, context);
  if (!evidence.ok) return evidence;
  const reason = "reason" in command ? requireReason(command.reason) : ok(null);
  if (!reason.ok) return reason;
  const route = costApprovalRoute({
    ...context.cost,
    safetyCritical: state.safetyFlags.length > 0,
  });
  const emergency =
    command.type === "schedule" && route.route === "emergency_rule";
  const triage =
    command.type === "triage"
      ? {
          category: command.category,
          priority: command.priority,
          payer: command.payer,
        }
      : {};
  const next = { ...state, ...triage, status: row.to };
  return ok({
    ticket: {
      ...next,
      priority: effectiveTicketPriority(next.priority, next.safetyFlags),
    },
    reason: reason.value,
    notify_owner: emergency,
    charge_owner_afterwards: emergency,
  });
}

/** Records the reporting tenant's single integer score after completion. */
export function rateTicket(
  state: TicketSnapshot,
  score: number,
  actor: TicketContext["actor"],
): Result<TicketSnapshot, DomainError<MaintenanceErrorCode>> {
  if (state.status !== "work_completed" && state.status !== "closed")
    return refuse("INVALID_TRANSITION");
  if (state.rating !== null) return refuse("RATING_EXISTS");
  if (!Number.isInteger(score) || score < 1 || score > 5)
    return refuse("INVALID_INPUT", "score");
  if (
    actor.role !== "tenant" ||
    state.authorRole !== "tenant" ||
    actor.accountId !== state.authorAccountId
  )
    return refuse("NOT_AUTHORISED");
  if (actor.sessionAccountId !== actor.accountId)
    return refuse("NOT_OWN_SESSION");
  return ok({ ...state, rating: score });
}
