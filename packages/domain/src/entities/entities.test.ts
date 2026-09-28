import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import * as ids from "../ids";
import { basisPoints, fils, vatFils } from "../money";
import { localDate, utcInstant } from "../time";
import * as records from "./index";

const uuid = "123e4567-e89b-42d3-a456-426614174000";
const otherUuid = "123e4567-e89b-42d3-a456-426614174001";
const digest = "a".repeat(64);
const date = localDate.parse("2026-01-01");
const instant = utcInstant.parse("2026-01-01T00:00:00Z");
const audit = {
  version: 1,
  createdAt: instant,
  createdBy: null,
  updatedAt: null,
  updatedBy: null,
};
function standard<Id>(id: Id) {
  return { ...audit, id, companyId: ids.companyId.parse(uuid) };
}

const company: records.CompanyRecord = {
  ...standard(ids.companyId.parse(uuid)),
  kind: "management_company",
  legalNameEn: "Fictional Company",
  legalNameAr: "شركة تجريبية",
  tradeLicenceNo: "DEMO-001",
  trn: null,
  defaultOwnerGate: true,
  isDemo: true,
};

const personAccount: records.PersonAccountRecord = {
  ...audit,
  id: ids.personAccountId.parse(uuid),
  authSubject: "fictional-subject",
  email: "person@example.test",
  displayName: "Fictional Person",
  preferredLanguage: "en",
};

const membership: records.MembershipRecord = {
  ...standard(ids.membershipId.parse(uuid)),
  accountId: ids.personAccountId.parse(uuid),
  isManager: true,
  isTechnician: false,
  isCompanyAdministrator: false,
  isAccountant: false,
  status: "active",
};

const technicianProfile: records.TechnicianProfileRecord = {
  ...standard(ids.technicianProfileId.parse(uuid)),
  membershipId: ids.membershipId.parse(uuid),
  vendorId: null,
  skills: ["ac"],
  phoneE164: "+971500000001",
};

const invitation: records.InvitationRecord = {
  ...standard(ids.invitationId.parse(uuid)),
  kind: "staff",
  email: "invite@example.test",
  targetId: null,
  tokenHash: digest,
  sentAt: utcInstant.parse("2026-01-01T00:00:00Z"),
  expiresAt: utcInstant.parse("2026-01-08T00:00:00Z"),
  status: "pending",
};

const owner: records.OwnerRecord = {
  ...standard(ids.ownerId.parse(uuid)),
  fullNameEn: "Fictional Owner",
  fullNameAr: "مالك تجريبي",
  eidNumber: null,
  passportNo: null,
  email: "owner@example.test",
  phoneE164: "+971500000001",
  preferredLanguage: "en",
  bankName: null,
  accountHolder: null,
  iban: null,
  linkedAccountId: null,
  statementLockedThrough: null,
};

const tenant: records.TenantRecord = {
  ...standard(ids.tenantId.parse(uuid)),
  kind: "individual",
  nameEn: "Fictional Tenant",
  nameAr: "مستأجر تجريبي",
  eidNumber: "000000000000000",
  passportNo: null,
  tradeLicenceNo: null,
  signatoryNameEn: null,
  signatoryNameAr: null,
  signatoryEidNumber: null,
  email: "tenant@example.test",
  phoneE164: "+971500000001",
  preferredLanguage: "en",
  linkedAccountId: null,
};

const occupant: records.OccupantRecord = {
  ...standard(ids.occupantId.parse(uuid)),
  contractVersionId: ids.contractVersionId.parse(uuid),
  fullName: "Fictional Occupant",
  relationship: "child",
  eidNumber: null,
};

const vendor: records.VendorRecord = {
  ...standard(ids.vendorId.parse(uuid)),
  nameEn: "Fictional Vendor",
  nameAr: "مورد تجريبي",
  tradeLicenceNo: null,
  email: null,
  phoneE164: "+971500000001",
  categories: ["ac"],
};

const property: records.PropertyRecord = {
  ...standard(ids.propertyId.parse(uuid)),
  nameEn: "Fictional Property",
  nameAr: "عقار تجريبي",
  kind: "building",
  areaEn: null,
  areaAr: null,
  plotNo: null,
  titleDeedNo: null,
  onwaniAddress: null,
  ownerGateOverride: null,
};

const unit: records.UnitRecord = {
  ...standard(ids.unitId.parse(uuid)),
  propertyId: ids.propertyId.parse(uuid),
  unitNo: "DEMO-1",
  untNumber: "DEMO-UNT-1",
  kind: "apartment",
  use: "residential",
  bedrooms: 0,
  areaSqm: null,
  status: "vacant",
  blockReason: null,
};

const ownership: records.OwnershipRecord = {
  ...standard(ids.ownershipId.parse(uuid)),
  ownerId: ids.ownerId.parse(uuid),
  propertyId: ids.propertyId.parse(uuid),
  shareBp: basisPoints.parse(10000),
  isRepresentative: true,
};

const ownerMandate: records.OwnerMandateRecord = {
  ...standard(ids.ownerMandateId.parse(uuid)),
  ownerId: ids.ownerId.parse(uuid),
  leaseAuthority: true,
  ownerGate: null,
  costThresholdFils: null,
  emergencyLimitFils: null,
  feeBp: basisPoints.parse(500),
  startsOn: localDate.parse("2026-01-01"),
  endsOn: null,
  status: "active",
};

const contract: records.ContractRecord = {
  ...standard(ids.contractId.parse(uuid)),
  contractNo: "DEMO-C-1",
  tenantId: ids.tenantId.parse(uuid),
  status: "draft",
  origin: "app",
  cancelKind: null,
  cancelReason: null,
  endReason: null,
  renewalOfId: null,
  revisionOfId: null,
  currentVersionId: null,
};

const contractUnit: records.ContractUnitRecord = {
  ...standard(ids.contractUnitId.parse(uuid)),
  contractId: ids.contractId.parse(uuid),
  unitId: ids.unitId.parse(uuid),
  occupancyFrom: localDate.parse("2026-01-01"),
  occupancyTo: localDate.parse("2026-12-31"),
  blocksUnit: true,
};

const contractVersion: records.ContractVersionRecord = {
  ...standard(ids.contractVersionId.parse(uuid)),
  contractId: ids.contractId.parse(uuid),
  versionNo: 1,
  kind: "standard",
  termStart: localDate.parse("2026-01-01"),
  termEnd: localDate.parse("2027-01-01"),
  graceDays: 0,
  annualRentFils: fils.parse(100000),
  totalFils: fils.parse(100000),
  depositFils: fils.parse(0),
  vatBp: basisPoints.parse(0),
  services: [],
  templateCode: "DEMO",
  templateVersion: 1,
  renderedBodySha256: null,
  contentHash: null,
  frozenOwnerGate: null,
  submittedAt: null,
};

const contractTemplate: records.ContractTemplateRecord = {
  ...standard(ids.contractTemplateId.parse(uuid)),
  companyId: null,
  code: "DEMO",
  templateVersion: 1,
  bodySha256: digest,
  status: "active",
};

const clause: records.ClauseRecord = {
  ...standard(ids.clauseId.parse(uuid)),
  companyId: null,
  clauseKey: "demo",
  category: "general",
  textEn: "Fictional clause",
  textAr: "بند تجريبي",
  comment: null,
};

const approval: records.ApprovalRecord = {
  ...standard(ids.approvalId.parse(uuid)),
  subjectType: "contract_version",
  subjectId: uuid,
  slot: "manager",
  kind: "contract_approval",
  approverAccountId: null,
  onBehalfOfPartyId: null,
  subjectHash: digest,
  status: "requested",
  reason: null,
};

const tawtheeq: records.TawtheeqRecord = {
  ...standard(ids.tawtheeqRecordId.parse(uuid)),
  contractId: ids.contractId.parse(uuid),
  path: "normal",
  workflowState: "awaiting_registration",
  tawtheeqNumber: null,
  registeredOn: null,
  tawtheeqDocumentVersionId: null,
  skipReason: null,
};

