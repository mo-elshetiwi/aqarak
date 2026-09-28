import { refuse, type DomainError } from "../errors";
import { ok, type Result } from "../result";
import type {
  TawtheeqPortalStatus,
  TawtheeqWorkflowState,
} from "../vocabulary";
import {
  createAdoptionVersion,
  requiresOwnerReapproval,
  resolveDiscrepancies,
} from "./discrepancies";
import {
  validateRegistrationEvidence,
  type RegisteredDocument,
  type TawtheeqErrorCode,
} from "./evidence";
import type { TawtheeqSnapshot } from "./types";

const portalStatuses: Readonly<
  Record<TawtheeqWorkflowState, TawtheeqPortalStatus>
> = {
  awaiting_registration: "not_started",
  submitted_on_portal: "pending",
  under_review: "pending",
  discrepancies_open: "pending",
  awaiting_owner_reapproval: "pending",
  registered: "registered",
  skipped: "skipped",
  closed: "cancelled",
};

/** Derives portal status from workflow state, including registered renewals. */
export function portalStatusOf(
  state: TawtheeqWorkflowState,
  options: { readonly isRenewal: boolean },
): TawtheeqPortalStatus {
  return state === "registered" && options.isRenewal
    ? "renewed"
    : portalStatuses[state];
}

/** Checks that registration evidence belongs to the current uploaded document version. */
export function linkedRegistrationEvidence(
  state: TawtheeqSnapshot,
): Result<RegisteredDocument, DomainError<TawtheeqErrorCode>> {
  const evidence = validateRegistrationEvidence(
    state.document,
    state.linkedIdentity,
  );
  if (!evidence.ok) return evidence;
  return state.documentVersionId === evidence.value.documentVersionId
    ? evidence
    : refuse("REGISTRATION_EVIDENCE_MISSING", "document_version_id");
}

/** Checks IN11 resolutions and any approval required by the frozen owner gate. */
export function validateRegistration(
  state: TawtheeqSnapshot,
): Result<RegisteredDocument, DomainError<TawtheeqErrorCode>> {
  const evidence = linkedRegistrationEvidence(state);
  if (!evidence.ok) return evidence;
  if (state.discrepancies.length === 0) {
    return state.resolutions.length === 0
      ? evidence
      : refuse("DISCREPANCIES_UNRESOLVED");
  }
  const resolutions = resolveDiscrepancies(
    state.discrepancies,
    state.resolutions.map((item) => ({
      field: item.field,
      choice: item.resolution,
    })),
  );
  if (!resolutions.ok) return resolutions;
  if (
    resolutions.value.some(
      (item) => item.resolution.kind === "cancel_and_reregister",
    )
  )
    return refuse("DISCREPANCIES_UNRESOLVED");
  const manager = state.managerApproval;
  if (
    manager?.slot !== "manager" ||
    manager.kind !== "contract_approval" ||
    manager.status !== "approved" ||
    manager.subjectHash !== state.subjectHash ||
    manager.approverAccountId !== manager.sessionAccountId
  )
    return refuse("REGISTRATION_EVIDENCE_MISSING", "manager_confirmation");
  const owner = validateOwnerReapproval(state);
  return owner.ok ? evidence : owner;
}

function validateOwnerReapproval(
  state: TawtheeqSnapshot,
): Result<void, DomainError<TawtheeqErrorCode>> {
  if (!requiresOwnerReapproval(state.frozenOwnerGate, state.resolutions))
    return ok(undefined);
  const owner = state.ownerApproval;
  if (
    owner?.slot !== "owner" ||
    owner.kind !== "owner_reapproval" ||
    owner.status !== "approved" ||
    owner.subjectHash !== state.subjectHash ||
    owner.approverAccountId !== state.ownerAccountId ||
    owner.approverAccountId !== owner.sessionAccountId ||
    owner.approverAccountId === state.managerApproval?.approverAccountId
  )
    return refuse("OWNER_REAPPROVAL_REQUIRED");
  return ok(undefined);
}

/** Answers whether the complete adoption approval set permits moving the current version. */
export function mayMoveCurrentVersion(state: TawtheeqSnapshot): boolean {
  if (
    state.contractStatus !== "concluded" ||
    state.candidateVersion?.contentHash !== state.subjectHash ||
    state.subjectHash === state.contractContentHash
  )
    return false;
  if (!state.resolutions.some((item) => item.resolution.kind === "adopt"))
    return false;
  const version = createAdoptionVersion(
    state.priorValues,
    state.resolutions,
    state.subjectHash,
  );
  if (
    !version.ok ||
    JSON.stringify(version.value) !== JSON.stringify(state.candidateVersion)
  )
    return false;
  return validateRegistration(state).ok;
}
