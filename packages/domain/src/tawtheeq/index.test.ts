import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { documentVersionId, personAccountId } from "../ids";
import { localDate } from "../time";
import {
  documentProcessingStatus,
  documentReviewStatus,
  tawtheeqWorkflowState,
  type ApprovalSlot,
} from "../vocabulary";
import type { ContractApproval } from "../contract/index";
import {
  classifyDiscrepancy,
  createAdoptionVersion,
  discrepancyFields,
  identityFields,
  identityMismatch,
  linkedRegistrationEvidence,
  mayMoveCurrentVersion,
  portalStatusOf,
  requiresOwnerReapproval,
  resolveDiscrepancy,
  resolveDiscrepancies,
  tawtheeqErrorCode,
  tawtheeqTransitions,
  transitionTawtheeq,
  validateRegistration,
  validateRegistrationEvidence,
  type DiscrepancyResolutionInput,
  type RegisteredDocument,
  type ResolutionChoice,
  type ResolvedDiscrepancy,
  type TawtheeqCommand,
  type TawtheeqContext,
  type TawtheeqDecision,
  type TawtheeqDiscrepancy,
  type TawtheeqSnapshot,
} from "./index";

const manager = personAccountId.parse("00000000-0000-4000-8000-000000000001");
const owner = personAccountId.parse("00000000-0000-4000-8000-000000000002");
const tenant = personAccountId.parse("00000000-0000-4000-8000-000000000003");
const docId = documentVersionId.parse("00000000-0000-4000-8000-000000000004");
const otherDocId = documentVersionId.parse(
  "00000000-0000-4000-8000-000000000005",
);
const hash = "contract-content";
const adoptedHash = "adopted-content";
const identity = {
  unt_number: "UNT-TEST-1",
  owner_id_number: "OWNER-TEST-1",
  tenant_id_number: "TENANT-TEST-1",
};
const document: RegisteredDocument = {
  documentVersionId: docId,
  processingStatus: "scan_clean",
  reviewStatus: "accepted",
  tawtheeqNumber: "T-TEST-1",
  registeredOn: localDate.parse("2026-09-28"),
  identity,
};
const material: TawtheeqDiscrepancy = {
  field: "annual_rent_fils",
  priorValue: 10000,
  registeredValue: 12000,
};
const minor: TawtheeqDiscrepancy = {
  field: "occupants",
  priorValue: "Person A",
  registeredValue: "Person B",
};
const formatted: TawtheeqDiscrepancy = {
  field: "contacts",
  priorValue: "TEST@EXAMPLE.INVALID",
  registeredValue: "test@example.invalid",
};
const adopt: ResolutionChoice = {
  kind: "adopt",
  reason: "Use the registered terms",
};
const resolved: ResolvedDiscrepancy = {
  ...material,
  resolution: { kind: "adopt", reason: "Use the registered terms" },
};
const choices: readonly DiscrepancyResolutionInput[] = [
  { field: material.field, choice: adopt },
];
const priorValues = { annual_rent_fils: 10000, occupants: "Person A" };
function context(role: ApprovalSlot = "manager"): TawtheeqContext {
  const accountId = { manager, owner, tenant }[role];
  return {
    actor: { role, accountId, sessionAccountId: accountId },
    on: localDate.parse("2026-09-28"),
  };
}
function approval(
  slot: ApprovalSlot = "manager",
  changes: Partial<ContractApproval> = {},
): ContractApproval {
  const accountId = { manager, owner, tenant }[slot];
  return {
    slot,
    kind: slot === "owner" ? "owner_reapproval" : "contract_approval",
    status: "approved",
    subjectHash: adoptedHash,
    approverAccountId: accountId,
    sessionAccountId: accountId,
    ...changes,
  };
}
function snapshot(changes: Partial<TawtheeqSnapshot> = {}): TawtheeqSnapshot {
  return {
    state: "awaiting_registration",
    path: "normal",
    version: 1,
    contractStatus: "concluded",
    frozenOwnerGate: true,
    ownerAccountId: owner,
    tenantAccountId: tenant,
    contractContentHash: hash,
    subjectHash: hash,
    priorValues,
    linkedIdentity: identity,
    documentVersionId: docId,
    document,
    discrepancies: [],
    resolutions: [],
    candidateVersion: null,
    managerApproval: null,
    ownerApproval: null,
    ...changes,
  };
}
function adoption(changes: Partial<TawtheeqSnapshot> = {}): TawtheeqSnapshot {
  const version = createAdoptionVersion(priorValues, [resolved], adoptedHash);
  if (!version.ok) throw new Error("Fixture");
  return snapshot({
    state: "awaiting_owner_reapproval",
    subjectHash: adoptedHash,
    discrepancies: [material],
    resolutions: [resolved],
    candidateVersion: version.value,
    managerApproval: approval(),
    ...changes,
  });
}
function command(type: TawtheeqCommand["type"]): TawtheeqCommand {
  switch (type) {
    case "attest_portal":
    case "resume":
      return { type, expectedVersion: 1 };
    case "portal_return":
    case "owner_return":
      return { type, expectedVersion: 1, reason: "Correction requested" };
    case "skip":
      return {
        type,
        expectedVersion: 1,
        reason: "Registration is not needed",
        ownerConfirmation: approval("owner", {
          kind: "skip_confirmation",
          subjectHash: hash,
        }),
      };
    case "upload":
      return { type, expectedVersion: 1, documentVersionId: docId };
    case "reject_identity":
      return {
        type,
        expectedVersion: 1,
        document: {
          ...document,
          identity: { ...identity, unt_number: "OTHER" },
        },
      };
    case "confirm_matches":
      return { type, expectedVersion: 1, document };
    case "open_discrepancies":
      return { type, expectedVersion: 1, document, discrepancies: [material] };
    case "reregister":
      return {
        type,
        expectedVersion: 1,
        subjectHash: hash,
        choices: [
          {
            field: material.field,
            choice: {
              kind: "cancel_and_reregister",
              reason: "Correct the portal",
            },
          },
        ],
      };
    case "prepare_adoption":
    case "register_resolved":
      return { type, expectedVersion: 1, choices, subjectHash: adoptedHash };
    case "owner_reapprove":
      return { type, expectedVersion: 1, subjectHash: adoptedHash };
    case "close":
      return {
        type,
        expectedVersion: 1,
        reason: "Portal closed",
        closureKind: "portal_close",
      };
  }
}
function accepted(
  result: ReturnType<typeof transitionTawtheeq>,
): TawtheeqDecision {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
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
  expect(tawtheeqErrorCode.safeParse(code).success).toBe(true);
}

