import { z } from "zod";
import { checkExpectedVersion, refuse, requireReason } from "../errors";
import { companyId, membershipId, personAccountId } from "../ids";
import { ok, type Result } from "../result";
import {
  membershipStatus,
  staffRole,
  type MembershipStatus,
} from "../vocabulary";
import type { LifecycleError } from "./errors";

const staffRoles = z.array(staffRole).min(1).readonly();
/** Validates an attributed membership with at least one staff role. */
export const membership = z
  .strictObject({
    id: membershipId,
    account_id: personAccountId,
    company_id: companyId,
    status: membershipStatus,
    staff_roles: staffRoles,
    version: z.int().nonnegative(),
    reason: z.string().nullable(),
  })
  .readonly();
/** Describes a membership whose identity remains present after access is removed. */
export type Membership = z.infer<typeof membership>;
/** Describes the events that can change staff access. */
export type MembershipCommand =
  | { readonly type: "accept_invitation" }
  | { readonly type: "suspend"; readonly reason?: string | null }
  | { readonly type: "reactivate" }
  | { readonly type: "remove"; readonly reason?: string | null };
/** Defines all allowed membership transitions, including terminal removal. */
export const membershipTransitions: Readonly<
  Record<
    MembershipStatus,
    Readonly<Partial<Record<MembershipCommand["type"], MembershipStatus>>>
  >
> = {
  invited: { accept_invitation: "active" },
  active: { suspend: "suspended", remove: "removed" },
  suspended: { reactivate: "active", remove: "removed" },
  removed: {},
};
/** Supplies the expected version and a complete snapshot of the person's memberships across companies. */
export interface MembershipContext {
  readonly expected_version: number;
  readonly memberships: readonly Membership[];
}

/** Applies an access transition, enforcing IN2 for activation across all companies. */
export function transitionMembership(
  current: Membership,
  command: MembershipCommand,
  context: MembershipContext,
): Result<Membership, LifecycleError> {
  const status = membershipTransitions[current.status][command.type];
  if (status === undefined) return refuse("INVALID_TRANSITION");
  const version = checkExpectedVersion(
    current.version,
    context.expected_version,
  );
  if (!version.ok) return version;
  if (!staffRoles.safeParse(current.staff_roles).success)
    return refuse("INVALID_INPUT", "staff_roles");
  if (
    status === "active" &&
    context.memberships.some(
      (other) =>
        other.id !== current.id &&
        other.account_id === current.account_id &&
        other.status === "active",
    )
  )
    return refuse("ACTIVE_MEMBERSHIP_EXISTS");
  if (command.type === "suspend" || command.type === "remove") {
    const reason = requireReason(command.reason);
    if (!reason.ok) return reason;
    return ok({
      ...current,
      status,
      version: current.version + 1,
      reason: reason.value,
    });
  }
  return ok({ ...current, status, version: current.version + 1 });
}