const discrepancy: records.DiscrepancyRecord = {
  ...standard(ids.discrepancyId.parse(uuid)),
  tawtheeqRecordId: ids.tawtheeqRecordId.parse(uuid),
  documentVersionId: ids.documentVersionId.parse(uuid),
  fieldKey: "rent",
  appValue: { nested: [null, true, 1, "demo"] },
  tawtheeqValue: null,
  class: "material",
  resolution: null,
  reason: null,
  status: "open",
};

const handover: records.HandoverRecord = {
  ...standard(ids.handoverId.parse(uuid)),
  contractId: ids.contractId.parse(uuid),
  unitId: ids.unitId.parse(uuid),
  kind: "move_in",
  occurredOn: localDate.parse("2026-01-01"),
  meterReadings: { water: "001.25" },
};

const instalment: records.InstalmentRecord = {
  ...standard(ids.instalmentId.parse(uuid)),
  contractVersionId: ids.contractVersionId.parse(uuid),
  seqNo: 1,
  dueOn: localDate.parse("2026-01-01"),
  amountFils: fils.parse(10000),
  vatFils: fils.parse(0),
  status: "open",
};

const cheque: records.ChequeRecord = {
  ...standard(ids.chequeId.parse(uuid)),
  instalmentId: null,
  chequeNo: "DEMO-CHEQUE",
  bankName: "Fictional Bank",
  drawerName: "Fictional Drawer",
  chequeDate: localDate.parse("2026-01-01"),
  amountFils: fils.parse(10000),
  status: "pending",
  replacesChequeId: null,
  depositedOn: null,
};

const payment: records.PaymentRecord = {
  ...standard(ids.paymentId.parse(uuid)),
  contractId: ids.contractId.parse(uuid),
  method: "cash",
  amountFils: fils.parse(10000),
  receivedOn: localDate.parse("2026-01-01"),
  source: "app",
  externalIssuer: null,
  externalReceiptNo: null,
  chequeId: null,
  status: "recorded",
};

const allocation: records.AllocationRecord = {
  ...standard(ids.allocationId.parse(uuid)),
  paymentId: ids.paymentId.parse(uuid),
  instalmentId: ids.instalmentId.parse(uuid),
  chargeId: null,
  amountFils: fils.parse(10000),
  status: "active",
};

const paymentReversal: records.PaymentReversalRecord = {
  ...standard(ids.paymentReversalId.parse(uuid)),
  paymentId: ids.paymentId.parse(uuid),
  reasonCode: "recorded_in_error",
  reason: "Fictional correction",
};

const refund: records.RefundRecord = {
  ...standard(ids.refundId.parse(uuid)),
  paymentId: ids.paymentId.parse(uuid),
  amountFils: fils.parse(100),
  reason: "Fictional refund",
};

const charge: records.ChargeRecord = {
  ...standard(ids.chargeId.parse(uuid)),
  contractId: ids.contractId.parse(uuid),
  ticketId: null,
  kind: "fee",
  payer: "tenant",
  amountFils: fils.parse(10000),
  vatFils: fils.parse(0),
  status: "open",
};

const deposit: records.DepositRecord = {
  ...standard(ids.depositId.parse(uuid)),
  contractId: ids.contractId.parse(uuid),
  amountFils: fils.parse(10000),
  status: "expected",
  deductions: [],
  refundDueOn: null,
  carriedToContractId: null,
};

const invoice: records.InvoiceRecord = {
  ...standard(ids.invoiceId.parse(uuid)),
  series: "INV",
  number: null,
  isTaxInvoice: false,
  issuerTrn: null,
  recipientType: "tenant",
  recipientId: uuid,
  recipientTrn: null,
  issueDate: null,
  supplyDate: null,
  totalFils: fils.parse(10000),
  vatFils: fils.parse(0),
  status: "draft",
  pdfDocumentVersionId: null,
};

const invoiceLine: records.InvoiceLineRecord = {
  ...standard(ids.invoiceLineId.parse(uuid)),
  invoiceId: ids.invoiceId.parse(uuid),
  instalmentId: ids.instalmentId.parse(uuid),
  chargeId: null,
  descriptionEn: "Fictional rent",
  descriptionAr: "إيجار تجريبي",
  amountFils: fils.parse(10000),
  vatBp: basisPoints.parse(500),
  vatFils: fils.parse(500),
};

const creditNote: records.CreditNoteRecord = {
  ...standard(ids.creditNoteId.parse(uuid)),
  invoiceId: ids.invoiceId.parse(uuid),
  number: 1,
  amountFils: fils.parse(100),
  vatFils: fils.parse(0),
  reason: "Fictional adjustment",
  pdfDocumentVersionId: null,
};

const receipt: records.ReceiptRecord = {
  ...standard(ids.receiptId.parse(uuid)),
  paymentId: ids.paymentId.parse(uuid),
  number: 1,
  status: "issued",
  voidReason: null,
  pdfDocumentVersionId: null,
};

const ownerStatement: records.OwnerStatementRecord = {
  ...standard(ids.ownerStatementId.parse(uuid)),
  ownerId: ids.ownerId.parse(uuid),
  periodStart: localDate.parse("2026-01-01"),
  periodEnd: localDate.parse("2026-01-31"),
  openingFils: fils.parse(-100),
  collectionsFils: fils.parse(1000),
  feesFils: fils.parse(100),
  expensesFils: fils.parse(100),
  payoutsFils: fils.parse(800),
  closingFils: fils.parse(-100),
  number: null,
  status: "draft",
};

const ownerPayout: records.OwnerPayoutRecord = {
  ...standard(ids.ownerPayoutId.parse(uuid)),
  ownerId: ids.ownerId.parse(uuid),
  amountFils: fils.parse(100),
  paidOn: localDate.parse("2026-01-01"),
  method: "transfer",
  reference: "DEMO-PAYOUT",
  statementId: null,
};

const ticket: records.TicketRecord = {
  ...standard(ids.ticketId.parse(uuid)),
  unitId: ids.unitId.parse(uuid),
  reportedByAccountId: ids.personAccountId.parse(uuid),
  category: "ac",
  priority: "routine",
  safetyCritical: false,
  status: "reported",
  payer: null,
  descriptionEn: "Fictional issue",
  descriptionAr: null,
  rating: null,
  linkedTicketId: null,
};

const quote: records.QuoteRecord = {
  ...standard(ids.quoteId.parse(uuid)),
  ticketId: ids.ticketId.parse(uuid),
  vendorId: ids.vendorId.parse(uuid),
  technicianProfileId: null,
  amountFils: fils.parse(10000),
  vatFils: fils.parse(0),
  status: "requested",
};

const dispatch: records.DispatchRecord = {
  ...standard(ids.dispatchId.parse(uuid)),
  ticketId: ids.ticketId.parse(uuid),
  technicianProfileId: ids.technicianProfileId.parse(uuid),
  vendorId: null,
  visitFrom: utcInstant.parse("2026-01-01T00:00:00Z"),
  visitTo: utcInstant.parse("2026-01-01T01:00:00Z"),
  status: "assigned",
  emergencyRuleUsed: false,
  contactAttempts: [],
};

const document: records.DocumentRecord = {
  ...standard(ids.documentId.parse(uuid)),
  subjectType: "contract_version",
  subjectId: uuid,
  docType: "contract",
  title: "Fictional Document",
  sensitivity: "general",
  currentVersionId: null,
};

const documentVersion: records.DocumentVersionRecord = {
  ...standard(ids.documentVersionId.parse(uuid)),
  documentId: ids.documentId.parse(uuid),
  versionNo: 1,
  bucket: "fictional-documents",
  s3Key: "company/123e4567-e89b-42d3-a456-426614174000/demo.pdf",
  s3VersionId: null,
  sha256: digest,
  byteSize: 1,
  contentType: "application/pdf",
  processingStatus: "awaiting_upload",
  reviewStatus: "pending_review",
  scanResult: null,
  scanEventId: null,
  issueDate: null,
  expiryDate: null,
  rejectReason: null,
  uploadedVia: "web_form",
};