const effectTypes: Readonly<
  Record<TawtheeqCommand["type"], readonly string[]>
> = {
  attest_portal: ["record_portal_attestation"],
  portal_return: ["record_reason"],
  skip: ["set_path", "record_reason", "record_skip_confirmation"],
  resume: ["set_path", "clear_review"],
  upload: ["clear_review", "link_document"],
  reject_identity: ["clear_review", "reject_upload"],
  confirm_matches: ["record_document"],
  open_discrepancies: ["record_document", "record_discrepancies"],
  reregister: ["record_resolutions", "clear_review"],
  prepare_adoption: [
    "record_resolutions",
    "record_approval",
    "create_adoption_version",
    "request_owner_reapproval",
    "notify",
  ],
  register_resolved: [
    "record_resolutions",
    "record_approval",
    "create_adoption_version",
    "move_current_version",
    "record_document_acceptance",
    "notify",
  ],
  owner_reapprove: [
    "record_approval",
    "move_current_version",
    "record_document_acceptance",
    "notify",
  ],
  owner_return: ["return_owner_reapproval", "notify"],
  close: ["record_close"],
};

describe("Tawtheeq workflow", () => {
  it.each(tawtheeqTransitions)("AC-7 $from to $to via $command", (row) => {
    const state =
      row.from === "awaiting_owner_reapproval"
        ? adoption()
        : snapshot({
            state: row.from,
            discrepancies: row.from === "discrepancies_open" ? [material] : [],
            frozenOwnerGate: row.command !== "register_resolved",
          });
    const before = structuredClone(state);
    const result = accepted(
      transitionTawtheeq(state, command(row.command), context(row.actor)),
    );
    expect(result.state).toBe(row.to);
    expect(result.events).toContain(`tawtheeq_record.${row.to}`);
    expect(result.effects.map((effect) => effect.type)).toEqual(
      effectTypes[row.command],
    );
    expect(state).toEqual(before);
    refused(
      transitionTawtheeq(
        { ...state, state: "closed" },
        command(row.command),
        context(row.actor),
      ),
      "INVALID_TRANSITION",
    );
  });

  it("AC-7 skip requires a reason", () => {
    refused(
      transitionTawtheeq(
        snapshot(),
        {
          type: "skip",
          expectedVersion: 1,
          reason: " ",
          ownerConfirmation: null,
        },
        context(),
      ),
      "REASON_REQUIRED",
    );
  });
  it("AC-7 gated skip requires owner confirmation", () => {
    refused(
      transitionTawtheeq(
        snapshot(),
        {
          type: "skip",
          expectedVersion: 1,
          reason: "Not needed",
          ownerConfirmation: null,
        },
        context(),
      ),
      "OWNER_CONFIRMATION_REQUIRED",
    );
  });
  it("AC-7 ungated skip needs no owner confirmation", () => {
    const result = accepted(
      transitionTawtheeq(
        snapshot({ frozenOwnerGate: false }),
        {
          type: "skip",
          expectedVersion: 1,
          reason: "Not needed",
          ownerConfirmation: null,
        },
        context(),
      ),
    );
    expect(result.effects).toEqual([
      { type: "set_path", path: "skip" },
      { type: "record_reason", reason: "Not needed" },
    ]);
  });
  it.each([
    { slot: "tenant" },
    { kind: "contract_approval" },
    { status: "requested" },
    { subjectHash: "stale" },
    { approverAccountId: manager },
    { sessionAccountId: manager },
  ] satisfies readonly Partial<ContractApproval>[])(
    "rejects invalid skip confirmation %#",
    (patch) => {
      refused(
        transitionTawtheeq(
          snapshot(),
          {
            type: "skip",
            expectedVersion: 1,
            reason: "Not needed",
            ownerConfirmation: approval("owner", {
              kind: "skip_confirmation",
              subjectHash: hash,
              ...patch,
            }),
          },
          context(),
        ),
        "OWNER_CONFIRMATION_REQUIRED",
      );
    },
  );

  it.each([
    ["document_version_id", { document: null }],
    ["tawtheeq_number", { document: { ...document, tawtheeqNumber: null } }],
    ["registered_on", { document: { ...document, registeredOn: null } }],
  ] as const)("AC-7 registration requires %s", (field, patch) => {
    refused(
      validateRegistration(snapshot(patch)),
      "REGISTRATION_EVIDENCE_MISSING",
      field,
    );
  });

  it("AC-7 rejects a mismatching identity upload and permits a new upload", () => {
    const result = accepted(
      transitionTawtheeq(
        snapshot({ state: "under_review" }),
        command("reject_identity"),
        context(),
      ),
    );
    expect(result.state).toBe("awaiting_registration");
    expect(result.events).toContain("tawtheeq_record.upload_rejected");
    expect(result.effects).toContainEqual({
      type: "reject_upload",
      field: "unt_number",
    });
  });

  it("AC-2 gated material adoption waits for owner and cannot move the current version", () => {
    refused(
      transitionTawtheeq(
        snapshot({ state: "discrepancies_open", discrepancies: [material] }),
        command("register_resolved"),
        context(),
      ),
      "OWNER_REAPPROVAL_REQUIRED",
    );
    expect(mayMoveCurrentVersion(adoption())).toBe(false);
    const result = accepted(
      transitionTawtheeq(
        adoption(),
        command("owner_reapprove"),
        context("owner"),
      ),
    );
    expect(result.effects).toContainEqual({
      type: "move_current_version",
      contentHash: adoptedHash,
    });
    expect(result.effects).toContainEqual({
      type: "record_document_acceptance",
      documentVersionId: docId,
      subjectHash: adoptedHash,
    });
    expect(result.effects).toContainEqual({
      type: "notify",
      recipient: "tenant",
      template: "tawtheeq_adoption_registered",
    });
    expect(
      mayMoveCurrentVersion(adoption({ ownerApproval: approval("owner") })),
    ).toBe(true);
  });

  it.each([
    ["awaiting_registration", "not_started"],
    ["submitted_on_portal", "pending"],
    ["under_review", "pending"],
    ["discrepancies_open", "pending"],
    ["awaiting_owner_reapproval", "pending"],
    ["registered", "registered"],
    ["skipped", "skipped"],
    ["closed", "cancelled"],
  ] as const)("AC-7 derives %s portal status %s", (state, expected) => {
    expect(portalStatusOf(state, { isRenewal: false })).toBe(expected);
    expect(portalStatusOf(state, { isRenewal: true })).toBe(
      state === "registered" ? "renewed" : expected,
    );
  });

  it("refuses concurrency, role, session and named party violations", () => {
    refused(
      transitionTawtheeq(
        snapshot(),
        { type: "attest_portal", expectedVersion: 2 },
        context(),
      ),
      "VERSION_CONFLICT",
    );
    refused(
      transitionTawtheeq(
        snapshot(),
        command("attest_portal"),
        context("tenant"),
      ),
      "INVALID_TRANSITION",
    );
    refused(
      transitionTawtheeq(snapshot(), command("attest_portal"), {
        ...context(),
        actor: {
          role: "manager",
          accountId: manager,
          sessionAccountId: tenant,
        },
      }),
      "NOT_OWN_SESSION",
    );
    refused(
      transitionTawtheeq(adoption(), command("owner_reapprove"), {
        ...context("owner"),
        actor: { role: "owner", accountId: tenant, sessionAccountId: tenant },
      }),
      "NOT_NAMED_PARTY",
    );
    refused(
      transitionTawtheeq(
        adoption(),
        { type: "owner_reapprove", expectedVersion: 1, subjectHash: "stale" },
        context("owner"),
      ),
      "STALE_SUBJECT_HASH",
    );
    refused(
      transitionTawtheeq(
        adoption({
          managerApproval: approval("manager", {
            approverAccountId: owner,
            sessionAccountId: owner,
          }),
        }),
        command("owner_reapprove"),
        context("owner"),
      ),
      "APPROVER_NOT_DISTINCT",
    );
  });

  it.each([
    ["submitted_on_portal", "portal_return", "manager"],
    ["awaiting_owner_reapproval", "owner_return", "owner"],
    ["registered", "close", "manager"],
  ] as const)("requires reason for %s %s", (state, type, role) => {
    const cmd = command(type);
    if (!("reason" in cmd)) throw new Error("Fixture");
    refused(
      transitionTawtheeq(
        snapshot({ state }),
        { ...cmd, reason: null },
        context(role),
      ),
      "REASON_REQUIRED",
    );
  });

  it.each([
    "portal_close",
    "cancellation",
    "renewal",
    "court_termination",
  ] as const)("records closure kind %s", (closureKind) => {
    expect(
      accepted(
        transitionTawtheeq(
          snapshot({ state: "registered" }),
          {
            type: "close",
            expectedVersion: 1,
            closureKind,
            reason: "Evidence recorded",
          },
          context(),
        ),
      ).effects,
    ).toContainEqual({
      type: "record_close",
      closureKind,
      reason: "Evidence recorded",
    });
  });

  it("requires the current uploaded document and actual identity mismatch", () => {
    refused(
      transitionTawtheeq(
        snapshot({ state: "under_review", documentVersionId: otherDocId }),
        command("confirm_matches"),
        context(),
      ),
      "REGISTRATION_EVIDENCE_MISSING",
    );
    refused(
      transitionTawtheeq(
        snapshot({ state: "under_review" }),
        { type: "reject_identity", expectedVersion: 1, document },
        context(),
      ),
      "INVALID_INPUT",
      "identity",
    );
    refused(
      transitionTawtheeq(
        snapshot({ state: "under_review" }),
        {
          type: "confirm_matches",
          expectedVersion: 1,
          document: { ...document, tawtheeqNumber: null },
        },
        context(),
      ),
      "REGISTRATION_EVIDENCE_MISSING",
    );
    refused(
      transitionTawtheeq(
        snapshot({ state: "under_review", discrepancies: [material] }),
        command("confirm_matches"),
        context(),
      ),
      "DISCREPANCIES_UNRESOLVED",
    );
  });

  it.each([[], [material, material]])(
    "requires a nonempty unique discrepancy list %#",
    (...discrepancies) => {
      refused(
        transitionTawtheeq(
          snapshot({ state: "under_review" }),
          {
            type: "open_discrepancies",
            expectedVersion: 1,
            document,
            discrepancies,
          },
          context(),
        ),
        "INVALID_INPUT",
        "discrepancies",
      );
    },
  );

  it("rejects identity fields presented as term discrepancies", () => {
    refused(
      transitionTawtheeq(
        snapshot({ state: "under_review" }),
        {
          type: "open_discrepancies",
          expectedVersion: 1,
          document,
          discrepancies: [
            { field: "unt_number", priorValue: "A", registeredValue: "B" },
          ],
        },
        context(),
      ),
      "IDENTITY_MISMATCH",
      "unt_number",
    );
  });

  it("resolves minor adoption without owner reapproval and retains concluded contract", () => {
    const state = snapshot({
      state: "discrepancies_open",
      discrepancies: [minor],
    });
    const result = accepted(
      transitionTawtheeq(
        state,
        {
          type: "register_resolved",
          expectedVersion: 1,
          subjectHash: adoptedHash,
          choices: [{ field: minor.field, choice: adopt }],
        },
        context(),
      ),
    );
    expect(result.state).toBe("registered");
    expect(state.contractStatus).toBe("concluded");
    expect(result.effects).toContainEqual({
      type: "move_current_version",
      contentHash: adoptedHash,
    });
  });

  it("registers text equivalence without creating a new contract version", () => {
    const result = accepted(
      transitionTawtheeq(
        snapshot({ state: "discrepancies_open", discrepancies: [formatted] }),
        {
          type: "register_resolved",
          expectedVersion: 1,
          subjectHash: hash,
          choices: [
            {
              field: formatted.field,
              choice: {
                kind: "mark_equivalent",
                reason: "Case formatting",
                basis: "formatting",
              },
            },
          ],
        },
        context(),
      ),
    );
    expect(result.effects.map((effect) => effect.type)).toEqual([
      "record_resolutions",
      "record_approval",
    ]);
  });

  it("requires cancellation choice for reregister and prevents registering that choice", () => {
    const state = snapshot({
      state: "discrepancies_open",
      discrepancies: [material],
    });
    refused(
      transitionTawtheeq(
        state,
        { type: "reregister", expectedVersion: 1, subjectHash: hash, choices },
        context(),
      ),
      "INVALID_INPUT",
      "resolutions",
    );
    const cmd = command("reregister");
    if (cmd.type !== "reregister") throw new Error("Fixture");
    refused(
      transitionTawtheeq(
        state,
        { ...cmd, type: "register_resolved" },
        context(),
      ),
      "DISCREPANCIES_UNRESOLVED",
    );
    refused(
      transitionTawtheeq(
        state,
        {
          type: "register_resolved",
          expectedVersion: 1,
          subjectHash: adoptedHash,
          choices: [],
        },
        context(),
      ),
      "DISCREPANCIES_UNRESOLVED",
    );
  });

  it.each([
    ["INVALID_TRANSITION", { contractStatus: "ended" }],
    ["STALE_SUBJECT_HASH", { priorValues: { annual_rent_fils: 9000 } }],
  ] as const)("adoption prerequisite %s", (code, patch) => {
    refused(
      transitionTawtheeq(
        snapshot({
          state: "discrepancies_open",
          discrepancies: [material],
          ...patch,
        }),
        command("prepare_adoption"),
        context(),
      ),
      code,
    );
  });

  it("requires a new adoption hash and the original equivalence hash", () => {
    refused(
      transitionTawtheeq(
        snapshot({ state: "discrepancies_open", discrepancies: [material] }),
        {
          type: "prepare_adoption",
          expectedVersion: 1,
          choices,
          subjectHash: hash,
        },
        context(),
      ),
      "STALE_SUBJECT_HASH",
    );
    refused(
      transitionTawtheeq(
        snapshot({ state: "discrepancies_open", discrepancies: [formatted] }),
        {
          type: "register_resolved",
          expectedVersion: 1,
          subjectHash: adoptedHash,
          choices: [
            {
              field: formatted.field,
              choice: {
                kind: "mark_equivalent",
                reason: "Formatting",
                basis: "formatting",
              },
            },
          ],
        },
        context(),
      ),
      "STALE_SUBJECT_HASH",
    );
  });

  it("prepares owner approval only when needed and with registration evidence", () => {
    refused(
      transitionTawtheeq(
        snapshot({
          state: "discrepancies_open",
          discrepancies: [material],
          frozenOwnerGate: false,
        }),
        command("prepare_adoption"),
        context(),
      ),
      "INVALID_TRANSITION",
    );
    refused(
      transitionTawtheeq(
        snapshot({
          state: "discrepancies_open",
          discrepancies: [material],
          document: null,
        }),
        command("prepare_adoption"),
        context(),
      ),
      "REGISTRATION_EVIDENCE_MISSING",
    );
  });

  it("cannot register adoption without the complete candidate version", () => {
    for (const state of [
      adoption({ candidateVersion: null }),
      adoption({ contractStatus: "ended" }),
    ]) {
      refused(
        transitionTawtheeq(state, command("owner_reapprove"), context("owner")),
        "REGISTRATION_EVIDENCE_MISSING",
        "adoption_approval_set",
      );
    }
  });
});

