import { refuse, requireReason } from "../errors";
import type {
  AllocationId,
  ChargeId,
  InstalmentId,
  PaymentId,
  ReceiptId,
} from "../ids";
import { fils, positiveFils, sumFils, type Fils } from "../money";
import { ok } from "../result";
import type { LocalDate } from "../time";
import {
  paymentReversalReason,
  type InstalmentStatus,
  type ChargeStatus,
  type PaymentReversalReason,
} from "../vocabulary";
import { authorize } from "./common";
import type {
  Allocation,
  Charge,
  ExternalReceiptIdentity,
  Instalment,
  MoneyContext,
  MoneyLedger,
  MoneyResult,
  Payment,
  Refund,
  TargetReference,
} from "./model";
import { issueReceipt } from "./receipts";

/** Computes remaining on-account credit under C1 for a recorded payment. */
export function paymentCredit(
  payment: Payment,
  allocations: readonly Allocation[],
  refunds: readonly Refund[],
): Fils {
  if (payment.status === "reversed") return fils.parse(0);
  return sumFils([
    payment.amount_fils,
    ...allocations
      .filter(
        (item) => item.payment_id === payment.id && item.status === "active",
      )
      .map((item) => fils.parse(0 - item.amount_fils)),
    ...refunds
      .filter((item) => item.payment_id === payment.id)
      .map((item) => fils.parse(0 - item.amount_fils)),
  ]);
}

/** Totals only active allocations backed by recorded payments under C2. */
export function targetAllocated(
  target: Pick<TargetReference, "instalment_id" | "charge_id">,
  state: MoneyLedger,
): Fils {
  return sumFils(
    state.allocations
      .filter(
        (item) =>
          item.status === "active" &&
          item.instalment_id === target.instalment_id &&
          item.charge_id === target.charge_id &&
          state.payments.some(
            (payment) =>
              payment.id === item.payment_id && payment.status === "recorded",
          ),
      )
      .map((item) => item.amount_fils),
  );
}

/** Derives the debt status while retaining explicit waivers and cancellations. */
export function deriveInstalmentStatus(
  target: Instalment,
  allocated: Fils,
): InstalmentStatus {
  if (target.status === "waived" || target.status === "cancelled")
    return target.status;
  if (allocated === 0) return "open";
  return BigInt(allocated) ===
    BigInt(target.amount_fils) + BigInt(target.vat_fils)
    ? "paid"
    : "partly_paid";
}

/** Derives charge settlement while preserving the stored unpaid state and explicit closures. */
export function deriveChargeStatus(
  target: Charge,
  allocated: Fils,
): ChargeStatus {
  if (target.status === "waived" || target.status === "cancelled")
    return target.status;
  if (BigInt(allocated) >= BigInt(target.amount_fils) + BigInt(target.vat_fils))
    return "settled";
  return target.status === "settled"
    ? (target.unsettled_status ?? "open")
    : target.status;
}

function recompute(state: MoneyLedger): MoneyLedger {
  return {
    ...state,
    instalments: state.instalments.map((item) => ({
      ...item,
      status: deriveInstalmentStatus(
        item,
        targetAllocated({ instalment_id: item.id, charge_id: null }, state),
      ),
    })),
    charges: state.charges.map((item) => ({
      ...item,
      ...(item.status === "open" || item.status === "invoiced"
        ? { unsettled_status: item.status }
        : {}),
      status: deriveChargeStatus(
        item,
        targetAllocated({ instalment_id: null, charge_id: item.id }, state),
      ),
    })),
  };
}

/** Records a payment and its sole receipt in one atomic decision under IN16. */
export function recordPayment(
  state: MoneyLedger,
  command: {
    readonly payment: Payment;
    readonly receipt_id: ReceiptId;
    readonly external: ExternalReceiptIdentity | null;
  },
  context: MoneyContext,
): MoneyResult<MoneyLedger> {
  const allowed = authorize(state.company_id, context);
  if (!allowed.ok) return allowed;
  const payment = command.payment;
  if (
    !positiveFils.safeParse(payment.amount_fils).success ||
    payment.status !== "recorded" ||
    state.payments.some((item) => item.id === payment.id)
  )
    return refuse("INVALID_INPUT", "payment");
  if ((payment.method === "cheque") !== (payment.cheque_id !== null))
    return refuse("INVALID_INPUT", "cheque_id");
  return issueReceipt(
    { ...state, payments: [...state.payments, payment] },
    {
      id: command.receipt_id,
      payment_id: payment.id,
      external: command.external,
    },
    context,
  );
}

