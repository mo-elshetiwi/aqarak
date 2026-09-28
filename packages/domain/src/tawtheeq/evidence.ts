import { z } from "zod";
import { coreErrorCode, refuse, type DomainError } from "../errors";
import type { DocumentVersionId } from "../ids";
import { ok, type Result } from "../result";
import { localDate, type LocalDate } from "../time";
import type {
  DocumentProcessingStatus,
  DocumentReviewStatus,
} from "../vocabulary";

/** Lists closed refusal codes for registration and discrepancy decisions. */
export const tawtheeqErrorCode = z.enum([
  ...coreErrorCode.options,
  "OWNER_CONFIRMATION_REQUIRED",
  "REGISTRATION_EVIDENCE_MISSING",
  "DISCREPANCIES_UNRESOLVED",
  "OWNER_REAPPROVAL_REQUIRED",
  "MARK_EQUIVALENT_NOT_ALLOWED",
  "IDENTITY_MISMATCH",
  "NOT_NAMED_PARTY",
  "NOT_OWN_SESSION",
  "STALE_SUBJECT_HASH",
  "APPROVER_NOT_DISTINCT",
]);
/** Represents a typed Tawtheeq refusal. */
export type TawtheeqErrorCode = z.infer<typeof tawtheeqErrorCode>;

/** Identifies the linked unit and parties independently of extracted terms. */
export interface RegistrationIdentity {
  readonly unt_number: string;
  readonly owner_id_number: string;
  readonly tenant_id_number: string;
}

/** Carries reviewed evidence from a particular Tawtheeq document version. */
export interface RegisteredDocument {
  readonly documentVersionId: DocumentVersionId;
  readonly processingStatus: DocumentProcessingStatus;
  readonly reviewStatus: DocumentReviewStatus;
  readonly tawtheeqNumber: string | null;
  readonly registeredOn: LocalDate | null;
  readonly identity: RegistrationIdentity;
}

/** Lists identity fields in the order used for deterministic mismatch refusals. */
export const identityFields = [
  "unt_number",
  "owner_id_number",
  "tenant_id_number",
] as const;

/** Finds the first identity mismatch against the linked records. */
export function identityMismatch(
  actual: RegistrationIdentity,
  linked: RegistrationIdentity,
): (typeof identityFields)[number] | undefined {
  return identityFields.find((field) => actual[field] !== linked[field]);
}

const cleanStatuses: readonly DocumentProcessingStatus[] = [
  "scan_clean",
  "extracting",
  "extracted",
  "extraction_failed",
];

/** Checks IN11 document completeness and identity without changing the evidence. */
export function validateRegistrationEvidence(
  document: RegisteredDocument | null,
  linked: RegistrationIdentity,
): Result<RegisteredDocument, DomainError<TawtheeqErrorCode>> {
  if (document === null)
    return refuse("REGISTRATION_EVIDENCE_MISSING", "document_version_id");
  if (
    !cleanStatuses.includes(document.processingStatus) ||
    document.reviewStatus !== "accepted"
  ) {
    return refuse("REGISTRATION_EVIDENCE_MISSING", "registered_document");
  }
  if (
    document.tawtheeqNumber === null ||
    document.tawtheeqNumber.trim() === ""
  ) {
    return refuse("REGISTRATION_EVIDENCE_MISSING", "tawtheeq_number");
  }
  if (!localDate.safeParse(document.registeredOn).success) {
    return refuse("REGISTRATION_EVIDENCE_MISSING", "registered_on");
  }
  const mismatch = identityMismatch(document.identity, linked);
  return mismatch === undefined
    ? ok(document)
    : refuse("IDENTITY_MISMATCH", mismatch);
}