describe("IN11 evidence and approval set", () => {
  it.each(documentProcessingStatus.options)(
    "accepts only scan-clean or later processing %s",
    (processingStatus) => {
      const result = validateRegistrationEvidence(
        { ...document, processingStatus },
        identity,
      );
      if (
        ["scan_clean", "extracting", "extracted", "extraction_failed"].includes(
          processingStatus,
        )
      )
        expect(result.ok).toBe(true);
      else refused(result, "REGISTRATION_EVIDENCE_MISSING");
    },
  );
  it.each(documentReviewStatus.options)(
    "requires accepted review %s",
    (reviewStatus) => {
      const result = validateRegistrationEvidence(
        { ...document, reviewStatus },
        identity,
      );
      if (reviewStatus === "accepted") expect(result.ok).toBe(true);
      else refused(result, "REGISTRATION_EVIDENCE_MISSING");
    },
  );
  it.each(identityFields)("matches identity %s", (field) => {
    const changed = { ...identity, [field]: "OTHER" };
    expect(identityMismatch(changed, identity)).toBe(field);
    refused(
      validateRegistrationEvidence(
        { ...document, identity: changed },
        identity,
      ),
      "IDENTITY_MISMATCH",
      field,
    );
  });
  it("refuses blank number and mismatched linked document", () => {
    refused(
      validateRegistrationEvidence(
        { ...document, tawtheeqNumber: " " },
        identity,
      ),
      "REGISTRATION_EVIDENCE_MISSING",
      "tawtheeq_number",
    );
    refused(
      linkedRegistrationEvidence(snapshot({ documentVersionId: otherDocId })),
      "REGISTRATION_EVIDENCE_MISSING",
      "document_version_id",
    );
  });
  it("requires matching discrepancy and resolution sets", () => {
    refused(
      validateRegistration(snapshot({ resolutions: [resolved] })),
      "DISCREPANCIES_UNRESOLVED",
    );
    refused(
      validateRegistration(adoption({ resolutions: [] })),
      "DISCREPANCIES_UNRESOLVED",
    );
    refused(
      validateRegistration(
        adoption({
          resolutions: [
            {
              ...resolved,
              resolution: {
                kind: "cancel_and_reregister",
                reason: "Correct portal",
              },
            },
          ],
        }),
      ),
      "DISCREPANCIES_UNRESOLVED",
    );
  });
  it.each([
    null,
    approval("tenant"),
    approval("manager", { kind: "skip_confirmation" }),
    approval("manager", { status: "requested" }),
    approval("manager", { subjectHash: "stale" }),
    approval("manager", { sessionAccountId: tenant }),
  ])("requires a valid manager resolution approval %#", (managerApproval) => {
    refused(
      validateRegistration(adoption({ managerApproval })),
      "REGISTRATION_EVIDENCE_MISSING",
      "manager_confirmation",
    );
  });
  it.each([
    null,
    approval("tenant"),
    approval("owner", { kind: "contract_approval" }),
    approval("owner", { status: "requested" }),
    approval("owner", { subjectHash: "stale" }),
    approval("owner", { approverAccountId: tenant }),
    approval("owner", { sessionAccountId: tenant }),
  ])("requires a valid named owner reapproval %#", (ownerApproval) => {
    refused(
      validateRegistration(adoption({ ownerApproval })),
      "OWNER_REAPPROVAL_REQUIRED",
    );
  });
  it("requires distinct manager and owner reapproval persons", () => {
    refused(
      validateRegistration(
        adoption({
          managerApproval: approval("manager", {
            approverAccountId: owner,
            sessionAccountId: owner,
          }),
          ownerApproval: approval("owner"),
        }),
      ),
      "OWNER_REAPPROVAL_REQUIRED",
    );
  });
  it.each([
    { contractStatus: "ended" },
    { candidateVersion: null },
    { subjectHash: hash },
    { resolutions: [] },
    { priorValues: { annual_rent_fils: 9000 } },
  ] satisfies readonly Partial<TawtheeqSnapshot>[])(
    "does not move incomplete or stale adoption %#",
    (patch) => {
      expect(
        mayMoveCurrentVersion(
          adoption({ ownerApproval: approval("owner"), ...patch }),
        ),
      ).toBe(false);
    },
  );
  it("does not move a candidate with changed or missing values", () => {
    const state = adoption({ ownerApproval: approval("owner") });
    if (state.candidateVersion === null) throw new Error("Fixture");
    expect(
      mayMoveCurrentVersion({
        ...state,
        candidateVersion: { ...state.candidateVersion, values: {} },
      }),
    ).toBe(false);
    expect(
      mayMoveCurrentVersion({
        ...state,
        candidateVersion: { ...state.candidateVersion, contentHash: "other" },
      }),
    ).toBe(false);
  });
});

