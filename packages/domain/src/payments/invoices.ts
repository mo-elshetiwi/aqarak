import { refuse } from "../errors";
import type { CreditNoteId, InvoiceId, InvoiceLineId } from "../ids";
import {
  applicableVatBp,
  nonNegativeFils,
  vatFils,
  type BasisPoints,
  type Fils,
} from "../money";
import { ok } from "../result";
import type { InvoiceStatus, UnitUse } from "../vocabulary";
import { authorize, checkedMoney, exactTotal } from "./common";
import { targetAllocated } from "./ledger";
import type {
  DocumentCounter,
  MoneyContext,
  MoneyLedger,
  MoneyResult,
  TargetReference,
} from "./model";
import { takeNumber } from "./receipts";

/** Identifies a rent line and its explicit tax classification and allocation target. */
export interface InvoiceLine {
  readonly instalment_id: TargetReference["instalment_id"];
  readonly charge_id: TargetReference["charge_id"];
  readonly id: InvoiceLineId;
  readonly amount_fils: Fils;
  readonly vat_bp: BasisPoints;
  readonly unit_use: UnitUse;
}
/** Keeps each rounded line VAT alongside the document's exact integer totals. */
export interface InvoiceTotals {
  readonly line_vat_fils: readonly Fils[];
  readonly amount_fils: Fils;
  readonly vat_fils: Fils;
  readonly total_fils: Fils;
}
/** Records the company issuer snapshot and immutable lines once issued. */
export interface Invoice {
  readonly id: InvoiceId;
  readonly company_id: MoneyContext["company_id"];
  readonly status: InvoiceStatus;
  readonly lines: readonly InvoiceLine[];
  readonly number: string | null;
  readonly issuer_name: string;
  readonly issuer_trn: string | null;
}
/** Records credited line amounts using the same VAT calculation as the invoice. */
export interface CreditNote {
  readonly id: CreditNoteId;
  readonly invoice_id: InvoiceId;
  readonly number: string;
  readonly lines: readonly InvoiceLine[];
  readonly totals: InvoiceTotals;
  readonly issuer_name: string;
  readonly issuer_trn: string | null;
}
/** Holds financial documents and their company-scoped numbering counters. */
export interface InvoiceBook {
  readonly company_id: MoneyContext["company_id"];
  readonly invoices: readonly Invoice[];
  readonly credit_notes: readonly CreditNote[];
  readonly counters: readonly DocumentCounter[];
}

/** Calculates per-line rounded VAT and refuses tax rates inconsistent with IN17. */
export function invoiceTotals(
  lines: readonly InvoiceLine[],
  issuerTrn: string | null,
): MoneyResult<InvoiceTotals> {
  const seen = new Set<string>();
  const ids = new Set<InvoiceLineId>();
  const taxes: Fils[] = [];
  if (lines.length === 0) return refuse("INVALID_INPUT", "lines");
  for (const line of lines) {
    const key = `${String(line.instalment_id)}:${String(line.charge_id)}`;
    if (
      (line.instalment_id === null) === (line.charge_id === null) ||
      seen.has(key) ||
      ids.has(line.id)
    )
      return refuse("INVALID_INPUT", "lines");
    if (
      !nonNegativeFils.safeParse(line.amount_fils).success ||
      line.vat_bp !== applicableVatBp({ unitUse: line.unit_use, issuerTrn })
    )
      return refuse("INVALID_INPUT", "vat_bp");
    seen.add(key);
    ids.add(line.id);
    taxes.push(vatFils(line.amount_fils, line.vat_bp));
  }
  return totals(lines, taxes);
}

function totals(
  lines: readonly InvoiceLine[],
  taxes: readonly Fils[],
): MoneyResult<InvoiceTotals> {
  const amount = checkedMoney(
    exactTotal(lines.map((line) => line.amount_fils)),
  );
  if (!amount.ok) return amount;
  const vat = checkedMoney(exactTotal(taxes));
  if (!vat.ok) return vat;
  const total = checkedMoney(BigInt(amount.value) + BigInt(vat.value));
  return total.ok
    ? ok({
        line_vat_fils: taxes,
        amount_fils: amount.value,
        vat_fils: vat.value,
        total_fils: total.value,
      })
    : total;
}

/** Derives C3 from active recorded allocations and the invoice's credit notes. */
export function deriveInvoiceStatus(
  invoice: Invoice,
  ledger: MoneyLedger,
  creditNotes: readonly CreditNote[],
): MoneyResult<InvoiceStatus> {
  if (invoice.status === "draft") return ok("draft");
  if (invoice.company_id !== ledger.company_id)
    return refuse("INVALID_INPUT", "company_id");
  const total = invoiceTotals(invoice.lines, invoice.issuer_trn);
  if (!total.ok) return total;
  const covered = invoice.lines.reduce(
    (sum, line) =>
      sum +
      BigInt(
        Math.min(
          targetAllocated(line, ledger),
          line.amount_fils + vatFils(line.amount_fils, line.vat_bp),
        ),
      ),
    0n,
  );
  const credited = creditNotes
    .filter((note) => note.invoice_id === invoice.id)
    .reduce((sum, note) => sum + BigInt(note.totals.total_fils), 0n);
  const value = BigInt(total.value.total_fils);
  if (credited > 0n && covered + credited >= value) return ok("credited");
  if (covered === value) return ok("paid");
  return ok(covered === 0n ? "issued" : "partly_paid");
}

/** Changes invoice lines only while the document remains a draft. */
export function editInvoice(
  state: Invoice,
  command: { readonly lines: readonly InvoiceLine[] },
  context: MoneyContext,
): MoneyResult<Invoice> {
  const allowed = authorize(state.company_id, context);
  if (!allowed.ok) return allowed;
  if (state.status !== "draft") return refuse("INVALID_TRANSITION");
  const total = invoiceTotals(command.lines, context.issuer_trn);
  return total.ok ? ok({ ...state, lines: command.lines }) : total;
}

