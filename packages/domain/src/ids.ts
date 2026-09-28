import { z } from "zod";

function identifier<Brand extends string>(brand: Brand) {
  return z
    .uuid()
    .refine((value) => value === value.toLowerCase())
    .brand(brand);
}

/** Validates a canonical lowercase company identifier at domain boundaries. */
export const companyId = identifier("CompanyId");
/** Identifies a company when linking domain records. */
export type CompanyId = z.infer<typeof companyId>;

/** Validates a canonical lowercase person account identifier at domain boundaries. */
export const personAccountId = z
  .guid()
  .refine((value) => value === value.toLowerCase())
  .brand("PersonAccountId");
/** Identifies a person account when linking domain records. */
export type PersonAccountId = z.infer<typeof personAccountId>;

/** Validates a canonical lowercase membership identifier at domain boundaries. */
export const membershipId = identifier("MembershipId");
/** Identifies a membership when linking domain records. */
export type MembershipId = z.infer<typeof membershipId>;

/** Validates a canonical lowercase technician profile identifier at domain boundaries. */
export const technicianProfileId = identifier("TechnicianProfileId");
/** Identifies a technician profile when linking domain records. */
export type TechnicianProfileId = z.infer<typeof technicianProfileId>;

/** Validates a canonical lowercase invitation identifier at domain boundaries. */
export const invitationId = identifier("InvitationId");
/** Identifies an invitation when linking domain records. */
export type InvitationId = z.infer<typeof invitationId>;

/** Validates a canonical lowercase owner identifier at domain boundaries. */
export const ownerId = identifier("OwnerId");
/** Identifies an owner when linking domain records. */
export type OwnerId = z.infer<typeof ownerId>;

/** Validates a canonical lowercase ownership identifier at domain boundaries. */
export const ownershipId = identifier("OwnershipId");
/** Identifies an ownership when linking domain records. */
export type OwnershipId = z.infer<typeof ownershipId>;

/** Validates a canonical lowercase owner mandate identifier at domain boundaries. */
export const ownerMandateId = identifier("OwnerMandateId");
/** Identifies an owner mandate when linking domain records. */
export type OwnerMandateId = z.infer<typeof ownerMandateId>;

/** Validates a canonical lowercase property identifier at domain boundaries. */
export const propertyId = identifier("PropertyId");
/** Identifies a property when linking domain records. */
export type PropertyId = z.infer<typeof propertyId>;

/** Validates a canonical lowercase unit identifier at domain boundaries. */
export const unitId = identifier("UnitId");
/** Identifies a unit when linking domain records. */
export type UnitId = z.infer<typeof unitId>;

/** Validates a canonical lowercase tenant identifier at domain boundaries. */
export const tenantId = identifier("TenantId");
/** Identifies a tenant when linking domain records. */
export type TenantId = z.infer<typeof tenantId>;

/** Validates a canonical lowercase occupant identifier at domain boundaries. */
export const occupantId = identifier("OccupantId");
/** Identifies an occupant when linking domain records. */
export type OccupantId = z.infer<typeof occupantId>;

/** Validates a canonical lowercase vendor identifier at domain boundaries. */
export const vendorId = identifier("VendorId");
/** Identifies a vendor when linking domain records. */
export type VendorId = z.infer<typeof vendorId>;

/** Validates a canonical lowercase contract identifier at domain boundaries. */
export const contractId = identifier("ContractId");
/** Identifies a contract when linking domain records. */
export type ContractId = z.infer<typeof contractId>;

/** Validates a canonical lowercase contract unit identifier at domain boundaries. */
export const contractUnitId = identifier("ContractUnitId");
/** Identifies a contract unit when linking domain records. */
export type ContractUnitId = z.infer<typeof contractUnitId>;

/** Validates a canonical lowercase contract version identifier at domain boundaries. */
export const contractVersionId = identifier("ContractVersionId");
/** Identifies a contract version when linking domain records. */
export type ContractVersionId = z.infer<typeof contractVersionId>;

