import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  contractId,
  documentVersionId,
  draftedActionId,
  handoverId,
  personAccountId,
  propertyId,
  unitId,
} from "../ids";
import { basisPoints, fils, vatFils } from "../money";
import { localDate } from "../time";
import {
  approvalSlot,
  contractStatus,
  type ApprovalSlot,
  type ContractStatus,
} from "../vocabulary";
import type { RegisteredDocument } from "../tawtheeq/index";
import {
  approvedSlot,
  contractErrorCode,
  contractTransitions,
  hasContractOverlap,
  retroactiveConfirmationFields,
  transitionContract,
  validateAcceptance,
  validateContractSchedule,
  validateContractTerms,
  type ContractApproval,
  type ContractCommand,
  type ContractContext,
  type ContractDecision,
  type ContractSnapshot,
  type ContractTerms,
  type NewContract,
  type RetroactiveConfirmation,
} from "./index";

const manager = personAccountId.parse("00000000-0000-4000-8000-000000000001");
const owner = personAccountId.parse("00000000-0000-4000-8000-000000000002");
const tenant = personAccountId.parse("00000000-0000-4000-8000-000000000003");
const signatory = personAccountId.parse("00000000-0000-4000-8000-000000000004");
const id = contractId.parse("00000000-0000-4000-8000-000000000005");
const successor = contractId.parse("00000000-0000-4000-8000-000000000006");
const unit = unitId.parse("00000000-0000-4000-8000-000000000007");
const documentId = documentVersionId.parse(
  "00000000-0000-4000-8000-000000000008",
);
const hash = "content-v1";
const accounts = { manager, owner, tenant };
const terms: ContractTerms = {
  unitIds: [unit],
  termStart: localDate.parse("2026-01-01"),
  termEnd: localDate.parse("2026-12-31"),
  totalFils: fils.parse(10000),
  vatBp: basisPoints.parse(500),
  instalments: [
    { seqNo: 1, amountFils: fils.parse(10000), vatFils: fils.parse(500) },
  ],
};
const identity = {
  unt_number: "UNT-SYNTHETIC-1",
  owner_id_number: "OWNER-TEST-1",
  tenant_id_number: "TENANT-TEST-1",
};
const document: RegisteredDocument = {
  documentVersionId: documentId,
  processingStatus: "scan_clean",
  reviewStatus: "accepted",
  tawtheeqNumber: "T-TEST-1",
  registeredOn: localDate.parse("2026-01-01"),
  identity,
};
const newContract: NewContract = {
  id,
  ownerAccountId: owner,
  tenantAccountId: tenant,
  tenantSignatoryAccountIds: [signatory],
  terms,
  contentHash: hash,
  linkedIdentity: identity,
  revisionOfId: null,
  renewalOfId: null,
};
const confirmation: RetroactiveConfirmation = {
  draftedActionId: draftedActionId.parse(
    "00000000-0000-4000-8000-000000000009",
  ),
  sourceDocumentVersionId: documentId,
  contentHash: hash,
  requiredFields: [...retroactiveConfirmationFields],
  fields: Object.fromEntries(
    retroactiveConfirmationFields.map((field) => [field, "ai_confirmed"]),
  ),
};
function context(role: ApprovalSlot = "manager", gate = true): ContractContext {
  return {
    actor: {
      role,
      accountId: accounts[role],
      sessionAccountId: accounts[role],
    },
    on: localDate.parse("2026-09-28"),
    company: { kind: "management_company", defaultOwnerGate: true },
    property: {
      id: propertyId.parse("00000000-0000-4000-8000-000000000010"),
      ownerGateOverride: gate,
    },
    mandate: null,
    blockedUnitIds: [],
    blockingContracts: [],
    tenantExists: true,
    tenantDocumentsAccepted: true,
    ownerAccountActive: true,
  };
}
function approval(
  slot: ApprovalSlot,
  changes: Partial<ContractApproval> = {},
): ContractApproval {
  return {
    slot,
    kind: "contract_approval",
    status: "approved",
    subjectHash: hash,
    approverAccountId: accounts[slot],
    sessionAccountId: accounts[slot],
    ...changes,
  };
}
function snapshot(
  status: ContractStatus = "draft",
  gate = true,
): ContractSnapshot {
  return {
    id,
    status,
    origin: "app",
    version: {
      number: 1,
      contentHash: hash,
      submitted: status !== "draft",
      frozenOwnerGate: status === "draft" ? null : gate,
      terms,
    },
    ownerAccountId: owner,
    tenantAccountId: tenant,
    tenantSignatoryAccountIds: [signatory],
    approvals:
      status === "awaiting_owner_approval"
        ? [approval("manager"), approval("owner", { status: "requested" })]
        : [
            approval("manager"),
            ...(gate ? [approval("owner")] : []),
            approval("tenant", { status: "requested" }),
          ],
    successorId: null,
  };
}
function command(type: ContractCommand["type"]): ContractCommand {
  switch (type) {
    case "create":
      return { type, contract: newContract };
    case "edit":
      return { type, expectedVersion: 1, terms, contentHash: "content-v2" };
    case "submit":
      return { type, expectedVersion: 1 };
    case "approve_owner":
    case "accept_tenant":
      return { type, expectedVersion: 1, subjectHash: hash };
    case "return_owner":
    case "return_tenant":
    case "withdraw":
    case "cancel_draft":
      return { type, expectedVersion: 1, reason: "Requested correction" };
    case "revise":
      return {
        type,
        expectedVersion: 1,
        contract: { ...newContract, id: successor },
      };
    case "conclude_retroactive":
      return {
        type,
        contract: newContract,
        managerConfirmation: confirmation,
        document,
        notifications: { owner, tenant },
      };
    case "end":
      return {
        type,
        expectedVersion: 1,
        endReason: "expired",
        effectiveOn: terms.termEnd,
        evidenceDocumentVersionId: documentId,
        moveOutHandoverId: null,
      };
  }
}
function refused(
  result: { readonly ok: boolean },
  code: string,
  field?: string,
): void {
  expect(result.ok).toBe(false);
  expect(result).not.toHaveProperty("value");
  expect(result).toMatchObject({
    error: { code, ...(field === undefined ? {} : { field }) },
  });
  expect(contractErrorCode.safeParse(code).success).toBe(true);
}
function accepted(
  result: ReturnType<typeof transitionContract>,
): ContractDecision {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

const expectedEffects: Readonly<Record<string, readonly string[]>> = {
  T1: ["create_contract", "create_version", "set_blocks_unit"],
  T2: ["create_version"],
  T3: [
    "freeze_version",
    "record_approval",
    "request_approval",
    "set_blocks_unit",
    "notify",
  ],
  T4: [
    "freeze_version",
    "record_approval",
    "request_approval",
    "set_blocks_unit",
    "notify",
  ],
  T5: ["record_approval", "request_approval", "notify"],
  T6: ["set_cancel_kind", "void_live_approvals", "set_blocks_unit", "notify"],
  T7: ["record_approval", "create_tawtheeq_record", "activate_schedule"],
  T8: ["set_cancel_kind", "void_live_approvals", "set_blocks_unit", "notify"],
  T9: ["set_cancel_kind", "void_live_approvals", "set_blocks_unit", "notify"],
  T10: ["set_cancel_kind", "void_live_approvals", "set_blocks_unit"],
  T11: [
    "create_contract",
    "create_version",
    "set_blocks_unit",
    "link_revision",
  ],
  T12: [
    "create_contract",
    "create_version",
    "record_retroactive_confirmation",
    "record_approval",
    "set_blocks_unit",
    "create_tawtheeq_record",
    "activate_schedule",
    "notify",
    "notify",
  ],
  T13: ["record_end", "set_blocks_unit"],
};

const expectedEvents: Readonly<Record<string, readonly string[]>> = {
  T1: ["contract.created"],
  T2: ["contract.updated"],
  T3: ["contract.awaiting_owner_approval", "approval.approved"],
  T4: ["contract.awaiting_tenant_acceptance", "approval.approved"],
  T5: ["approval.approved", "contract.awaiting_tenant_acceptance"],
  T6: ["contract.cancelled", "approval.voided"],
  T7: [
    "approval.approved",
    "contract.concluded",
    "tawtheeq_record.awaiting_registration",
  ],
  T8: ["contract.cancelled", "approval.voided"],
  T9: ["contract.cancelled", "approval.voided"],
  T10: ["contract.cancelled", "approval.voided"],
  T11: ["contract.created"],
  T12: [
    "contract.created",
    "approval.approved",
    "contract.concluded",
    "tawtheeq_record.registered",
  ],
  T13: ["contract.ended"],
};

describe("contract lifecycle", () => {
  it.each(contractTransitions)(
    "AC-1 $id $from to $to declares atomic effects",
    (row) => {
      const state =
        row.from === null ? null : snapshot(row.from, row.gate ?? true);
      const before = structuredClone(state);
      const result = accepted(
        transitionContract(
          state,
          command(row.command),
          context(row.actor, row.gate ?? true),
        ),
      );
      expect(result.status).toBe(row.to);
      expect(result.events).toEqual(expectedEvents[row.id]);
      expect(new Set(result.effects.map((effect) => effect.type))).toEqual(
        new Set(expectedEffects[row.id]),
      );
      expect(state).toEqual(before);
      if (row.id === "T3" || row.id === "T4") {
        expect(result.effects).toContainEqual({
          type: "freeze_version",
          contentHash: hash,
          frozenOwnerGate: row.gate,
        });
        expect(result.effects).toContainEqual({
          type: "record_approval",
          approval: approval("manager"),
        });
        expect(result.effects).toContainEqual({
          type: "set_blocks_unit",
          value: true,
        });
      }
      if (row.id === "T1" || row.id === "T11")
        expect(result.effects).toContainEqual({
          type: "set_blocks_unit",
          value: false,
        });
      if (row.id === "T2")
        expect(result.effects).toContainEqual({
          type: "create_version",
          number: 2,
          terms,
          contentHash: "content-v2",
        });
      if (row.id === "T5")
        expect(result.effects).toContainEqual({
          type: "record_approval",
          approval: approval("owner"),
        });
      if (row.id === "T7")
        expect(result.effects).toContainEqual({
          type: "create_tawtheeq_record",
          path: "normal",
          state: "awaiting_registration",
        });
      if (row.id === "T11")
        expect(result.effects).toContainEqual({
          type: "link_revision",
          revisionOfId: id,
          successorId: successor,
        });
      if (row.id === "T12") {
        expect(result.effects).toContainEqual({
          type: "record_approval",
          approval: approval("manager", { kind: "retroactive_confirmation" }),
        });
        expect(result.effects).toContainEqual({
          type: "create_tawtheeq_record",
          path: "retroactive",
          state: "registered",
          document,
        });
        expect(
          result.effects
            .filter((effect) => effect.type === "notify")
            .map((effect) => effect.recipient),
        ).toEqual(["owner", "tenant"]);
      }
      if (row.id === "T13")
        expect(result.effects).toContainEqual({
          type: "set_blocks_unit",
          value: false,
          effectiveOn: localDate.parse("2027-01-01"),
        });
    },
  );

  it.each([
    ["awaiting_owner_approval", "edit", "manager", "INVALID_TRANSITION"],
    [
      "awaiting_owner_approval",
      "accept_tenant",
      "tenant",
      "INVALID_TRANSITION",
    ],
    ["draft", "submit", "owner", "INVALID_TRANSITION"],
  ] as const)("AC-2 rejects %s %s by %s", (status, type, role, code) => {
    refused(
      transitionContract(snapshot(status), command(type), context(role)),
      code,
    );
  });

  it.each(["approve_owner", "accept_tenant"] as const)(
    "AC-2 refuses stale hash for %s",
    (type) => {
      const status =
        type === "approve_owner"
          ? "awaiting_owner_approval"
          : "awaiting_tenant_acceptance";
      refused(
        transitionContract(
          snapshot(status),
          { type, expectedVersion: 1, subjectHash: "stale" },
          context(type === "approve_owner" ? "owner" : "tenant"),
        ),
        "STALE_SUBJECT_HASH",
      );
    },
  );

  it.each(["manager", "owner"] as const)(
    "AC-2 tenant cannot share the %s person",
    (slot) => {
      const state = {
        ...snapshot("awaiting_tenant_acceptance"),
        tenantAccountId: accounts[slot],
      };
      const ctx = {
        ...context("tenant"),
        actor: {
          role: "tenant",
          accountId: accounts[slot],
          sessionAccountId: accounts[slot],
        },
      } satisfies ContractContext;
      refused(
        transitionContract(state, command("accept_tenant"), ctx),
        "APPROVER_NOT_DISTINCT",
      );
    },
  );

  it("AC-2 owner cannot be the manager approver", () => {
    const state = {
      ...snapshot("awaiting_owner_approval"),
      ownerAccountId: manager,
    };
    refused(
      transitionContract(state, command("approve_owner"), {
        ...context("owner"),
        actor: { role: "owner", accountId: manager, sessionAccountId: manager },
      }),
      "APPROVER_NOT_DISTINCT",
    );
  });

  it.each([
    ["awaiting_owner_approval", "return_owner", "owner", "returned_by_owner"],
    [
      "awaiting_tenant_acceptance",
      "return_tenant",
      "tenant",
      "returned_by_tenant",
    ],
    ["awaiting_owner_approval", "withdraw", "manager", "withdrawn_by_manager"],
    [
      "awaiting_tenant_acceptance",
      "withdraw",
      "manager",
      "withdrawn_by_manager",
    ],
    ["draft", "cancel_draft", "manager", "cancelled_draft"],
  ] as const)(
    "AC-2 AC-4 %s %s requires a reason and voids live approvals",
    (status, type, role, cancelKind) => {
      const state = snapshot(status);
      refused(
        transitionContract(
          state,
          { type, expectedVersion: 1, reason: "  " },
          context(role),
        ),
        "REASON_REQUIRED",
      );
      const result = accepted(
        transitionContract(
          state,
          { type, expectedVersion: 1, reason: "  Correction  " },
          context(role),
        ),
      );
      expect(result.events).toContain("approval.voided");
      expect(result.effects).toContainEqual({
        type: "void_live_approvals",
        reason: "contract_cancelled",
        statuses: ["requested", "approved"],
      });
      expect(result.effects).toContainEqual({
        type: "set_blocks_unit",
        value: false,
      });
      expect(result.effects).toContainEqual({
        type: "set_cancel_kind",
        cancelKind,
        reason: "Correction",
      });
    },
  );

  it("AC-2 refuses a second successor", () => {
    refused(
      transitionContract(
        { ...snapshot("cancelled"), successorId: successor },
        command("revise"),
        context(),
      ),
      "SUCCESSOR_EXISTS",
    );
  });

  it.each(["submit", "accept_tenant", "conclude_retroactive"] as const)(
    "AC-2 exclusion is rechecked for %s",
    (type) => {
      const state =
        type === "conclude_retroactive"
          ? null
          : snapshot(
              type === "submit" ? "draft" : "awaiting_tenant_acceptance",
            );
      const ctx = {
        ...context(type === "accept_tenant" ? "tenant" : "manager"),
        blockingContracts: [
          {
            id: successor,
            unitIds: [unit],
            termStart: terms.termStart,
            termEnd: terms.termEnd,
            blocksUnit: true,
          },
        ],
      };
      refused(
        transitionContract(state, command(type), ctx),
        "OVERLAPPING_CONTRACT",
      );
    },
  );

  it.each([
    ["manager_confirmation", { managerConfirmation: null }],
    ["registered_document", { document: null }],
    ["party_notifications", { notifications: null }],
  ] as const)("AC-2 IN8R requires %s", (field, patch) => {
    const cmd = command("conclude_retroactive");
    if (cmd.type !== "conclude_retroactive") throw new Error("Fixture");
    refused(
      transitionContract(null, { ...cmd, ...patch }, context()),
      "RETROACTIVE_EVIDENCE_MISSING",
      field,
    );
  });

  it.each([
    { ...confirmation, contentHash: "stale" },
    {
      ...confirmation,
      fields: { ...confirmation.fields, total_fils: "unconfirmed" },
    },
    {
      ...confirmation,
      requiredFields: [...confirmation.requiredFields, "deposit_fils"],
    },
    {
      ...confirmation,
      sourceDocumentVersionId: documentVersionId.parse(
        "00000000-0000-4000-8000-000000000099",
      ),
    },
  ] satisfies readonly RetroactiveConfirmation[])(
    "IN8R refuses partial or unrelated manager confirmation %#",
    (managerConfirmation) => {
      const cmd = command("conclude_retroactive");
      if (cmd.type !== "conclude_retroactive") throw new Error("Fixture");
      refused(
        transitionContract(null, { ...cmd, managerConfirmation }, context()),
        "RETROACTIVE_EVIDENCE_MISSING",
        "manager_confirmation",
      );
    },
  );

  it.each(["unt_number", "owner_id_number", "tenant_id_number"] as const)(
    "IN8R refuses identity mismatch %s",
    (field) => {
      const cmd = command("conclude_retroactive");
      if (cmd.type !== "conclude_retroactive") throw new Error("Fixture");
      refused(
        transitionContract(
          null,
          {
            ...cmd,
            document: {
              ...document,
              identity: { ...identity, [field]: "OTHER" },
            },
          },
          context(),
        ),
        "IDENTITY_MISMATCH",
        field,
      );
    },
  );

  it("IN8R rejects recipients other than the linked parties", () => {
    const cmd = command("conclude_retroactive");
    if (cmd.type !== "conclude_retroactive") throw new Error("Fixture");
    refused(
      transitionContract(
        null,
        { ...cmd, notifications: { owner, tenant: manager } },
        context(),
      ),
      "RETROACTIVE_EVIDENCE_MISSING",
      "party_notifications",
    );
  });

  it("AC-3 uses the frozen gate after the property policy changes", () => {
    const state = {
      ...snapshot("awaiting_tenant_acceptance"),
      approvals: [approval("manager")],
    };
    refused(
      transitionContract(
        state,
        command("accept_tenant"),
        context("tenant", false),
      ),
      "APPROVALS_REQUIRED",
    );
    expect(
      accepted(
        transitionContract(
          snapshot("awaiting_tenant_acceptance"),
          command("accept_tenant"),
          context("tenant", false),
        ),
      ).status,
    ).toBe("concluded");
    expect(
      accepted(
        transitionContract(
          snapshot("awaiting_tenant_acceptance", false),
          command("accept_tenant"),
          context("tenant", true),
        ),
      ).status,
    ).toBe("concluded");
  });

  it.each([null, owner])(
    "AC-3 gated submission requires an active owner account %s",
    (ownerAccountId) => {
      refused(
        transitionContract(
          { ...snapshot(), ownerAccountId },
          command("submit"),
          { ...context(), ownerAccountActive: false },
        ),
        "OWNER_ACCOUNT_REQUIRED",
      );
    },
  );

  it.each([
    {
      ...terms,
      instalments: [
        { seqNo: 1, amountFils: fils.parse(10000), vatFils: fils.parse(501) },
      ],
    },
    {
      ...terms,
      instalments: [
        {
          seqNo: 1,
          amountFils: fils.parse(9999),
          vatFils: vatFils(fils.parse(9999), terms.vatBp),
        },
      ],
    },
  ])("AC-5 rejects one fils schedule errors %#", (invalidTerms) => {
    const state = snapshot();
    refused(
      transitionContract(
        { ...state, version: { ...state.version, terms: invalidTerms } },
        command("submit"),
        context(),
      ),
      "SCHEDULE_TOTAL_MISMATCH",
      invalidTerms.instalments[0]?.vatFils === 501 ? "1" : "total_fils",
    );
  });

  it.each(["owner", "tenant"] as const)(
    "requires the named %s in their own session",
    (role) => {
      const state = snapshot(
        role === "owner"
          ? "awaiting_owner_approval"
          : "awaiting_tenant_acceptance",
      );
      const cmd = command(role === "owner" ? "approve_owner" : "accept_tenant");
      refused(
        transitionContract(state, cmd, {
          ...context(role),
          actor: { role, accountId: accounts[role], sessionAccountId: manager },
        }),
        "NOT_OWN_SESSION",
      );
      refused(
        transitionContract(state, cmd, {
          ...context(role),
          actor: { role, accountId: manager, sessionAccountId: manager },
        }),
        "NOT_NAMED_PARTY",
      );
    },
  );

  it("accepts an authorised tenant signatory", () => {
    const ctx = {
      ...context("tenant"),
      actor: {
        role: "tenant",
        accountId: signatory,
        sessionAccountId: signatory,
      },
    } satisfies ContractContext;
    expect(
      accepted(
        transitionContract(
          snapshot("awaiting_tenant_acceptance"),
          command("accept_tenant"),
          ctx,
        ),
      ).effects,
    ).toContainEqual({
      type: "record_approval",
      approval: approval("tenant", {
        approverAccountId: signatory,
        sessionAccountId: signatory,
      }),
    });
  });

  it("checks expected version before editing", () => {
    refused(
      transitionContract(
        snapshot(),
        { type: "edit", expectedVersion: 2, terms, contentHash: hash },
        context(),
      ),
      "VERSION_CONFLICT",
    );
  });

  it.each(["edit", "submit"] as const)(
    "prevents %s of a submitted draft",
    (type) => {
      const state = snapshot();
      refused(
        transitionContract(
          { ...state, version: { ...state.version, submitted: true } },
          command(type),
          context(),
        ),
        "INVALID_TRANSITION",
      );
    },
  );

  it.each([
    ["TENANT_REQUIRED", { tenantExists: false }],
    ["UNIT_BLOCKED", { blockedUnitIds: [unit] }],
  ] as const)("creation guard %s", (code, patch) => {
    refused(
      transitionContract(null, command("create"), { ...context(), ...patch }),
      code,
    );
  });

  it("requires tenant documents at submission", () => {
    refused(
      transitionContract(snapshot(), command("submit"), {
        ...context(),
        tenantDocumentsAccepted: false,
      }),
      "TENANT_DOCUMENTS_REQUIRED",
    );
  });

  it.each([
    { ...newContract, contentHash: " " },
    { ...newContract, revisionOfId: successor, renewalOfId: successor },
    { ...newContract, terms: { ...terms, unitIds: [] } },
  ])("rejects invalid new contract %#", (contract) => {
    refused(
      transitionContract(null, { type: "create", contract }, context()),
      "INVALID_INPUT",
    );
  });

  it("retains optional revision and renewal links", () => {
    for (const contract of [
      { ...newContract, revisionOfId: successor },
      { ...newContract, renewalOfId: successor },
    ]) {
      expect(
        accepted(
          transitionContract(null, { type: "create", contract }, context()),
        ).effects,
      ).toContainEqual({ type: "create_contract", contract, origin: "app" });
    }
    refused(
      transitionContract(
        snapshot("cancelled"),
        { type: "revise", expectedVersion: 1, contract: newContract },
        context(),
      ),
      "INVALID_INPUT",
      "id",
    );
  });

  it.each(["edit", "submit"] as const)(
    "requires a nonempty hash for %s",
    (type) => {
      const state = snapshot();
      const cmd: ContractCommand =
        type === "edit"
          ? { type, expectedVersion: 1, terms, contentHash: " " }
          : command(type);
      refused(
        transitionContract(
          { ...state, version: { ...state.version, contentHash: " " } },
          cmd,
          context(),
        ),
        "INVALID_INPUT",
        "content_hash",
      );
    },
  );

  it("rejects invalid edited terms and retroactive creation", () => {
    refused(
      transitionContract(
        snapshot(),
        {
          type: "edit",
          expectedVersion: 1,
          terms: { ...terms, unitIds: [] },
          contentHash: hash,
        },
        context(),
      ),
      "INVALID_INPUT",
    );
    refused(
      transitionContract(null, command("conclude_retroactive"), {
        ...context(),
        tenantExists: false,
      }),
      "TENANT_REQUIRED",
    );
  });

  it("T13 refuses an end date without a representable following day", () => {
    const cmd = command("end");
    if (cmd.type !== "end") throw new Error("Fixture");
    refused(
      transitionContract(
        snapshot("concluded"),
        { ...cmd, effectiveOn: localDate.parse("9999-12-31") },
        context(),
      ),
      "INVALID_INPUT",
      "effective_on",
    );
  });

  it("T13 requires evidence and a valid effective date", () => {
    const cmd = command("end");
    if (cmd.type !== "end") throw new Error("Fixture");
    refused(
      transitionContract(
        snapshot("concluded"),
        { ...cmd, evidenceDocumentVersionId: null },
        context(),
      ),
      "END_EVIDENCE_MISSING",
    );
    refused(
      transitionContract(
        snapshot("concluded"),
        { ...cmd, effectiveOn: localDate.parse("2025-12-31") },
        context(),
      ),
      "INVALID_INPUT",
    );
    expect(
      accepted(
        transitionContract(
          snapshot("concluded"),
          {
            ...cmd,
            evidenceDocumentVersionId: null,
            moveOutHandoverId: handoverId.parse(
              "00000000-0000-4000-8000-000000000012",
            ),
          },
          context(),
        ),
      ).status,
    ).toBe("ended");
  });
});

describe("contract invariant guards", () => {
  it.each([
    { ...terms, unitIds: [] },
    { ...terms, unitIds: [unit, unit] },
    { ...terms, termEnd: localDate.parse("2025-12-31") },
    { ...terms, totalFils: fils.parse(-1) },
  ])("refuses invalid terms %#", (invalid) => {
    refused(validateContractTerms(invalid), "INVALID_INPUT");
  });

  it.each(
    [
      [],
      [{ seqNo: 0, amountFils: fils.parse(10000), vatFils: fils.parse(500) }],
      [{ seqNo: 1, amountFils: fils.parse(-1), vatFils: fils.parse(0) }],
      [{ seqNo: 1, amountFils: fils.parse(10000), vatFils: fils.parse(-1) }],
      [terms.instalments[0], terms.instalments[0]].filter(
        (line) => line !== undefined,
      ),
      [1, 2].map((seqNo) => ({
        seqNo,
        amountFils: fils.parse(Number.MAX_SAFE_INTEGER),
        vatFils: vatFils(fils.parse(Number.MAX_SAFE_INTEGER), terms.vatBp),
      })),
    ].map((instalments) => ({ instalments })),
  )("validates schedule lines and total %#", ({ instalments }) => {
    const result = validateContractSchedule({ ...terms, instalments });
    refused(
      result,
      instalments.length === 0 ||
        instalments[0]?.amountFils === Number.MAX_SAFE_INTEGER
        ? "SCHEDULE_TOTAL_MISMATCH"
        : "INVALID_INPUT",
    );
  });

  it("propagates invalid terms through schedule validation", () => {
    refused(
      validateContractSchedule({ ...terms, unitIds: [] }),
      "INVALID_INPUT",
    );
  });

  it.each([
    {
      id,
      blocksUnit: true,
      unitIds: [unit],
      termStart: terms.termStart,
      termEnd: terms.termEnd,
    },
    {
      id: successor,
      blocksUnit: false,
      unitIds: [unit],
      termStart: terms.termStart,
      termEnd: terms.termEnd,
    },
    {
      id: successor,
      blocksUnit: true,
      unitIds: [],
      termStart: terms.termStart,
      termEnd: terms.termEnd,
    },
    {
      id: successor,
      blocksUnit: true,
      unitIds: [unit],
      termStart: localDate.parse("2027-01-01"),
      termEnd: localDate.parse("2027-12-31"),
    },
    {
      id: successor,
      blocksUnit: true,
      unitIds: [unit],
      termStart: localDate.parse("2025-01-01"),
      termEnd: localDate.parse("2025-12-31"),
    },
  ])(
    "exclusion ignores self, nonblocking, disjoint units and dates %#",
    (other) => {
      expect(
        hasContractOverlap(id, terms, {
          ...context(),
          blockingContracts: [other],
        }),
      ).toBe(false);
    },
  );

  it.each(
    [
      [],
      [approval("manager"), approval("manager")],
      [approval("manager", { subjectHash: "stale" })],
      [approval("manager", { kind: "skip_confirmation" })],
      [approval("manager", { sessionAccountId: owner })],
      [approval("manager", { status: "voided" })],
    ].map((approvals) => ({ approvals })),
  )("approvedSlot rejects an invalid approval %#", ({ approvals }) => {
    expect(
      approvedSlot({ ...snapshot(), approvals }, "manager"),
    ).toBeUndefined();
  });

  it.each([
    { ...snapshot("awaiting_tenant_acceptance"), approvals: [] },
    {
      ...snapshot("awaiting_tenant_acceptance"),
      version: { ...snapshot().version, frozenOwnerGate: null },
    },
    { ...snapshot("awaiting_tenant_acceptance"), ownerAccountId: signatory },
    {
      ...snapshot("awaiting_tenant_acceptance", false),
      approvals: [approval("manager"), approval("owner")],
    },
  ])("IN8 refuses missing or extraneous approval prerequisites %#", (state) => {
    refused(validateAcceptance(state, context("tenant")), "APPROVALS_REQUIRED");
  });

  it("IN8 rejects identical stored manager and owner persons", () => {
    refused(
      validateAcceptance(
        {
          ...snapshot("awaiting_tenant_acceptance"),
          ownerAccountId: manager,
          approvals: [
            approval("manager"),
            approval("owner", {
              approverAccountId: manager,
              sessionAccountId: manager,
            }),
          ],
        },
        context("tenant"),
      ),
      "APPROVER_NOT_DISTINCT",
    );
  });

  it.each([[], [approval("manager")]].map((approvals) => ({ approvals })))(
    "owner approval requires the manager and frozen gate %#",
    ({ approvals }) => {
      const state = snapshot("awaiting_owner_approval");
      refused(
        transitionContract(
          {
            ...state,
            approvals,
            version: { ...state.version, frozenOwnerGate: false },
          },
          command("approve_owner"),
          context("owner"),
        ),
        "APPROVALS_REQUIRED",
      );
    },
  );
});

function applyDecision(
  state: ContractSnapshot | null,
  result: ContractDecision,
): ContractSnapshot {
  let next = state ?? { ...snapshot("draft"), approvals: [] };
  for (const effect of result.effects) {
    if (effect.type === "create_contract")
      next = {
        ...snapshot("draft"),
        ...effect.contract,
        origin: effect.origin,
        approvals: [],
      };
    if (effect.type === "create_version")
      next = {
        ...next,
        version: {
          number: effect.number,
          contentHash: effect.contentHash,
          terms: effect.terms,
          submitted: false,
          frozenOwnerGate: null,
        },
      };
    if (effect.type === "freeze_version")
      next = {
        ...next,
        version: {
          ...next.version,
          submitted: true,
          contentHash: effect.contentHash,
          frozenOwnerGate: effect.frozenOwnerGate,
        },
      };
    if (effect.type === "record_approval")
      next = {
        ...next,
        approvals: [
          ...next.approvals.filter(
            (item) => item.slot !== effect.approval.slot,
          ),
          effect.approval,
        ],
      };
    if (effect.type === "request_approval")
      next = {
        ...next,
        approvals: [
          ...next.approvals,
          approval(effect.slot, {
            status: "requested",
            subjectHash: effect.subjectHash,
            approverAccountId: effect.accountId,
            sessionAccountId: effect.accountId,
          }),
        ],
      };
    if (effect.type === "void_live_approvals")
      next = {
        ...next,
        approvals: next.approvals.map((item) =>
          item.status === "approved" || item.status === "requested"
            ? { ...item, status: "voided" }
            : item,
        ),
      };
  }
  return { ...next, status: result.status };
}

describe("contract command sequence properties", () => {
  it("AC-6 random commands never throw, follow the table and preserve IN8", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.integer({ min: 0, max: 4 }),
        fc.array(
          fc.record({
            type: fc.constantFrom(
              ...contractTransitions.map((row) => row.command),
            ),
            role: fc.constantFrom(...approvalSlot.options),
            person: fc.constantFrom(manager, owner, tenant),
            ownSession: fc.boolean(),
            hash: fc.constantFrom(hash, "stale"),
            reason: fc.constantFrom(null, "", "Correction"),
            version: fc.integer({ min: 1, max: 3 }),
          }),
          { maxLength: 60 },
        ),
        (gate, prefixLength, steps) => {
          let state: ContractSnapshot | null = null;
          const prefix = [
            { type: "create", role: "manager" },
            { type: "submit", role: "manager" },
            ...(gate
              ? [{ type: "approve_owner", role: "owner" } as const]
              : []),
            { type: "accept_tenant", role: "tenant" },
          ] as const;
          const attempts = [
            ...prefix.slice(0, prefixLength).map((step) => ({
              type: step.type,
              role: step.role,
              person: accounts[step.role],
              ownSession: true,
              hash,
              reason: "Correction",
              version: 1,
            })),
            ...steps,
          ];
          for (const step of attempts) {
            const base = command(step.type);
            const cmd = {
              ...base,
              ...("expectedVersion" in base
                ? { expectedVersion: step.version }
                : {}),
              ...("subjectHash" in base ? { subjectHash: step.hash } : {}),
              ...("reason" in base ? { reason: step.reason } : {}),
            };
            const ctx = {
              ...context(step.role, gate),
              actor: {
                role: step.role,
                accountId: step.person,
                sessionAccountId: step.ownSession ? step.person : signatory,
              },
            };
            const before = structuredClone(state);
            const result = transitionContract(state, cmd, ctx);
            expect(state).toEqual(before);
            if (!result.ok) {
              refused(result, result.error.code);
              continue;
            }
            expect(
              contractTransitions.some(
                (row) =>
                  row.from === (state?.status ?? null) &&
                  row.to === result.value.status &&
                  row.command === step.type &&
                  row.actor === step.role &&
                  (row.gate === undefined || row.gate === gate),
              ),
            ).toBe(true);
            state = applyDecision(state, result.value);
            if (state.status === "concluded" && state.origin === "app") {
              const approvals = state.approvals.filter(
                (item) => item.status === "approved",
              );
              expect(approvals.map((item) => item.slot).sort()).toEqual(
                gate ? ["manager", "owner", "tenant"] : ["manager", "tenant"],
              );
              expect(
                new Set(approvals.map((item) => item.approverAccountId)).size,
              ).toBe(approvals.length);
              expect(
                approvals.every(
                  (item) =>
                    item.subjectHash === state?.version.contentHash &&
                    item.approverAccountId === item.sessionAccountId,
                ),
              ).toBe(true);
            }
          }
        },
      ),
      { seed: 920262, numRuns: 100 },
    );
  }, 60_000);

  it.each(
    contractStatus.options.filter(
      (status) => status === "ended" || status === "cancelled",
    ),
  )("AC-6 terminal %s only permits a cancelled revision", (status) => {
    for (const row of contractTransitions) {
      const result = transitionContract(
        snapshot(status),
        command(row.command),
        context(row.actor),
      );
      if (status === "cancelled" && row.command === "revise")
        expect(result.ok).toBe(true);
      else refused(result, "INVALID_TRANSITION");
    }
  });
});
