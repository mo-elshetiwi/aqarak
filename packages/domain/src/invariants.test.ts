import { describe, expect, it } from "vitest";
import {
  can,
  companyId,
  personAccountId,
  ownerId,
  tenantId,
  technicianProfileId,
  membership,
  membershipId,
  transitionMembership,
  transitionDraftedAction,
  draftedActionId,
  coWorkerToolFamilies,
  coWorkerToolEffects,
  transitionDocumentReview,
  transitionDocumentProcessing,
  documentId,
  documentVersionId,
  transitionContract,
  validateAcceptance,
  validateContractSchedule,
  hasContractOverlap,
  contractId,
  contractVersionId,
  propertyId,
  unitId,
  ownerGate,
  isOccupied,
  validateRegistration,
  resolveDiscrepancy,
  firingDedupeKey,
  localDateOf,
  localDate,
  utcInstant,
  allocate,
  voidAllocation,
  paymentCredit,
  fils,
  basisPoints,
  vatFils,
  instalmentId,
  paymentId,
  allocationId,
  receiptId,
  transitionCheque,
  isChequeStale,
  chequeId,
  issueReceipt,
  takeNumber,
  applicableVatBp,
  invitation,
  invitationId,
  transitionOwnerStatement,
  ownerStatementId,
  transitionTicket,
  ticketId,
  costApprovalRoute,
  auditEventContent,
  appendToChain,
  verifyChain,
  encodeCanonical,
  requestSha256,
  ok,
  type Result,
  type PermissionActor,
  type DraftedAction,
  type DraftedActionContext,
  type DocumentVersionSnapshot,
  type ContractContext,
  type ContractSnapshot,
  type ContractApproval,
  type NewContract,
  type TawtheeqSnapshot,
  type MoneyLedger,
  type MoneyContext,
  type Cheque,
  type OwnerStatement,
  type TicketSnapshot,
  type TicketContext,
  type ChainRow,
  type ChainCheckpoint,
} from "./index";

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const company = companyId.parse(uuid(1));
const otherCompany = companyId.parse(uuid(2));
const manager = personAccountId.parse(uuid(3));
const owner = personAccountId.parse(uuid(4));
const tenant = personAccountId.parse(uuid(5));
const on = localDate.parse("2026-09-28");
const now = utcInstant.parse("2026-09-28T08:00:00Z");

