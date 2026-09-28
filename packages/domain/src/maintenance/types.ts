import { z } from "zod";
import { coreErrorCode } from "../errors";
import type { DocumentVersionId, PersonAccountId, TicketId } from "../ids";
import type { Fils } from "../money";
import type { UtcInstant } from "../time";
import type {
  CostPayer,
  TicketCategory,
  TicketPriority,
  TicketStatus,
} from "../vocabulary";

/** Lists closed maintenance refusal codes. */
export const maintenanceErrorCode = z.enum([
  ...coreErrorCode.options,
  "COST_APPROVAL_REQUIRED",
  "RATING_EXISTS",
  "NOT_AUTHORISED",
  "NOT_OWN_SESSION",
  "AFTER_PHOTO_REQUIRED",
  "COST_ALLOCATION_REQUIRED",
  "CONFIRMATION_REQUIRED",
]);
/** Represents a typed maintenance refusal. */
export type MaintenanceErrorCode = z.infer<typeof maintenanceErrorCode>;
/** Lists faults that always require emergency priority. */
export const safetyCriticalFlag = z.enum([
  "gas_smell",
  "electrical_sparking",
  "water_into_electrics",
  "lift_entrapment",
  "other_safety_hazard",
]);
/** Represents a confirmed safety-critical fault. */
export type SafetyCriticalFlag = z.infer<typeof safetyCriticalFlag>;
/** Identifies the person issuing a maintenance command in their own session. */
export interface MaintenanceActor {
  readonly role: "tenant" | "owner" | "technician" | "manager";
  readonly accountId: PersonAccountId;
  readonly sessionAccountId: PersonAccountId;
}
/** Supplies validated monetary amounts and owner contact facts. */
export interface CostApprovalInput {
  readonly costFils: Fils;
  readonly costThresholdFils: Fils | null;
  readonly emergencyLimitFils: Fils | null;
  readonly safetyCritical: boolean;
  readonly ownerContactAttempts: number;
  readonly ownerReachable: boolean;
}
/** Describes the approving party and mandatory emergency follow-up. */
export type CostApprovalRoute =
  | { readonly route: "manager" | "owner" }
  | {
      readonly route: "emergency_rule";
      readonly notify_owner: true;
      readonly charge_owner_afterwards: true;
    };
/** Holds the immutable ticket facts used by each decision. */
export interface TicketSnapshot {
  readonly id: TicketId;
  readonly status: TicketStatus;
  readonly authorAccountId: PersonAccountId;
  readonly authorRole: MaintenanceActor["role"];
  readonly ownerAccountId: PersonAccountId;
  readonly reportedAt: UtcInstant;
  readonly category: TicketCategory;
  readonly priority: TicketPriority;
  readonly payer: CostPayer;
  readonly safetyFlags: readonly SafetyCriticalFlag[];
  readonly linked_ticket_id: TicketId | null;
  readonly rating: number | null;
}
/** Supplies report facts before the initial confirmation. */
export type TicketReport = Omit<TicketSnapshot, "status" | "rating">;
/** Binds a prior owner approval to the current cost and their own session. */
export interface TicketCostApproval {
  readonly accountId: PersonAccountId;
  readonly sessionAccountId: PersonAccountId;
  readonly costFils: Fils;
}
/** Supplies service-verified facts without reading clocks or account state. */
export interface TicketContext {
  readonly actor: MaintenanceActor;
  readonly cost: Omit<CostApprovalInput, "safetyCritical">;
  readonly ownerApproval: TicketCostApproval | null;
  readonly now: UtcInstant;
  readonly confirmationDeadline: UtcInstant;
}
/** Describes ticket commands with the evidence required by their guards. */
export type TicketCommand =
  | {
      readonly type: "report";
      readonly report: TicketReport;
      readonly confirmed: boolean;
    }
  | {
      readonly type: "triage";
      readonly category: TicketCategory;
      readonly priority: TicketPriority;
      readonly payer: CostPayer;
    }
  | {
      readonly type: "cancel";
      readonly kind: "duplicate" | "invalid";
      readonly reason: string | null;
    }
  | { readonly type: "reject_cost" | "reopen"; readonly reason: string | null }
  | {
      readonly type:
        | "request_quote"
        | "request_cost_approval"
        | "schedule"
        | "approve_cost"
        | "start_visit"
        | "book_revisit";
    }
  | { readonly type: "hold"; readonly pending: "parts" | "access" }
  | {
      readonly type: "complete";
      readonly afterPhotos: readonly DocumentVersionId[];
    }
  | {
      readonly type: "close";
      readonly confirmation: "tenant_confirmed" | "window_lapsed";
      readonly costAllocated: boolean;
    };
/** Returns the next ticket and obligations that must accompany its persistence. */
export interface TicketDecision {
  readonly ticket: TicketSnapshot;
  readonly reason: string | null;
  readonly notify_owner: boolean;
  readonly charge_owner_afterwards: boolean;
}
