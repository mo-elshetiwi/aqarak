import { z } from "zod";
import { coreErrorCode } from "../errors";
import type {
  ContractId,
  DocumentVersionId,
  DraftedActionId,
  HandoverId,
  PersonAccountId,
  UnitId,
} from "../ids";
import type { BasisPoints, Fils } from "../money";
import type {
  OwnerGateCompany,
  OwnerGateMandate,
  OwnerGateProperty,
} from "../owner-gate/index";
import type { LocalDate } from "../time";
import type {
  RegisteredDocument,
  RegistrationIdentity,
} from "../tawtheeq/evidence";
import type {
  ApprovalKind,
  ApprovalSlot,
  ApprovalStatus,
  ContractCancelKind,
  ContractEndReason,
  ContractOrigin,
  ContractStatus,
  FieldProvenance,
  TawtheeqPath,
  TawtheeqWorkflowState,
} from "../vocabulary";

/** Lists closed refusal codes for the contract lifecycle. */
export const contractErrorCode = z.enum([
  ...coreErrorCode.options,
  "UNIT_BLOCKED",
  "TENANT_REQUIRED",
  "TENANT_DOCUMENTS_REQUIRED",
  "OWNER_ACCOUNT_REQUIRED",
  "OVERLAPPING_CONTRACT",
  "STALE_SUBJECT_HASH",
  "NOT_NAMED_PARTY",
  "NOT_OWN_SESSION",
  "APPROVER_NOT_DISTINCT",
  "APPROVALS_REQUIRED",
  "SUCCESSOR_EXISTS",
  "RETROACTIVE_EVIDENCE_MISSING",
  "IDENTITY_MISMATCH",
  "END_EVIDENCE_MISSING",
  "SCHEDULE_TOTAL_MISMATCH",
]);
/** Represents a typed contract refusal. */
export type ContractErrorCode = z.infer<typeof contractErrorCode>;

/** Binds a person command to the authenticated person's own session. */
export interface ContractActor {
  readonly role: ApprovalSlot;
  readonly accountId: PersonAccountId;
  readonly sessionAccountId: PersonAccountId;
}

/** Stores an approval bound to a single immutable content hash. */
export interface ContractApproval {
  readonly slot: ApprovalSlot;
  readonly kind: ApprovalKind;
  readonly status: ApprovalStatus;
  readonly subjectHash: string;
  readonly approverAccountId: PersonAccountId;
  readonly sessionAccountId: PersonAccountId;
}

/** Describes one instalment before schedule activation. */
export interface ContractInstalment {
  readonly seqNo: number;
  readonly amountFils: Fils;
  readonly vatFils: Fils;
}

/** Holds the contract's unit exclusion period and financial schedule. */
export interface ContractTerms {
  readonly unitIds: readonly UnitId[];
  readonly termStart: LocalDate;
  readonly termEnd: LocalDate;
  readonly totalFils: Fils;
  readonly vatBp: BasisPoints;
  readonly instalments: readonly ContractInstalment[];
}

/** Holds a version whose submitted terms and frozen owner gate cannot be edited. */
export interface ContractVersion {
  readonly number: number;
  readonly contentHash: string;
  readonly submitted: boolean;
  readonly frozenOwnerGate: boolean | null;
  readonly terms: ContractTerms;
}

/** Supplies the identity and terms for creating a new contract. */
export interface NewContract {
  readonly id: ContractId;
  readonly ownerAccountId: PersonAccountId | null;
  readonly tenantAccountId: PersonAccountId;
  readonly tenantSignatoryAccountIds: readonly PersonAccountId[];
  readonly terms: ContractTerms;
  readonly contentHash: string;
  readonly linkedIdentity: RegistrationIdentity;
  readonly revisionOfId: ContractId | null;
  readonly renewalOfId: ContractId | null;
}

/** Supplies the current persisted contract without permitting mutation. */
export interface ContractSnapshot {
  readonly id: ContractId;
  readonly status: ContractStatus;
  readonly origin: ContractOrigin;
  readonly version: ContractVersion;
  readonly ownerAccountId: PersonAccountId | null;
  readonly tenantAccountId: PersonAccountId;
  readonly tenantSignatoryAccountIds: readonly PersonAccountId[];
  readonly approvals: readonly ContractApproval[];
  readonly successorId: ContractId | null;
}

/** Supplies other contracts that may exclude one or more requested units. */
export interface BlockingContract {
  readonly id: ContractId;
  readonly unitIds: readonly UnitId[];
  readonly termStart: LocalDate;
  readonly termEnd: LocalDate;
  readonly blocksUnit: boolean;
}

