import { refuse, requireReason, type DomainError } from "../errors";
import { positiveFils, type Fils } from "../money";
import { ok, type Result } from "../result";
import type { DispatchStatus, QuoteStatus } from "../vocabulary";
import type { MaintenanceActor, MaintenanceErrorCode } from "./types";

/** Describes vendor updates recorded by a manager. */
export type DispatchCommand =
  | { readonly type: "accept" | "complete" }
  | { readonly type: "decline" | "cancel"; readonly reason: string | null };
/** Describes an allowed dispatch lifecycle step. */
export interface DispatchTransitionRow {
  readonly from: DispatchStatus;
  readonly command: DispatchCommand["type"];
  readonly to: DispatchStatus;
}
/** Defines all accepted vendor dispatch updates. */
export const dispatchTransitions: readonly DispatchTransitionRow[] = [
  { from: "assigned", command: "accept", to: "accepted" },
  { from: "assigned", command: "decline", to: "declined" },
  { from: "accepted", command: "complete", to: "done" },
  { from: "assigned", command: "cancel", to: "cancelled" },
  { from: "accepted", command: "cancel", to: "cancelled" },
];
/** Describes a quotation's current amount and decision. */
export interface QuoteSnapshot {
  readonly status: QuoteStatus;
  readonly amount_fils: Fils | null;
}
/** Describes quote updates with a positive amount or a rejection reason. */
export type QuoteCommand =
  | { readonly type: "receive"; readonly amount_fils: Fils }
  | { readonly type: "approve" }
  | { readonly type: "reject"; readonly reason: string | null };
/** Describes an allowed quote lifecycle step. */
export interface QuoteTransitionRow {
  readonly from: QuoteStatus;
  readonly command: QuoteCommand["type"];
  readonly to: QuoteStatus;
}
/** Defines every quote transition. */
export const quoteTransitions: readonly QuoteTransitionRow[] = [
  { from: "requested", command: "receive", to: "received" },
  { from: "received", command: "approve", to: "approved" },
  { from: "received", command: "reject", to: "rejected" },
];

function manager(
  actor: MaintenanceActor,
): Result<void, DomainError<MaintenanceErrorCode>> {
  if (actor.role !== "manager") return refuse("NOT_AUTHORISED");
  return actor.accountId === actor.sessionAccountId
    ? ok(undefined)
    : refuse("NOT_OWN_SESSION");
}

/** Records a vendor's dispatch response through a manager's own session. */
export function transitionDispatch(
  status: DispatchStatus,
  command: DispatchCommand,
  actor: MaintenanceActor,
): Result<
  { readonly status: DispatchStatus; readonly reason: string | null },
  DomainError<MaintenanceErrorCode>
> {
  const row = dispatchTransitions.find(
    (entry) => entry.from === status && entry.command === command.type,
  );
  if (row === undefined) return refuse("INVALID_TRANSITION");
  const author = manager(actor);
  if (!author.ok) return author;
  const reason = "reason" in command ? requireReason(command.reason) : ok(null);
  if (!reason.ok) return reason;
  return ok({ status: row.to, reason: reason.value });
}

/** Records a quote's amount and review through a manager's own session. */
export function transitionQuote(
  state: QuoteSnapshot,
  command: QuoteCommand,
  actor: MaintenanceActor,
): Result<
  { readonly quote: QuoteSnapshot; readonly reason: string | null },
  DomainError<MaintenanceErrorCode>
> {
  const row = quoteTransitions.find(
    (entry) => entry.from === state.status && entry.command === command.type,
  );
  if (row === undefined) return refuse("INVALID_TRANSITION");
  const author = manager(actor);
  if (!author.ok) return author;
  if (
    command.type === "receive" &&
    !positiveFils.safeParse(command.amount_fils).success
  )
    return refuse("INVALID_INPUT", "amount_fils");
  const reason =
    command.type === "reject" ? requireReason(command.reason) : ok(null);
  if (!reason.ok) return reason;
  return ok({
    quote: {
      status: row.to,
      amount_fils:
        command.type === "receive" ? command.amount_fils : state.amount_fils,
    },
    reason: reason.value,
  });
}