const note: records.NoteRecord = {
  ...standard(ids.noteId.parse(uuid)),
  subjectType: "contract",
  subjectId: uuid,
  body: "Fictional note",
  visibility: "staff",
};

const task: records.TaskRecord = {
  ...standard(ids.taskId.parse(uuid)),
  subjectType: "contract",
  subjectId: uuid,
  title: "Fictional task",
  assigneeAccountId: ids.personAccountId.parse(uuid),
  dueAt: null,
  status: "open",
};

const reminder: records.ReminderRecord = {
  ...standard(ids.reminderId.parse(uuid)),
  subjectType: "contract",
  subjectId: uuid,
  ruleCode: "n1",
  recipientAccountId: ids.personAccountId.parse(uuid),
  fireOn: localDate.parse("2026-01-01"),
  status: "scheduled",
};

const notification: records.NotificationRecord = {
  ...standard(ids.notificationId.parse(uuid)),
  recipientAccountId: ids.personAccountId.parse(uuid),
  channel: "in_app",
  templateCode: "demo",
  language: "en",
  subjectType: null,
  subjectId: null,
  status: "queued",
  readAt: null,
  dedupeKey: "fictional-key",
};

const modelCall: records.ModelCallRecord = {
  ...standard(ids.modelCallId.parse(uuid)),
  purpose: "extraction",
  registryEntry: "fictional-registry",
  promptVersion: "v1",
  inputSha256: digest,
  outputSha256: null,
  latencyMs: 0,
  inputTokens: 0,
  outputTokens: 0,
  costMicroUsd: 0,
  status: "succeeded",
};

const extraction: records.ExtractionRecord = {
  ...standard(ids.extractionId.parse(uuid)),
  documentVersionId: ids.documentVersionId.parse(uuid),
  modelCallId: ids.modelCallId.parse(uuid),
  schemaCode: "demo",
  fields: {
    rent: {
      value: { nested: [1, false, null] },
      confidence: null,
      page: null,
      evidence: null,
    },
  },
};

const draftedAction: records.DraftedActionRecord = {
  ...standard(ids.draftedActionId.parse(uuid)),
  forAccountId: ids.personAccountId.parse(uuid),
  initiator: "person",
  channel: "web_form",
  commandType: "demo",
  payload: { nested: [null, true, 1, "demo"] },
  baseVersions: { "123e4567-e89b-42d3-a456-426614174000": 1 },
  fieldProvenance: { rent: "human_entered" },
  extractionId: null,
  status: "drafting",
  failureReason: null,
};

const entityVersion: records.EntityVersionRecord = {
  ...standard(ids.entityVersionId.parse(uuid)),
  subjectType: "contract",
  subjectId: uuid,
  subjectVersion: 1,
  snapshotSha256: digest,
  txId: "12345678901234567890",
};

const ownerMandateProperty: records.OwnerMandatePropertyRecord = {
  ...standard(records.ownerMandatePropertyRecord.shape.id.parse(uuid)),
  ownerMandateId: ids.ownerMandateId.parse(uuid),
  propertyId: ids.propertyId.parse(uuid),
};
const contractVersionClause: records.ContractVersionClauseRecord = {
  ...standard(records.contractVersionClauseRecord.shape.id.parse(uuid)),
  contractVersionId: ids.contractVersionId.parse(uuid),
  position: 1,
  clauseKey: "fictional",
  source: "library",
  textEn: "Fictional version clause",
  textAr: "بند تجريبي",
  modelTranslated: false,
};

const examples = [
  {
    name: "ownerMandateProperty",
    schema: records.ownerMandatePropertyRecord,
    example: ownerMandateProperty,
  },
  {
    name: "contractVersionClause",
    schema: records.contractVersionClauseRecord,
    example: contractVersionClause,
  },
  { name: "company", schema: records.companyRecord, example: company },
  {
    name: "personAccount",
    schema: records.personAccountRecord,
    example: personAccount,
  },
  { name: "membership", schema: records.membershipRecord, example: membership },
  {
    name: "technicianProfile",
    schema: records.technicianProfileRecord,
    example: technicianProfile,
  },
  { name: "invitation", schema: records.invitationRecord, example: invitation },
  { name: "owner", schema: records.ownerRecord, example: owner },
  { name: "tenant", schema: records.tenantRecord, example: tenant },
  { name: "occupant", schema: records.occupantRecord, example: occupant },
  { name: "vendor", schema: records.vendorRecord, example: vendor },
  { name: "property", schema: records.propertyRecord, example: property },
  { name: "unit", schema: records.unitRecord, example: unit },
  { name: "ownership", schema: records.ownershipRecord, example: ownership },
  {
    name: "ownerMandate",
    schema: records.ownerMandateRecord,
    example: ownerMandate,
  },
  { name: "contract", schema: records.contractRecord, example: contract },
  {
    name: "contractUnit",
    schema: records.contractUnitRecord,
    example: contractUnit,
  },
  {
    name: "contractVersion",
    schema: records.contractVersionRecord,
    example: contractVersion,
  },
  {
    name: "contractTemplate",
    schema: records.contractTemplateRecord,
    example: contractTemplate,
  },
  { name: "clause", schema: records.clauseRecord, example: clause },
  { name: "approval", schema: records.approvalRecord, example: approval },
  { name: "tawtheeq", schema: records.tawtheeqRecord, example: tawtheeq },
  {
    name: "discrepancy",
    schema: records.discrepancyRecord,
    example: discrepancy,
  },
  { name: "handover", schema: records.handoverRecord, example: handover },
  { name: "instalment", schema: records.instalmentRecord, example: instalment },
  { name: "cheque", schema: records.chequeRecord, example: cheque },
  { name: "payment", schema: records.paymentRecord, example: payment },
  { name: "allocation", schema: records.allocationRecord, example: allocation },
  {
    name: "paymentReversal",
    schema: records.paymentReversalRecord,
    example: paymentReversal,
  },
  { name: "refund", schema: records.refundRecord, example: refund },
  { name: "charge", schema: records.chargeRecord, example: charge },
  { name: "deposit", schema: records.depositRecord, example: deposit },
  { name: "invoice", schema: records.invoiceRecord, example: invoice },
  {
    name: "invoiceLine",
    schema: records.invoiceLineRecord,
    example: invoiceLine,
  },
  { name: "creditNote", schema: records.creditNoteRecord, example: creditNote },
  { name: "receipt", schema: records.receiptRecord, example: receipt },
  {
    name: "ownerStatement",
    schema: records.ownerStatementRecord,
    example: ownerStatement,
  },
  {
    name: "ownerPayout",
    schema: records.ownerPayoutRecord,
    example: ownerPayout,
  },
  { name: "ticket", schema: records.ticketRecord, example: ticket },
  { name: "quote", schema: records.quoteRecord, example: quote },
  { name: "dispatch", schema: records.dispatchRecord, example: dispatch },
  { name: "document", schema: records.documentRecord, example: document },
  {
    name: "documentVersion",
    schema: records.documentVersionRecord,
    example: documentVersion,
  },
  { name: "note", schema: records.noteRecord, example: note },
  { name: "task", schema: records.taskRecord, example: task },
  { name: "reminder", schema: records.reminderRecord, example: reminder },
  {
    name: "notification",
    schema: records.notificationRecord,
    example: notification,
  },
  { name: "modelCall", schema: records.modelCallRecord, example: modelCall },
  { name: "extraction", schema: records.extractionRecord, example: extraction },
  {
    name: "draftedAction",
    schema: records.draftedActionRecord,
    example: draftedAction,
  },
  {
    name: "entityVersion",
    schema: records.entityVersionRecord,
    example: entityVersion,
  },
];