function value<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error("Expected a successful domain decision");
  return result.value;
}
function refusal(result: Result<unknown>, code: string): void {
  expect(result).toMatchObject({ ok: false, error: { code } });
  expect(result).not.toHaveProperty("value");
}
function deepFreeze<T>(input: T): T {
  if (typeof input === "object" && input !== null) {
    for (const child of Object.values(input)) deepFreeze(child);
    Object.freeze(input);
  }
  return input;
}
function actor(roles: PermissionActor["roles"] = ["manager"]): PermissionActor {
  return {
    account_id: manager,
    company_id: company,
    roles,
    owner_ids: [ownerId.parse(uuid(4))],
    tenant_ids: [tenantId.parse(uuid(5))],
    technician_profile_id: technicianProfileId.parse(uuid(6)),
  };
}
function draft(): DraftedAction {
  return {
    id: draftedActionId.parse(uuid(1)),
    company_id: company,
    drafted_for_account_id: manager,
    status: "ready",
    version: 1,
    payload: { amount_fils: 100 },
    field_provenance: { "/amount_fils": "ai_confirmed" },
    base_versions: { contract: 1 },
    refusal: null,
    reason: null,
  };
}
const draftContext: DraftedActionContext = {
  initiator: "person",
  account_id: manager,
  expected_version: 1,
};
const commit = {
  type: "commit",
  current_versions: { contract: 1 },
  command_result: ok(undefined),
} as const;
function document(): DocumentVersionSnapshot {
  return {
    id: documentVersionId.parse(uuid(1)),
    documentId: documentId.parse(uuid(1)),
    versionNumber: 1,
    documentType: "tawtheeq",
    expiryDate: null,
    processing_status: "scan_clean",
    review_status: "pending_review",
    recordedSha256: "a".repeat(64),
    recordedByteSize: 100,
  };
}
const acceptDocument = {
  type: "accept",
  documentType: "tawtheeq",
  expiryDate: null,
  typeConfirmed: true,
  datesConfirmed: true,
} as const;
function contract(): ContractSnapshot {
  return {
    id: contractId.parse(uuid(1)),
    status: "draft",
    origin: "app",
    ownerAccountId: owner,
    tenantAccountId: tenant,
    tenantSignatoryAccountIds: [],
    successorId: null,
    approvals: [],
    version: {
      number: 1,
      contentHash: "synthetic_hash",
      submitted: false,
      frozenOwnerGate: null,
      terms: {
        unitIds: [unitId.parse(uuid(1))],
        termStart: on,
        termEnd: localDate.parse("2027-09-27"),
        totalFils: fils.parse(100),
        vatBp: basisPoints.parse(500),
        instalments: [
          { seqNo: 1, amountFils: fils.parse(100), vatFils: fils.parse(5) },
        ],
      },
    },
  };
}
function contractContext(): ContractContext {
  return {
    actor: { role: "manager", accountId: manager, sessionAccountId: manager },
    on,
    company: { kind: "management_company", defaultOwnerGate: true },
    property: { id: propertyId.parse(uuid(1)), ownerGateOverride: null },
    mandate: null,
    blockedUnitIds: [],
    blockingContracts: [],
    tenantExists: true,
    tenantDocumentsAccepted: true,
    ownerAccountActive: true,
  };
}
function approval(
  slot: ContractApproval["slot"],
  account = slot === "manager" ? manager : owner,
): ContractApproval {
  return {
    slot,
    kind: "contract_approval",
    status: "approved",
    subjectHash: "synthetic_hash",
    approverAccountId: account,
    sessionAccountId: account,
  };
}
function readyContract(): ContractSnapshot {
  const state = contract();
  return {
    ...state,
    status: "awaiting_tenant_acceptance",
    version: { ...state.version, submitted: true, frozenOwnerGate: true },
    approvals: [approval("manager"), approval("owner")],
  };
}
const identity = {
  unt_number: "UNT-SYNTHETIC",
  owner_id_number: "OWNER-SYNTHETIC",
  tenant_id_number: "TENANT-SYNTHETIC",
};
function registration(): TawtheeqSnapshot {
  return {
    state: "under_review",
    path: "normal",
    version: 1,
    contractStatus: "concluded",
    frozenOwnerGate: true,
    ownerAccountId: owner,
    tenantAccountId: tenant,
    contractContentHash: "synthetic_hash",
    subjectHash: "synthetic_hash",
    priorValues: {},
    linkedIdentity: identity,
    documentVersionId: documentVersionId.parse(uuid(1)),
    document: {
      documentVersionId: documentVersionId.parse(uuid(1)),
      processingStatus: "scan_clean",
      reviewStatus: "accepted",
      tawtheeqNumber: "SYNTHETIC-REGISTRATION",
      registeredOn: on,
      identity,
    },
    discrepancies: [],
    resolutions: [],
    candidateVersion: null,
    managerApproval: null,
    ownerApproval: null,
  };
}
const moneyContext: MoneyContext = {
  company_id: company,
  company_name: "Synthetic Company",
  issuer_trn: "100000000000001",
  on,
  role: "manager",
};
function ledger(): MoneyLedger {
  return {
    company_id: company,
    payments: [
      {
        id: paymentId.parse(uuid(1)),
        contract_id: contractId.parse(uuid(1)),
        method: "cash",
        amount_fils: fils.parse(105),
        received_on: on,
        source: "app",
        cheque_id: null,
        status: "recorded",
      },
    ],
    instalments: [
      {
        id: instalmentId.parse(uuid(1)),
        contract_id: contractId.parse(uuid(1)),
        contract_version_id: contractVersionId.parse(uuid(1)),
        seq_no: 1,
        due_on: on,
        amount_fils: fils.parse(100),
        vat_fils: fils.parse(5),
        status: "open",
      },
    ],
    receipts: [],
    allocations: [],
    refunds: [],
    reversals: [],
    charges: [],
    counters: [],
  };
}
const allocation = {
  id: allocationId.parse(uuid(1)),
  payment_id: paymentId.parse(uuid(1)),
  instalment_id: instalmentId.parse(uuid(1)),
  charge_id: null,
  amount_fils: fils.parse(105),
};
function cheque(): Cheque {
  return {
    id: chequeId.parse(uuid(1)),
    instalment_id: instalmentId.parse(uuid(1)),
    cheque_no: "SYNTHETIC",
    bank_name: "Synthetic Bank",
    drawer_name: "Synthetic Drawer",
    cheque_date: on,
    amount_fils: fils.parse(105),
    status: "received",
    replaces_cheque_id: null,
    deposited_on: null,
  };
}
function ticket(): TicketSnapshot {
  return {
    id: ticketId.parse(uuid(1)),
    status: "triaged",
    authorAccountId: tenant,
    authorRole: "tenant",
    ownerAccountId: owner,
    reportedAt: now,
    category: "plumbing",
    priority: "routine",
    payer: "owner",
    safetyFlags: [],
    linked_ticket_id: null,
    rating: null,
  };
}
function ticketContext(): TicketContext {
  return {
    actor: { role: "manager", accountId: manager, sessionAccountId: manager },
    cost: {
      costFils: fils.parse(200),
      costThresholdFils: fils.parse(100),
      emergencyLimitFils: fils.parse(300),
      ownerContactAttempts: 1,
      ownerReachable: false,
    },
    ownerApproval: null,
    now,
    confirmationDeadline: now,
  };
}

