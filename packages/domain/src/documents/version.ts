import { refuse, requireReason, type DomainError } from "../errors";
import type { DocumentId, DocumentVersionId } from "../ids";
import { ok, type Result } from "../result";
import type { LocalDate } from "../time";
import type {
  DocumentProcessingStatus,
  DocumentReviewStatus,
  DocumentType,
  Initiator,
} from "../vocabulary";
import type { DocumentsErrorCode } from "./errors";

/** Holds independent machine and person facets for one immutable file version. */
export interface DocumentVersionSnapshot {
  readonly id: DocumentVersionId;
  readonly documentId: DocumentId;
  readonly versionNumber: number;
  readonly documentType: DocumentType;
  readonly expiryDate: LocalDate | null;
  readonly processing_status: DocumentProcessingStatus;
  readonly review_status: DocumentReviewStatus;
  readonly recordedSha256: string;
  readonly recordedByteSize: number;
}
/** Describes pipeline observations and extraction progress. */
export type ProcessingCommand =
  | {
      readonly type: "bytes_arrived";
      readonly sha256: string;
      readonly byteSize: number;
    }
  | { readonly type: "scan_result"; readonly clean: boolean }
  | {
      readonly type:
        | "start_extraction"
        | "extraction_succeeded"
        | "extraction_failed"
        | "retry_extraction";
    };
/** Describes a machine transition and the observation selecting its result. */
export interface ProcessingTransitionRow {
  readonly from: DocumentProcessingStatus;
  readonly command: ProcessingCommand["type"];
  readonly outcome: boolean | null;
  readonly to: DocumentProcessingStatus;
}
/** Defines pipeline transitions without changes to human review. */
export const processingTransitions: readonly ProcessingTransitionRow[] = [
  {
    from: "awaiting_upload",
    command: "bytes_arrived",
    outcome: true,
    to: "uploaded",
  },
  {
    from: "awaiting_upload",
    command: "bytes_arrived",
    outcome: false,
    to: "scan_rejected",
  },
  { from: "uploaded", command: "scan_result", outcome: true, to: "scan_clean" },
  {
    from: "uploaded",
    command: "scan_result",
    outcome: false,
    to: "scan_rejected",
  },
  {
    from: "scan_clean",
    command: "start_extraction",
    outcome: null,
    to: "extracting",
  },
  {
    from: "extracting",
    command: "extraction_succeeded",
    outcome: null,
    to: "extracted",
  },
  {
    from: "extracting",
    command: "extraction_failed",
    outcome: null,
    to: "extraction_failed",
  },
  {
    from: "extraction_failed",
    command: "retry_extraction",
    outcome: null,
    to: "extracting",
  },
];
/** Describes explicit person confirmations, rejection or replacement. */
export type ReviewCommand =
  | {
      readonly type: "accept";
      readonly documentType: DocumentType;
      readonly expiryDate: LocalDate | null;
      readonly typeConfirmed: boolean;
      readonly datesConfirmed: boolean;
    }
  | {
      readonly type: "reject";
      readonly reason: "wrong_type" | "illegible" | null;
    }
  | {
      readonly type: "supersede";
      readonly newerVersion: DocumentVersionSnapshot;
    };
/** Describes one allowed person review transition. */
export interface ReviewTransitionRow {
  readonly from: DocumentReviewStatus;
  readonly command: ReviewCommand["type"];
  readonly to: DocumentReviewStatus;
}
/** Defines human review independently from the machine transition table. */
export const reviewTransitions: readonly ReviewTransitionRow[] = [
  { from: "pending_review", command: "accept", to: "accepted" },
  { from: "pending_review", command: "reject", to: "rejected" },
  { from: "accepted", command: "supersede", to: "superseded" },
];
/** Returns a next version or an explicitly idempotent duplicate delivery. */
export interface DocumentDecision {
  readonly version: DocumentVersionSnapshot;
  readonly no_op: boolean;
  readonly reason: string | null;
}
type Outcome = Result<DocumentDecision, DomainError<DocumentsErrorCode>>;

function processingOutcome(
  state: DocumentVersionSnapshot,
  command: ProcessingCommand,
): boolean | null {
  switch (command.type) {
    case "bytes_arrived":
      return (
        /^[a-f0-9]{64}$/.test(command.sha256) &&
        command.sha256 === state.recordedSha256 &&
        Number.isSafeInteger(command.byteSize) &&
        command.byteSize > 0 &&
        command.byteSize === state.recordedByteSize
      );
    case "scan_result":
      return command.clean;
    case "start_extraction":
    case "extraction_succeeded":
    case "extraction_failed":
    case "retry_extraction":
      return null;
  }
}

/** Applies pipeline observations, marking late scan deliveries as no-ops. */
export function transitionDocumentProcessing(
  state: DocumentVersionSnapshot,
  command: ProcessingCommand,
  actor: Initiator,
): Outcome {
  if (actor !== "pipeline") return refuse("NOT_A_PIPELINE_COMMAND");
  if (
    command.type === "scan_result" &&
    state.processing_status !== "awaiting_upload" &&
    state.processing_status !== "uploaded"
  )
    return ok({ version: state, no_op: true, reason: null });
  const outcome = processingOutcome(state, command);
  const row = processingTransitions.find(
    (entry) =>
      entry.from === state.processing_status &&
      entry.command === command.type &&
      entry.outcome === outcome,
  );
  if (row === undefined) return refuse("INVALID_TRANSITION");
  return ok({
    version: { ...state, processing_status: row.to },
    no_op: false,
    reason: null,
  });
}

/** Identifies machine states with a recorded clean scan. */
export function isScanClean(status: DocumentProcessingStatus): boolean {
  return (
    status === "scan_clean" ||
    status === "extracting" ||
    status === "extracted" ||
    status === "extraction_failed"
  );
}

function supersessionValid(
  state: DocumentVersionSnapshot,
  newer: DocumentVersionSnapshot,
): boolean {
  return (
    newer.documentId === state.documentId &&
    newer.id !== state.id &&
    newer.versionNumber > state.versionNumber &&
    newer.review_status === "accepted" &&
    isScanClean(newer.processing_status)
  );
}

/** Applies only explicit person commands to the review facet under IN7. */
export function transitionDocumentReview(
  state: DocumentVersionSnapshot,
  command: ReviewCommand,
  actor: Initiator,
): Outcome {
  if (actor !== "person") return refuse("NOT_A_PERSON_COMMAND");
  const row = reviewTransitions.find(
    (entry) =>
      entry.from === state.review_status && entry.command === command.type,
  );
  if (row === undefined) return refuse("INVALID_TRANSITION");
  switch (command.type) {
    case "accept":
      if (!isScanClean(state.processing_status))
        return refuse("SCAN_NOT_CLEAN");
      if (!command.typeConfirmed || !command.datesConfirmed)
        return refuse("INVALID_INPUT", "confirmed_fields");
      return ok({
        version: {
          ...state,
          documentType: command.documentType,
          expiryDate: command.expiryDate,
          review_status: row.to,
        },
        no_op: false,
        reason: null,
      });
    case "reject": {
      const reason = requireReason(command.reason);
      if (!reason.ok) return reason;
      return ok({
        version: { ...state, review_status: row.to },
        no_op: false,
        reason: reason.value,
      });
    }
    case "supersede":
      if (!supersessionValid(state, command.newerVersion))
        return refuse("INVALID_INPUT", "newer_version");
      return ok({
        version: { ...state, review_status: row.to },
        no_op: false,
        reason: null,
      });
  }
}