/** Supplies authoritative service facts and settings for one pure transition. */
export interface ContractContext {
  readonly actor: ContractActor;
  readonly on: LocalDate;
  readonly company: OwnerGateCompany;
  readonly property: OwnerGateProperty;
  readonly mandate: OwnerGateMandate | null;
  readonly blockedUnitIds: readonly UnitId[];
  readonly blockingContracts: readonly BlockingContract[];
  readonly tenantExists: boolean;
  readonly tenantDocumentsAccepted: boolean;
  readonly ownerAccountActive: boolean;
}

/** Records each field confirmation on the extraction's drafted action. */
export interface RetroactiveConfirmation {
  readonly draftedActionId: DraftedActionId;
  readonly sourceDocumentVersionId: DocumentVersionId;
  readonly contentHash: string;
  readonly requiredFields: readonly string[];
  readonly fields: Readonly<Record<string, FieldProvenance | "unconfirmed">>;
}

/** Describes commands accepted by the T1 to T13 transition table. */
export type ContractCommand =
  | { readonly type: "create"; readonly contract: NewContract }
  | {
      readonly type: "edit";
      readonly expectedVersion: number;
      readonly terms: ContractTerms;
      readonly contentHash: string;
    }
  | { readonly type: "submit"; readonly expectedVersion: number }
  | {
      readonly type: "approve_owner" | "accept_tenant";
      readonly expectedVersion: number;
      readonly subjectHash: string;
    }
  | {
      readonly type:
        "return_owner" | "return_tenant" | "withdraw" | "cancel_draft";
      readonly expectedVersion: number;
      readonly reason: string | null;
    }
  | {
      readonly type: "revise";
      readonly expectedVersion: number;
      readonly contract: NewContract;
    }
  | {
      readonly type: "conclude_retroactive";
      readonly contract: NewContract;
      readonly managerConfirmation: RetroactiveConfirmation | null;
      readonly document: RegisteredDocument | null;
      readonly notifications: {
        readonly owner: PersonAccountId;
        readonly tenant: PersonAccountId;
      } | null;
    }
  | {
      readonly type: "end";
      readonly expectedVersion: number;
      readonly endReason: ContractEndReason;
      readonly effectiveOn: LocalDate;
      readonly evidenceDocumentVersionId: DocumentVersionId | null;
      readonly moveOutHandoverId: HandoverId | null;
    };

/** Declares writes that the service must commit atomically with contract events. */
export type ContractEffect =
  | {
      readonly type: "create_contract";
      readonly contract: NewContract;
      readonly origin: ContractOrigin;
    }
  | {
      readonly type: "create_version";
      readonly number: number;
      readonly terms: ContractTerms;
      readonly contentHash: string;
    }
  | {
      readonly type: "freeze_version";
      readonly contentHash: string;
      readonly frozenOwnerGate: boolean;
    }
  | { readonly type: "record_approval"; readonly approval: ContractApproval }
  | {
      readonly type: "request_approval";
      readonly slot: "owner" | "tenant";
      readonly subjectHash: string;
      readonly accountId: PersonAccountId;
    }
  | {
      readonly type: "void_live_approvals";
      readonly reason: "contract_cancelled";
      readonly statuses: readonly ["requested", "approved"];
    }
  | {
      readonly type: "set_blocks_unit";
      readonly value: boolean;
      readonly effectiveOn?: LocalDate;
    }
  | {
      readonly type: "set_cancel_kind";
      readonly cancelKind: ContractCancelKind;
      readonly reason: string;
    }
  | {
      readonly type: "create_tawtheeq_record";
      readonly path: TawtheeqPath;
      readonly state: TawtheeqWorkflowState;
      readonly document?: RegisteredDocument;
    }
  | { readonly type: "activate_schedule" }
  | {
      readonly type: "notify";
      readonly recipient: ApprovalSlot;
      readonly template: string;
      readonly accountId?: PersonAccountId;
    }
  | {
      readonly type: "link_revision";
      readonly revisionOfId: ContractId;
      readonly successorId: ContractId;
    }
  | {
      readonly type: "record_retroactive_confirmation";
      readonly confirmation: RetroactiveConfirmation;
    }
  | {
      readonly type: "record_end";
      readonly endReason: ContractEndReason;
      readonly effectiveOn: LocalDate;
      readonly evidenceDocumentVersionId: DocumentVersionId | null;
      readonly moveOutHandoverId: HandoverId | null;
    };

/** Returns the next state with its transaction's audit events and declarative effects. */
export interface ContractDecision {
  readonly status: ContractStatus;
  readonly events: readonly string[];
  readonly effects: readonly ContractEffect[];
}