describe("stored record contracts", () => {
  it.each(examples)(
    "AC-1 parses the typed $name example",
    ({ schema, example }) => {
      expect(schema.parse(example)).toEqual(example);
    },
  );
  it.each(examples)(
    "AC-3 rejects unknown keys on $name",
    ({ schema, example }) => {
      expect(schema.safeParse({ ...example, unknownKey: true }).success).toBe(
        false,
      );
    },
  );
  it.each(examples)(
    "AC-4 rejects uppercase ids on $name",
    ({ schema, example }) => {
      expect(
        schema.safeParse({ ...example, id: uuid.toUpperCase() }).success,
      ).toBe(false);
    },
  );
  it.each(examples)(
    "requires every nullable and standard key on $name",
    ({ schema, example }) => {
      for (const key of Object.keys(example)) {
        const incomplete = Object.fromEntries(
          Object.entries(example).filter(([field]) => field !== key),
        );
        expect(schema.safeParse(incomplete).success, key).toBe(false);
      }
    },
  );
  it.each(examples)(
    "rejects invalid standard fields on $name",
    ({ schema, example }) => {
      for (const patch of [
        { version: 0 },
        { version: 1.5 },
        { createdAt: "invalid" },
        { createdBy: "invalid" },
        { updatedAt: "invalid" },
        { updatedBy: "invalid" },
      ]) {
        expect(schema.safeParse({ ...example, ...patch }).success).toBe(false);
      }
    },
  );
  it.each(examples)(
    "accepts populated audit fields on $name",
    ({ schema, example }) => {
      expect(
        schema.safeParse({
          ...example,
          createdBy: uuid,
          updatedBy: uuid,
          updatedAt: instant,
        }).success,
      ).toBe(true);
    },
  );
  it.each(examples)(
    "AC-4 rejects floating point money on $name",
    ({ schema, example }) => {
      for (const key of Object.keys(example).filter((field) =>
        field.endsWith("Fils"),
      )) {
        expect(schema.safeParse({ ...example, [key]: 1.5 }).success, key).toBe(
          false,
        );
      }
    },
  );
  it("keeps output types inferred from their schemas", () => {
    expectTypeOf<records.OwnerMandatePropertyRecord>().toEqualTypeOf<
      z.infer<typeof records.ownerMandatePropertyRecord>
    >();
    expectTypeOf<records.ContractVersionClauseRecord>().toEqualTypeOf<
      z.infer<typeof records.contractVersionClauseRecord>
    >();
    expectTypeOf<records.OwnerMandatePropertyRecord["id"]>().not.toEqualTypeOf<
      records.OwnerMandateRecord["id"]
    >();
    expectTypeOf<records.ContractVersionClauseRecord["id"]>().not.toEqualTypeOf<
      records.ClauseRecord["id"]
    >();
    expectTypeOf<records.CompanyRecord>().toEqualTypeOf<
      z.infer<typeof records.companyRecord>
    >();
    expectTypeOf<records.PersonAccountRecord>().toEqualTypeOf<
      z.infer<typeof records.personAccountRecord>
    >();
    expectTypeOf<records.MembershipRecord>().toEqualTypeOf<
      z.infer<typeof records.membershipRecord>
    >();
    expectTypeOf<records.TechnicianProfileRecord>().toEqualTypeOf<
      z.infer<typeof records.technicianProfileRecord>
    >();
    expectTypeOf<records.InvitationRecord>().toEqualTypeOf<
      z.infer<typeof records.invitationRecord>
    >();
    expectTypeOf<records.OwnerRecord>().toEqualTypeOf<
      z.infer<typeof records.ownerRecord>
    >();
    expectTypeOf<records.TenantRecord>().toEqualTypeOf<
      z.infer<typeof records.tenantRecord>
    >();
    expectTypeOf<records.OccupantRecord>().toEqualTypeOf<
      z.infer<typeof records.occupantRecord>
    >();
    expectTypeOf<records.VendorRecord>().toEqualTypeOf<
      z.infer<typeof records.vendorRecord>
    >();
    expectTypeOf<records.PropertyRecord>().toEqualTypeOf<
      z.infer<typeof records.propertyRecord>
    >();
    expectTypeOf<records.UnitRecord>().toEqualTypeOf<
      z.infer<typeof records.unitRecord>
    >();
    expectTypeOf<records.OwnershipRecord>().toEqualTypeOf<
      z.infer<typeof records.ownershipRecord>
    >();
    expectTypeOf<records.OwnerMandateRecord>().toEqualTypeOf<
      z.infer<typeof records.ownerMandateRecord>
    >();
    expectTypeOf<records.ContractRecord>().toEqualTypeOf<
      z.infer<typeof records.contractRecord>
    >();
    expectTypeOf<records.ContractUnitRecord>().toEqualTypeOf<
      z.infer<typeof records.contractUnitRecord>
    >();
    expectTypeOf<records.ContractVersionRecord>().toEqualTypeOf<
      z.infer<typeof records.contractVersionRecord>
    >();
    expectTypeOf<records.ContractTemplateRecord>().toEqualTypeOf<
      z.infer<typeof records.contractTemplateRecord>
    >();
    expectTypeOf<records.ClauseRecord>().toEqualTypeOf<
      z.infer<typeof records.clauseRecord>
    >();
    expectTypeOf<records.ApprovalRecord>().toEqualTypeOf<
      z.infer<typeof records.approvalRecord>
    >();
    expectTypeOf<records.TawtheeqRecord>().toEqualTypeOf<
      z.infer<typeof records.tawtheeqRecord>
    >();
    expectTypeOf<records.DiscrepancyRecord>().toEqualTypeOf<
      z.infer<typeof records.discrepancyRecord>
    >();
    expectTypeOf<records.HandoverRecord>().toEqualTypeOf<
      z.infer<typeof records.handoverRecord>
    >();
    expectTypeOf<records.InstalmentRecord>().toEqualTypeOf<
      z.infer<typeof records.instalmentRecord>
    >();
    expectTypeOf<records.ChequeRecord>().toEqualTypeOf<
      z.infer<typeof records.chequeRecord>
    >();
    expectTypeOf<records.PaymentRecord>().toEqualTypeOf<
      z.infer<typeof records.paymentRecord>
    >();
    expectTypeOf<records.AllocationRecord>().toEqualTypeOf<
      z.infer<typeof records.allocationRecord>
    >();
    expectTypeOf<records.PaymentReversalRecord>().toEqualTypeOf<
      z.infer<typeof records.paymentReversalRecord>
    >();
    expectTypeOf<records.RefundRecord>().toEqualTypeOf<
      z.infer<typeof records.refundRecord>
    >();
    expectTypeOf<records.ChargeRecord>().toEqualTypeOf<
      z.infer<typeof records.chargeRecord>
    >();
    expectTypeOf<records.DepositRecord>().toEqualTypeOf<
      z.infer<typeof records.depositRecord>
    >();
    expectTypeOf<records.InvoiceRecord>().toEqualTypeOf<
      z.infer<typeof records.invoiceRecord>
    >();
    expectTypeOf<records.InvoiceLineRecord>().toEqualTypeOf<
      z.infer<typeof records.invoiceLineRecord>
    >();
    expectTypeOf<records.CreditNoteRecord>().toEqualTypeOf<
      z.infer<typeof records.creditNoteRecord>
    >();
    expectTypeOf<records.ReceiptRecord>().toEqualTypeOf<
      z.infer<typeof records.receiptRecord>
    >();
    expectTypeOf<records.OwnerStatementRecord>().toEqualTypeOf<
      z.infer<typeof records.ownerStatementRecord>
    >();
    expectTypeOf<records.OwnerPayoutRecord>().toEqualTypeOf<
      z.infer<typeof records.ownerPayoutRecord>
    >();
    expectTypeOf<records.TicketRecord>().toEqualTypeOf<
      z.infer<typeof records.ticketRecord>
    >();
    expectTypeOf<records.QuoteRecord>().toEqualTypeOf<
      z.infer<typeof records.quoteRecord>
    >();
    expectTypeOf<records.DispatchRecord>().toEqualTypeOf<
      z.infer<typeof records.dispatchRecord>
    >();
    expectTypeOf<records.DocumentRecord>().toEqualTypeOf<
      z.infer<typeof records.documentRecord>
    >();
    expectTypeOf<records.DocumentVersionRecord>().toEqualTypeOf<
      z.infer<typeof records.documentVersionRecord>
    >();
    expectTypeOf<records.NoteRecord>().toEqualTypeOf<
      z.infer<typeof records.noteRecord>
    >();
    expectTypeOf<records.TaskRecord>().toEqualTypeOf<
      z.infer<typeof records.taskRecord>
    >();
    expectTypeOf<records.ReminderRecord>().toEqualTypeOf<
      z.infer<typeof records.reminderRecord>
    >();
    expectTypeOf<records.NotificationRecord>().toEqualTypeOf<
      z.infer<typeof records.notificationRecord>
    >();
    expectTypeOf<records.ModelCallRecord>().toEqualTypeOf<
      z.infer<typeof records.modelCallRecord>
    >();
    expectTypeOf<records.ExtractionRecord>().toEqualTypeOf<
      z.infer<typeof records.extractionRecord>
    >();
    expectTypeOf<records.DraftedActionRecord>().toEqualTypeOf<
      z.infer<typeof records.draftedActionRecord>
    >();
    expectTypeOf<records.EntityVersionRecord>().toEqualTypeOf<
      z.infer<typeof records.entityVersionRecord>
    >();
  });
});

