import { localDateOf, utcInstant, type UtcInstant } from "../time";
import type { TicketPriority } from "../vocabulary";
import type {
  CostApprovalInput,
  CostApprovalRoute,
  SafetyCriticalFlag,
} from "./types";

/** Selects cost authority; an unset threshold always requires owner approval under IN20. */
export function costApprovalRoute(input: CostApprovalInput): CostApprovalRoute {
  if (input.costThresholdFils === null) return { route: "owner" };
  if (input.costFils <= input.costThresholdFils) return { route: "manager" };
  if (
    input.safetyCritical &&
    !input.ownerReachable &&
    Number.isSafeInteger(input.ownerContactAttempts) &&
    input.ownerContactAttempts >= 1 &&
    (input.emergencyLimitFils === null ||
      input.costFils <= input.emergencyLimitFils)
  ) {
    return {
      route: "emergency_rule",
      notify_owner: true,
      charge_owner_afterwards: true,
    };
  }
  return { route: "owner" };
}
/** Escalates every flagged fault to emergency priority. */
export function effectiveTicketPriority(
  priority: TicketPriority,
  flags: readonly SafetyCriticalFlag[],
): TicketPriority {
  return flags.length > 0 ? "emergency" : priority;
}
/**
 * Calculates the resolution deadline while preserving microseconds for elapsed durations.
 * @throws {RangeError} If the deadline exceeds the supported four digit calendar.
 */
export function resolutionDeadline(
  priority: TicketPriority,
  reportedAt: UtcInstant,
): UtcInstant {
  if (priority === "emergency")
    return utcInstant.parse(`${localDateOf(reportedAt)}T19:59:59.999999Z`);
  const days: Readonly<Record<"urgent" | "routine", number>> = {
    urgent: 2,
    routine: 7,
  };
  const date = new Date(
    new Date(reportedAt).getTime() + days[priority] * 86_400_000,
  );
  if (date.getUTCFullYear() > 9999)
    throw new RangeError("Deadline exceeds the supported calendar");
  const fraction = /\.\d+Z$/.exec(reportedAt)?.[0] ?? "Z";
  return utcInstant.parse(`${date.toISOString().slice(0, 19)}${fraction}`);
}
