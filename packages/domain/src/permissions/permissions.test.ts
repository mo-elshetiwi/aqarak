import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  companyId,
  ownerId,
  personAccountId,
  technicianProfileId,
  tenantId,
} from "../ids";
import { role, type Role } from "../vocabulary";
import {
  actorCapabilities,
  approvalStepRoles,
  can,
  capability,
  permissionApprovalStep,
  permissionLevel,
  permissionMatrix,
  permissionOperation,
  permissionsErrorCode,
  type Capability,
  type PermissionActor,
  type PermissionSubject,
} from "./index";

const company = companyId.parse("00000000-0000-4000-8000-000000000001");
const otherCompany = companyId.parse("00000000-0000-4000-8000-000000000002");
const account = personAccountId.parse("00000000-0000-4000-8000-000000000003");
const otherAccount = personAccountId.parse(
  "00000000-0000-4000-8000-000000000004",
);
const owner = ownerId.parse("00000000-0000-4000-8000-000000000005");
const otherOwner = ownerId.parse("00000000-0000-4000-8000-000000000006");
const tenant = tenantId.parse("00000000-0000-4000-8000-000000000007");
const otherTenant = tenantId.parse("00000000-0000-4000-8000-000000000008");
const technician = technicianProfileId.parse(
  "00000000-0000-4000-8000-000000000009",
);
const otherTechnician = technicianProfileId.parse(
  "00000000-0000-4000-8000-00000000000a",
);
const scoped: PermissionSubject = {
  company_id: company,
  owner_ids: [owner],
  tenant_ids: [tenant],
  assigned_technician_profile_ids: [technician],
  reported_by_account_id: account,
};
const outside: PermissionSubject = {
  company_id: company,
  owner_ids: [otherOwner],
  tenant_ids: [otherTenant],
  assigned_technician_profile_ids: [otherTechnician],
  reported_by_account_id: otherAccount,
};
function actor(roles: readonly Role[]): PermissionActor {
  return {
    account_id: account,
    company_id: company,
    roles,
    owner_ids: [owner],
    tenant_ids: [tenant],
    technician_profile_id: technician,
  };
}
const expectedRows: readonly (readonly [
  Capability,
  string,
  string,
  string,
  string,
  string,
  string,
])[] = [
  ["company_settings", "R", "-", "-", "-", "A", "R"],
  ["staff_memberships", "R", "-", "-", "-", "A", "-"],
  ["party_links", "A", "-", "-", "-", "A", "-"],
  ["owners", "A", "S", "-", "-", "R", "R"],
  ["owner_bank_details", "A", "S", "-", "-", "-", "A"],
  ["properties_units", "A", "R,P", "R", "R", "R", "R"],
  ["tenants_occupants", "A", "R", "S", "R", "R", "R"],
  ["identity_documents", "A", "S", "S", "-", "-", "-"],
  ["contracts", "A", "R", "R", "-", "R", "R"],
  ["approval_steps", "G", "G", "G", "-", "-", "-"],
  ["tawtheeq", "A", "R", "R", "-", "R", "R"],
  ["payments", "A", "R", "P,R", "-", "R", "A"],
  ["invoices_receipts", "A", "R", "R", "-", "R", "A"],
  ["owner_statements", "A", "R", "-", "-", "R", "A"],
  ["ticket_report", "A", "S", "S", "S", "-", "-"],
  ["ticket_management", "A", "R", "R", "-", "-", "R"],
  ["job_updates", "A", "-", "-", "S", "-", "-"],
  ["notes", "A", "S", "S", "S", "R", "S"],
  ["tasks_reminders", "A", "S", "S", "S", "A", "S"],
  ["audit_read", "A", "S", "S", "S", "A", "S"],
  ["export", "A", "S", "S", "-", "A", "S"],
  ["co_worker", "S", "S", "S", "S", "S", "S"],
];

describe("permission matrix", () => {
  it.each(
    expectedRows.flatMap(([key, ...cells]) =>
      role.options.map((heldRole, index) => ({
        key,
        heldRole,
        expected: cells[index],
      })),
    ),
  )(
    "AC-1 $key / $heldRole has exactly $expected",
    ({ key, heldRole, expected }) => {
      expect(permissionMatrix[key][heldRole].join(",") || "-").toBe(expected);
    },
  );
  it("AC-1 contains exactly 22 capabilities and six roles", () => {
    expect(Object.keys(permissionMatrix)).toEqual(
      expectedRows.map(([key]) => key),
    );
    expect(capability.options).toEqual(Object.keys(permissionMatrix));
    for (const cells of Object.values(permissionMatrix))
      expect(Object.keys(cells)).toEqual(role.options);
    expect(permissionLevel.options).toEqual(["A", "S", "R", "P", "G"]);
    expect(permissionsErrorCode.options).toEqual([
      "NOT_FOUND",
      "NOT_PERMITTED",
      "REQUEST_ONLY",
    ]);
  });
});