describe("IN1", () => {
  it("returns not found for another company's subject", () => {
    refusal(
      can(actor(), "read", "contracts", { company_id: otherCompany }),
      "NOT_FOUND",
    );
  });
});
describe("IN2", () => {
  it("refuses a second active staff membership across companies", () => {
    const current = membership.parse({
      id: uuid(1),
      company_id: company,
      account_id: manager,
      status: "invited",
      staff_roles: ["manager"],
      version: 1,
      reason: null,
    });
    const existing = {
      ...current,
      id: membershipId.parse(uuid(2)),
      company_id: otherCompany,
      status: "active",
    } as const;
    refusal(
      transitionMembership(
        current,
        { type: "accept_invitation" },
        {
          expected_version: 1,
          memberships: [existing],
        },
      ),
      "ACTIVE_MEMBERSHIP_EXISTS",
    );
  });
});
describe("IN3", () => {
  it.each(["owner", "tenant", "technician"] as const)(
    "confines %s to its own subject scope",
    (role) => {
      refusal(
        can(actor([role]), "read", "properties_units", { company_id: company }),
        "NOT_FOUND",
      );
      expect(
        can(actor([role]), "read", "properties_units", {
          company_id: company,
          owner_ids: actor().owner_ids,
          tenant_ids: actor().tenant_ids,
          assigned_technician_profile_ids: [technicianProfileId.parse(uuid(6))],
        }),
      ).toEqual({ ok: true, value: { level: "R", scope: "own" } });
    },
  );
});
describe("IN4", () => {
  it("returns no decision and leaves deeply frozen refused input unchanged", () => {
    const state = deepFreeze(contract());
    const before = JSON.stringify(state);
    refusal(
      transitionContract(
        state,
        { type: "submit", expectedVersion: 2 },
        deepFreeze(contractContext()),
      ),
      "VERSION_CONFLICT",
    );
    expect(JSON.stringify(state)).toBe(before);
    expect(Object.isFrozen(state.version.terms.instalments)).toBe(true);
  });
});
describe("IN5", () => {
  it("allows only read or draft families and only the named person to commit", () => {
    for (const family of coWorkerToolFamilies([
      "manager",
      "owner",
      "tenant",
      "technician",
      "company_administrator",
      "accountant",
    ])) {
      expect(["read", "draft"]).toContain(coWorkerToolEffects[family]);
    }
    refusal(
      transitionDraftedAction(draft(), commit, {
        ...draftContext,
        initiator: "co_worker",
      }),
      "PERSON_REQUIRED",
    );
    refusal(
      transitionDraftedAction(draft(), commit, {
        ...draftContext,
        account_id: owner,
      }),
      "NOT_DRAFTED_FOR_ACTOR",
    );
    expect(
      value(
        transitionDraftedAction(
          draft(),
          { ...commit, current_versions: { contract: 2 } },
          draftContext,
        ),
      ).status,
    ).toBe("expired");
    expect(
      value(transitionDraftedAction(draft(), commit, draftContext)).status,
    ).toBe("committed");
  });
});
describe("IN6", () => {
  it("requires confirmation and field provenance before accepting extracted values", () => {
    refusal(
      transitionDocumentReview(
        document(),
        { ...acceptDocument, datesConfirmed: false },
        "person",
      ),
      "INVALID_INPUT",
    );
    refusal(
      transitionDraftedAction(
        { ...draft(), field_provenance: {} },
        commit,
        draftContext,
      ),
      "INVALID_INPUT",
    );
    expect(
      value(transitionDraftedAction(draft(), commit, draftContext))
        .field_provenance,
    ).toEqual({ "/amount_fils": "ai_confirmed" });
  });
});
describe("IN7", () => {
  it("keeps pipeline processing separate from human review and business commit", () => {
    const next = value(
      transitionDocumentProcessing(
        document(),
        { type: "start_extraction" },
        "pipeline",
      ),
    );
    expect(next.version.processing_status).toBe("extracting");
    expect(next.version.review_status).toBe("pending_review");
    refusal(
      transitionDocumentReview(document(), acceptDocument, "pipeline"),
      "NOT_A_PERSON_COMMAND",
    );
    refusal(
      transitionDraftedAction(draft(), commit, {
        ...draftContext,
        initiator: "pipeline",
      }),
      "PERSON_REQUIRED",
    );
  });
});
describe("IN8", () => {
  it("requires distinct manager owner and tenant approvals on one hash", () => {
    const state = readyContract();
    const context: ContractContext = {
      ...contractContext(),
      actor: { role: "tenant", accountId: tenant, sessionAccountId: tenant },
    };
    const command = {
      type: "accept_tenant",
      expectedVersion: 1,
      subjectHash: "synthetic_hash",
    } as const;
    expect(value(transitionContract(state, command, context)).status).toBe(
      "concluded",
    );
    refusal(
      validateAcceptance(
        { ...state, approvals: [approval("manager")] },
        context,
      ),
      "APPROVALS_REQUIRED",
    );
    refusal(
      validateAcceptance(
        {
          ...state,
          approvals: [
            approval("manager"),
            { ...approval("owner"), subjectHash: "changed" },
          ],
        },
        context,
      ),
      "APPROVALS_REQUIRED",
    );
    refusal(
      validateAcceptance(
        {
          ...state,
          ownerAccountId: manager,
          approvals: [approval("manager"), approval("owner", manager)],
        },
        context,
      ),
      "APPROVER_NOT_DISTINCT",
    );
    refusal(
      validateAcceptance(state, {
        ...context,
        actor: {
          role: "tenant",
          accountId: manager,
          sessionAccountId: manager,
        },
      }),
      "APPROVER_NOT_DISTINCT",
    );
  });
  it("freezes owner gate precedence at submission", () => {
    const context = contractContext();
    expect(
      ownerGate(
        context.company,
        { ...context.property, ownerGateOverride: false },
        null,
        on,
      ),
    ).toBe(false);
    const result = value(
      transitionContract(
        contract(),
        { type: "submit", expectedVersion: 1 },
        context,
      ),
    );
    expect(result.effects).toContainEqual({
      type: "freeze_version",
      contentHash: "synthetic_hash",
      frozenOwnerGate: true,
    });
  });
});
describe("IN8R", () => {
  it("refuses retroactive conclusion without confirmed evidence", () => {
    const state = contract();
    const proposed: NewContract = {
      id: state.id,
      ownerAccountId: owner,
      tenantAccountId: tenant,
      tenantSignatoryAccountIds: [],
      terms: state.version.terms,
      contentHash: state.version.contentHash,
      linkedIdentity: identity,
      revisionOfId: null,
      renewalOfId: null,
    };
    refusal(
      transitionContract(
        null,
        {
          type: "conclude_retroactive",
          contract: proposed,
          managerConfirmation: null,
          document: registration().document,
          notifications: { owner, tenant },
        },
        contractContext(),
      ),
      "RETROACTIVE_EVIDENCE_MISSING",
    );
  });
});
describe("IN9", () => {
  it("refuses submitted edits and voids approvals on reasoned cancellation", () => {
    const state = readyContract();
    refusal(
      transitionContract(
        state,
        {
          type: "edit",
          expectedVersion: 1,
          terms: state.version.terms,
          contentHash: "changed",
        },
        contractContext(),
      ),
      "INVALID_TRANSITION",
    );
    refusal(
      transitionContract(
        state,
        { type: "withdraw", expectedVersion: 1, reason: "" },
        contractContext(),
      ),
      "REASON_REQUIRED",
    );
    const result = value(
      transitionContract(
        state,
        {
          type: "withdraw",
          expectedVersion: 1,
          reason: "Synthetic correction",
        },
        contractContext(),
      ),
    );
    expect(result.status).toBe("cancelled");
    expect(result.effects).toContainEqual({
      type: "void_live_approvals",
      reason: "contract_cancelled",
      statuses: ["requested", "approved"],
    });
  });
});
describe("IN10", () => {
  it("blocks overlapping contracts and derives occupancy from handovers", () => {
    const state = contract();
    const context: ContractContext = {
      ...contractContext(),
      blockingContracts: [
        {
          id: contractId.parse(uuid(2)),
          unitIds: state.version.terms.unitIds,
          termStart: on,
          termEnd: on,
          blocksUnit: true,
        },
      ],
    };
    expect(hasContractOverlap(state.id, state.version.terms, context)).toBe(
      true,
    );
    refusal(
      transitionContract(
        state,
        { type: "submit", expectedVersion: 1 },
        context,
      ),
      "OVERLAPPING_CONTRACT",
    );
    expect(
      isOccupied({ concludedContract: true, moveIn: on, moveOut: null }),
    ).toBe(true);
    expect(
      isOccupied({ concludedContract: true, moveIn: on, moveOut: on }),
    ).toBe(false);
    expect(
      isOccupied({ concludedContract: true, moveIn: null, moveOut: null }),
    ).toBe(false);
  });
});
describe("IN11", () => {
  it("requires registration document number date identity and approved resolutions", () => {
    const state = registration();
    expect(validateRegistration(state).ok).toBe(true);
    refusal(
      validateRegistration({ ...state, document: null }),
      "REGISTRATION_EVIDENCE_MISSING",
    );
    if (state.document === null) throw new Error("Expected synthetic evidence");
    for (const document of [
      { ...state.document, tawtheeqNumber: null },
      { ...state.document, registeredOn: null },
      { ...state.document, reviewStatus: "pending_review" as const },
    ])
      refusal(
        validateRegistration({ ...state, document }),
        "REGISTRATION_EVIDENCE_MISSING",
      );
    refusal(
      validateRegistration({
        ...state,
        document: {
          ...state.document,
          identity: { ...identity, unt_number: "OTHER" },
        },
      }),
      "IDENTITY_MISMATCH",
    );
    const discrepancy = {
      field: "total_fils",
      priorValue: 100,
      registeredValue: 200,
    } as const;
    refusal(
      validateRegistration({ ...state, discrepancies: [discrepancy] }),
      "DISCREPANCIES_UNRESOLVED",
    );
    const resolved = value(
      resolveDiscrepancy(discrepancy, {
        kind: "adopt",
        reason: "Registered amount confirmed",
      }),
    );
    const pending = {
      ...state,
      discrepancies: [discrepancy],
      resolutions: [resolved],
      managerApproval: approval("manager"),
    };
    refusal(validateRegistration(pending), "OWNER_REAPPROVAL_REQUIRED");
    expect(
      validateRegistration({
        ...pending,
        ownerApproval: { ...approval("owner"), kind: "owner_reapproval" },
      }).ok,
    ).toBe(true);
  });
});
describe("IN12", () => {
  it("refuses comparison adoption without a reason and preserves source values", () => {
    const discrepancy = deepFreeze({
      field: "total_fils",
      priorValue: 100,
      registeredValue: 200,
    } as const);
    refusal(
      resolveDiscrepancy(discrepancy, { kind: "adopt", reason: "" }),
      "REASON_REQUIRED",
    );
    expect(discrepancy.priorValue).toBe(100);
  });
});
describe("IN13", () => {
  it("assigns one firing key per rule subject and Dubai date", () => {
    const before = localDateOf(utcInstant.parse("2026-09-27T20:00:00Z"));
    const after = localDateOf(utcInstant.parse("2026-09-28T19:59:59Z"));
    expect(
      firingDedupeKey({ ruleCode: "n1", subjectId: uuid(1), fireOn: before }),
    ).toBe(
      firingDedupeKey({ ruleCode: "n1", subjectId: uuid(1), fireOn: after }),
    );
    expect(
      firingDedupeKey({ ruleCode: "n1", subjectId: uuid(1), fireOn: on }),
    ).not.toBe(
      firingDedupeKey({
        ruleCode: "n1",
        subjectId: uuid(1),
        fireOn: "2026-09-29",
      }),
    );
  });
});
describe("IN14", () => {
  it("reconciles instalments and per-line VAT and derives paid only at full coverage", () => {
    const terms = contract().version.terms;
    expect(validateContractSchedule(terms).ok).toBe(true);
    refusal(
      validateContractSchedule({ ...terms, totalFils: fils.parse(101) }),
      "SCHEDULE_TOTAL_MISMATCH",
    );
    refusal(
      validateContractSchedule({
        ...terms,
        instalments: [
          { seqNo: 1, amountFils: fils.parse(100), vatFils: fils.parse(4) },
        ],
      }),
      "SCHEDULE_TOTAL_MISMATCH",
    );
    expect(vatFils(fils.parse(10), basisPoints.parse(500))).toBe(1);
    const partial = value(
      allocate(
        ledger(),
        { ...allocation, amount_fils: fils.parse(104) },
        moneyContext,
      ),
    );
    expect(partial.instalments[0]?.status).toBe("partly_paid");
    const covered = value(allocate(ledger(), allocation, moneyContext));
    expect(covered.instalments[0]?.status).toBe("paid");
    expect(
      value(
        voidAllocation(covered, { allocation_id: allocation.id }, moneyContext),
      ).instalments[0]?.status,
    ).toBe("open");
    for (const payment of covered.payments)
      expect(paymentCredit(payment, covered.allocations, covered.refunds)).toBe(
        0,
      );
  });
});
describe("IN15", () => {
  it("refuses early deposit and flags six calendar months", () => {
    refusal(
      transitionCheque(
        { cheque: cheque(), ledger: ledger() },
        {
          to: "deposited",
          deposited_on: localDate.parse("2026-09-27"),
        },
        moneyContext,
      ),
      "EARLY_DEPOSIT",
    );
    expect(
      isChequeStale({ cheque: cheque(), on: localDate.parse("2027-03-27") }),
    ).toBe(false);
    expect(
      isChequeStale({ cheque: cheque(), on: localDate.parse("2027-03-28") }),
    ).toBe(true);
  });
});
describe("IN16", () => {
  it("issues one receipt and advances only the selected company series", () => {
    const command = {
      id: receiptId.parse(uuid(1)),
      payment_id: paymentId.parse(uuid(1)),
      external: null,
    };
    const issued = value(issueReceipt(ledger(), command, moneyContext));
    refusal(
      issueReceipt(
        issued,
        { ...command, id: receiptId.parse(uuid(2)) },
        moneyContext,
      ),
      "RECEIPT_ALREADY_ISSUED",
    );
    expect(issued.receipts).toHaveLength(1);
    const counter = { company_id: company, series: "INV", next: 1 } as const;
    const first = value(takeNumber(counter, { series: "INV" }, moneyContext));
    const second = value(
      takeNumber(first.next_counter, { series: "INV" }, moneyContext),
    );
    expect([first.number, second.number]).toEqual(["INV-000001", "INV-000002"]);
    expect(counter.next).toBe(1);
    refusal(
      takeNumber(
        { ...counter, company_id: otherCompany },
        { series: "INV" },
        moneyContext,
      ),
      "FORBIDDEN",
    );
  });
});
describe("IN17", () => {
  it("applies VAT only to commercial rent with a nonempty issuer TRN", () => {
    expect(
      applicableVatBp({
        unitUse: "commercial",
        issuerTrn: moneyContext.issuer_trn,
      }),
    ).toBe(500);
    expect(applicableVatBp({ unitUse: "commercial", issuerTrn: null })).toBe(0);
    expect(
      applicableVatBp({
        unitUse: "residential",
        issuerTrn: moneyContext.issuer_trn,
      }),
    ).toBe(0);
  });
});
describe("IN18", () => {
  it("rejects bank and IBAN fields on the stored tenant record", async () => {
    const { tenantRecord, ownerRecord } = await import("./index");
    const common = {
      companyId: company,
      version: 1,
      createdAt: now,
      createdBy: manager,
      updatedAt: null,
      updatedBy: null,
      eidNumber: null,
      passportNo: "SYNTHETIC-PASSPORT",
      email: "party@example.invalid",
      phoneE164: "+99912345678",
      preferredLanguage: "en",
      linkedAccountId: null,
    };
    const input = {
      ...common,
      id: tenantId.parse(uuid(1)),
      kind: "individual",
      nameEn: "Synthetic Tenant",
      nameAr: "مستأجر افتراضي",
      tradeLicenceNo: null,
      signatoryNameEn: null,
      signatoryNameAr: null,
      signatoryEidNumber: null,
    };
    expect(tenantRecord.parse(input)).toEqual(input);
    expect(
      tenantRecord.safeParse({ ...input, iban: "SYNTHETIC-IBAN" }).success,
    ).toBe(false);
    expect(
      tenantRecord.safeParse({ ...input, bankName: "Synthetic Bank" }).success,
    ).toBe(false);
    expect(
      tenantRecord.safeParse({ ...input, accountHolder: "Synthetic Tenant" })
        .success,
    ).toBe(false);

    const ownerInput = {
      ...common,
      id: ownerId.parse(uuid(1)),
      fullNameEn: "Synthetic Owner",
      fullNameAr: "مالك افتراضي",
      bankName: "Synthetic Bank",
      accountHolder: "Synthetic Owner",
      iban: "SYNTHETIC-IBAN",
      statementLockedThrough: null,
    };
    expect(ownerRecord.parse(ownerInput)).toEqual(ownerInput);
  });

  it("rejects bank and IBAN fields on the existing tenant invitation boundary", () => {
    const input = {
      id: invitationId.parse(uuid(1)),
      company_id: company,
      kind: "tenant",
      tenant_id: tenantId.parse(uuid(1)),
      status: "pending",
      email: "tenant@example.invalid",
      sent_at: now,
      version: 1,
      accepted_by_account_id: null,
      confirmed_by_manager_account_id: null,
      reason: null,
    };
    expect(invitation.safeParse(input).success).toBe(true);
    expect(invitation.safeParse({ ...input, iban: "SYNTHETIC" }).success).toBe(
      false,
    );
    expect(
      invitation.safeParse({ ...input, bank_account: "SYNTHETIC" }).success,
    ).toBe(false);
  });
});
describe("IN19", () => {
  it("refuses an unreconciled statement before issue and period locking", () => {
    const statement: OwnerStatement = {
      id: ownerStatementId.parse(uuid(1)),
      company_id: company,
      status: "in_review",
      period_from: on,
      period_to: on,
      opening_fils: fils.parse(100),
      collections_fils: fils.parse(50),
      fees_fils: fils.parse(10),
      expenses_fils: fils.parse(20),
      payouts_fils: fils.parse(30),
      closing_fils: fils.parse(91),
      period_locked: false,
      number: null,
    };
    const state = {
      statement,
      counter: { company_id: company, series: "STMT", next: 1 } as const,
    };
    refusal(
      transitionOwnerStatement(state, { to: "issued" }, moneyContext),
      "STATEMENT_NOT_BALANCED",
    );
    const issued = value(
      transitionOwnerStatement(
        { ...state, statement: { ...statement, closing_fils: fils.parse(90) } },
        { to: "issued" },
        moneyContext,
      ),
    );
    expect(issued.statement.period_locked).toBe(true);
    expect(issued.statement.number).toBe("STMT-000001");
  });
});
describe("IN20", () => {
  it("requires cost approval or the emergency rule and completion before closure", () => {
    const context = ticketContext();
    refusal(
      transitionTicket(ticket(), { type: "schedule" }, context),
      "COST_APPROVAL_REQUIRED",
    );
    expect(
      costApprovalRoute({ ...context.cost, safetyCritical: true }).route,
    ).toBe("emergency_rule");
    const emergency = value(
      transitionTicket(
        { ...ticket(), safetyFlags: ["water_into_electrics"] },
        { type: "schedule" },
        context,
      ),
    );
    expect(emergency.notify_owner).toBe(true);
    refusal(
      transitionTicket(
        ticket(),
        { type: "close", confirmation: "window_lapsed", costAllocated: true },
        context,
      ),
      "INVALID_TRANSITION",
    );
    refusal(
      transitionTicket(
        { ...ticket(), status: "work_completed" },
        { type: "close", confirmation: "window_lapsed", costAllocated: false },
        context,
      ),
      "COST_ALLOCATION_REQUIRED",
    );
    expect(
      value(
        transitionTicket(
          { ...ticket(), status: "work_completed" },
          { type: "close", confirmation: "window_lapsed", costAllocated: true },
          context,
        ),
      ).ticket.status,
    ).toBe("closed");
  });
});

