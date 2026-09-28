import { z } from "zod";
import * as ids from "../ids";
import {
  basisPoints,
  fils,
  nonNegativeFils,
  positiveFils,
  vatFils,
} from "../money";
import { localDate } from "../time";
import * as vocabulary from "../vocabulary";
import { fifteenDigits, standardFields, subjectId, text } from "./shared";

/** Records a scheduled instalment of a contract version. */
export const instalmentRecord = z.strictObject({
  ...standardFields(ids.instalmentId),
  contractVersionId: ids.contractVersionId,
  seqNo: z.int().min(1),
  dueOn: localDate,
  amountFils: positiveFils,
  vatFils: nonNegativeFils,
  status: vocabulary.instalmentStatus,
});
/** Represents a stored scheduled instalment. */
export type InstalmentRecord = z.infer<typeof instalmentRecord>;

/** Records a cheque without account identifiers or premature deposit dates. */
export const chequeRecord = z
  .strictObject({
    ...standardFields(ids.chequeId),
    instalmentId: ids.instalmentId.nullable(),
    chequeNo: text,
    bankName: text,
    drawerName: text,
    chequeDate: localDate,
    amountFils: positiveFils,
    status: vocabulary.chequeStatus,
    replacesChequeId: ids.chequeId.nullable(),
    depositedOn: localDate.nullable(),
  })
  .refine(
    (record) =>
      record.depositedOn === null || record.depositedOn >= record.chequeDate,
    {
      message: "A cheque cannot be deposited before its date",
      path: ["depositedOn"],
    },
  );
/** Represents a stored cheque without account identifiers. */
export type ChequeRecord = z.infer<typeof chequeRecord>;

/** Records received money and the evidence required by its source and method. */
export const paymentRecord = z
  .strictObject({
    ...standardFields(ids.paymentId),
    contractId: ids.contractId,
    method: vocabulary.paymentMethod,
    amountFils: positiveFils,
    receivedOn: localDate,
    source: vocabulary.paymentSource,
    externalIssuer: text.nullable(),
    externalReceiptNo: text.nullable(),
    chequeId: ids.chequeId.nullable(),
    status: vocabulary.paymentStatus,
  })
  .refine(
    (record) =>
      (record.source === "external") === (record.externalIssuer !== null),
    {
      message: "Only external payments require an issuer",
      path: ["externalIssuer"],
    },
  )
  .refine(
    (record) =>
      (record.source === "external") === (record.externalReceiptNo !== null),
    {
      message: "Only external payments require a receipt number",
      path: ["externalReceiptNo"],
    },
  )
  .refine(
    (record) => (record.method === "cheque") === (record.chequeId !== null),
    {
      message: "Only cheque payments require a cheque reference",
      path: ["chequeId"],
    },
  );
/** Represents a stored payment and its evidence references. */
export type PaymentRecord = z.infer<typeof paymentRecord>;

/** Records payment allocation to exactly one instalment or charge. */
export const allocationRecord = z
  .strictObject({
    ...standardFields(ids.allocationId),
    paymentId: ids.paymentId,
    instalmentId: ids.instalmentId.nullable(),
    chargeId: ids.chargeId.nullable(),
    amountFils: positiveFils,
    status: vocabulary.allocationStatus,
  })
  .refine(
    (record) => (record.instalmentId === null) !== (record.chargeId === null),
    {
      message: "An allocation requires exactly one debt reference",
      path: ["instalmentId"],
    },
  );
/** Represents a stored payment allocation. */
export type AllocationRecord = z.infer<typeof allocationRecord>;

/** Records the classified reason for reversing a payment. */
export const paymentReversalRecord = z.strictObject({
  ...standardFields(ids.paymentReversalId),
  paymentId: ids.paymentId,
  reasonCode: vocabulary.paymentReversalReason,
  reason: text,
});
/** Represents a stored payment reversal. */
export type PaymentReversalRecord = z.infer<typeof paymentReversalRecord>;

/** Records a positive refund against a payment. */
export const refundRecord = z.strictObject({
  ...standardFields(ids.refundId),
  paymentId: ids.paymentId,
  amountFils: positiveFils,
  reason: text,
});
/** Represents a stored payment refund. */
export type RefundRecord = z.infer<typeof refundRecord>;

/** Records a charge linked to a contract, maintenance ticket or both. */
export const chargeRecord = z
  .strictObject({
    ...standardFields(ids.chargeId),
    contractId: ids.contractId.nullable(),
    ticketId: ids.ticketId.nullable(),
    kind: vocabulary.chargeKind,
    payer: vocabulary.chargePayer,
    amountFils: positiveFils,
    vatFils: nonNegativeFils,
    status: vocabulary.chargeStatus,
  })
  .refine((record) => record.contractId !== null || record.ticketId !== null, {
    message: "A charge requires a contract or ticket",
    path: ["contractId"],
  });
/** Represents a stored contract or maintenance charge. */
export type ChargeRecord = z.infer<typeof chargeRecord>;

/** Records a contract deposit, itemised deductions and refund details. */
export const depositRecord = z.strictObject({
  ...standardFields(ids.depositId),
  contractId: ids.contractId,
  amountFils: nonNegativeFils,
  status: vocabulary.depositStatus,
  deductions: z.array(
    z.strictObject({ reason: text, amountFils: positiveFils }),
  ),
  refundDueOn: localDate.nullable(),
  carriedToContractId: ids.contractId.nullable(),
});
/** Represents a stored deposit and its deductions. */
export type DepositRecord = z.infer<typeof depositRecord>;

