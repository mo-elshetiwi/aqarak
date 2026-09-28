import { z } from "zod";
import { refuse, type DomainError } from "../errors";
import type {
  CompanyId,
  OwnerId,
  PersonAccountId,
  TenantId,
  TechnicianProfileId,
} from "../ids";
import { ok, type Result } from "../result";
import type { Role } from "../vocabulary";
import {
  approvalStepRoles,
  capability,
  permissionMatrix,
  type Capability,
  type PermissionApprovalStep,
  type PermissionLevel,
  type PermissionOperation,
} from "./matrix";

/** Lists authorization refusals without exposing records outside the actor's scope. */
export const permissionsErrorCode = z.enum([
  "NOT_FOUND",
  "NOT_PERMITTED",
  "REQUEST_ONLY",
]);
/** Describes a typed authorization refusal. */
export type PermissionsError = DomainError<
  z.infer<typeof permissionsErrorCode>
>;
/** Supplies roles from an active membership and party links within one company. */
export interface PermissionActor {
  readonly account_id: PersonAccountId;
  readonly company_id: CompanyId;
  readonly roles: readonly Role[];
  readonly owner_ids: readonly OwnerId[];
  readonly tenant_ids: readonly TenantId[];
  readonly technician_profile_id: TechnicianProfileId | null;
}
/** Supplies trusted scope facts; omitted facts never establish access. */
export interface PermissionSubject {
  readonly company_id: CompanyId;
  readonly owner_ids?: readonly OwnerId[];
  readonly tenant_ids?: readonly TenantId[];
  readonly assigned_technician_profile_ids?: readonly TechnicianProfileId[];
  readonly reported_by_account_id?: PersonAccountId;
  readonly approval_step?: PermissionApprovalStep;
}
/** Describes the winning level and the scope that authorized the command. */
export interface PermissionGrant {
  readonly level: PermissionLevel;
  readonly scope: "company" | "own";
}

const personalCapabilities: readonly Capability[] = [
  "ticket_report",
  "notes",
  "tasks_reminders",
  "audit_read",
  "export",
  "co_worker",
];
const levelOperations: Readonly<
  Record<PermissionLevel, readonly PermissionOperation[]>
> = {
  A: ["read", "write"],
  S: ["read", "write"],
  R: ["read"],
  P: ["request"],
  G: ["approve"],
};
const levelOrder: readonly PermissionLevel[] = ["A", "S", "R", "P", "G"];

function isCompanyRole(role: Role): boolean {
  return (
    role === "manager" ||
    role === "company_administrator" ||
    role === "accountant"
  );
}

function ownsSubject(
  actor: PermissionActor,
  role: Role,
  key: Capability,
  subject: PermissionSubject,
): boolean {
  if (
    personalCapabilities.includes(key) &&
    subject.reported_by_account_id === actor.account_id
  )
    return true;
  switch (role) {
    case "owner":
      return (
        subject.owner_ids?.some((id) => actor.owner_ids.includes(id)) ?? false
      );
    case "tenant":
      return (
        subject.tenant_ids?.some((id) => actor.tenant_ids.includes(id)) ?? false
      );
    case "technician":
      return (
        subject.assigned_technician_profile_ids?.some(
          (id) => id === actor.technician_profile_id,
        ) ?? false
      );
    case "manager":
    case "company_administrator":
    case "accountant":
      return false;
  }
}

function scopeFor(
  level: PermissionLevel,
  role: Role,
): PermissionGrant["scope"] {
  return level === "A" ||
    ((level === "R" || level === "G") && isCompanyRole(role))
    ? "company"
    : "own";
}

function eligibleStep(
  level: PermissionLevel,
  role: Role,
  subject: PermissionSubject,
): boolean {
  return (
    level !== "G" ||
    (subject.approval_step !== undefined &&
      approvalStepRoles[subject.approval_step] === role)
  );
}

/** Checks company isolation, the union of role cells, and finally the eligible role's scope. */
export function can(
  actor: PermissionActor,
  operation: PermissionOperation,
  key: Capability,
  subject: PermissionSubject | null,
): Result<PermissionGrant, PermissionsError> {
  // IN1: missing and cross-company records have the same refusal before role inspection.
  if (subject?.company_id !== actor.company_id) return refuse("NOT_FOUND");
  const grants = actor.roles.flatMap((role) =>
    permissionMatrix[key][role].map((level) => ({ role, level })),
  );
  const candidates = grants
    .filter(
      ({ role, level }) =>
        levelOperations[level].includes(operation) &&
        eligibleStep(level, role, subject),
    )
    .toSorted(
      (left, right) =>
        Number(scopeFor(left.level, left.role) === "own") -
        Number(scopeFor(right.level, right.role) === "own"),
    );
  for (const level of levelOrder) {
    for (const candidate of candidates.filter(
      (grant) => grant.level === level,
    )) {
      const scope = scopeFor(level, candidate.role);
      if (
        scope === "company" ||
        ownsSubject(actor, candidate.role, key, subject)
      )
        return ok({ level, scope });
    }
  }
  if (candidates.length > 0) return refuse("NOT_FOUND");
  if (operation === "write" && grants.some(({ level }) => level === "P"))
    return refuse("REQUEST_ONLY");
  return refuse("NOT_PERMITTED");
}

/** Lists navigation capabilities only; command handlers must call can again for every subject. */
export function actorCapabilities(
  actor: PermissionActor,
): readonly Capability[] {
  return capability.options.filter((key) =>
    actor.roles.some((role) => permissionMatrix[key][role].length > 0),
  );
}
