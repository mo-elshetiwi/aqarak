import { z } from "zod";

/** Lists role values for domain validation. */
export const role = z.enum([
  "manager",
  "owner",
  "tenant",
  "technician",
  "company_administrator",
  "accountant",
]);
/** Represents a validated role in domain decisions. */
export type Role = z.infer<typeof role>;

/** Lists staff role values for domain validation. */
export const staffRole = z.enum([
  "manager",
  "technician",
  "company_administrator",
  "accountant",
]);
/** Represents a validated staff role in domain decisions. */
export type StaffRole = z.infer<typeof staffRole>;

/** Lists company kind values for domain validation. */
export const companyKind = z.enum(["management_company", "self_managed_owner"]);
/** Represents a validated company kind in domain decisions. */
export type CompanyKind = z.infer<typeof companyKind>;

/** Lists membership status values for domain validation. */
export const membershipStatus = z.enum([
  "invited",
  "active",
  "suspended",
  "removed",
]);
/** Represents a validated membership status in domain decisions. */
export type MembershipStatus = z.infer<typeof membershipStatus>;

/** Lists invitation kind values for domain validation. */
export const invitationKind = z.enum(["staff", "owner", "tenant"]);
/** Represents a validated invitation kind in domain decisions. */
export type InvitationKind = z.infer<typeof invitationKind>;

/** Lists invitation status values for domain validation. */
export const invitationStatus = z.enum([
  "pending",
  "accepted",
  "expired",
  "revoked",
]);
/** Represents a validated invitation status in domain decisions. */
export type InvitationStatus = z.infer<typeof invitationStatus>;

/** Lists tenant kind values for domain validation. */
export const tenantKind = z.enum([
  "individual",
  "company",
  "government",
  "diplomatic",
]);
/** Represents a validated tenant kind in domain decisions. */
export type TenantKind = z.infer<typeof tenantKind>;

/** Lists owner mandate status values for domain validation. */
export const ownerMandateStatus = z.enum(["active", "expired", "ended"]);
/** Represents a validated owner mandate status in domain decisions. */
export type OwnerMandateStatus = z.infer<typeof ownerMandateStatus>;

/** Lists property kind values for domain validation. */
export const propertyKind = z.enum(["building", "villa", "plot"]);
/** Represents a validated property kind in domain decisions. */
export type PropertyKind = z.infer<typeof propertyKind>;

/** Lists unit use values for domain validation. */
export const unitUse = z.enum(["residential", "commercial"]);
/** Represents a validated unit use in domain decisions. */
export type UnitUse = z.infer<typeof unitUse>;

/** Lists unit kind values for domain validation. */
export const unitKind = z.enum([
  "apartment",
  "villa",
  "townhouse",
  "office",
  "shop",
  "warehouse",
  "other",
]);
/** Represents a validated unit kind in domain decisions. */
export type UnitKind = z.infer<typeof unitKind>;

/** Lists unit status values for domain validation. */
export const unitStatus = z.enum([
  "vacant",
  "listed",
  "reserved",
  "occupied",
  "notice_given",
  "under_maintenance",
  "blocked",
]);
/** Represents a validated unit status in domain decisions. */
export type UnitStatus = z.infer<typeof unitStatus>;

/** Lists occupant relationship values for domain validation. */
export const occupantRelationship = z.enum([
  "spouse",
  "child",
  "parent",
  "relative",
  "domestic_worker",
  "other",
]);
/** Represents a validated occupant relationship in domain decisions. */
export type OccupantRelationship = z.infer<typeof occupantRelationship>;

/** Lists contract status values for domain validation. */
export const contractStatus = z.enum([
  "draft",
  "awaiting_owner_approval",
  "awaiting_tenant_acceptance",
  "concluded",
  "ended",
  "cancelled",
]);
/** Represents a validated contract status in domain decisions. */
export type ContractStatus = z.infer<typeof contractStatus>;

/** Lists contract origin values for domain validation. */
export const contractOrigin = z.enum(["app", "retroactive"]);
/** Represents a validated contract origin in domain decisions. */
export type ContractOrigin = z.infer<typeof contractOrigin>;

/** Lists contract cancel kind values for domain validation. */
export const contractCancelKind = z.enum([
  "withdrawn_by_manager",
  "returned_by_owner",
  "returned_by_tenant",
  "cancelled_draft",
]);
/** Represents a validated contract cancel kind in domain decisions. */
export type ContractCancelKind = z.infer<typeof contractCancelKind>;

/** Lists contract end reason values for domain validation. */
export const contractEndReason = z.enum([
  "expired",
  "renewed",
  "terminated_by_notice",
  "terminated_by_agreement",
  "terminated_by_court_order",
  "cancelled_on_portal",
]);
/** Represents a validated contract end reason in domain decisions. */
export type ContractEndReason = z.infer<typeof contractEndReason>;