describe("subject authorization", () => {
  it.each([null, { company_id: otherCompany }])(
    "AC-2 masks missing and other-company contracts: %j",
    (subject) => {
      expect(can(actor(["manager"]), "read", "contracts", subject)).toEqual({
        ok: false,
        error: { code: "NOT_FOUND" },
      });
      expect(can(actor([]), "approve", "contracts", subject)).toEqual({
        ok: false,
        error: { code: "NOT_FOUND" },
      });
    },
  );
  it("AC-2 masks another tenant's ticket", () => {
    expect(
      can(actor(["tenant"]), "read", "ticket_management", outside),
    ).toEqual({ ok: false, error: { code: "NOT_FOUND" } });
  });
  it("AC-2 allows the technician's assigned dispatch", () => {
    expect(can(actor(["technician"]), "read", "job_updates", scoped)).toEqual({
      ok: true,
      value: { level: "S", scope: "own" },
    });
  });
  it.each(["owner", "tenant", "technician"] satisfies readonly Role[])(
    "limits %s reads to linked scope even for a staff technician",
    (heldRole) => {
      expect(
        can(actor([heldRole]), "read", "properties_units", scoped),
      ).toEqual({ ok: true, value: { level: "R", scope: "own" } });
      expect(
        can(actor([heldRole]), "read", "properties_units", outside),
      ).toEqual({ ok: false, error: { code: "NOT_FOUND" } });
      expect(
        can(actor([heldRole]), "read", "properties_units", {
          company_id: company,
        }),
      ).toEqual({ ok: false, error: { code: "NOT_FOUND" } });
    },
  );
  it.each([
    "manager",
    "company_administrator",
    "accountant",
  ] satisfies readonly Role[])("allows company-wide R for %s", (heldRole) => {
    expect(
      can(actor([heldRole]), "read", "company_settings", outside),
    ).toMatchObject({ ok: true, value: { scope: "company" } });
  });
  it.each([
    "manager",
    "company_administrator",
    "accountant",
  ] satisfies readonly Role[])(
    "requires personal scope for %s co-worker access",
    (heldRole) => {
      expect(can(actor([heldRole]), "write", "co_worker", scoped)).toEqual({
        ok: true,
        value: { level: "S", scope: "own" },
      });
      expect(can(actor([heldRole]), "write", "co_worker", outside)).toEqual({
        ok: false,
        error: { code: "NOT_FOUND" },
      });
    },
  );
  it("does not use a reporting account to bypass document or dispatch scope", () => {
    const selfReported = { ...outside, reported_by_account_id: account };
    expect(
      can(actor(["tenant"]), "write", "identity_documents", selfReported),
    ).toMatchObject({ ok: false });
    expect(
      can(actor(["technician"]), "write", "job_updates", selfReported),
    ).toMatchObject({ ok: false });
    expect(
      can(actor(["technician"]), "write", "ticket_report", selfReported),
    ).toMatchObject({ ok: true });
    expect(
      can(
        { ...actor(["technician"]), technician_profile_id: null },
        "read",
        "job_updates",
        scoped,
      ),
    ).toMatchObject({ ok: false });
  });
  it("allows S writes only in the role's own scope", () => {
    expect(can(actor(["owner"]), "write", "owners", scoped)).toEqual({
      ok: true,
      value: { level: "S", scope: "own" },
    });
    expect(can(actor(["owner"]), "write", "owners", outside)).toEqual({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });
  it("AC-3 R refuses write with NOT_PERMITTED", () => {
    expect(can(actor(["owner"]), "write", "contracts", scoped)).toEqual({
      ok: false,
      error: { code: "NOT_PERMITTED" },
    });
  });
  it.each([
    ["tenant", "payments"],
    ["owner", "properties_units"],
  ] satisfies readonly (readonly [Role, Capability])[])(
    "AC-3 P allows scoped requests and refuses writes: %s / %s",
    (heldRole, key) => {
      expect(can(actor([heldRole]), "request", key, scoped)).toEqual({
        ok: true,
        value: { level: "P", scope: "own" },
      });
      expect(can(actor([heldRole]), "write", key, scoped)).toEqual({
        ok: false,
        error: { code: "REQUEST_ONLY" },
      });
      expect(can(actor([heldRole]), "request", key, outside)).toEqual({
        ok: false,
        error: { code: "NOT_FOUND" },
      });
      expect(can(actor([heldRole]), "read", key, scoped)).toEqual({
        ok: true,
        value: { level: "R", scope: "own" },
      });
    },
  );
  it.each(permissionApprovalStep.options)(
    "AC-3 G authorizes only the role's %s step",
    (step) => {
      for (const heldRole of role.options) {
        expect(
          can(actor([heldRole]), "approve", "approval_steps", {
            ...scoped,
            approval_step: step,
          }).ok,
        ).toBe(heldRole === approvalStepRoles[step]);
      }
      for (const operation of [
        "read",
        "write",
        "request",
      ] satisfies readonly (typeof permissionOperation.options)[number][]) {
        expect(
          can(actor([approvalStepRoles[step]]), operation, "approval_steps", {
            ...scoped,
            approval_step: step,
          }),
        ).toEqual({ ok: false, error: { code: "NOT_PERMITTED" } });
      }
    },
  );
  it("requires an approval step and the approving party's scope", () => {
    expect(
      can(actor(["manager"]), "approve", "approval_steps", scoped),
    ).toMatchObject({ ok: false, error: { code: "NOT_PERMITTED" } });
    expect(
      can(actor(["owner"]), "approve", "approval_steps", {
        ...outside,
        approval_step: "gated_approval",
      }),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });
  it("AC-3 unions roles, preserving company access over a party scope refusal", () => {
    expect(
      can(actor(["manager", "accountant"]), "write", "payments", outside),
    ).toEqual({ ok: true, value: { level: "A", scope: "company" } });
    expect(
      can(actor(["owner", "accountant"]), "read", "owners", outside),
    ).toEqual({ ok: true, value: { level: "R", scope: "company" } });
    expect(
      can(actor(["tenant", "accountant"]), "write", "payments", outside),
    ).toEqual({ ok: true, value: { level: "A", scope: "company" } });
  });
  it("denies empty or denied roles and operations absent from a level", () => {
    expect(can(actor([]), "read", "payments", scoped)).toMatchObject({
      ok: false,
      error: { code: "NOT_PERMITTED" },
    });
    expect(
      can(actor(["technician"]), "read", "contracts", scoped),
    ).toMatchObject({ ok: false, error: { code: "NOT_PERMITTED" } });
    expect(
      can(actor(["manager"]), "request", "contracts", scoped),
    ).toMatchObject({ ok: false, error: { code: "NOT_PERMITTED" } });
    expect(
      can(actor(["tenant"]), "approve", "ticket_report", scoped),
    ).toMatchObject({ ok: false, error: { code: "NOT_PERMITTED" } });
  });
  it("lists a stable capability union for navigation without granting subject access", () => {
    expect(actorCapabilities(actor([]))).toEqual([]);
    expect(actorCapabilities(actor(["technician"]))).toEqual([
      "properties_units",
      "tenants_occupants",
      "ticket_report",
      "job_updates",
      "notes",
      "tasks_reminders",
      "audit_read",
      "co_worker",
    ]);
    expect(actorCapabilities(actor(["owner", "accountant"]))).toEqual(
      actorCapabilities(actor(["accountant", "owner", "owner"])),
    );
  });
  it("AC-4 never throws, crosses companies, or invents write grants", () => {
    const actorArbitrary = fc.record({
      account_id: fc.constantFrom(account, otherAccount),
      company_id: fc.constantFrom(company, otherCompany),
      roles: fc.array(fc.constantFrom(...role.options), { maxLength: 8 }),
      owner_ids: fc.subarray([owner, otherOwner]),
      tenant_ids: fc.subarray([tenant, otherTenant]),
      technician_profile_id: fc.constantFrom(technician, otherTechnician, null),
    });
    const subjectArbitrary = fc.oneof(
      fc.constant(null),
      fc.record({ company_id: fc.constantFrom(company, otherCompany) }),
      fc.record({
        company_id: fc.constantFrom(company, otherCompany),
        owner_ids: fc.subarray([owner, otherOwner]),
        tenant_ids: fc.subarray([tenant, otherTenant]),
        assigned_technician_profile_ids: fc.subarray([
          technician,
          otherTechnician,
        ]),
        reported_by_account_id: fc.constantFrom(account, otherAccount),
        approval_step: fc.constantFrom(...permissionApprovalStep.options),
      }),
    );
    fc.assert(
      fc.property(
        actorArbitrary,
        fc.constantFrom(...permissionOperation.options),
        fc.constantFrom(...capability.options),
        subjectArbitrary,
        (person, operation, key, subject) => {
          const result = can(person, operation, key, subject);
          if (person.company_id !== subject?.company_id)
            expect(result).toEqual({ ok: false, error: { code: "NOT_FOUND" } });
          if (result.ok && operation === "write")
            expect(
              person.roles.some((heldRole) =>
                permissionMatrix[key][heldRole].some(
                  (level) => level === "A" || level === "S",
                ),
              ),
            ).toBe(true);
          expect(
            can(
              { ...person, roles: [...person.roles].reverse() },
              operation,
              key,
              subject,
            ),
          ).toEqual(result);
        },
      ),
      { seed: 5205, numRuns: 100 },
    );
  }, 60_000);
});
