import { z } from "zod";
import { checkExpectedVersion, refuse, requireReason } from "../errors";
import {
  companyId,
  invitationId,
  ownerId,
  personAccountId,
  tenantId,
  type PersonAccountId,
} from "../ids";
import { ok, type Result } from "../result";
import { utcInstant, type UtcInstant } from "../time";
import {
  invitationKind,
  invitationStatus,
  staffRole,
  type InvitationStatus,
} from "../vocabulary";
import type { LifecycleError } from "./errors";

const invitationFields = {
  id: invitationId,
  company_id: companyId,
  status: invitationStatus,
  email: z.email(),
  sent_at: utcInstant,
  version: z.int().nonnegative(),
  accepted_by_account_id: personAccountId.nullable(),
  confirmed_by_manager_account_id: personAccountId.nullable(),
  reason: z.string().nullable(),
};
/** Validates staff invitations and party invitations that identify the linked record. */
export const invitation = z.discriminatedUnion("kind", [
  z
    .strictObject({
      ...invitationFields,
      kind: z.literal(invitationKind.enum.staff),
      staff_roles: z.array(staffRole).min(1).readonly(),
    })
    .readonly(),
  z
    .strictObject({
      ...invitationFields,
      kind: z.literal(invitationKind.enum.owner),
      owner_id: ownerId,
    })
    .readonly(),
  z
    .strictObject({
      ...invitationFields,
      kind: z.literal(invitationKind.enum.tenant),
      tenant_id: tenantId,
    })
    .readonly(),
]);
/** Describes an invitation and the acceptance evidence retained with it. */
export type Invitation = z.infer<typeof invitation>;
/** Describes acceptance evidence, explicit expiry and reasoned revocation. */
export type InvitationCommand =
  | {
      readonly type: "accept";
      readonly account_id: PersonAccountId;
      readonly verified_account_email: string | null;
      readonly confirmed_by_manager_account_id?: PersonAccountId;
    }
  | { readonly type: "expire" }
  | { readonly type: "revoke"; readonly reason?: string | null };
/** Defines the invitation lifecycle with terminal accepted, expired and revoked states. */
export const invitationTransitions: Readonly<
  Record<
    InvitationStatus,
    Readonly<Partial<Record<InvitationCommand["type"], InvitationStatus>>>
  >
> = {
  pending: { accept: "accepted", expire: "expired", revoke: "revoked" },
  accepted: {},
  expired: {},
  revoked: {},
};
/** Supplies explicit time and optimistic concurrency for invitation commands. */
export interface InvitationContext {
  readonly now: UtcInstant;
  readonly expected_version: number;
}

function microseconds(instant: UtcInstant): bigint {
  const [whole = "", fraction = ""] = instant.slice(0, -1).split(".");
  return (
    BigInt(Date.parse(`${whole}Z`)) * 1000n + BigInt(fraction.padEnd(6, "0"))
  );
}

/** Derives pending invitation expiry at exactly seven elapsed days without modifying stored data. */
export function invitationStatusAt(
  current: Invitation,
  now: UtcInstant,
): InvitationStatus {
  return current.status === "pending" &&
    microseconds(now) - microseconds(current.sent_at) >= 604_800_000_000n
    ? "expired"
    : current.status;
}

function acceptInvitation(
  current: Invitation,
  command: Extract<InvitationCommand, { readonly type: "accept" }>,
): Result<Invitation, LifecycleError> {
  const matches =
    command.verified_account_email !== null &&
    command.verified_account_email.trim().toLowerCase() ===
      current.email.toLowerCase();
  if (!matches && command.confirmed_by_manager_account_id === undefined)
    return refuse("INVITATION_EMAIL_MISMATCH", "verified_account_email");
  return ok({
    ...current,
    status: "accepted",
    version: current.version + 1,
    accepted_by_account_id: command.account_id,
    confirmed_by_manager_account_id:
      command.confirmed_by_manager_account_id ?? null,
  });
}

/** Applies an invitation command; manager confirmation must be authorized by the calling command handler. */
export function transitionInvitation(
  current: Invitation,
  command: InvitationCommand,
  context: InvitationContext,
): Result<Invitation, LifecycleError> {
  const target = invitationTransitions[current.status][command.type];
  if (target === undefined)
    return refuse(
      current.status === "expired" && command.type === "accept"
        ? "INVITATION_EXPIRED"
        : "INVALID_TRANSITION",
    );
  const version = checkExpectedVersion(
    current.version,
    context.expected_version,
  );
  if (!version.ok) return version;
  if (microseconds(context.now) < microseconds(current.sent_at))
    return refuse("INVALID_INPUT", "now");
  const expired = invitationStatusAt(current, context.now) === "expired";
  if (expired && command.type !== "expire")
    return refuse(
      command.type === "accept" ? "INVITATION_EXPIRED" : "INVALID_TRANSITION",
    );
  switch (command.type) {
    case "accept":
      return acceptInvitation(current, command);
    case "expire":
      return expired
        ? ok({ ...current, status: target, version: current.version + 1 })
        : refuse("INVALID_TRANSITION");
    case "revoke": {
      const reason = requireReason(command.reason);
      if (!reason.ok) return reason;
      return ok({
        ...current,
        status: target,
        version: current.version + 1,
        reason: reason.value,
      });
    }
  }
}