/** Lists contract version kind values for domain validation. */
export const contractVersionKind = z.enum(["standard", "tawtheeq_adoption"]);
/** Represents a validated contract version kind in domain decisions. */
export type ContractVersionKind = z.infer<typeof contractVersionKind>;

/** Lists derived contract term phases for domain validation. */
export const termPhase = z.enum([
  "upcoming",
  "current",
  "renewal_window",
  "notice_deadline_passed",
  "holding_over",
]);
/** Represents a validated term phase in domain decisions. */
export type TermPhase = z.infer<typeof termPhase>;

/** Lists approval slot values for domain validation. */
export const approvalSlot = z.enum(["manager", "owner", "tenant"]);
/** Represents a validated approval slot in domain decisions. */
export type ApprovalSlot = z.infer<typeof approvalSlot>;

/** Lists approval kind values for domain validation. */
export const approvalKind = z.enum([
  "contract_approval",
  "owner_reapproval",
  "skip_confirmation",
  "cost_approval",
  "retroactive_confirmation",
]);
/** Represents a validated approval kind in domain decisions. */
export type ApprovalKind = z.infer<typeof approvalKind>;

/** Lists approval status values for domain validation. */
export const approvalStatus = z.enum([
  "requested",
  "approved",
  "returned",
  "voided",
]);
/** Represents a validated approval status in domain decisions. */
export type ApprovalStatus = z.infer<typeof approvalStatus>;

/** Lists tawtheeq path values for domain validation. */
export const tawtheeqPath = z.enum(["normal", "skip", "retroactive"]);
/** Represents a validated tawtheeq path in domain decisions. */
export type TawtheeqPath = z.infer<typeof tawtheeqPath>;

/** Lists tawtheeq workflow state values for domain validation. */
export const tawtheeqWorkflowState = z.enum([
  "awaiting_registration",
  "submitted_on_portal",
  "under_review",
  "discrepancies_open",
  "awaiting_owner_reapproval",
  "registered",
  "skipped",
  "closed",
]);
/** Represents a validated tawtheeq workflow state in domain decisions. */
export type TawtheeqWorkflowState = z.infer<typeof tawtheeqWorkflowState>;

/** Lists tawtheeq portal status values for domain validation. */
export const tawtheeqPortalStatus = z.enum([
  "not_started",
  "pending",
  "registered",
  "renewed",
  "skipped",
  "cancelled",
]);
/** Represents a validated tawtheeq portal status in domain decisions. */
export type TawtheeqPortalStatus = z.infer<typeof tawtheeqPortalStatus>;

/** Lists discrepancy class values for domain validation. */
export const discrepancyClass = z.enum(["identity", "material", "minor"]);
/** Represents a validated discrepancy class in domain decisions. */
export type DiscrepancyClass = z.infer<typeof discrepancyClass>;

/** Lists discrepancy resolution values for domain validation. */
export const discrepancyResolution = z.enum([
  "adopt",
  "cancel_and_reregister",
  "mark_equivalent",
]);
/** Represents a validated discrepancy resolution in domain decisions. */
export type DiscrepancyResolution = z.infer<typeof discrepancyResolution>;

/** Lists discrepancy status values for domain validation. */
export const discrepancyStatus = z.enum(["open", "resolved"]);
/** Represents a validated discrepancy status in domain decisions. */
export type DiscrepancyStatus = z.infer<typeof discrepancyStatus>;

/** Lists handover kind values for domain validation. */
export const handoverKind = z.enum(["move_in", "move_out"]);
/** Represents a validated handover kind in domain decisions. */
export type HandoverKind = z.infer<typeof handoverKind>;

/** Lists instalment status values for domain validation. */
export const instalmentStatus = z.enum([
  "open",
  "partly_paid",
  "paid",
  "waived",
  "cancelled",
]);
/** Represents a validated instalment status in domain decisions. */
export type InstalmentStatus = z.infer<typeof instalmentStatus>;

/** Lists cheque status values for domain validation. */
export const chequeStatus = z.enum([
  "pending",
  "received",
  "deposited",
  "cleared",
  "partly_paid",
  "bounced",
  "replaced",
  "returned_to_drawer",
]);
/** Represents a validated cheque status in domain decisions. */
export type ChequeStatus = z.infer<typeof chequeStatus>;

/** Lists payment method values for domain validation. */
export const paymentMethod = z.enum([
  "cash",
  "transfer",
  "cheque",
  "card_elsewhere",
]);
/** Represents a validated payment method in domain decisions. */
export type PaymentMethod = z.infer<typeof paymentMethod>;

