import { refuse, requireReason } from "../errors";
import type { PaymentId, ReceiptId } from "../ids";
import { ok } from "../result";
import type { NumberSeries } from "../vocabulary";
import { authorize } from "./common";
import type {
  DocumentCounter,
  ExternalReceiptIdentity,
  MoneyContext,
  MoneyLedger,
  MoneyResult,
  Receipt,
} from "./model";

/** Formats a validated positive document sequence with at least six digits. */
export function formatDocumentNumber(series: NumberSeries, n: number): string {
  return `${series}-${String(n).padStart(6, "0")}`;
}
/**
 * Plans a counter advance that the caller commits only with the issued document.
 * The issuing transaction must lock this company and series counter row, persist
 * both records together, and discard the entire decision on rollback.
 */
export function takeNumber(
  state: DocumentCounter,
  command: { readonly series: NumberSeries },
  context: MoneyContext,
): MoneyResult<{
  readonly number: string;
  readonly next_counter: DocumentCounter;
}> {
  const allowed = authorize(state.company_id, context);
  if (!allowed.ok) return allowed;
  if (
    state.series !== command.series ||
    !Number.isSafeInteger(state.next) ||
    state.next < 1 ||
    state.next === Number.MAX_SAFE_INTEGER
  )
    return refuse("INVALID_INPUT", "counter");
  return ok({
    number: formatDocumentNumber(state.series, state.next),
    next_counter: { ...state, next: state.next + 1 },
  });
}
/** Carries either an app receipt request or an attached external receipt identity. */
export interface IssueReceiptCommand {
  readonly id: ReceiptId;
  readonly payment_id: PaymentId;
  readonly external: ExternalReceiptIdentity | null;
}
/** Plans the sole receipt for a payment, consuming a number only for app receipts. */
export function issueReceipt(
  state: MoneyLedger,
  command: IssueReceiptCommand,
  context: MoneyContext,
): MoneyResult<MoneyLedger> {
  const allowed = authorize(state.company_id, context);
  if (!allowed.ok) return allowed;
  const payment = state.payments.find((item) => item.id === command.payment_id);
  if (payment === undefined) return refuse("INVALID_INPUT", "payment_id");
  if (state.receipts.some((item) => item.payment_id === payment.id))
    return refuse("RECEIPT_ALREADY_ISSUED");
  if (state.receipts.some((item) => item.id === command.id))
    return refuse("INVALID_INPUT", "id");
  if (payment.status === "reversed") return refuse("PAYMENT_REVERSED");
  const base = {
    id: command.id,
    payment_id: payment.id,
    company_id: state.company_id,
    status: "issued",
  } as const;
  if (payment.source === "external") {
    return externalReceipt(state, command.external, base);
  }
  if (command.external !== null || context.company_name.trim() === "")
    return refuse("INVALID_INPUT", "issuer");
  const counter = state.counters.find(
    (item) => item.series === "RCPT" && item.company_id === state.company_id,
  ) ?? { company_id: state.company_id, series: "RCPT", next: 1 };
  const taken = takeNumber(counter, { series: "RCPT" }, context);
  if (!taken.ok) return taken;
  const receipt: Receipt = {
    ...base,
    source: "app",
    number: taken.value.number,
    issuer_name: context.company_name,
    issuer_trn: context.issuer_trn,
  };
  return ok({
    ...state,
    receipts: [...state.receipts, receipt],
    counters: [
      ...state.counters.filter((item) => item !== counter),
      taken.value.next_counter,
    ],
  });
}

function externalReceipt(
  state: MoneyLedger,
  identity: ExternalReceiptIdentity | null,
  base: {
    readonly id: ReceiptId;
    readonly payment_id: PaymentId;
    readonly company_id: MoneyContext["company_id"];
    readonly status: "issued";
  },
): MoneyResult<MoneyLedger> {
  if (
    identity === null ||
    identity.external_issuer.trim() === "" ||
    identity.external_receipt_no.trim() === "" ||
    identity.document_version_id.length === 0
  )
    return refuse("INVALID_INPUT", "external");
  const external_issuer = identity.external_issuer.trim();
  const external_receipt_no = identity.external_receipt_no.trim();
  if (
    state.receipts.some(
      (item) =>
        item.company_id === state.company_id &&
        item.source === "external" &&
        item.external_issuer === external_issuer &&
        item.external_receipt_no === external_receipt_no,
    )
  )
    return refuse("DUPLICATE_EXTERNAL_RECEIPT");
  return ok({
    ...state,
    receipts: [
      ...state.receipts,
      {
        ...base,
        ...identity,
        external_issuer,
        external_receipt_no,
        source: "external",
      },
    ],
  });
}
/** Voids an app receipt with a reason while keeping its consumed number. */
export function voidReceipt(
  state: Receipt,
  command: { readonly reason: string },
  context: MoneyContext,
): MoneyResult<Receipt> {
  const allowed = authorize(state.company_id, context);
  if (!allowed.ok) return allowed;
  if (state.status !== "issued" || state.source !== "app")
    return refuse("INVALID_TRANSITION");
  const reason = requireReason(command.reason);
  if (!reason.ok) return reason;
  return ok({ ...state, status: "voided", void_reason: reason.value });
}