describe("discrepancy policy and immutable adoption", () => {
  it.each(Object.entries(discrepancyFields))(
    "classifies field %s",
    (key, policy) => {
      const field = Object.keys(discrepancyFields).find((item) => item === key);
      expect(field).toBe(key);
      expect(policy.class).toBe(
        ["unt_number", "owner_id_number", "tenant_id_number"].includes(key)
          ? "identity"
          : [
                "occupants",
                "utilities",
                "contacts",
                "owner_name",
                "tenant_name",
              ].includes(key)
            ? "minor"
            : "material",
      );
    },
  );
  it.each(["unt_number", "term_start", "occupants"] as const)(
    "classifyDiscrepancy consults %s policy",
    (field) => {
      expect(classifyDiscrepancy(field)).toBe(discrepancyFields[field].class);
    },
  );
  it.each(["annual_rent_fils", "term_start", "tenant_id_number"] as const)(
    "AC-2 cannot mark equivalent %s",
    (field) => {
      refused(
        resolveDiscrepancy(
          { field, priorValue: "A", registeredValue: "B" },
          {
            kind: "mark_equivalent",
            basis: "formatting",
            reason: "Formatting",
          },
        ),
        "MARK_EQUIVALENT_NOT_ALLOWED",
        field,
      );
    },
  );
  it.each([
    { kind: "adopt", reason: null },
    { kind: "cancel_and_reregister", reason: " " },
    { kind: "mark_equivalent", reason: "", basis: "transliteration" },
  ] satisfies readonly ResolutionChoice[])(
    "every resolution requires a reason %#",
    (choice) => {
      refused(resolveDiscrepancy(minor, choice), "REASON_REQUIRED");
    },
  );
  it("allows formatting and manager-attested transliteration only for text", () => {
    expect(
      resolveDiscrepancy(formatted, {
        kind: "mark_equivalent",
        reason: "Case only",
        basis: "formatting",
      }).ok,
    ).toBe(true);
    expect(
      resolveDiscrepancy(
        {
          field: "owner_name",
          priorValue: "Name A",
          registeredValue: "Name B",
        },
        {
          kind: "mark_equivalent",
          reason: "Same name transliterated",
          basis: "transliteration",
        },
      ).ok,
    ).toBe(true);
    refused(
      resolveDiscrepancy(minor, {
        kind: "mark_equivalent",
        reason: "Different person",
        basis: "formatting",
      }),
      "MARK_EQUIVALENT_NOT_ALLOWED",
    );
    refused(
      resolveDiscrepancy(
        { ...formatted, registeredValue: 123 },
        { kind: "mark_equivalent", reason: "Not text", basis: "formatting" },
      ),
      "MARK_EQUIVALENT_NOT_ALLOWED",
    );
  });
  it("rejects identity adoption", () => {
    refused(
      resolveDiscrepancy(
        { field: "unt_number", priorValue: "A", registeredValue: "B" },
        adopt,
      ),
      "IDENTITY_MISMATCH",
    );
  });
  it.each([
    ["annual_rent_fils", -1, false],
    ["annual_rent_fils", 1, true],
    ["term_start", "2026-01-01", true],
    ["term_end", "not-date", false],
    ["grace_days", 3, true],
    ["grace_days", -1, false],
    ["grace_days", "3", false],
    ["occupants", " ", false],
    ["contacts", 2, false],
    ["utilities", "Water", true],
    ["payment_schedule", [], false],
    ["payment_schedule", "bad", false],
    ["payment_schedule", 1, false],
    ["payment_schedule", [{ seqNo: 1, amountFils: 10, vatFils: 0 }], true],
    ["payment_schedule", [{ seqNo: 0, amountFils: 10, vatFils: 0 }], false],
    ["payment_schedule", [{ seqNo: 1, amountFils: -1, vatFils: 0 }], false],
    ["payment_schedule", [{ seqNo: 1, amountFils: 10, vatFils: -1 }], false],
  ] as const)("validates %s value %#", (field, registeredValue, valid) => {
    const result = resolveDiscrepancy(
      { field, priorValue: "prior", registeredValue },
      adopt,
    );
    if (valid) expect(result.ok).toBe(true);
    else refused(result, "INVALID_INPUT", field);
  });
  it.each([
    { discrepancies: [], choices: [] },
    { discrepancies: [material], choices: [] },
    {
      discrepancies: [material, minor],
      choices: [choices[0], choices[0]].filter((item) => item !== undefined),
    },
    {
      discrepancies: [material, material],
      choices: [
        { field: material.field, choice: adopt },
        { field: minor.field, choice: adopt },
      ],
    },
    {
      discrepancies: [material],
      choices: [{ field: minor.field, choice: adopt }],
    },
    {
      discrepancies: [material],
      choices: [
        { field: material.field, choice: { kind: "adopt", reason: null } },
      ],
    },
  ] satisfies readonly {
    discrepancies: readonly TawtheeqDiscrepancy[];
    choices: readonly DiscrepancyResolutionInput[];
  }[])(
    "requires every discrepancy resolved once %#",
    ({ discrepancies, choices: inputs }) => {
      const result = resolveDiscrepancies(discrepancies, inputs);
      refused(
        result,
        inputs.some((item) => item.choice.reason === null)
          ? "REASON_REQUIRED"
          : "DISCREPANCIES_UNRESOLVED",
      );
    },
  );
  it("adoption copies prior values and changes only adopted fields", () => {
    const minorResolved: ResolvedDiscrepancy = {
      ...formatted,
      resolution: {
        kind: "mark_equivalent",
        reason: "Formatting",
        basis: "formatting",
      },
    };
    const prior = { ...priorValues, contacts: formatted.priorValue };
    const before = structuredClone(prior);
    const result = createAdoptionVersion(
      prior,
      [resolved, minorResolved],
      adoptedHash,
    );
    expect(result).toEqual({
      ok: true,
      value: {
        kind: "tawtheeq_adoption",
        contentHash: adoptedHash,
        values: { ...prior, annual_rent_fils: 12000 },
        changedFields: { annual_rent_fils: 12000 },
      },
    });
    expect(prior).toEqual(before);
    expect(requiresOwnerReapproval(true, [resolved])).toBe(true);
    expect(requiresOwnerReapproval(false, [resolved])).toBe(false);
    expect(requiresOwnerReapproval(true, [minorResolved])).toBe(false);
    expect(
      requiresOwnerReapproval(true, [
        { ...minor, resolution: { kind: "adopt", reason: "Update occupants" } },
      ]),
    ).toBe(false);
  });
  it("refuses invalid hash, reason or stale predecessor values", () => {
    refused(
      createAdoptionVersion(priorValues, [resolved], " "),
      "INVALID_INPUT",
      "content_hash",
    );
    refused(
      createAdoptionVersion(
        priorValues,
        [{ ...resolved, resolution: { kind: "adopt", reason: "" } }],
        adoptedHash,
      ),
      "REASON_REQUIRED",
    );
    refused(
      createAdoptionVersion({}, [resolved], adoptedHash),
      "STALE_SUBJECT_HASH",
      "annual_rent_fils",
    );
  });
});

