import { refuse, requireReason } from "../errors";
import type { OwnerStatementId } from "../ids";
import { nonNegativeFils, type Fils } from "../money";
import { ok } from "../result";
import type { LocalDate } from "../time";
import type { OwnerStatementStatus } from "../vocabulary";
import { authorize } from "./common";
import type { DocumentCounter, MoneyContext, MoneyResult } from "./model";
import { takeNumber } from "./receipts";

/** Records the reconciliation inputs and the locked accounting period under IN19. */
export interface OwnerStatement {
  readonly id: OwnerStatementId;
  readonly company_id: MoneyContext["company_id"];
  readonly status: OwnerStatementStatus;
  readonly period_from: LocalDate;
  readonly period_to: LocalDate;
  readonly opening_fils: Fils;
  readonly collections_fils: Fils;
  readonly fees_fils: Fils;
  readonly expenses_fils: Fils;
  readonly payouts_fils: Fils;
  readonly closing_fils: Fils;
  readonly period_locked: boolean;
  readonly number: string | null;
  readonly return_reason?: string;
}
/** Declares the owner statement review and supersession lifecycle as data. */
export const ownerStatementTransitions: Readonly<
  Record<OwnerStatementStatus, readonly OwnerStatementStatus[]>
> = {
  draft: ["in_review"],
  in_review: ["draft", "issued"],
  issued: ["superseded"],
  superseded: [],
};
/** Carries a statement and its STMT counter for atomic issue or rollback. */
export interface StatementDecision {
  readonly statement: OwnerStatement;
  readonly counter: DocumentCounter;
}
/** Reconciles and locks the period only when the reviewed statement is issued. */
export function transitionOwnerStatement(
  state: StatementDecision,
  command: { readonly to: OwnerStatementStatus; readonly reason?: string },
  context: MoneyContext,
): MoneyResult<StatementDecision> {
  const allowed = authorize(state.statement.company_id, context);
  if (!allowed.ok) return allowed;
  const statement = state.statement;
  if (!ownerStatementTransitions[statement.status].includes(command.to))
    return refuse("INVALID_TRANSITION");
  if (command.to === "draft") {
    const reason = requireReason(command.reason);
    return reason.ok
      ? ok({
          ...state,
          statement: {
            ...statement,
            status: "draft",
            return_reason: reason.value,
          },
        })
      : reason;
  }
  if (command.to !== "issued")
    return ok({ ...state, statement: { ...statement, status: command.to } });
  const valid = balancedStatement(statement);
  if (!valid.ok) return valid;
  const taken = takeNumber(state.counter, { series: "STMT" }, context);
  if (!taken.ok) return taken;
  return ok({
    statement: {
      ...statement,
      status: "issued",
      period_locked: true,
      number: taken.value.number,
    },
    counter: taken.value.next_counter,
  });
}

function balancedStatement(statement: OwnerStatement): MoneyResult<void> {
  if (
    statement.period_from > statement.period_to ||
    [
      statement.collections_fils,
      statement.fees_fils,
      statement.expenses_fils,
      statement.payouts_fils,
    ].some((value) => !nonNegativeFils.safeParse(value).success)
  )
    return refuse("INVALID_INPUT", "statement");
  // IN19: exact reconciliation is required before the accounting period is locked.
  const closing =
    BigInt(statement.opening_fils) +
    BigInt(statement.collections_fils) -
    BigInt(statement.fees_fils) -
    BigInt(statement.expenses_fils) -
    BigInt(statement.payouts_fils);
  return closing === BigInt(statement.closing_fils)
    ? ok(undefined)
    : refuse("STATEMENT_NOT_BALANCED");
}
