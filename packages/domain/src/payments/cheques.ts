import { refuse } from "../errors";
import type { PaymentId, ReceiptId } from "../ids";
import { positiveFils, type Fils } from "../money";
import { ok } from "../result";
import { addMonths, compareLocalDates, type LocalDate } from "../time";
import type { ChequeStatus } from "../vocabulary";
import { authorize } from "./common";
import {
  recordPayment,
  reversePayment,
  type ReversePaymentCommand,
} from "./ledger";
import type { Cheque, MoneyContext, MoneyLedger, MoneyResult } from "./model";

/** Declares the complete cheque lifecycle as data, including a return after clearance. */
export const chequeTransitions: Readonly<
  Record<ChequeStatus, readonly ChequeStatus[]>
> = {
  pending: ["received", "replaced"],
  received: ["deposited", "replaced", "returned_to_drawer"],
  deposited: ["cleared", "partly_paid", "bounced"],
  cleared: ["bounced"],
  partly_paid: ["replaced"],
  bounced: ["deposited", "replaced"],
  replaced: [],
  returned_to_drawer: [],
};

/** Supplies the evidence needed for the requested cheque transition. */
export type ChequeCommand =
  | { readonly to: "received" | "returned_to_drawer" }
  | { readonly to: "deposited"; readonly deposited_on: LocalDate }
  | {
      readonly to: "replaced";
      readonly replacement_reference: string;
      readonly replacement_cheque: Cheque | null;
    }
  | {
      readonly to: "cleared" | "partly_paid";
      readonly paid_fils: Fils;
      readonly payment_id: PaymentId;
      readonly receipt_id: ReceiptId;
    }
  | { readonly to: "bounced"; readonly reversal: ReversePaymentCommand | null };

/** Combines the instrument and ledger changes that must be committed together. */
export interface ChequeDecision {
  readonly cheque: Cheque;
  readonly ledger: MoneyLedger;
  readonly replacement_cheque: Cheque | null;
}

/** Records cheque movement without moving funds or imposing automatic penalties. */
export function transitionCheque(
  state: { readonly cheque: Cheque; readonly ledger: MoneyLedger },
  command: ChequeCommand,
  context: MoneyContext,
): MoneyResult<ChequeDecision> {
  const allowed = authorize(state.ledger.company_id, context);
  if (!allowed.ok) return allowed;
  if (!positiveFils.safeParse(state.cheque.amount_fils).success)
    return refuse("INVALID_INPUT", "amount_fils");
  if (!chequeTransitions[state.cheque.status].includes(command.to))
    return refuse("INVALID_TRANSITION");
  const decision: ChequeDecision = {
    ...state,
    cheque: { ...state.cheque, status: command.to },
    replacement_cheque: null,
  };
  switch (command.to) {
    case "received":
    case "returned_to_drawer":
      return ok(decision);
    case "deposited":
      // IN15 and Art. 648: presentation before the instrument date is refused.
      if (compareLocalDates(command.deposited_on, state.cheque.cheque_date) < 0)
        return refuse("EARLY_DEPOSIT");
      return ok({
        ...decision,
        cheque: { ...decision.cheque, deposited_on: command.deposited_on },
      });
    case "replaced":
      return replaceCheque(decision, command);
    case "cleared":
    case "partly_paid":
      return clearCheque(decision, command, context);
    case "bounced":
      if (state.cheque.status !== "cleared") return ok(decision);
      return bounceClearedCheque(decision, command.reversal, context);
  }
}

function replaceCheque(
  decision: ChequeDecision,
  command: Extract<ChequeCommand, { readonly to: "replaced" }>,
): MoneyResult<ChequeDecision> {
  if (command.replacement_reference.trim() === "")
    return refuse("INVALID_INPUT", "replacement_reference");
  const replacement = command.replacement_cheque;
  if (
    replacement !== null &&
    (replacement.id === decision.cheque.id ||
      replacement.replaces_cheque_id !== decision.cheque.id ||
      replacement.instalment_id !== decision.cheque.instalment_id ||
      !positiveFils.safeParse(replacement.amount_fils).success)
  )
    return refuse("INVALID_INPUT", "replacement_cheque");
  return ok({
    ...decision,
    cheque: {
      ...decision.cheque,
      replacement_reference: command.replacement_reference.trim(),
    },
    replacement_cheque: replacement,
  });
}

function clearCheque(
  decision: ChequeDecision,
  command: Extract<ChequeCommand, { readonly to: "cleared" | "partly_paid" }>,
  context: MoneyContext,
): MoneyResult<ChequeDecision> {
  if (
    !positiveFils.safeParse(command.paid_fils).success ||
    command.paid_fils > decision.cheque.amount_fils
  )
    return refuse("INVALID_INPUT", "paid_fils");
  if (
    (command.to === "cleared") !==
    (command.paid_fils === decision.cheque.amount_fils)
  )
    return refuse("INVALID_INPUT", "paid_fils");
  const instalment = decision.ledger.instalments.find(
    (item) => item.id === decision.cheque.instalment_id,
  );
  if (
    instalment === undefined ||
    decision.ledger.payments.some(
      (item) =>
        item.cheque_id === decision.cheque.id && item.status === "recorded",
    )
  )
    return refuse("INVALID_INPUT", "cheque_payment");
  const recorded = recordPayment(
    decision.ledger,
    {
      payment: {
        id: command.payment_id,
        contract_id: instalment.contract_id,
        method: "cheque",
        amount_fils: command.paid_fils,
        received_on: context.on,
        source: "app",
        cheque_id: decision.cheque.id,
        status: "recorded",
      },
      receipt_id: command.receipt_id,
      external: null,
    },
    context,
  );
  return recorded.ok ? ok({ ...decision, ledger: recorded.value }) : recorded;
}

function bounceClearedCheque(
  decision: ChequeDecision,
  reversal: ReversePaymentCommand | null,
  context: MoneyContext,
): MoneyResult<ChequeDecision> {
  if (reversal === null) return refuse("REVERSAL_REQUIRED");
  const payment = decision.ledger.payments.find(
    (item) => item.id === reversal.payment_id,
  );
  if (
    payment?.cheque_id !== decision.cheque.id ||
    payment.method !== "cheque" ||
    payment.amount_fils !== decision.cheque.amount_fils ||
    reversal.reason_code !== "bounced"
  )
    return refuse("INVALID_INPUT", "reversal");
  const reversed = reversePayment(decision.ledger, reversal, context);
  return reversed.ok ? ok({ ...decision, ledger: reversed.value }) : reversed;
}

/** Flags six-month presentation age for pending or received cheques without blocking commands. */
export function isChequeStale(input: {
  readonly cheque: Cheque;
  readonly on: LocalDate;
}): boolean {
  return (
    (input.cheque.status === "pending" || input.cheque.status === "received") &&
    compareLocalDates(input.on, addMonths(input.cheque.cheque_date, 6)) >= 0
  );
}