/** Records an invoice with issuance and issuer tax registration requirements. */
export const invoiceRecord = z
  .strictObject({
    ...standardFields(ids.invoiceId),
    series: vocabulary.numberSeries.extract(["INV"]),
    number: z.int().positive().nullable(),
    isTaxInvoice: z.boolean(),
    issuerTrn: fifteenDigits.nullable(),
    recipientType: vocabulary.invoiceRecipientType,
    recipientId: subjectId,
    recipientTrn: fifteenDigits.nullable(),
    issueDate: localDate.nullable(),
    supplyDate: localDate.nullable(),
    totalFils: nonNegativeFils,
    vatFils: nonNegativeFils,
    status: vocabulary.invoiceStatus,
    pdfDocumentVersionId: ids.documentVersionId.nullable(),
  })
  .refine((record) => record.vatFils === 0 || record.issuerTrn !== null, {
    message: "Taxable invoices require the issuer TRN",
    path: ["issuerTrn"],
  })
  .refine(
    (record) => (record.status === "draft") === (record.number === null),
    {
      message: "Invoice numbers are assigned exactly when issued",
      path: ["number"],
    },
  )
  .refine(
    (record) => (record.status === "draft") === (record.issueDate === null),
    {
      message: "Invoice dates are assigned exactly when issued",
      path: ["issueDate"],
    },
  );
/** Represents a stored invoice. */
export type InvoiceRecord = z.infer<typeof invoiceRecord>;

/** Records an invoice line with one debt reference and exact rounded VAT. */
export const invoiceLineRecord = z
  .strictObject({
    ...standardFields(ids.invoiceLineId),
    invoiceId: ids.invoiceId,
    instalmentId: ids.instalmentId.nullable(),
    chargeId: ids.chargeId.nullable(),
    descriptionEn: text,
    descriptionAr: text,
    amountFils: nonNegativeFils,
    vatBp: basisPoints,
    vatFils: nonNegativeFils,
  })
  .refine(
    (record) => (record.instalmentId === null) !== (record.chargeId === null),
    {
      message: "An invoice line requires exactly one debt reference",
      path: ["instalmentId"],
    },
  )
  .refine(
    (record) =>
      nonNegativeFils.safeParse(record.amountFils).success &&
      basisPoints.safeParse(record.vatBp).success &&
      record.vatFils === vatFils(record.amountFils, record.vatBp),
    {
      message: "Line VAT must match the rounded amount and rate",
      path: ["vatFils"],
    },
  );
/** Represents a stored invoice line. */
export type InvoiceLineRecord = z.infer<typeof invoiceLineRecord>;

/** Records a numbered credit note against an invoice. */
export const creditNoteRecord = z.strictObject({
  ...standardFields(ids.creditNoteId),
  invoiceId: ids.invoiceId,
  number: z.int().positive(),
  amountFils: nonNegativeFils,
  vatFils: nonNegativeFils,
  reason: text,
  pdfDocumentVersionId: ids.documentVersionId.nullable(),
});
/** Represents a stored credit note. */
export type CreditNoteRecord = z.infer<typeof creditNoteRecord>;

/** Records a numbered receipt and any required void explanation. */
export const receiptRecord = z
  .strictObject({
    ...standardFields(ids.receiptId),
    paymentId: ids.paymentId,
    number: z.int().positive(),
    status: vocabulary.receiptStatus,
    voidReason: text.nullable(),
    pdfDocumentVersionId: ids.documentVersionId.nullable(),
  })
  .refine(
    (record) => (record.status === "voided") === (record.voidReason !== null),
    {
      message: "A void reason is required exactly when voided",
      path: ["voidReason"],
    },
  );
/** Represents a stored payment receipt. */
export type ReceiptRecord = z.infer<typeof receiptRecord>;

/** Records an owner's statement with an exactly reconciled closing balance. */
export const ownerStatementRecord = z
  .strictObject({
    ...standardFields(ids.ownerStatementId),
    ownerId: ids.ownerId,
    periodStart: localDate,
    periodEnd: localDate,
    openingFils: fils,
    collectionsFils: fils,
    feesFils: fils,
    expensesFils: fils,
    payoutsFils: fils,
    closingFils: fils,
    number: z.int().positive().nullable(),
    status: vocabulary.ownerStatementStatus,
  })
  .refine((record) => record.periodEnd >= record.periodStart, {
    message: "A statement period cannot end before it starts",
    path: ["periodEnd"],
  })
  .refine(
    (record) =>
      BigInt(record.closingFils) ===
      BigInt(record.openingFils) +
        BigInt(record.collectionsFils) -
        BigInt(record.feesFils) -
        BigInt(record.expensesFils) -
        BigInt(record.payoutsFils),
    {
      message: "The statement closing balance must reconcile",
      path: ["closingFils"],
    },
  )
  .refine(
    (record) => (record.status === "draft") === (record.number === null),
    { message: "A statement number is required after draft", path: ["number"] },
  );
/** Represents a stored reconciled owner statement. */
export type OwnerStatementRecord = z.infer<typeof ownerStatementRecord>;

/** Records a positive owner payout and its optional statement reference. */
export const ownerPayoutRecord = z.strictObject({
  ...standardFields(ids.ownerPayoutId),
  ownerId: ids.ownerId,
  amountFils: positiveFils,
  paidOn: localDate,
  method: vocabulary.paymentMethod.extract(["transfer", "cheque"]),
  reference: text,
  statementId: ids.ownerStatementId.nullable(),
});
/** Represents a stored owner payout. */
export type OwnerPayoutRecord = z.infer<typeof ownerPayoutRecord>;