const rules: {
  name: string;
  schema: z.ZodType;
  example: object;
  valid: Record<string, unknown>[];
  invalid: Record<string, unknown>[];
}[] = [
  {
    name: "membership requires at least one staff role",
    schema: records.membershipRecord,
    example: membership,
    valid: [
      { isManager: false, isTechnician: true },
      { isManager: false, isAccountant: true },
      { isManager: false, isCompanyAdministrator: true },
    ],
    invalid: [{ isManager: false }],
  },
  {
    name: "invitation targets match staff and party kinds",
    schema: records.invitationRecord,
    example: invitation,
    valid: [
      { kind: "owner", targetId: uuid },
      { kind: "tenant", targetId: uuid },
    ],
    invalid: [{ targetId: uuid }, { kind: "owner" }, { kind: "tenant" }],
  },
  {
    name: "invitation expiry is exactly seven days to the microsecond",
    schema: records.invitationRecord,
    example: invitation,
    valid: [
      {
        sentAt: "2026-01-01T00:00:00.123456Z",
        expiresAt: "2026-01-08T00:00:00.123456Z",
      },
      {
        sentAt: "2026-01-01T00:00:00.1Z",
        expiresAt: "2026-01-08T00:00:00.100000Z",
      },
    ],
    invalid: [
      { expiresAt: "2026-01-07T23:59:59Z" },
      { expiresAt: "2026-01-08T00:00:00.000001Z" },
      { sentAt: "invalid" },
      { expiresAt: "invalid" },
    ],
  },
  {
    name: "company tenants require every licence and signatory field",
    schema: records.tenantRecord,
    example: tenant,
    valid: [
      {
        kind: "company",
        eidNumber: null,
        tradeLicenceNo: "DEMO",
        signatoryNameEn: "Fictional Signatory",
        signatoryNameAr: "مفوض تجريبي",
        signatoryEidNumber: "000000000000000",
      },
      { kind: "government", eidNumber: null },
      { kind: "diplomatic", eidNumber: null },
    ],
    invalid: [
      "tradeLicenceNo",
      "signatoryNameEn",
      "signatoryNameAr",
      "signatoryEidNumber",
    ].map((field) => ({
      kind: "company",
      tradeLicenceNo: "DEMO",
      signatoryNameEn: "Fictional Signatory",
      signatoryNameAr: "مفوض تجريبي",
      signatoryEidNumber: "000000000000000",
      [field]: null,
    })),
  },
  {
    name: "individual tenants require either identity document",
    schema: records.tenantRecord,
    example: tenant,
    valid: [
      { eidNumber: null, passportNo: "DEMO-PASSPORT" },
      { passportNo: "DEMO-PASSPORT" },
    ],
    invalid: [{ eidNumber: null }],
  },
  {
    name: "unit block reasons exist exactly when blocked",
    schema: records.unitRecord,
    example: unit,
    valid: [{ status: "blocked", blockReason: "Fictional block" }],
    invalid: [{ status: "blocked" }, { blockReason: "Fictional block" }],
  },
  {
    name: "ownership shares are positive bounded basis points",
    schema: records.ownershipRecord,
    example: ownership,
    valid: [{ shareBp: 1 }],
    invalid: [
      { shareBp: 0 },
      { shareBp: -1 },
      { shareBp: 10001 },
      { shareBp: 1.5 },
    ],
  },
  {
    name: "mandate dates permit equality and an open end",
    schema: records.ownerMandateRecord,
    example: ownerMandate,
    valid: [{ endsOn: date }, { endsOn: "2026-12-31" }],
    invalid: [{ endsOn: "2025-12-31" }],
  },
  {
    name: "contract cancellation fields exist exactly when cancelled",
    schema: records.contractRecord,
    example: contract,
    valid: [
      {
        status: "cancelled",
        cancelKind: "cancelled_draft",
        cancelReason: "Fictional cancellation",
      },
    ],
    invalid: [
      { status: "cancelled" },
      { status: "cancelled", cancelKind: "cancelled_draft" },
      { status: "cancelled", cancelReason: "Fictional cancellation" },
      { cancelKind: "cancelled_draft" },
      { cancelReason: "Fictional cancellation" },
    ],
  },
  {
    name: "contract end reason exists exactly when ended",
    schema: records.contractRecord,
    example: contract,
    valid: [{ status: "ended", endReason: "expired" }],
    invalid: [{ status: "ended" }, { endReason: "expired" }],
  },
  {
    name: "contract renewal and revision are mutually exclusive",
    schema: records.contractRecord,
    example: contract,
    valid: [{ renewalOfId: uuid }, { revisionOfId: uuid }],
    invalid: [{ renewalOfId: uuid, revisionOfId: otherUuid }],
  },
  {
    name: "occupancy ends on or after its start",
    schema: records.contractUnitRecord,
    example: contractUnit,
    valid: [{ occupancyTo: date }],
    invalid: [{ occupancyTo: "2025-12-31" }],
  },
  {
    name: "contract terms end strictly after their start",
    schema: records.contractVersionRecord,
    example: contractVersion,
    valid: [{ termEnd: "2026-01-02" }],
    invalid: [{ termEnd: date }, { termEnd: "2025-12-31" }],
  },
  {
    name: "submission fields are all null or all populated including false",
    schema: records.contractVersionRecord,
    example: contractVersion,
    valid: [
      { contentHash: digest, frozenOwnerGate: false, submittedAt: instant },
      { contentHash: digest, frozenOwnerGate: true, submittedAt: instant },
    ],
    invalid: [
      { contentHash: digest },
      { frozenOwnerGate: false },
      { submittedAt: instant },
      { contentHash: digest, frozenOwnerGate: true },
      { contentHash: digest, submittedAt: instant },
      { frozenOwnerGate: true, submittedAt: instant },
    ],
  },
  {
    name: "returned and voided approvals require reasons",
    schema: records.approvalRecord,
    example: approval,
    valid: [
      {
        status: "returned",
        reason: "Fictional return",
        approverAccountId: uuid,
      },
      { status: "voided", reason: "Fictional void", approverAccountId: uuid },
      { status: "approved", approverAccountId: uuid },
    ],
    invalid: [
      { status: "returned", approverAccountId: uuid },
      { status: "voided", approverAccountId: uuid },
    ],
  },
  {
    name: "approval decisions require an approver",
    schema: records.approvalRecord,
    example: approval,
    valid: [{ approverAccountId: uuid }],
    invalid: [{ status: "approved" }],
  },
  {
    name: "registered Tawtheeq records require all registration evidence",
    schema: records.tawtheeqRecord,
    example: tawtheeq,
    valid: [
      {
        workflowState: "registered",
        tawtheeqNumber: "DEMO-REG",
        registeredOn: date,
        tawtheeqDocumentVersionId: uuid,
      },
    ],
    invalid: [
      "tawtheeqNumber",
      "registeredOn",
      "tawtheeqDocumentVersionId",
    ].map((field) => ({
      workflowState: "registered",
      tawtheeqNumber: "DEMO-REG",
      registeredOn: date,
      tawtheeqDocumentVersionId: uuid,
      [field]: null,
    })),
  },
  {
    name: "skipped Tawtheeq records require a reason",
    schema: records.tawtheeqRecord,
    example: tawtheeq,
    valid: [{ workflowState: "skipped", skipReason: "Fictional skip" }],
    invalid: [{ workflowState: "skipped" }],
  },
  {
    name: "discrepancy resolutions require reasons and resolved status",
    schema: records.discrepancyRecord,
    example: discrepancy,
    valid: [
      {
        resolution: "adopt",
        status: "resolved",
        reason: "Fictional resolution",
      },
    ],
    invalid: [
      { status: "resolved" },
      { resolution: "adopt", reason: "Fictional resolution" },
      { resolution: "adopt", status: "resolved" },
    ],
  },
  {
    name: "IN15 cheque deposit cannot precede its date",
    schema: records.chequeRecord,
    example: cheque,
    valid: [{ depositedOn: date }, { depositedOn: "2026-01-02" }],
    invalid: [{ depositedOn: "2025-12-31" }],
  },
  {
    name: "external payment evidence exists exactly for external sources",
    schema: records.paymentRecord,
    example: payment,
    valid: [
      {
        source: "external",
        externalIssuer: "Fictional Issuer",
        externalReceiptNo: "DEMO-EXT",
      },
    ],
    invalid: [
      { source: "external" },
      { source: "external", externalIssuer: "Fictional Issuer" },
      { source: "external", externalReceiptNo: "DEMO-EXT" },
      { externalIssuer: "Fictional Issuer" },
      { externalReceiptNo: "DEMO-EXT" },
    ],
  },
  {
    name: "cheque payment references exist exactly for cheque methods",
    schema: records.paymentRecord,
    example: payment,
    valid: [{ method: "cheque", chequeId: uuid }],
    invalid: [{ method: "cheque" }, { chequeId: uuid }],
  },
  {
    name: "allocations reference exactly one debt",
    schema: records.allocationRecord,
    example: allocation,
    valid: [{ instalmentId: null, chargeId: uuid }],
    invalid: [{ instalmentId: null }, { chargeId: uuid }],
  },
  {
    name: "charges reference at least one contract or ticket",
    schema: records.chargeRecord,
    example: charge,
    valid: [{ contractId: null, ticketId: uuid }, { ticketId: uuid }],
    invalid: [{ contractId: null }],
  },
  {
    name: "IN17 positive invoice VAT requires an issuer TRN",
    schema: records.invoiceRecord,
    example: invoice,
    valid: [{ vatFils: 1, issuerTrn: "000000000000000" }],
    invalid: [{ vatFils: 1 }],
  },
  {
    name: "invoice number and issue date exist exactly after draft",
    schema: records.invoiceRecord,
    example: invoice,
    valid: [{ status: "issued", number: 1, issueDate: date }],
    invalid: [
      { number: 1 },
      { issueDate: date },
      { status: "issued" },
      { status: "issued", number: 1 },
      { status: "issued", issueDate: date },
    ],
  },
  {
    name: "invoice lines reference exactly one debt",
    schema: records.invoiceLineRecord,
    example: invoiceLine,
    valid: [{ instalmentId: null, chargeId: uuid }],
    invalid: [{ instalmentId: null }, { chargeId: uuid }],
  },
  {
    name: "invoice VAT equals exact per line half up rounding",
    schema: records.invoiceLineRecord,
    example: invoiceLine,
    valid: [
      { amountFils: 10, vatBp: 500, vatFils: 1 },
      { amountFils: 0, vatFils: 0 },
      { vatBp: 0, vatFils: 0 },
    ],
    invalid: [
      { vatFils: 501 },
      { amountFils: -1 },
      { vatBp: -1 },
      { vatBp: 10001 },
      { amountFils: 1.5 },
    ],
  },
  {
    name: "receipt void reason exists exactly when voided",
    schema: records.receiptRecord,
    example: receipt,
    valid: [{ status: "voided", voidReason: "Fictional void" }],
    invalid: [{ status: "voided" }, { voidReason: "Fictional void" }],
  },
  {
    name: "owner statement period is ordered",
    schema: records.ownerStatementRecord,
    example: ownerStatement,
    valid: [{ periodEnd: date }],
    invalid: [{ periodEnd: "2025-12-31" }],
  },
  {
    name: "IN19 statement balances reconcile using exact integer arithmetic",
    schema: records.ownerStatementRecord,
    example: ownerStatement,
    valid: [
      {
        openingFils: Number.MAX_SAFE_INTEGER,
        collectionsFils: 1,
        feesFils: 1,
        expensesFils: 0,
        payoutsFils: 0,
        closingFils: Number.MAX_SAFE_INTEGER,
      },
    ],
    invalid: [
      { closingFils: -99 },
      {
        openingFils: Number.MAX_SAFE_INTEGER,
        collectionsFils: 1,
        feesFils: 0,
        expensesFils: 0,
        payoutsFils: 0,
        closingFils: Number.MAX_SAFE_INTEGER,
      },
      { openingFils: 1.5 },
    ],
  },
  {
    name: "owner statement numbers are assigned after draft",
    schema: records.ownerStatementRecord,
    example: ownerStatement,
    valid: [
      { status: "issued", number: 1 },
      { status: "in_review", number: 1 },
    ],
    invalid: [{ status: "issued" }, { number: 1 }],
  },
  {
    name: "safety critical tickets require emergency priority",
    schema: records.ticketRecord,
    example: ticket,
    valid: [
      { safetyCritical: true, priority: "emergency" },
      { priority: "emergency" },
    ],
    invalid: [
      { safetyCritical: true },
      { safetyCritical: true, priority: "urgent" },
    ],
  },
  {
    name: "tickets require at least one language description",
    schema: records.ticketRecord,
    example: ticket,
    valid: [
      { descriptionEn: null, descriptionAr: "عطل تجريبي" },
      { descriptionAr: "عطل تجريبي" },
    ],
    invalid: [{ descriptionEn: null }],
  },
  {
    name: "quotes reference exactly one provider",
    schema: records.quoteRecord,
    example: quote,
    valid: [{ vendorId: null, technicianProfileId: uuid }],
    invalid: [{ vendorId: null }, { technicianProfileId: uuid }],
  },
  {
    name: "dispatches reference exactly one provider",
    schema: records.dispatchRecord,
    example: dispatch,
    valid: [{ vendorId: uuid, technicianProfileId: null }],
    invalid: [{ technicianProfileId: null }, { vendorId: uuid }],
  },
  {
    name: "dispatch visits end strictly later at microsecond precision",
    schema: records.dispatchRecord,
    example: dispatch,
    valid: [
      {
        visitFrom: "2026-01-01T00:00:00.000001Z",
        visitTo: "2026-01-01T00:00:00.000002Z",
      },
    ],
    invalid: [
      { visitTo: instant },
      { visitTo: "2025-12-31T23:59:59Z" },
      {
        visitFrom: "2026-01-01T00:00:00Z",
        visitTo: "2026-01-01T00:00:00.000000Z",
      },
      { visitFrom: "invalid" },
      { visitTo: "invalid" },
    ],
  },
  {
    name: "emergency dispatches require contact evidence",
    schema: records.dispatchRecord,
    example: dispatch,
    valid: [
      {
        emergencyRuleUsed: true,
        contactAttempts: [
          { at: instant, channel: "phone", outcome: "No answer" },
        ],
      },
    ],
    invalid: [{ emergencyRuleUsed: true }],
  },
  {
    name: "document keys belong to the record company",
    schema: records.documentVersionRecord,
    example: documentVersion,
    valid: [{ s3Key: `company/${uuid}/folder/demo.pdf` }],
    invalid: [
      { s3Key: `company/${otherUuid}/demo.pdf` },
      { s3Key: `company/${uuid}extra/demo.pdf` },
    ],
  },
  {
    name: "document expiry cannot precede issue when both dates exist",
    schema: records.documentVersionRecord,
    example: documentVersion,
    valid: [
      { issueDate: date },
      { expiryDate: date },
      { issueDate: date, expiryDate: date },
      { issueDate: date, expiryDate: "2026-01-02" },
    ],
    invalid: [{ issueDate: date, expiryDate: "2025-12-31" }],
  },
  {
    name: "document reject reason exists exactly when rejected",
    schema: records.documentVersionRecord,
    example: documentVersion,
    valid: [{ reviewStatus: "rejected", rejectReason: "Fictional rejection" }],
    invalid: [
      { reviewStatus: "rejected" },
      { rejectReason: "Fictional rejection" },
    ],
  },
  {
    name: "notification subject type and id are nullable together",
    schema: records.notificationRecord,
    example: notification,
    valid: [{ subjectType: "contract", subjectId: uuid }],
    invalid: [{ subjectType: "contract" }, { subjectId: uuid }],
  },
  {
    name: "drafted action failure reason exists exactly when failed",
    schema: records.draftedActionRecord,
    example: draftedAction,
    valid: [{ status: "failed", failureReason: "Fictional failure" }],
    invalid: [{ status: "failed" }, { failureReason: "Fictional failure" }],
  },
];

