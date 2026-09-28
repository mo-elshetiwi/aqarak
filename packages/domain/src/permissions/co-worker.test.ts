import { describe, expect, it } from "vitest";
import { role, type Role } from "../vocabulary";
import {
  coWorkerToolEffects,
  coWorkerToolFamilies,
  coWorkerToolFamily,
  commonCoWorkerToolFamilies,
  roleCoWorkerToolFamilies,
} from "./index";

const common = [
  "search",
  "read",
  "explain",
  "draft_message",
  "propose_note",
  "propose_task",
  "propose_reminder",
];
const expected: Readonly<Record<Role, readonly string[]>> = {
  manager: [
    "records_from_documents",
    "contracts_and_schedules",
    "tawtheeq_comparison",
    "triage",
    "dispatch",
    "payments_from_uploads",
    "renewals",
  ],
  owner: [
    "portfolio_questions",
    "statement_questions",
    "ticket_reports",
    "own_documents",
  ],
  tenant: [
    "own_contract",
    "own_schedule",
    "own_tickets",
    "fault_reports",
    "payment_evidence",
  ],
  technician: ["assigned_jobs", "job_status", "parts", "quote_drafts"],
  company_administrator: [
    "settings",
    "members",
    "invitations",
    "templates",
    "audit_search",
  ],
  accountant: [
    "payments_from_receipts",
    "payments_from_slips",
    "payments_from_cheque_images",
    "invoices",
    "receipts",
    "arrears_messages",
    "statements",
  ],
};
const combinations = Array.from({ length: 64 }, (_, mask) =>
  role.options.filter((_, index) => (mask & (1 << index)) !== 0),
);

describe("co-worker tool families", () => {
  it.each(role.options)(
    "AC-5 %s gets exactly the common and role families",
    (heldRole) => {
      expect(coWorkerToolFamilies([heldRole])).toEqual([
        ...common,
        ...expected[heldRole],
      ]);
      expect(roleCoWorkerToolFamilies[heldRole]).toEqual(expected[heldRole]);
      expect(commonCoWorkerToolFamilies).toEqual(common);
    },
  );
  it.each(
    combinations.map((roles) => ({ roles, label: roles.join(",") || "none" })),
  )(
    "AC-5 $label has only read/draft effects with a stable deduplicated union",
    ({ roles }) => {
      const families = coWorkerToolFamilies(roles);
      expect(new Set(families).size).toBe(families.length);
      expect(coWorkerToolFamilies([...roles].reverse())).toEqual(families);
      expect(coWorkerToolFamilies([...roles, ...roles])).toEqual(families);
      const expectedSet = new Set(
        roles.length === 0
          ? []
          : [...common, ...roles.flatMap((heldRole) => expected[heldRole])],
      );
      expect(new Set(families)).toEqual(expectedSet);
      for (const family of families) {
        expect(["read", "draft"]).toContain(coWorkerToolEffects[family]);
        expect(["commit", "approve"]).not.toContain(
          coWorkerToolEffects[family],
        );
      }
    },
  );
  it("closes the schema and effect table over the same families", () => {
    expect(Object.keys(coWorkerToolEffects)).toEqual(
      coWorkerToolFamily.options,
    );
    expect(coWorkerToolFamilies(role.options)).toEqual(
      coWorkerToolFamily.options,
    );
    for (const invalid of [
      "commit",
      "approve",
      "commit_payment",
      "approve_contract",
    ])
      expect(coWorkerToolFamily.safeParse(invalid).success).toBe(false);
    expect(coWorkerToolFamilies([])).toEqual([]);
  });
});