function applyDecision(
  state: TawtheeqSnapshot,
  result: TawtheeqDecision,
): TawtheeqSnapshot {
  let next = state;
  for (const effect of result.effects) {
    if (effect.type === "clear_review")
      next = {
        ...next,
        document: null,
        documentVersionId: null,
        discrepancies: [],
        resolutions: [],
        candidateVersion: null,
        managerApproval: null,
        ownerApproval: null,
        subjectHash: next.contractContentHash,
      };
    if (effect.type === "link_document")
      next = { ...next, documentVersionId: effect.documentVersionId };
    if (effect.type === "record_document")
      next = { ...next, document: effect.document };
    if (effect.type === "record_discrepancies")
      next = { ...next, discrepancies: effect.discrepancies };
    if (effect.type === "record_resolutions")
      next = {
        ...next,
        resolutions: effect.resolutions,
        subjectHash: effect.subjectHash,
      };
    if (effect.type === "create_adoption_version")
      next = { ...next, candidateVersion: effect.version };
    if (effect.type === "record_approval")
      next =
        effect.approval.slot === "manager"
          ? { ...next, managerApproval: effect.approval }
          : { ...next, ownerApproval: effect.approval };
    if (effect.type === "return_owner_reapproval")
      next = { ...next, ownerApproval: null };
    if (effect.type === "set_path") next = { ...next, path: effect.path };
  }
  return { ...next, state: result.state };
}