const ruleCases = rules.flatMap(({ name, schema, example, valid, invalid }) => [
  ...valid.map((patch, index) => ({
    name: `${name}: valid ${String(index + 1)}`,
    schema,
    example,
    patch,
    success: true,
  })),
  ...invalid.map((patch, index) => ({
    name: `${name}: invalid ${String(index + 1)}`,
    schema,
    example,
    patch,
    success: false,
  })),
]);

it.each(ruleCases)("AC-2 $name", ({ schema, example, patch, success }) => {
  expect(schema.safeParse({ ...example, ...patch }).success).toBe(success);
});

it.each(["iban", "bankName", "accountNo", "accountNumber", "accountHolder"])(
  "IN18 rejects tenant and cheque bank account field %s",
  (key) => {
    expect(
      records.tenantRecord.safeParse({ ...tenant, [key]: "FICTIONAL" }).success,
    ).toBe(false);
    if (key !== "bankName") {
      expect(
        records.chequeRecord.safeParse({ ...cheque, [key]: "FICTIONAL" })
          .success,
      ).toBe(false);
    }
  },
);

it("permits owner bank details and standard templates without a company", () => {
  expect(
    records.ownerRecord.safeParse({
      ...owner,
      bankName: "Fictional Bank",
      accountHolder: "Fictional Owner",
      iban: "FICTIONAL-IBAN",
    }).success,
  ).toBe(true);
  expect(
    records.personAccountRecord.safeParse({ ...personAccount, companyId: uuid })
      .success,
  ).toBe(false);
  expect(
    records.contractTemplateRecord.safeParse({
      ...contractTemplate,
      companyId: uuid,
    }).success,
  ).toBe(true);
  expect(
    records.clauseRecord.safeParse({ ...clause, companyId: uuid }).success,
  ).toBe(true);
});