/** Accepts an untrusted target shape so invalid exclusive references are refused. */
export interface AllocateCommand {
  readonly id: AllocationId;
  readonly payment_id: PaymentId;
  readonly instalment_id: InstalmentId | null;
  readonly charge_id: ChargeId | null;
  readonly amount_fils: Fils;
}

function reference(
  command: Pick<AllocateCommand, "instalment_id" | "charge_id">,
): MoneyResult<TargetReference> {
  if (command.instalment_id !== null && command.charge_id === null)
    return ok({ instalment_id: command.instalment_id, charge_id: null });
  if (command.instalment_id === null && command.charge_id !== null)
    return ok({ instalment_id: null, charge_id: command.charge_id });
  return refuse("INVALID_INPUT", "target");
}

/** Allocates only available payment credit and unpaid target balance under C1 and C2. */
export function allocate(
  state: MoneyLedger,
  command: AllocateCommand,
  context: MoneyContext,
): MoneyResult<MoneyLedger> {
  const allowed = authorize(state.company_id, context);
  if (!allowed.ok) return allowed;
  const ref = reference(command);
  if (!ref.ok) return ref;
  if (
    !positiveFils.safeParse(command.amount_fils).success ||
    state.allocations.some((item) => item.id === command.id)
  )
    return refuse("INVALID_INPUT", "allocation");
  const payment = state.payments.find((item) => item.id === command.payment_id);
  if (payment === undefined) return refuse("INVALID_INPUT", "payment_id");
  if (payment.status === "reversed") return refuse("PAYMENT_REVERSED");
  if (
    command.amount_fils >
    paymentCredit(payment, state.allocations, state.refunds)
  )
    return refuse("ALLOCATION_EXCEEDS_PAYMENT");
  return allocateTarget(
    state,
    { ...command, ...ref.value, status: "active" },
    payment,
  );
}

function allocateTarget(
  state: MoneyLedger,
  allocation: Allocation,
  payment: Payment,
): MoneyResult<MoneyLedger> {
  const target =
    allocation.instalment_id === null
      ? state.charges.find((item) => item.id === allocation.charge_id)
      : state.instalments.find((item) => item.id === allocation.instalment_id);
  if (target?.contract_id !== payment.contract_id)
    return refuse("INVALID_INPUT", "target");
  if (target.status === "waived" || target.status === "cancelled")
    return refuse("INVALID_TRANSITION");
  if (
    BigInt(allocation.amount_fils) +
      BigInt(targetAllocated(allocation, state)) >
    BigInt(target.amount_fils) + BigInt(target.vat_fils)
  )
    return refuse("ALLOCATION_EXCEEDS_BALANCE");
  return ok(
    recompute({ ...state, allocations: [...state.allocations, allocation] }),
  );
}

/** Voids a single active allocation and restores its target's derived status. */
export function voidAllocation(
  state: MoneyLedger,
  command: { readonly allocation_id: AllocationId },
  context: MoneyContext,
): MoneyResult<MoneyLedger> {
  const allowed = authorize(state.company_id, context);
  if (!allowed.ok) return allowed;
  const allocation = state.allocations.find(
    (item) => item.id === command.allocation_id,
  );
  if (allocation === undefined) return refuse("INVALID_INPUT", "allocation_id");
  if (allocation.status !== "active") return refuse("INVALID_TRANSITION");
  return ok(
    recompute({
      ...state,
      allocations: state.allocations.map((item) =>
        item.id === allocation.id ? { ...item, status: "voided" } : item,
      ),
    }),
  );
}

/** Specifies a full reversal and its mandatory explanation. */
export interface ReversePaymentCommand {
  readonly payment_id: PaymentId;
  readonly reason_code: PaymentReversalReason;
  readonly reason: string;
}

/** Reverses a payment, its active allocations and its app receipt as one decision. */
export function reversePayment(
  state: MoneyLedger,
  command: ReversePaymentCommand,
  context: MoneyContext,
): MoneyResult<MoneyLedger> {
  const allowed = authorize(state.company_id, context);
  if (!allowed.ok) return allowed;
  const payment = state.payments.find((item) => item.id === command.payment_id);
  if (payment === undefined) return refuse("INVALID_INPUT", "payment_id");
  if (
    payment.status === "reversed" ||
    state.reversals.some((item) => item.payment_id === payment.id)
  )
    return refuse("PAYMENT_ALREADY_REVERSED");
  if (state.refunds.some((item) => item.payment_id === payment.id))
    return refuse("PAYMENT_HAS_REFUNDS");
  const reason = requireReason(command.reason);
  if (!reason.ok) return reason;
  if (!paymentReversalReason.safeParse(command.reason_code).success)
    return refuse("INVALID_INPUT", "reason_code");
  return ok(
    recompute({
      ...state,
      payments: state.payments.map((item) =>
        item.id === payment.id ? { ...item, status: "reversed" } : item,
      ),
      allocations: state.allocations.map((item) =>
        item.payment_id === payment.id && item.status === "active"
          ? { ...item, status: "voided" }
          : item,
      ),
      receipts: state.receipts.map((item) =>
        item.payment_id === payment.id &&
        item.source === "app" &&
        item.status === "issued"
          ? { ...item, status: "voided", void_reason: reason.value }
          : item,
      ),
      reversals: [
        ...state.reversals,
        { ...command, reason: reason.value, amount_fils: payment.amount_fils },
      ],
    }),
  );
}