/** Issues either invoice form using the same INV counter and company issuer identity. */
export function issueInvoice(
  state: InvoiceBook,
  command: { readonly invoice_id: InvoiceId },
  context: MoneyContext,
): MoneyResult<InvoiceBook> {
  const allowed = authorize(state.company_id, context);
  if (!allowed.ok) return allowed;
  const invoice = state.invoices.find((item) => item.id === command.invoice_id);
  if (
    invoice?.company_id !== state.company_id ||
    context.company_name.trim() === ""
  )
    return refuse("INVALID_INPUT", "invoice");
  if (invoice.status !== "draft") return refuse("INVALID_TRANSITION");
  const total = invoiceTotals(invoice.lines, context.issuer_trn);
  if (!total.ok) return total;
  const counter = state.counters.find(
    (item) => item.company_id === state.company_id && item.series === "INV",
  ) ?? { company_id: state.company_id, series: "INV", next: 1 };
  const taken = takeNumber(counter, { series: "INV" }, context);
  if (!taken.ok) return taken;
  return ok({
    ...state,
    invoices: state.invoices.map((item) =>
      item.id === invoice.id
        ? {
            ...item,
            number: taken.value.number,
            issuer_name: context.company_name,
            issuer_trn: context.issuer_trn,
            status: "issued",
          }
        : item,
    ),
    counters: [
      ...state.counters.filter((item) => item !== counter),
      taken.value.next_counter,
    ],
  });
}

/** Credits only uncredited source line amounts and no more than the unpaid invoice balance. */
export function issueCreditNote(
  state: InvoiceBook,
  command: {
    readonly id: CreditNoteId;
    readonly invoice_id: InvoiceId;
    readonly lines: readonly InvoiceLine[];
  },
  context: MoneyContext,
  ledger: MoneyLedger,
): MoneyResult<InvoiceBook> {
  const allowed = authorize(state.company_id, context);
  if (!allowed.ok) return allowed;
  const invoice = state.invoices.find((item) => item.id === command.invoice_id);
  if (
    invoice === undefined ||
    state.credit_notes.some((item) => item.id === command.id)
  )
    return refuse("INVALID_INPUT", "invoice");
  const status = deriveInvoiceStatus(invoice, ledger, state.credit_notes);
  if (!status.ok) return status;
  if (status.value !== "issued" && status.value !== "partly_paid")
    return refuse("INVALID_TRANSITION");
  const total = invoiceTotals(command.lines, invoice.issuer_trn);
  if (!total.ok) return total;
  const valid = validateCredit(
    invoice,
    command.lines,
    state.credit_notes,
    ledger,
  );
  if (!valid.ok) return valid;
  return commitCredit(
    state,
    {
      ...command,
      totals: total.value,
      issuer_name: invoice.issuer_name,
      issuer_trn: invoice.issuer_trn,
    },
    context,
    ledger,
  );
}

function validateCredit(
  invoice: Invoice,
  lines: readonly InvoiceLine[],
  notes: readonly CreditNote[],
  ledger: MoneyLedger,
): MoneyResult<void> {
  for (const line of lines) {
    const original = invoice.lines.find((item) => item.id === line.id);
    if (
      original?.instalment_id !== line.instalment_id ||
      original.charge_id !== line.charge_id ||
      original.vat_bp !== line.vat_bp ||
      original.unit_use !== line.unit_use
    )
      return refuse("INVALID_INPUT", "line");
    const previous = notes
      .filter((note) => note.invoice_id === invoice.id)
      .flatMap((note) => note.lines)
      .filter((item) => item.id === line.id);
    if (
      exactTotal(previous.map((item) => item.amount_fils)) +
        BigInt(line.amount_fils) >
      BigInt(original.amount_fils)
    )
      return refuse("INVALID_INPUT", "credit");
    const credited = previous.reduce(
      (sum, item) =>
        sum +
        BigInt(item.amount_fils) +
        BigInt(vatFils(item.amount_fils, item.vat_bp)),
      0n,
    );
    const newCredit =
      BigInt(line.amount_fils) + BigInt(vatFils(line.amount_fils, line.vat_bp));
    const full =
      BigInt(original.amount_fils) +
      BigInt(vatFils(original.amount_fils, original.vat_bp));
    if (credited + newCredit + BigInt(targetAllocated(line, ledger)) > full)
      return refuse("INVALID_INPUT", "credit");
  }
  return ok(undefined);
}

function commitCredit(
  state: InvoiceBook,
  note: Omit<CreditNote, "number">,
  context: MoneyContext,
  ledger: MoneyLedger,
): MoneyResult<InvoiceBook> {
  const counter = state.counters.find(
    (item) => item.company_id === state.company_id && item.series === "CN",
  ) ?? { company_id: state.company_id, series: "CN", next: 1 };
  const taken = takeNumber(counter, { series: "CN" }, context);
  if (!taken.ok) return taken;
  const notes = [
    ...state.credit_notes,
    { ...note, number: taken.value.number },
  ];
  const invoices: Invoice[] = [];
  for (const invoice of state.invoices) {
    if (invoice.id !== note.invoice_id) {
      invoices.push(invoice);
      continue;
    }
    const status = deriveInvoiceStatus(invoice, ledger, notes);
    if (!status.ok) return status;
    invoices.push({ ...invoice, status: status.value });
  }
  return ok({
    ...state,
    invoices,
    credit_notes: notes,
    counters: [
      ...state.counters.filter((item) => item !== counter),
      taken.value.next_counter,
    ],
  });
}
