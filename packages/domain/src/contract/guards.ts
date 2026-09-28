import { refuse, type DomainError } from "../errors";
import { basisPoints, nonNegativeFils, sumFils, vatFils } from "../money";
import { ok, type Result } from "../result";
import { localDate } from "../time";
import type { ApprovalSlot } from "../vocabulary";
import type {
  ContractApproval,
  ContractContext,
  ContractErrorCode,
  ContractSnapshot,
  ContractTerms,
} from "./types";

/** Validates terms before accepting a draft or submitted version. */
export function validateContractTerms(
  terms: ContractTerms,
): Result<void, DomainError<ContractErrorCode>> {
  if (
    terms.unitIds.length === 0 ||
    new Set(terms.unitIds).size !== terms.unitIds.length
  )
    return refuse("INVALID_INPUT", "unit_ids");
  if (
    !localDate.safeParse(terms.termStart).success ||
    !localDate.safeParse(terms.termEnd).success ||
    terms.termEnd < terms.termStart
  )
    return refuse("INVALID_INPUT", "term_end");
  if (!nonNegativeFils.safeParse(terms.totalFils).success)
    return refuse("INVALID_INPUT", "total_fils");
  if (!basisPoints.safeParse(terms.vatBp).success)
    return refuse("INVALID_INPUT", "vat_bp");
  return ok(undefined);
}

/** Applies IN14 using shared exact fils arithmetic without overflowing the safe range. */
export function validateContractSchedule(
  terms: ContractTerms,
): Result<void, DomainError<ContractErrorCode>> {
  const valid = validateContractTerms(terms);
  if (!valid.ok) return valid;
  const seen = new Set<number>();
  for (const instalment of terms.instalments) {
    const field = String(instalment.seqNo);
    if (
      !Number.isSafeInteger(instalment.seqNo) ||
      instalment.seqNo < 1 ||
      seen.has(instalment.seqNo)
    )
      return refuse("INVALID_INPUT", field);
    seen.add(instalment.seqNo);
    if (
      !nonNegativeFils.safeParse(instalment.amountFils).success ||
      !nonNegativeFils.safeParse(instalment.vatFils).success
    )
      return refuse("INVALID_INPUT", field);
    if (instalment.vatFils !== vatFils(instalment.amountFils, terms.vatBp))
      return refuse("SCHEDULE_TOTAL_MISMATCH", field);
  }
  const total = terms.instalments.reduce(
    (value, instalment) => value + BigInt(instalment.amountFils),
    0n,
  );
  if (total > BigInt(Number.MAX_SAFE_INTEGER))
    return refuse("SCHEDULE_TOTAL_MISMATCH", "total_fils");
  return sumFils(
    terms.instalments.map((instalment) => instalment.amountFils),
  ) === terms.totalFils
    ? ok(undefined)
    : refuse("SCHEDULE_TOTAL_MISMATCH", "total_fils");
}

/** Checks inclusive term overlap against every blocking contract on the requested units. */
export function hasContractOverlap(
  id: ContractSnapshot["id"],
  terms: ContractTerms,
  context: ContractContext,
): boolean {
  return context.blockingContracts.some(
    (other) =>
      other.id !== id &&
      other.blocksUnit &&
      terms.termStart <= other.termEnd &&
      other.termStart <= terms.termEnd &&
      terms.unitIds.some((unit) => other.unitIds.includes(unit)),
  );
}

/** Finds an approved slot bound to this content hash and the approver's own session. */
export function approvedSlot(
  state: ContractSnapshot,
  slot: ApprovalSlot,
): ContractApproval | undefined {
  const approvals = state.approvals.filter(
    (approval) => approval.slot === slot && approval.status === "approved",
  );
  if (approvals.length !== 1) return undefined;
  const approval = approvals[0];
  return approval?.subjectHash === state.version.contentHash &&
    approval.kind === "contract_approval" &&
    approval.approverAccountId === approval.sessionAccountId
    ? approval
    : undefined;
}

/** Checks IN8's frozen manager and owner prerequisites before tenant acceptance. */
export function validateAcceptance(
  state: ContractSnapshot,
  context: ContractContext,
): Result<void, DomainError<ContractErrorCode>> {
  const manager = approvedSlot(state, "manager");
  if (manager === undefined || state.version.frozenOwnerGate === null)
    return refuse("APPROVALS_REQUIRED");
  const owner = approvedSlot(state, "owner");
  if (state.version.frozenOwnerGate) {
    if (owner?.approverAccountId !== state.ownerAccountId)
      return refuse("APPROVALS_REQUIRED");
    if (owner.approverAccountId === manager.approverAccountId)
      return refuse("APPROVER_NOT_DISTINCT");
  } else if (
    state.approvals.some(
      (approval) => approval.slot === "owner" && approval.status === "approved",
    )
  ) {
    return refuse("APPROVALS_REQUIRED");
  }
  if (
    context.actor.accountId === manager.approverAccountId ||
    context.actor.accountId === owner?.approverAccountId
  )
    return refuse("APPROVER_NOT_DISTINCT");
  return ok(undefined);
}