function auditChain(): { rows: ChainRow[]; head: ChainCheckpoint } {
  const rows: ChainRow[] = [];
  let head: ChainCheckpoint | null = null;
  for (const seq of [1, 2, 3]) {
    const event = auditEventContent.parse({
      event_id: uuid(seq),
      company_id: company,
      seq,
      occurred_at: now,
      tx_id: String(seq),
      event_type: "contract.created",
      actor_account_id: manager,
      actor_role: "manager",
      on_behalf_of: null,
      initiator: "person",
      channel: "web_form",
      subject_type: "contract",
      subject_id: uuid(1),
      version_before: null,
      version_after: 1,
      changed_fields: ["status"],
      before_hash: null,
      after_hash: null,
      reason: null,
      drafted_action_id: null,
      field_provenance: { status: "human_entered" },
      model_call_ids: [],
      registry_entry: null,
      prompt_version: null,
      tool_version: null,
      policy_decision: null,
      idempotency_key: null,
      trace_id: null,
      visibility: "staff",
      retention_class: "company_lifetime",
    });
    const appended = appendToChain(head, event);
    rows.push(appended.row);
    head = appended.head;
  }
  if (head === null) throw new Error("Expected an audit head");
  return { rows, head };
}
describe("IN21", () => {
  it("verifies the chain and detects content sequence link head and anchor tampering", () => {
    const chain = auditChain();
    expect(verifyChain({ ...chain, anchor: chain.head }).ok).toBe(true);
    const first = chain.rows[0];
    if (first === undefined) throw new Error("Expected a first event");
    const cases = [
      { ...chain, rows: chain.rows.slice(1) },
      { ...chain, rows: [...chain.rows].reverse() },
      {
        ...chain,
        rows: chain.rows.map((row) =>
          row.seq === 2 ? { ...row, canonical_text: "{}" } : row,
        ),
      },
      {
        ...chain,
        rows: chain.rows.map((row) =>
          row.seq === 2 ? { ...row, prev_hash: "f".repeat(64) } : row,
        ),
      },
      {
        ...chain,
        rows: chain.rows.map((row) =>
          row.seq === 2 ? { ...row, row_hash: "f".repeat(64) } : row,
        ),
      },
      {
        ...chain,
        rows: chain.rows.map((row) =>
          row.seq === 2 ? { ...row, canon_version: "changed" } : row,
        ),
      },
      { ...chain, rows: chain.rows.slice(0, 2) },
      { ...chain, head: { ...chain.head, head_hash: "f".repeat(64) } },
      { rows: [first], head: { seq: first.seq, head_hash: first.row_hash } },
    ];
    for (const tampered of cases)
      expect(verifyChain({ ...tampered, anchor: chain.head }).ok).toBe(false);
  });
  it("documents the unanchored tail limitation and canonical type collision", () => {
    const chain = auditChain();
    const first = chain.rows[0];
    if (first === undefined) throw new Error("Expected a first event");
    const checkpoint = { seq: first.seq, head_hash: first.row_hash };
    expect(
      verifyChain({ rows: [first], head: checkpoint, anchor: checkpoint }).ok,
    ).toBe(true);
    expect(encodeCanonical(1)).toBe(encodeCanonical("1"));
    expect(requestSha256({ pathParams: {}, body: 1 })).toBe(
      requestSha256({ pathParams: {}, body: "1" }),
    );
  });
});
describe("IN22", () => {
  it("keeps the shared reminder notification identity stable across object ordering", () => {
    const key = firingDedupeKey({
      ruleCode: "n3",
      subjectId: uuid(1),
      fireOn: on,
    });
    expect(key).toBe(
      firingDedupeKey({ fireOn: on, subjectId: uuid(1), ruleCode: "n3" }),
    );
    expect(key).not.toBe(
      firingDedupeKey({ fireOn: on, subjectId: uuid(2), ruleCode: "n3" }),
    );
    expect(key).not.toBe(
      firingDedupeKey({ fireOn: on, subjectId: uuid(1), ruleCode: "n4" }),
    );
  });
});