/** Validates a canonical lowercase approval identifier at domain boundaries. */
export const approvalId = identifier("ApprovalId");
/** Identifies an approval when linking domain records. */
export type ApprovalId = z.infer<typeof approvalId>;

/** Validates a canonical lowercase contract template identifier at domain boundaries. */
export const contractTemplateId = identifier("ContractTemplateId");
/** Identifies a contract template when linking domain records. */
export type ContractTemplateId = z.infer<typeof contractTemplateId>;

/** Validates a canonical lowercase clause identifier at domain boundaries. */
export const clauseId = identifier("ClauseId");
/** Identifies a clause when linking domain records. */
export type ClauseId = z.infer<typeof clauseId>;

/** Validates a canonical lowercase tawtheeq record identifier at domain boundaries. */
export const tawtheeqRecordId = identifier("TawtheeqRecordId");
/** Identifies a tawtheeq record when linking domain records. */
export type TawtheeqRecordId = z.infer<typeof tawtheeqRecordId>;

/** Validates a canonical lowercase discrepancy identifier at domain boundaries. */
export const discrepancyId = identifier("DiscrepancyId");
/** Identifies a discrepancy when linking domain records. */
export type DiscrepancyId = z.infer<typeof discrepancyId>;

/** Validates a canonical lowercase handover identifier at domain boundaries. */
export const handoverId = identifier("HandoverId");
/** Identifies a handover when linking domain records. */
export type HandoverId = z.infer<typeof handoverId>;

/** Validates a canonical lowercase instalment identifier at domain boundaries. */
export const instalmentId = identifier("InstalmentId");
/** Identifies an instalment when linking domain records. */
export type InstalmentId = z.infer<typeof instalmentId>;

/** Validates a canonical lowercase cheque identifier at domain boundaries. */
export const chequeId = identifier("ChequeId");
/** Identifies a cheque when linking domain records. */
export type ChequeId = z.infer<typeof chequeId>;

/** Validates a canonical lowercase payment identifier at domain boundaries. */
export const paymentId = identifier("PaymentId");
/** Identifies a payment when linking domain records. */
export type PaymentId = z.infer<typeof paymentId>;

/** Validates a canonical lowercase allocation identifier at domain boundaries. */
export const allocationId = identifier("AllocationId");
/** Identifies an allocation when linking domain records. */
export type AllocationId = z.infer<typeof allocationId>;

/** Validates a canonical lowercase payment reversal identifier at domain boundaries. */
export const paymentReversalId = identifier("PaymentReversalId");
/** Identifies a payment reversal when linking domain records. */
export type PaymentReversalId = z.infer<typeof paymentReversalId>;

/** Validates a canonical lowercase refund identifier at domain boundaries. */
export const refundId = identifier("RefundId");
/** Identifies a refund when linking domain records. */
export type RefundId = z.infer<typeof refundId>;

/** Validates a canonical lowercase charge identifier at domain boundaries. */
export const chargeId = identifier("ChargeId");
/** Identifies a charge when linking domain records. */
export type ChargeId = z.infer<typeof chargeId>;

/** Validates a canonical lowercase deposit identifier at domain boundaries. */
export const depositId = identifier("DepositId");
/** Identifies a deposit when linking domain records. */
export type DepositId = z.infer<typeof depositId>;

/** Validates a canonical lowercase invoice identifier at domain boundaries. */
export const invoiceId = identifier("InvoiceId");
/** Identifies an invoice when linking domain records. */
export type InvoiceId = z.infer<typeof invoiceId>;

/** Validates a canonical lowercase invoice line identifier at domain boundaries. */
export const invoiceLineId = identifier("InvoiceLineId");
/** Identifies an invoice line when linking domain records. */
export type InvoiceLineId = z.infer<typeof invoiceLineId>;

/** Validates a canonical lowercase credit note identifier at domain boundaries. */
export const creditNoteId = identifier("CreditNoteId");
/** Identifies a credit note when linking domain records. */
export type CreditNoteId = z.infer<typeof creditNoteId>;

