import { z } from "zod";
import {
  coreErrorCode,
  refuse,
  requireReason,
  type DomainError,
} from "../errors";
import { ok, type Result } from "../result";
import type { LocalDate } from "../time";
import type { UnitStatus } from "../vocabulary";

/** Lists typed refusals for unit commands. */
export const unitsErrorCode = z.enum([
  ...coreErrorCode.options,
  "UNIT_BLOCKED",
]);
/** Represents a unit command refusal. */
export type UnitsErrorCode = z.infer<typeof unitsErrorCode>;
/** Lists the recorded facts that change a unit's lifecycle. */
export type UnitCommand =
  | {
      readonly type:
        | "list"
        | "delist"
        | "submit_contract"
        | "cancel_contract"
        | "reservation_lapsed"
        | "move_in"
        | "retroactive_move_in"
        | "record_notice"
        | "withdraw_notice"
        | "conclude_renewal"
        | "move_out"
        | "open_make_ready"
        | "close_make_ready"
        | "unblock";
    }
  | {
      readonly type: "block";
      readonly reason: "owner_use" | "legal_hold" | "sale" | null;
    };
/** Describes an allowed unit transition. */
export interface UnitTransitionRow {
  readonly from: UnitStatus;
  readonly command: UnitCommand["type"];
  readonly to: UnitStatus;
}
/** Defines all changes to occupancy and availability as inspectable data. */
export const unitTransitions: readonly UnitTransitionRow[] = [
  { from: "vacant", command: "list", to: "listed" },
  { from: "listed", command: "delist", to: "vacant" },
  { from: "vacant", command: "submit_contract", to: "reserved" },
  { from: "listed", command: "submit_contract", to: "reserved" },
  { from: "reserved", command: "cancel_contract", to: "vacant" },
  { from: "reserved", command: "reservation_lapsed", to: "vacant" },
  { from: "reserved", command: "move_in", to: "occupied" },
  { from: "vacant", command: "retroactive_move_in", to: "occupied" },
  { from: "occupied", command: "record_notice", to: "notice_given" },
  { from: "notice_given", command: "withdraw_notice", to: "occupied" },
  { from: "notice_given", command: "conclude_renewal", to: "occupied" },
  { from: "notice_given", command: "move_out", to: "vacant" },
  { from: "occupied", command: "move_out", to: "vacant" },
  { from: "vacant", command: "open_make_ready", to: "under_maintenance" },
  { from: "under_maintenance", command: "close_make_ready", to: "vacant" },
  { from: "vacant", command: "block", to: "blocked" },
  { from: "blocked", command: "unblock", to: "vacant" },
];
/** Applies a recorded occupancy or availability fact without mutating the unit.
 * Tickets on an occupied unit leave its status unchanged under IN10.
 */
export function transitionUnit(
  status: UnitStatus,
  command: UnitCommand,
): Result<UnitStatus, DomainError<UnitsErrorCode>> {
  const row = unitTransitions.find(
    (entry) => entry.from === status && entry.command === command.type,
  );
  if (row === undefined) return refuse("INVALID_TRANSITION");
  if (command.type === "block") {
    const reason = requireReason(command.reason);
    if (!reason.ok) return reason;
  }
  return ok(row.to);
}
/** Refuses a new contract draft on a blocked unit. */
export function checkUnitContractDraft(
  status: UnitStatus,
): Result<void, DomainError<UnitsErrorCode>> {
  return status === "blocked" ? refuse("UNIT_BLOCKED") : ok(undefined);
}
/** Derives physical occupancy from a concluded contract and its handovers under IN10. */
export function isOccupied(input: {
  readonly concludedContract: boolean;
  readonly moveIn: LocalDate | null;
  readonly moveOut: LocalDate | null;
}): boolean {
  return (
    input.concludedContract && input.moveIn !== null && input.moveOut === null
  );
}
