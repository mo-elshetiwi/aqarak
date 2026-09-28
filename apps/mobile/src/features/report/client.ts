import { z } from "zod";
import type {
  ReportUnit,
  UploadBody,
  UploadResponse,
  MediaView,
  IntakeBody,
  IntakeView,
  ConfirmIntakeBody,
  RejectIntakeBody,
  ConfirmResponse,
  TicketsPage,
  TicketView,
  MediaLink,
} from "./contract";

/** I keep server problem identifiers intact at the transport boundary. */
export const reportErrorCodeSchema = z.enum([
  "UNAUTHENTICATED",
  "NOT_FOUND",
  "NOT_AUTHORISED",
  "INVALID_INPUT",
  "INVALID_REQUEST",
  "UPLOAD_ALREADY_COMPLETED",
  "UPLOAD_NOT_READY",
  "LIMIT_EXCEEDED",
  "UNSUPPORTED_TYPE",
  "MEDIA_NOT_READY",
  "MEDIA_IN_USE",
  "UPLOAD_MISMATCH",
  "UPLOAD_NOT_FOUND",
  "STALE_VERSION",
  "EXPIRED",
  "ALREADY_DECIDED",
  "IDEMPOTENCY_KEY_REUSED",
  "unexpected_response",
  "network_unavailable",
  "upload_failed",
  "could_not_load",
]);
export type ReportErrorCode = z.infer<typeof reportErrorCodeSchema>;
/** I expose only closed, translated failure codes to screens. */
export class ReportError extends Error {
  constructor(readonly code: ReportErrorCode) {
    super(code);
    this.name = "ReportError";
  }
}
/** I require the caller to retain a command key across transport retries. */
export interface ReportClient {
  tickets(
    companyId: string,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<TicketsPage>;
  ticket(
    companyId: string,
    ticketId: string,
    signal?: AbortSignal,
  ): Promise<TicketView>;
  mediaLink(
    companyId: string,
    mediaId: string,
    signal?: AbortSignal,
  ): Promise<MediaLink>;
  units(companyId: string, signal?: AbortSignal): Promise<ReportUnit[]>;
  createUpload(
    companyId: string,
    body: UploadBody,
    key: string,
  ): Promise<UploadResponse>;
  putObject(upload: UploadResponse["upload"], bytes: Uint8Array): Promise<void>;
  completeUpload(
    companyId: string,
    mediaId: string,
    body: { expectedVersion: number },
    key: string,
  ): Promise<MediaView>;
  createIntake(
    companyId: string,
    body: IntakeBody,
    key: string,
  ): Promise<IntakeView>;
  getIntake(
    companyId: string,
    intakeId: string,
    signal?: AbortSignal,
  ): Promise<IntakeView>;
  confirmIntake(
    companyId: string,
    intakeId: string,
    body: ConfirmIntakeBody,
    key: string,
  ): Promise<ConfirmResponse>;
  rejectIntake(
    companyId: string,
    intakeId: string,
    body: RejectIntakeBody,
    key: string,
  ): Promise<IntakeView>;
}
let sequence = 0;
/** I use a unique command identifier, never a credential or an entity identifier. */
export function commandKey(): string {
  sequence += 1;
  return `report-${Date.now().toString(36)}-${sequence.toString(36)}-${Math.random().toString(36).slice(2)}`;
}
/** I discard transport exception text before displaying a catalogue message. */
export function asReportError(error: unknown): ReportError {
  return error instanceof ReportError
    ? error
    : new ReportError("could_not_load");
}