/** Records a refund solely from available on-account credit under C1. */
export function recordRefund(
  state: MoneyLedger,
  command: Refund,
  context: MoneyContext,
): MoneyResult<MoneyLedger> {
  const allowed = authorize(state.company_id, context);
  if (!allowed.ok) return allowed;
  const payment = state.payments.find((item) => item.id === command.payment_id);
  if (payment === undefined) return refuse("INVALID_INPUT", "payment_id");
  if (payment.status === "reversed") return refuse("PAYMENT_REVERSED");
  if (!positiveFils.safeParse(command.amount_fils).success)
    return refuse("INVALID_INPUT", "amount_fils");
  const reason = requireReason(command.reason);
  if (!reason.ok) return reason;
  if (
    command.amount_fils >
    paymentCredit(payment, state.allocations, state.refunds)
  )
    return refuse("REFUND_EXCEEDS_CREDIT");
  return ok({
    ...state,
    refunds: [...state.refunds, { ...command, reason: reason.value }],
  });
}

/** Explicitly waives or cancels an unallocated instalment without implying receipt of money. */
export function closeInstalment(
  state: MoneyLedger,
  command: {
    readonly instalment_id: InstalmentId;
    readonly status: "waived" | "cancelled";
    readonly reason: string;
  },
  context: MoneyContext,
): MoneyResult<MoneyLedger> {
  const allowed = authorize(state.company_id, context);
  if (!allowed.ok) return allowed;
  const target = state.instalments.find(
    (item) => item.id === command.instalment_id,
  );
  if (target === undefined) return refuse("INVALID_INPUT", "instalment_id");
  if (target.status !== "open") return refuse("INVALID_TRANSITION");
  const reason = requireReason(command.reason);
  if (!reason.ok) return reason;
  if (
    targetAllocated({ instalment_id: target.id, charge_id: null }, state) !== 0
  )
    return refuse("INVALID_TRANSITION");
  return ok({
    ...state,
    instalments: state.instalments.map((item) =>
      item.id === target.id
        ? { ...item, status: command.status, reason: reason.value }
        : item,
    ),
  });
}

/** Supplies a target's current balance to the default allocation planner. */
export type OpenTarget = TargetReference & {
  readonly due_on: LocalDate;
  readonly seq_no: number;
  readonly balance_fils: Fils;
  readonly contract_id: Payment["contract_id"];
};
/** Describes a proposed allocation before identifiers are assigned on recording. */
export type PlannedAllocation = TargetReference & {
  readonly amount_fils: Fils;
};
/** Leaves unused funds explicitly visible as on-account credit. */
export interface AllocationPlan {
  readonly allocations: readonly PlannedAllocation[];
  readonly credit_fils: Fils;
}

/** Plans oldest due date first, then sequence, using only the payment's remaining credit. */
export function allocateOldestFirst(
  payment: Payment,
  openTargets: readonly OpenTarget[],
  allocations: readonly Allocation[] = [],
  refunds: readonly Refund[] = [],
): MoneyResult<AllocationPlan> {
  if (payment.status === "reversed") return refuse("PAYMENT_REVERSED");
  const seen = new Set<string>();
  for (const target of openTargets) {
    const ref = reference(target);
    if (!ref.ok) return ref;
    const key = `${String(target.instalment_id)}:${String(target.charge_id)}`;
    if (
      seen.has(key) ||
      target.contract_id !== payment.contract_id ||
      target.balance_fils < 0
    )
      return refuse("INVALID_INPUT", "target");
    seen.add(key);
  }
  let remaining = paymentCredit(payment, allocations, refunds);
  const plan: PlannedAllocation[] = [];
  const sorted = [...openTargets].sort(
    (a, b) => a.due_on.localeCompare(b.due_on) || a.seq_no - b.seq_no,
  );
  for (const target of sorted) {
    const amount = fils.parse(Math.min(remaining, target.balance_fils));
    if (amount > 0) plan.push({ ...target, amount_fils: amount });
    remaining = fils.parse(remaining - amount);
  }
  return ok({ allocations: plan, credit_fils: remaining });
}
