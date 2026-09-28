import type { ContractActor, ContractApproval } from "../contract/types";
import type { DocumentVersionId, PersonAccountId } from "../ids";
import type { LocalDate } from "../time";
import type {
  ContractStatus,
  TawtheeqPath,
  TawtheeqWorkflowState,
} from "../vocabulary";
import type {
  ContractFieldValues,
  DiscrepancyResolutionInput,
  ResolvedDiscrepancy,
  TawtheeqAdoptionVersion,
  TawtheeqDiscrepancy,
} from "./discrepancies";
import type { RegisteredDocument, RegistrationIdentity } from "./evidence";

/** Supplies the frozen contract facts and the current registration workflow. */
export interface TawtheeqSnapshot {
  readonly state: TawtheeqWorkflowState;
  readonly path: TawtheeqPath;
  readonly version: number;
  readonly contractStatus: ContractStatus;
  readonly frozenOwnerGate: boolean;
  readonly ownerAccountId: PersonAccountId;
  readonly tenantAccountId: PersonAccountId;
  readonly contractContentHash: string;
  readonly subjectHash: string;
  readonly priorValues: ContractFieldValues;
  readonly linkedIdentity: RegistrationIdentity;
  readonly documentVersionId: DocumentVersionId | null;
  readonly document: RegisteredDocument | null;
  readonly discrepancies: readonly TawtheeqDiscrepancy[];
  readonly resolutions: readonly ResolvedDiscrepancy[];
  readonly candidateVersion: TawtheeqAdoptionVersion | null;
  readonly managerApproval: ContractApproval | null;
  readonly ownerApproval: ContractApproval | null;
}

/** Supplies the authenticated actor and calendar date to a pure registration decision. */
export interface TawtheeqContext {
  readonly actor: ContractActor;
  readonly on: LocalDate;
}

interface Versioned {
  readonly expectedVersion: number;
}
/** Describes commands in the three Tawtheeq registration paths. */
export type TawtheeqCommand = Versioned &
  (
    | { readonly type: "attest_portal" | "resume" }
    | {
        readonly type: "portal_return" | "owner_return";
        readonly reason: string | null;
      }
    | {
        readonly type: "skip";
        readonly reason: string | null;
        readonly ownerConfirmation: ContractApproval | null;
      }
    | { readonly type: "upload"; readonly documentVersionId: DocumentVersionId }
    | {
        readonly type: "reject_identity";
        readonly document: RegisteredDocument;
      }
    | {
        readonly type: "confirm_matches";
        readonly document: RegisteredDocument;
      }
    | {
        readonly type: "open_discrepancies";
        readonly document: RegisteredDocument;
        readonly discrepancies: readonly TawtheeqDiscrepancy[];
      }
    | {
        readonly type: "reregister" | "prepare_adoption" | "register_resolved";
        readonly choices: readonly DiscrepancyResolutionInput[];
        readonly subjectHash: string;
      }
    | { readonly type: "owner_reapprove"; readonly subjectHash: string }
    | {
        readonly type: "close";
        readonly reason: string | null;
        readonly closureKind:
          "portal_close" | "cancellation" | "renewal" | "court_termination";
      }
  );

/** Declares transaction writes for registration, evidence, adoption and notifications. */
export type TawtheeqEffect =
  | { readonly type: "set_path"; readonly path: TawtheeqPath }
  | {
      readonly type: "record_portal_attestation";
      readonly accountId: PersonAccountId;
      readonly on: LocalDate;
    }
  | { readonly type: "record_reason"; readonly reason: string }
  | {
      readonly type: "record_skip_confirmation";
      readonly approval: ContractApproval;
    }
  | {
      readonly type: "link_document";
      readonly documentVersionId: DocumentVersionId;
    }
  | { readonly type: "record_document"; readonly document: RegisteredDocument }
  | { readonly type: "clear_review" }
  | { readonly type: "reject_upload"; readonly field: string }
  | {
      readonly type: "record_discrepancies";
      readonly discrepancies: readonly TawtheeqDiscrepancy[];
    }
  | {
      readonly type: "record_resolutions";
      readonly resolutions: readonly ResolvedDiscrepancy[];
      readonly subjectHash: string;
    }
  | {
      readonly type: "create_adoption_version";
      readonly version: TawtheeqAdoptionVersion;
    }
  | { readonly type: "record_approval"; readonly approval: ContractApproval }
  | {
      readonly type: "request_owner_reapproval";
      readonly subjectHash: string;
      readonly accountId: PersonAccountId;
    }
  | { readonly type: "return_owner_reapproval"; readonly reason: string }
  | { readonly type: "move_current_version"; readonly contentHash: string }
  | {
      readonly type: "record_document_acceptance";
      readonly documentVersionId: DocumentVersionId;
      readonly subjectHash: string;
    }
  | {
      readonly type: "notify";
      readonly recipient: "owner" | "tenant" | "manager";
      readonly template: string;
    }
  | {
      readonly type: "record_close";
      readonly closureKind:
        "portal_close" | "cancellation" | "renewal" | "court_termination";
      readonly reason: string;
    };

/** Returns a registration state and all writes required in its transaction. */
export interface TawtheeqDecision {
  readonly state: TawtheeqWorkflowState;
  readonly events: readonly string[];
  readonly effects: readonly TawtheeqEffect[];
}
