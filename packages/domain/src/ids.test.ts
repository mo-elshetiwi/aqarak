import { describe, it, expect } from "vitest";
import {
  companyId,
  personAccountId,
  membershipId,
  technicianProfileId,
  invitationId,
  ownerId,
  ownershipId,
  ownerMandateId,
  propertyId,
  unitId,
  tenantId,
  occupantId,
  vendorId,
  contractId,
  contractUnitId,
  contractVersionId,
  approvalId,
  contractTemplateId,
  clauseId,
  tawtheeqRecordId,
  discrepancyId,
  handoverId,
  instalmentId,
  chequeId,
  paymentId,
  allocationId,
  paymentReversalId,
  refundId,
  chargeId,
  depositId,
  invoiceId,
  invoiceLineId,
  creditNoteId,
  receiptId,
  ownerStatementId,
  ownerPayoutId,
  ticketId,
  quoteId,
  dispatchId,
  documentId,
  documentVersionId,
  noteId,
  taskId,
  reminderId,
  notificationId,
  draftedActionId,
  extractionId,
  modelCallId,
  auditEventId,
  entityVersionId,
  type CompanyId,
  type ContractId,
} from "./index";

const canonical = "123e4567-e89b-42d3-a456-426614174000";
const identifiers = [
  { name: "companyId", schema: companyId },
  { name: "personAccountId", schema: personAccountId },
  { name: "membershipId", schema: membershipId },
  { name: "technicianProfileId", schema: technicianProfileId },
  { name: "invitationId", schema: invitationId },
  { name: "ownerId", schema: ownerId },
  { name: "ownershipId", schema: ownershipId },
  { name: "ownerMandateId", schema: ownerMandateId },
  { name: "propertyId", schema: propertyId },
  { name: "unitId", schema: unitId },
  { name: "tenantId", schema: tenantId },
  { name: "occupantId", schema: occupantId },
  { name: "vendorId", schema: vendorId },
  { name: "contractId", schema: contractId },
  { name: "contractUnitId", schema: contractUnitId },
  { name: "contractVersionId", schema: contractVersionId },
  { name: "approvalId", schema: approvalId },
  { name: "contractTemplateId", schema: contractTemplateId },
  { name: "clauseId", schema: clauseId },
  { name: "tawtheeqRecordId", schema: tawtheeqRecordId },
  { name: "discrepancyId", schema: discrepancyId },
  { name: "handoverId", schema: handoverId },
  { name: "instalmentId", schema: instalmentId },
  { name: "chequeId", schema: chequeId },
  { name: "paymentId", schema: paymentId },
  { name: "allocationId", schema: allocationId },
  { name: "paymentReversalId", schema: paymentReversalId },
  { name: "refundId", schema: refundId },
  { name: "chargeId", schema: chargeId },
  { name: "depositId", schema: depositId },
  { name: "invoiceId", schema: invoiceId },
  { name: "invoiceLineId", schema: invoiceLineId },
  { name: "creditNoteId", schema: creditNoteId },
  { name: "receiptId", schema: receiptId },
  { name: "ownerStatementId", schema: ownerStatementId },
  { name: "ownerPayoutId", schema: ownerPayoutId },
  { name: "ticketId", schema: ticketId },
  { name: "quoteId", schema: quoteId },
  { name: "dispatchId", schema: dispatchId },
  { name: "documentId", schema: documentId },
  { name: "documentVersionId", schema: documentVersionId },
  { name: "noteId", schema: noteId },
  { name: "taskId", schema: taskId },
  { name: "reminderId", schema: reminderId },
  { name: "notificationId", schema: notificationId },
  { name: "draftedActionId", schema: draftedActionId },
  { name: "extractionId", schema: extractionId },
  { name: "modelCallId", schema: modelCallId },
  { name: "auditEventId", schema: auditEventId },
  { name: "entityVersionId", schema: entityVersionId },
];

describe("entity identifiers", () => {
  it("accepts Cognito account identifiers without RFC variant bits", () => {
    const cognitoSubject = "11111111-1111-7111-f111-111111111111";
    expect(personAccountId.parse(cognitoSubject)).toBe(cognitoSubject);
    expect(companyId.safeParse(cognitoSubject).success).toBe(false);
    expect(personAccountId.safeParse("not-an-account-id").success).toBe(false);
  });
  it.each(identifiers)(
    "accepts canonical lowercase UUIDs for $name",
    ({ schema }) => {
      expect(schema.parse(canonical)).toBe(canonical);
    },
  );
  it.each(identifiers)("refuses uppercase UUIDs for $name", ({ schema }) => {
    expect(schema.safeParse(canonical.toUpperCase()).success).toBe(false);
  });
  it.each([
    "",
    "123",
    "123e4567e89b42d3a456426614174000",
    " 123e4567-e89b-42d3-a456-426614174000",
    "123e4567-e89b-42d3-a456-42661417400g",
  ])("refuses malformed contract identifiers: %s", (value) => {
    expect(contractId.safeParse(value).success).toBe(false);
  });
  it("keeps entity identifier brands distinct at compilation", () => {
    const company: CompanyId = companyId.parse(canonical);
    // @ts-expect-error AC-7: a company identifier cannot identify a contract.
    const contract: ContractId = company;
    expect(contract).toBe(canonical);
  });
});