const fieldCases: {
  name: string;
  schema: z.ZodType;
  example: object;
  patch: Record<string, unknown>;
  success: boolean;
}[] = [
  ...["", "0".repeat(14), "0".repeat(16), "A".repeat(15)].map((eidNumber) => ({
    name: "invalid Emirates ID",
    schema: records.tenantRecord,
    example: tenant,
    patch: { eidNumber },
    success: false,
  })),
  ...["person", "person@", "@example.test"].map((email) => ({
    name: "invalid email",
    schema: records.ownerRecord,
    example: owner,
    patch: { email },
    success: false,
  })),
  ...[
    "+012345678",
    "971500000001",
    "+1234567",
    `+1${"2".repeat(15)}`,
    "+971 500000001",
  ].map((phoneE164) => ({
    name: "invalid phone",
    schema: records.ownerRecord,
    example: owner,
    patch: { phoneE164 },
    success: false,
  })),
  ...["+12345678", `+1${"2".repeat(14)}`].map((phoneE164) => ({
    name: "boundary phone",
    schema: records.ownerRecord,
    example: owner,
    patch: { phoneE164 },
    success: true,
  })),
  ...["", "a".repeat(63), "a".repeat(65), "A".repeat(64), "g".repeat(64)].map(
    (inputSha256) => ({
      name: "invalid SHA-256",
      schema: records.modelCallRecord,
      example: modelCall,
      patch: { inputSha256 },
      success: false,
    }),
  ),
  ...["", "x".repeat(501)].map((legalNameEn) => ({
    name: "invalid bilingual text length",
    schema: records.companyRecord,
    example: company,
    patch: { legalNameEn },
    success: false,
  })),
  {
    name: "maximum bilingual text",
    schema: records.companyRecord,
    example: company,
    patch: { legalNameEn: "x".repeat(500), legalNameAr: "س".repeat(500) },
    success: true,
  },
  {
    name: "invalid company TRN",
    schema: records.companyRecord,
    example: company,
    patch: { trn: "123" },
    success: false,
  },
  {
    name: "empty vendor categories",
    schema: records.vendorRecord,
    example: vendor,
    patch: { categories: [] },
    success: false,
  },
  {
    name: "unknown vendor category",
    schema: records.vendorRecord,
    example: vendor,
    patch: { categories: ["invalid"] },
    success: false,
  },
  ...[-1, 21, 1.5].map((bedrooms) => ({
    name: "invalid bedroom count",
    schema: records.unitRecord,
    example: unit,
    patch: { bedrooms },
    success: false,
  })),
  {
    name: "maximum bedroom count",
    schema: records.unitRecord,
    example: unit,
    patch: { bedrooms: 20, areaSqm: 0.5 },
    success: true,
  },
  ...[0, -1, Number.POSITIVE_INFINITY].map((areaSqm) => ({
    name: "invalid area",
    schema: records.unitRecord,
    example: unit,
    patch: { areaSqm },
    success: false,
  })),
  ...[-1, 366, 1.5].map((graceDays) => ({
    name: "invalid grace days",
    schema: records.contractVersionRecord,
    example: contractVersion,
    patch: { graceDays },
    success: false,
  })),
  {
    name: "maximum grace days",
    schema: records.contractVersionRecord,
    example: contractVersion,
    patch: { graceDays: 365 },
    success: true,
  },
  ...["1e3", "NaN", ".5", "1.", " 1", "1,000"].map((reading) => ({
    name: "invalid meter decimal",
    schema: records.handoverRecord,
    example: handover,
    patch: { meterReadings: { water: reading } },
    success: false,
  })),
  {
    name: "signed exact meter decimal",
    schema: records.handoverRecord,
    example: handover,
    patch: { meterReadings: { water: "-1.250", power: "0" } },
    success: true,
  },
  ...["CN", "RCPT", "STMT"].map((series) => ({
    name: "invoice series is INV only",
    schema: records.invoiceRecord,
    example: invoice,
    patch: { series },
    success: false,
  })),
  ...[0, 6, 1.5].map((rating) => ({
    name: "invalid ticket rating",
    schema: records.ticketRecord,
    example: ticket,
    patch: { rating },
    success: false,
  })),
  ...[1, 5].map((rating) => ({
    name: "boundary ticket rating",
    schema: records.ticketRecord,
    example: ticket,
    patch: { rating },
    success: true,
  })),
  ...["", "x".repeat(4001)].map((body) => ({
    name: "invalid note length",
    schema: records.noteRecord,
    example: note,
    patch: { body },
    success: false,
  })),
  {
    name: "maximum note length",
    schema: records.noteRecord,
    example: note,
    patch: { body: "x".repeat(4000) },
    success: true,
  },
  ...["n0", "n14", "n01", "N1"].map((ruleCode) => ({
    name: "invalid reminder rule",
    schema: records.reminderRecord,
    example: reminder,
    patch: { ruleCode },
    success: false,
  })),
  ...Array.from({ length: 13 }, (_, index) => `n${String(index + 1)}`).map(
    (ruleCode) => ({
      name: "valid reminder rule",
      schema: records.reminderRecord,
      example: reminder,
      patch: { ruleCode },
      success: true,
    }),
  ),
  ...["", "Contract", "contract-version", "_contract", "contract__version"].map(
    (subjectType) => ({
      name: "invalid subject table",
      schema: records.documentRecord,
      example: document,
      patch: { subjectType },
      success: false,
    }),
  ),
  ...["-1", "1.5", "1e3", ""].map((txId) => ({
    name: "invalid transaction digits",
    schema: records.entityVersionRecord,
    example: entityVersion,
    patch: { txId },
    success: false,
  })),
  ...["latencyMs", "inputTokens", "outputTokens", "costMicroUsd"].flatMap(
    (field) =>
      [-1, 1.5, Number.MAX_SAFE_INTEGER + 1].map((value) => ({
        name: `invalid model metric ${field}`,
        schema: records.modelCallRecord,
        example: modelCall,
        patch: { [field]: value },
        success: false,
      })),
  ),
  {
    name: "rejects raw model input",
    schema: records.modelCallRecord,
    example: modelCall,
    patch: { input: "raw content" },
    success: false,
  },
  {
    name: "rejects raw contract body",
    schema: records.contractVersionRecord,
    example: contractVersion,
    patch: { renderedBody: "raw content" },
    success: false,
  },
  {
    name: "rejects raw document page text",
    schema: records.documentVersionRecord,
    example: documentVersion,
    patch: { pageText: "raw content" },
    success: false,
  },
  ...["dueOn", "createdAt"].map((field) => ({
    name: "invalid real calendar date",
    schema: records.instalmentRecord,
    example: instalment,
    patch: {
      [field]: field === "dueOn" ? "2026-02-30" : "2026-01-01T00:00:00+04:00",
    },
    success: false,
  })),
];