/** Lists payment source values for domain validation. */
export const paymentSource = z.enum(["app", "external"]);
/** Represents a validated payment source in domain decisions. */
export type PaymentSource = z.infer<typeof paymentSource>;

/** Lists payment status values for domain validation. */
export const paymentStatus = z.enum(["recorded", "reversed"]);
/** Represents a validated payment status in domain decisions. */
export type PaymentStatus = z.infer<typeof paymentStatus>;

/** Lists allocation status values for domain validation. */
export const allocationStatus = z.enum(["active", "voided"]);
/** Represents a validated allocation status in domain decisions. */
export type AllocationStatus = z.infer<typeof allocationStatus>;

/** Lists payment reversal reason values for domain validation. */
export const paymentReversalReason = z.enum(["bounced", "recorded_in_error"]);
/** Represents a validated payment reversal reason in domain decisions. */
export type PaymentReversalReason = z.infer<typeof paymentReversalReason>;

/** Lists charge kind values for domain validation. */
export const chargeKind = z.enum([
  "maintenance",
  "utility",
  "penalty",
  "fee",
  "other",
]);
/** Represents a validated charge kind in domain decisions. */
export type ChargeKind = z.infer<typeof chargeKind>;

/** Lists charge payer values for domain validation. */
export const chargePayer = z.enum(["owner", "tenant", "company"]);
/** Represents a validated charge payer in domain decisions. */
export type ChargePayer = z.infer<typeof chargePayer>;

/** Lists charge status values for domain validation. */
export const chargeStatus = z.enum([
  "open",
  "invoiced",
  "settled",
  "waived",
  "cancelled",
]);
/** Represents a validated charge status in domain decisions. */
export type ChargeStatus = z.infer<typeof chargeStatus>;

/** Lists deposit status values for domain validation. */
export const depositStatus = z.enum([
  "expected",
  "held",
  "refund_due",
  "refunded",
  "applied",
  "carried_over",
]);
/** Represents a validated deposit status in domain decisions. */
export type DepositStatus = z.infer<typeof depositStatus>;

/** Lists invoice status values for domain validation. */
export const invoiceStatus = z.enum([
  "draft",
  "issued",
  "partly_paid",
  "paid",
  "credited",
]);
/** Represents a validated invoice status in domain decisions. */
export type InvoiceStatus = z.infer<typeof invoiceStatus>;

/** Lists invoice recipient type values for domain validation. */
export const invoiceRecipientType = z.enum(["tenant", "owner"]);
/** Represents a validated invoice recipient type in domain decisions. */
export type InvoiceRecipientType = z.infer<typeof invoiceRecipientType>;

/** Lists uppercase prefixes for displayed document numbers for domain validation. */
export const numberSeries = z.enum(["INV", "CN", "RCPT", "STMT"]);
/** Represents a validated number series in domain decisions. */
export type NumberSeries = z.infer<typeof numberSeries>;

/** Lists receipt status values for domain validation. */
export const receiptStatus = z.enum(["issued", "voided"]);
/** Represents a validated receipt status in domain decisions. */
export type ReceiptStatus = z.infer<typeof receiptStatus>;

/** Lists owner statement status values for domain validation. */
export const ownerStatementStatus = z.enum([
  "draft",
  "in_review",
  "issued",
  "superseded",
]);
/** Represents a validated owner statement status in domain decisions. */
export type OwnerStatementStatus = z.infer<typeof ownerStatementStatus>;

/** Lists ticket status values for domain validation. */
export const ticketStatus = z.enum([
  "reported",
  "triaged",
  "awaiting_quote",
  "awaiting_cost_approval",
  "scheduled",
  "in_progress",
  "on_hold",
  "work_completed",
  "closed",
  "cancelled",
]);
/** Represents a validated ticket status in domain decisions. */
export type TicketStatus = z.infer<typeof ticketStatus>;

/** Lists ticket category values for domain validation. */
export const ticketCategory = z.enum([
  "ac",
  "plumbing",
  "electrical",
  "appliances",
  "pest_control",
  "cleaning",
  "carpentry",
  "painting",
  "lift",
  "fire_safety",
  "other",
]);
/** Represents a validated ticket category in domain decisions. */
export type TicketCategory = z.infer<typeof ticketCategory>;

/** Lists ticket priority values for domain validation. */
export const ticketPriority = z.enum(["emergency", "urgent", "routine"]);
/** Represents a validated ticket priority in domain decisions. */
export type TicketPriority = z.infer<typeof ticketPriority>;

/** Lists cost payer values for domain validation. */
export const costPayer = z.enum(["owner", "tenant", "company", "split"]);
/** Represents a validated cost payer in domain decisions. */
export type CostPayer = z.infer<typeof costPayer>;

