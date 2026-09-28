import { z } from "zod";
import type { CoreErrorCode, DomainError } from "../errors";
import type {
  AllocationId,
  ChargeId,
  ChequeId,
  CompanyId,
  ContractId,
  ContractVersionId,
  DocumentVersionId,
  InstalmentId,
  PaymentId,
  ReceiptId,
} from "../ids";
import type { Fils } from "../money";
import type { Result } from "../result";
import type { LocalDate } from "../time";
import type {
  AllocationStatus,
  ChequeStatus,
  ChargeStatus,
  InstalmentStatus,
  NumberSeries,
  PaymentMethod,
  PaymentReversalReason,
  PaymentSource,
  PaymentStatus,
  ReceiptStatus,
  Role,
} from "../vocabulary";

/** Lists refusals specific to recording money and financial documents. */
export const paymentsErrorCode = z.enum([
  "EARLY_DEPOSIT",
  "REVERSAL_REQUIRED",
  "PAYMENT_REVERSED",
  "ALLOCATION_EXCEEDS_PAYMENT",
  "ALLOCATION_EXCEEDS_BALANCE",
  "PAYMENT_ALREADY_REVERSED",
  "PAYMENT_HAS_REFUNDS",
  "REFUND_EXCEEDS_CREDIT",
  "RECEIPT_ALREADY_ISSUED",
  "DUPLICATE_EXTERNAL_RECEIPT",
  "DEDUCTIONS_EXCEED_DEPOSIT",
  "STATEMENT_NOT_BALANCED",
  "FORBIDDEN",
]);
/** Identifies an expected refusal from the payments module. */
export type PaymentsErrorCode =
  z.infer<typeof paymentsErrorCode> | CoreErrorCode;
/** Returns a complete decision or a typed refusal without changing the input. */
export type MoneyResult<T> = Result<T, DomainError<PaymentsErrorCode>>;
/** Supplies the issuing company and an explicit business date for decisions. */
export interface MoneyContext {
  readonly company_id: CompanyId;
  readonly company_name: string;
  readonly issuer_trn: string | null;
  readonly on: LocalDate;
  readonly role: Role;
}
/** Records a scheduled contract debt and its allocation derived status. */
export interface Instalment {
  readonly id: InstalmentId;
  readonly contract_id: ContractId;
  readonly contract_version_id: ContractVersionId;
  readonly seq_no: number;
  readonly due_on: LocalDate;
  readonly amount_fils: Fils;
  readonly vat_fils: Fils;
  readonly status: InstalmentStatus;
  readonly reason?: string;
}
/** Records a charge that participates in the same conservation rules as rent. */
export interface Charge {
  readonly id: ChargeId;
  readonly contract_id: ContractId;
  readonly seq_no: number;
  readonly due_on: LocalDate;
  readonly amount_fils: Fils;
  readonly vat_fils: Fils;
  readonly status: ChargeStatus;
  /** Retains the unpaid state when allocations derive settlement, so voiding can restore it. */
  readonly unsettled_status?: "open" | "invoiced";
  readonly reason?: string;
}
/** Links exactly one kind of debt when storing a validated allocation. */
export type TargetReference =
  | { readonly instalment_id: InstalmentId; readonly charge_id: null }
  | { readonly instalment_id: null; readonly charge_id: ChargeId };
/** Records money received elsewhere; this model performs no transfer. */
export interface Payment {
  readonly id: PaymentId;
  readonly contract_id: ContractId;
  readonly method: PaymentMethod;
  readonly amount_fils: Fils;
  readonly received_on: LocalDate;
  readonly source: PaymentSource;
  readonly cheque_id: ChequeId | null;
  readonly status: PaymentStatus;
}
/** Assigns a positive part of a payment to one debt. */
export type Allocation = TargetReference & {
  readonly id: AllocationId;
  readonly payment_id: PaymentId;
  readonly amount_fils: Fils;
  readonly status: AllocationStatus;
};
/** Records a full payment reversal once, preserving its explanation. */
export interface PaymentReversal {
  readonly payment_id: PaymentId;
  readonly reason_code: PaymentReversalReason;
  readonly reason: string;
  readonly amount_fils: Fils;
}
/** Records returned on-account credit without moving funds. */
export interface Refund {
  readonly payment_id: PaymentId;
  readonly amount_fils: Fils;
  readonly reason: string;
}
/** Identifies the immutable document supplied for an external receipt. */
export interface ExternalReceiptIdentity {
  readonly external_issuer: string;
  readonly external_receipt_no: string;
  readonly document_version_id: DocumentVersionId;
}
/** Preserves the sole receipt identity even after an app receipt is voided. */
export type Receipt = {
  readonly id: ReceiptId;
  readonly company_id: CompanyId;
  readonly payment_id: PaymentId;
  readonly status: ReceiptStatus;
  readonly void_reason?: string;
} & (
  | {
      readonly source: "app";
      readonly number: string;
      readonly issuer_name: string;
      readonly issuer_trn: string | null;
    }
  | ({ readonly source: "external" } & ExternalReceiptIdentity)
);
/** Holds the next unused number for one company and document series. */
export interface DocumentCounter {
  readonly company_id: CompanyId;
  readonly series: NumberSeries;
  readonly next: number;
}
/** Supplies a complete company scoped snapshot for atomic ledger decisions. */
export interface MoneyLedger {
  readonly company_id: CompanyId;
  readonly payments: readonly Payment[];
  readonly allocations: readonly Allocation[];
  readonly refunds: readonly Refund[];
  readonly reversals: readonly PaymentReversal[];
  readonly receipts: readonly Receipt[];
  readonly instalments: readonly Instalment[];
  readonly charges: readonly Charge[];
  readonly counters: readonly DocumentCounter[];
}
/** Describes a cheque without retaining bank account identifiers. */
export interface Cheque {
  readonly id: ChequeId;
  readonly instalment_id: InstalmentId;
  readonly cheque_no: string;
  readonly bank_name: string;
  readonly drawer_name: string;
  readonly cheque_date: LocalDate;
  readonly amount_fils: Fils;
  readonly status: ChequeStatus;
  readonly replaces_cheque_id: ChequeId | null;
  readonly deposited_on: LocalDate | null;
  readonly replacement_reference?: string;
}
