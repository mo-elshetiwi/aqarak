import { refuse, requireReason } from "../errors";
import type { DepositId, DocumentVersionId } from "../ids";
import { fils, nonNegativeFils, positiveFils, type Fils } from "../money";
import { ok } from "../result";
import type { DepositStatus } from "../vocabulary";
import { authorize, exactTotal } from "./common";
import type { MoneyContext, MoneyResult } from "./model";

/** Retains a reason for every item deducted from held deposit money. */
export interface DepositDeduction {
  readonly amount_fils: Fils;
  readonly reason: string;
}
/** Records deposit custody and settlement amounts without transferring funds. */
export interface Deposit {
  readonly id: DepositId;
  readonly company_id: MoneyContext["company_id"];
  readonly status: DepositStatus;
  readonly amount_fils: Fils;
  readonly held_fils: Fils;
  readonly inspection_document_version_id: DocumentVersionId | null;
  readonly deductions: readonly DepositDeduction[];
  readonly refund_fils: Fils;
  readonly applied_fils: Fils;
  readonly top_up_fils: Fils;
}
/** Declares the permitted deposit transitions as data. */
export const depositTransitions: Readonly<
  Record<DepositStatus, readonly DepositStatus[]>
> = {
  expected: ["held"],
  held: ["refund_due", "applied", "carried_over"],
  refund_due: ["refunded"],
  refunded: [],
  applied: [],
  carried_over: [],
};
/** Supplies the inspection or itemised settlement evidence for a deposit decision. */
export type DepositCommand =
  | { readonly to: "held" }
  | {
      readonly to: "refund_due";
      readonly inspection_document_version_id: DocumentVersionId;
    }
  | {
      readonly to: "refunded";
      readonly deductions: readonly DepositDeduction[];
    }
  | { readonly to: "applied"; readonly unpaid_dues_fils: Fils }
  | { readonly to: "carried_over"; readonly new_deposit_fils: Fils };

/** Applies a deposit lifecycle decision with bounded deductions and explicit renewal top-up. */
export function transitionDeposit(
  state: Deposit,
  command: DepositCommand,
  context: MoneyContext,
): MoneyResult<Deposit> {
  const allowed = authorize(state.company_id, context);
  if (!allowed.ok) return allowed;
  if (!depositTransitions[state.status].includes(command.to))
    return refuse("INVALID_TRANSITION");
  switch (command.to) {
    case "held":
      if (!positiveFils.safeParse(state.amount_fils).success)
        return refuse("INVALID_INPUT", "amount_fils");
      return ok({ ...state, status: "held", held_fils: state.amount_fils });
    case "refund_due":
      if (command.inspection_document_version_id.length === 0)
        return refuse("INVALID_INPUT", "inspection_document_version_id");
      return ok({
        ...state,
        status: "refund_due",
        inspection_document_version_id: command.inspection_document_version_id,
      });
    case "refunded":
      return settleDeposit(state, command.deductions);
    case "applied":
      if (
        !positiveFils.safeParse(command.unpaid_dues_fils).success ||
        command.unpaid_dues_fils < state.held_fils
      )
        return refuse("INVALID_INPUT", "unpaid_dues_fils");
      return ok({ ...state, status: "applied", applied_fils: state.held_fils });
    case "carried_over":
      if (!nonNegativeFils.safeParse(command.new_deposit_fils).success)
        return refuse("INVALID_INPUT", "new_deposit_fils");
      return ok({
        ...state,
        status: "carried_over",
        top_up_fils: fils.parse(
          Math.max(0, command.new_deposit_fils - state.held_fils),
        ),
      });
  }
}

function settleDeposit(
  state: Deposit,
  deductions: readonly DepositDeduction[],
): MoneyResult<Deposit> {
  const items: DepositDeduction[] = [];
  for (const item of deductions) {
    if (!positiveFils.safeParse(item.amount_fils).success)
      return refuse("INVALID_INPUT", "deductions");
    const reason = requireReason(item.reason);
    if (!reason.ok) return reason;
    items.push({ ...item, reason: reason.value });
  }
  const total = exactTotal(items.map((item) => item.amount_fils));
  if (total > BigInt(state.held_fils))
    return refuse("DEDUCTIONS_EXCEED_DEPOSIT");
  return ok({
    ...state,
    status: "refunded",
    deductions: items,
    refund_fils: fils.parse(state.held_fils - Number(total)),
  });
}