/** Lists quote status values for domain validation. */
export const quoteStatus = z.enum([
  "requested",
  "received",
  "approved",
  "rejected",
]);
/** Represents a validated quote status in domain decisions. */
export type QuoteStatus = z.infer<typeof quoteStatus>;

/** Lists dispatch status values for domain validation. */
export const dispatchStatus = z.enum([
  "assigned",
  "accepted",
  "declined",
  "done",
  "cancelled",
]);
/** Represents a validated dispatch status in domain decisions. */
export type DispatchStatus = z.infer<typeof dispatchStatus>;

/** Lists document type values for domain validation. */
export const documentType = z.enum([
  "emirates_id",
  "passport",
  "title_deed",
  "site_plan",
  "management_agreement",
  "tawtheeq_authorisation",
  "trade_licence",
  "signatory_id",
  "civil_defence_certificate",
  "hassantuk_certificate",
  "floor_plan",
  "maintenance_contract",
  "fire_safety_contract",
  "income_evidence",
  "occupancy_certificate",
  "tawtheeq",
  "contract",
  "receipt",
  "invoice",
  "quote",
  "transfer_slip",
  "cheque_image",
  "portal_summary",
  "photo",
  "voice_note",
  "video",
  "other",
]);
/** Represents a validated document type in domain decisions. */
export type DocumentType = z.infer<typeof documentType>;

/** Lists document sensitivity values for domain validation. */
export const documentSensitivity = z.enum(["identity", "financial", "general"]);
/** Represents a validated document sensitivity in domain decisions. */
export type DocumentSensitivity = z.infer<typeof documentSensitivity>;

/** Lists document processing states written by the pipeline for domain validation. */
export const documentProcessingStatus = z.enum([
  "awaiting_upload",
  "uploaded",
  "scan_clean",
  "scan_rejected",
  "extracting",
  "extracted",
  "extraction_failed",
]);
/** Represents a validated document processing status in domain decisions. */
export type DocumentProcessingStatus = z.infer<typeof documentProcessingStatus>;

/** Lists document review states written by person commands for domain validation. */
export const documentReviewStatus = z.enum([
  "pending_review",
  "accepted",
  "rejected",
  "superseded",
]);
/** Represents a validated document review status in domain decisions. */
export type DocumentReviewStatus = z.infer<typeof documentReviewStatus>;

/** Lists derived document validity states for domain validation. */
export const documentValidity = z.enum(["valid", "expiring_soon", "expired"]);
/** Represents a validated document validity in domain decisions. */
export type DocumentValidity = z.infer<typeof documentValidity>;

/** Lists note visibility values for domain validation. */
export const noteVisibility = z.enum(["staff", "parties"]);
/** Represents a validated note visibility in domain decisions. */
export type NoteVisibility = z.infer<typeof noteVisibility>;

/** Lists task status values for domain validation. */
export const taskStatus = z.enum(["open", "done", "cancelled"]);
/** Represents a validated task status in domain decisions. */
export type TaskStatus = z.infer<typeof taskStatus>;

/** Lists reminder status values for domain validation. */
export const reminderStatus = z.enum(["scheduled", "fired", "dismissed"]);
/** Represents a validated reminder status in domain decisions. */
export type ReminderStatus = z.infer<typeof reminderStatus>;

/** Lists notification channel values for domain validation. */
export const notificationChannel = z.enum(["in_app", "email", "push"]);
/** Represents a validated notification channel in domain decisions. */
export type NotificationChannel = z.infer<typeof notificationChannel>;

/** Lists notification status values for domain validation. */
export const notificationStatus = z.enum(["queued", "sent", "failed"]);
/** Represents a validated notification status in domain decisions. */
export type NotificationStatus = z.infer<typeof notificationStatus>;

/** Lists drafted action status values for domain validation. */
export const draftedActionStatus = z.enum([
  "drafting",
  "ready",
  "committed",
  "rejected",
  "expired",
  "failed",
]);
/** Represents a validated drafted action status in domain decisions. */
export type DraftedActionStatus = z.infer<typeof draftedActionStatus>;

/** Lists initiator values for domain validation. */
export const initiator = z.enum([
  "person",
  "co_worker",
  "pipeline",
  "scheduler",
]);
/** Represents a validated initiator in domain decisions. */
export type Initiator = z.infer<typeof initiator>;

/** Lists channel values for domain validation. */
export const channel = z.enum([
  "web_form",
  "mobile_form",
  "chat",
  "voice",
  "system",
  "import",
]);
/** Represents a validated channel in domain decisions. */
export type Channel = z.infer<typeof channel>;

/** Lists field provenance values for domain validation. */
export const fieldProvenance = z.enum([
  "ai_confirmed",
  "ai_edited",
  "human_entered",
]);
/** Represents a validated field provenance in domain decisions. */
export type FieldProvenance = z.infer<typeof fieldProvenance>;