describe("Tawtheeq command sequence properties", () => {
  it("AC-8 random commands reach registered only with IN11 evidence and portal status is total", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.integer({ min: 0, max: 4 }),
        fc.array(
          fc.record({
            type: fc.constantFrom(
              ...tawtheeqTransitions.map((row) => row.command),
            ),
            role: fc.constantFrom("manager", "owner", "tenant"),
            validEvidence: fc.boolean(),
            hasReason: fc.boolean(),
            currentHash: fc.boolean(),
          }),
          { maxLength: 60 },
        ),
        (gate, prefixLength, steps) => {
          let state = snapshot({
            frozenOwnerGate: gate,
            document: null,
            documentVersionId: null,
          });
          const prefix: readonly TawtheeqCommand["type"][] = [
            "upload",
            "open_discrepancies",
            ...(gate
              ? (["prepare_adoption", "owner_reapprove"] as const)
              : (["register_resolved"] as const)),
          ];
          const attempts = [
            ...prefix.slice(0, prefixLength).map(
              (type) =>
                ({
                  type,
                  role: type === "owner_reapprove" ? "owner" : "manager",
                  validEvidence: true,
                  hasReason: true,
                  currentHash: true,
                }) as const,
            ),
            ...steps,
          ];
          for (const step of attempts) {
            const base = command(step.type);
            const cmd = {
              ...base,
              ...("document" in base && !step.validEvidence
                ? { document: { ...base.document, tawtheeqNumber: null } }
                : {}),
              ...("reason" in base && !step.hasReason ? { reason: null } : {}),
              ...("subjectHash" in base && !step.currentHash
                ? { subjectHash: "stale" }
                : {}),
            };
            const before = structuredClone(state);
            const result = transitionTawtheeq(state, cmd, context(step.role));
            expect(state).toEqual(before);
            if (result.ok) {
              expect(
                tawtheeqTransitions.some(
                  (row) =>
                    row.from === state.state &&
                    row.to === result.value.state &&
                    row.command === cmd.type &&
                    row.actor === step.role,
                ),
              ).toBe(true);
              state = applyDecision(state, result.value);
              if (state.state === "registered") {
                expect(
                  validateRegistrationEvidence(
                    state.document,
                    state.linkedIdentity,
                  ).ok,
                ).toBe(true);
                expect(state.documentVersionId).toBe(
                  state.document?.documentVersionId,
                );
                expect(
                  state.resolutions.every(
                    (item) => item.resolution.reason.trim() !== "",
                  ),
                ).toBe(true);
                if (requiresOwnerReapproval(gate, state.resolutions)) {
                  expect(state.ownerApproval).toMatchObject({
                    slot: "owner",
                    status: "approved",
                    subjectHash: state.subjectHash,
                  });
                }
                expect(validateRegistration(state).ok).toBe(true);
              }
            } else refused(result, result.error.code);
            for (const workflow of tawtheeqWorkflowState.options)
              expect(
                portalStatusOf(workflow, { isRenewal: step.currentHash }),
              ).toBeTypeOf("string");
          }
        },
      ),
      { seed: 920263, numRuns: 100 },
    );
  }, 60_000);
});