/** Validates a canonical lowercase receipt identifier at domain boundaries. */
export const receiptId = identifier("ReceiptId");
/** Identifies a receipt when linking domain records. */
export type ReceiptId = z.infer<typeof receiptId>;

/** Validates a canonical lowercase owner statement identifier at domain boundaries. */
export const ownerStatementId = identifier("OwnerStatementId");
/** Identifies an owner statement when linking domain records. */
export type OwnerStatementId = z.infer<typeof ownerStatementId>;

/** Validates a canonical lowercase owner payout identifier at domain boundaries. */
export const ownerPayoutId = identifier("OwnerPayoutId");
/** Identifies an owner payout when linking domain records. */
export type OwnerPayoutId = z.infer<typeof ownerPayoutId>;

/** Validates a canonical lowercase ticket identifier at domain boundaries. */
export const ticketId = identifier("TicketId");
/** Identifies a ticket when linking domain records. */
export type TicketId = z.infer<typeof ticketId>;

/** Validates a canonical lowercase quote identifier at domain boundaries. */
export const quoteId = identifier("QuoteId");
/** Identifies a quote when linking domain records. */
export type QuoteId = z.infer<typeof quoteId>;

/** Validates a canonical lowercase dispatch identifier at domain boundaries. */
export const dispatchId = identifier("DispatchId");
/** Identifies a dispatch when linking domain records. */
export type DispatchId = z.infer<typeof dispatchId>;

/** Validates a canonical lowercase document identifier at domain boundaries. */
export const documentId = identifier("DocumentId");
/** Identifies a document when linking domain records. */
export type DocumentId = z.infer<typeof documentId>;

/** Validates a canonical lowercase document version identifier at domain boundaries. */
export const documentVersionId = identifier("DocumentVersionId");
/** Identifies a document version when linking domain records. */
export type DocumentVersionId = z.infer<typeof documentVersionId>;

/** Validates a canonical lowercase note identifier at domain boundaries. */
export const noteId = identifier("NoteId");
/** Identifies a note when linking domain records. */
export type NoteId = z.infer<typeof noteId>;

/** Validates a canonical lowercase task identifier at domain boundaries. */
export const taskId = identifier("TaskId");
/** Identifies a task when linking domain records. */
export type TaskId = z.infer<typeof taskId>;

/** Validates a canonical lowercase reminder identifier at domain boundaries. */
export const reminderId = identifier("ReminderId");
/** Identifies a reminder when linking domain records. */
export type ReminderId = z.infer<typeof reminderId>;

/** Validates a canonical lowercase notification identifier at domain boundaries. */
export const notificationId = identifier("NotificationId");
/** Identifies a notification when linking domain records. */
export type NotificationId = z.infer<typeof notificationId>;

/** Validates a canonical lowercase drafted action identifier at domain boundaries. */
export const draftedActionId = identifier("DraftedActionId");
/** Identifies a drafted action when linking domain records. */
export type DraftedActionId = z.infer<typeof draftedActionId>;

/** Validates a canonical lowercase extraction identifier at domain boundaries. */
export const extractionId = identifier("ExtractionId");
/** Identifies an extraction when linking domain records. */
export type ExtractionId = z.infer<typeof extractionId>;

/** Validates a canonical lowercase model call identifier at domain boundaries. */
export const modelCallId = identifier("ModelCallId");
/** Identifies a model call when linking domain records. */
export type ModelCallId = z.infer<typeof modelCallId>;

/** Validates a canonical lowercase audit event identifier at domain boundaries. */
export const auditEventId = identifier("AuditEventId");
/** Identifies an audit event when linking domain records. */
export type AuditEventId = z.infer<typeof auditEventId>;

/** Validates a canonical lowercase entity version identifier at domain boundaries. */
export const entityVersionId = identifier("EntityVersionId");
/** Identifies an entity version when linking domain records. */
export type EntityVersionId = z.infer<typeof entityVersionId>;
