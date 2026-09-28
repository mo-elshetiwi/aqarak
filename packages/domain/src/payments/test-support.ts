import {
  allocationId,
  chargeId,
  chequeId,
  companyId,
  contractId,
  contractVersionId,
  documentVersionId,
  instalmentId,
  paymentId,
  receiptId,
} from "../ids";
import { fils } from "../money";
import { localDate } from "../time";
import type {
  Cheque,
  MoneyContext,
  MoneyLedger,
  MoneyResult,
  Payment,
  Receipt,
  AllocateCommand,
} from "./index";

/** Makes deterministic synthetic identifiers for financial rule tests. */
export function uuid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}
/** Supplies a synthetic company actor and explicit calendar date. */
export const context: MoneyContext = {
  company_id: companyId.parse(uuid(1)),
  company_name: "Example Company",
  issuer_trn: "100000000000001",
  on: localDate.parse("2026-09-28"),
  role: "manager",
};
/** Supplies another synthetic company for scope isolation tests. */
export const otherCompany = companyId.parse(uuid(2));
/** Supplies a deterministic attached document version. */
export const documentVersion = documentVersionId.parse(uuid(3));
/** Creates a valid recorded payment with independently selectable identity and amount. */
export function payment(n = 1, amount = 100): Payment {
  return {
    id: paymentId.parse(uuid(n)),
    contract_id: contractId.parse(uuid(1)),
    method: "cash",
    amount_fils: fils.parse(amount),
    received_on: context.on,
    source: "app",
    cheque_id: null,
    status: "recorded",
  };
}
/** Creates a matching issued app receipt. */
export function receipt(n = 1): Receipt {
  return {
    id: receiptId.parse(uuid(n)),
    company_id: context.company_id,
    payment_id: payment(n).id,
    source: "app",
    status: "issued",
    number: `RCPT-${String(n).padStart(6, "0")}`,
    issuer_name: context.company_name,
    issuer_trn: context.issuer_trn,
  };
}
/** Creates a complete synthetic ledger with one open instalment and charge. */
export function ledger(): MoneyLedger {
  return {
    company_id: context.company_id,
    payments: [payment()],
    receipts: [receipt()],
    allocations: [],
    refunds: [],
    reversals: [],
    instalments: [
      {
        id: instalmentId.parse(uuid(1)),
        contract_id: contractId.parse(uuid(1)),
        contract_version_id: contractVersionId.parse(uuid(1)),
        seq_no: 1,
        due_on: localDate.parse("2026-03-28"),
        amount_fils: fils.parse(100),
        vat_fils: fils.parse(0),
        status: "open",
      },
    ],
    charges: [
      {
        id: chargeId.parse(uuid(1)),
        contract_id: contractId.parse(uuid(1)),
        seq_no: 2,
        due_on: context.on,
        amount_fils: fils.parse(200),
        vat_fils: fils.parse(0),
        status: "open",
      },
    ],
    counters: [{ company_id: context.company_id, series: "RCPT", next: 2 }],
  };
}
/** Creates an allocation command for the fixture instalment. */
export function allocation(n = 1, amount = 100): AllocateCommand {
  return {
    id: allocationId.parse(uuid(n)),
    payment_id: payment(1).id,
    instalment_id: instalmentId.parse(uuid(1)),
    charge_id: null,
    amount_fils: fils.parse(amount),
  };
}
/** Creates a synthetic cheque with no bank account identifiers. */
export function cheque(): Cheque {
  return {
    id: chequeId.parse(uuid(1)),
    instalment_id: instalmentId.parse(uuid(1)),
    cheque_no: "SYNTHETIC-1",
    bank_name: "Example Bank",
    drawer_name: "Example Drawer",
    cheque_date: localDate.parse("2026-03-28"),
    amount_fils: fils.parse(100),
    status: "pending",
    replaces_cheque_id: null,
    deposited_on: null,
  };
}
/** Fails a test immediately if an expected successful decision is refused. */
export function value<T>(result: MoneyResult<T>): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