it.each(fieldCases)(
  "validates scalar boundaries: $name",
  ({ schema, example, patch, success }) => {
    expect(schema.safeParse({ ...example, ...patch }).success).toBe(success);
  },
);

it.each([
  undefined,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  1n,
  () => "invalid",
  new Date(0),
])("rejects non-JSON values in structured record data: %s", (value) => {
  expect(
    records.discrepancyRecord.safeParse({
      ...discrepancy,
      appValue: { nested: [value] },
    }).success,
  ).toBe(false);
  expect(
    records.draftedActionRecord.safeParse({
      ...draftedAction,
      payload: { nested: [value] },
    }).success,
  ).toBe(false);
  expect(
    records.extractionRecord.safeParse({
      ...extraction,
      fields: { rent: { value, confidence: null, page: null, evidence: null } },
    }).success,
  ).toBe(false);
});

it.each([null, [], "text", 1, true])(
  "requires a JSON object for action payload: %s",
  (payload) => {
    expect(
      records.draftedActionRecord.safeParse({ ...draftedAction, payload })
        .success,
    ).toBe(false);
  },
);

it.each([
  { confidence: -0.01 },
  { confidence: 1.01 },
  { page: 0 },
  { page: 1.5 },
  { evidence: "x".repeat(501) },
  { unknownKey: true },
])("validates extraction metadata and strict nested keys: %j", (patch) => {
  expect(
    records.extractionRecord.safeParse({
      ...extraction,
      fields: {
        rent: {
          value: 1,
          confidence: null,
          page: null,
          evidence: null,
          ...patch,
        },
      },
    }).success,
  ).toBe(false);
});

it.each([0, 1])("accepts extraction confidence boundary %s", (confidence) => {
  expect(
    records.extractionRecord.safeParse({
      ...extraction,
      fields: {
        rent: {
          value: [true, null, "demo", {}],
          confidence,
          page: 1,
          evidence: "x".repeat(500),
        },
      },
    }).success,
  ).toBe(true);
});

it.each([0, -1, 1.5])(
  "requires positive integer action base versions: %s",
  (version) => {
    expect(
      records.draftedActionRecord.safeParse({
        ...draftedAction,
        baseVersions: { [uuid]: version },
      }).success,
    ).toBe(false);
  },
);

it("validates action reference keys and provenance vocabulary", () => {
  expect(
    records.draftedActionRecord.safeParse({
      ...draftedAction,
      baseVersions: { invalid: 1 },
    }).success,
  ).toBe(false);
  expect(
    records.draftedActionRecord.safeParse({
      ...draftedAction,
      fieldProvenance: { rent: "invalid" },
    }).success,
  ).toBe(false);
});

it.each([
  { reason: "Fictional deduction", amountFils: 0 },
  { reason: "Fictional deduction", amountFils: 1.5 },
  { reason: "Fictional deduction", amountFils: 1, unknownKey: true },
])("validates positive deductions and strict nested keys: %j", (deduction) => {
  expect(
    records.depositRecord.safeParse({ ...deposit, deductions: [deduction] })
      .success,
  ).toBe(false);
});

it("accepts itemised deductions and rejects unknown contact attempt keys", () => {
  expect(
    records.depositRecord.safeParse({
      ...deposit,
      deductions: [{ reason: "Fictional deduction", amountFils: 1 }],
    }).success,
  ).toBe(true);
  expect(
    records.dispatchRecord.safeParse({
      ...dispatch,
      contactAttempts: [
        {
          at: instant,
          channel: "phone",
          outcome: "No answer",
          unknownKey: true,
        },
      ],
    }).success,
  ).toBe(false);
});

it.each([0, 1, 10, 10001, Number.MAX_SAFE_INTEGER])(
  "retains exact VAT at amount boundary %s",
  (amount) => {
    const amountFils = fils.parse(amount);
    const vatBp = basisPoints.parse(10000);
    expect(
      records.invoiceLineRecord.safeParse({
        ...invoiceLine,
        amountFils,
        vatBp,
        vatFils: vatFils(amountFils, vatBp),
      }).success,
    ).toBe(true);
  },
);

it.each(["textEn", "textAr"])(
  "validates version clause text length for %s",
  (field) => {
    expect(
      records.contractVersionClauseRecord.safeParse({
        ...contractVersionClause,
        [field]: "x".repeat(4000),
      }).success,
    ).toBe(true);
    expect(
      records.contractVersionClauseRecord.safeParse({
        ...contractVersionClause,
        [field]: "x".repeat(4001),
      }).success,
    ).toBe(false);
    expect(
      records.contractVersionClauseRecord.safeParse({
        ...contractVersionClause,
        [field]: "",
      }).success,
    ).toBe(false);
  },
);

it.each(["library", "company", "special"])(
  "accepts version clause source %s",
  (source) => {
    expect(
      records.contractVersionClauseRecord.safeParse({
        ...contractVersionClause,
        source,
      }).success,
    ).toBe(true);
  },
);

it.each([{ position: 0 }, { position: 1.5 }, { source: "invalid" }])(
  "rejects invalid version clause fields: %j",
  (patch) => {
    expect(
      records.contractVersionClauseRecord.safeParse({
        ...contractVersionClause,
        ...patch,
      }).success,
    ).toBe(false);
  },
);

it("covers every public record schema with a typed synthetic example", () => {
  expect(examples).toHaveLength(51);
  expect(new Set(examples.map(({ schema }) => schema))).toEqual(
    new Set(Object.values(records)),
  );
});
