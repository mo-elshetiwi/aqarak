import { describe, expect, it } from "vitest";
import { companyId, membershipId, personAccountId } from "../ids";
import { membershipStatus, staffRole } from "../vocabulary";
import {
  lifecycleRefusalCode,
  lifecyclesErrorCode,
  membership,
  membershipTransitions,
  transitionMembership,
  type Membership,
  type MembershipCommand,
} from "./index";

const company = companyId.parse("00000000-0000-4000-8000-000000000001");
const otherCompany = companyId.parse("00000000-0000-4000-8000-000000000002");
const account = personAccountId.parse("00000000-0000-4000-8000-000000000003");
const otherAccount = personAccountId.parse(
  "00000000-0000-4000-8000-000000000004",
);
const initial: Membership = membership.parse({
  id: "00000000-0000-4000-8000-000000000005",
  company_id: company,
  account_id: account,
  status: "invited",
  staff_roles: ["manager"],
  version: 0,
  reason: null,
});
const another: Membership = {
  ...initial,
  id: membershipId.parse("00000000-0000-4000-8000-000000000006"),
  company_id: otherCompany,
  status: "active",
};
const commands: readonly MembershipCommand[] = [
  { type: "accept_invitation" },
  { type: "suspend", reason: "Staff access paused" },
  { type: "reactivate" },
  { type: "remove", reason: "Staff access ended" },
];
const expected = {
  invited: { accept_invitation: "active" },
  active: { suspend: "suspended", remove: "removed" },
  suspended: { reactivate: "active", remove: "removed" },
  removed: {},
};

describe("membership lifecycle", () => {
  it.each(
    membershipStatus.options.flatMap((status) =>
      commands.map((command) => ({ status, command, type: command.type })),
    ),
  )(
    "AC-6 $status handles $type according to the transition table",
    ({ status, command }) => {
      const before = { ...initial, status };
      const result = transitionMembership(before, command, {
        expected_version: 0,
        memberships: [],
      });
      const targets: Readonly<Record<string, string>> = expected[status];
      const target = targets[command.type];
      if (target === undefined)
        expect(result).toEqual({
          ok: false,
          error: { code: "INVALID_TRANSITION" },
        });
      else
        expect(result).toMatchObject({
          ok: true,
          value: {
            status: target,
            version: 1,
            account_id: account,
            company_id: company,
            id: initial.id,
            staff_roles: ["manager"],
          },
        });
      expect(before.status).toBe(status);
      expect(before.version).toBe(0);
      expect(membershipTransitions).toEqual(expected);
    },
  );
  it.each(["invited", "suspended"] as const)(
    "AC-6 refuses a second active membership when activating %s",
    (status) => {
      const type = status === "invited" ? "accept_invitation" : "reactivate";
      for (const company_id of [company, otherCompany])
        expect(
          transitionMembership(
            { ...initial, status },
            { type },
            { expected_version: 0, memberships: [{ ...another, company_id }] },
          ),
        ).toEqual({ ok: false, error: { code: "ACTIVE_MEMBERSHIP_EXISTS" } });
    },
  );
  it("ignores the same membership, other accounts and inactive memberships during activation", () => {
    const result = transitionMembership(
      initial,
      { type: "accept_invitation" },
      {
        expected_version: 0,
        memberships: [
          { ...initial, status: "active" },
          { ...another, account_id: otherAccount },
          { ...another, status: "suspended" },
        ],
      },
    );
    expect(result).toMatchObject({ ok: true, value: { status: "active" } });
  });
  it.each([undefined, null, "", "  ", "x".repeat(1001)])(
    "AC-6 requires a reason for suspend and remove: %j",
    (reason) => {
      for (const type of ["suspend", "remove"] as const) {
        const command = reason === undefined ? { type } : { type, reason };
        expect(
          transitionMembership({ ...initial, status: "active" }, command, {
            expected_version: 0,
            memberships: [],
          }),
        ).toEqual({
          ok: false,
          error: { code: "REASON_REQUIRED", field: "reason" },
        });
      }
    },
  );
  it("retains attribution and a trimmed reason when access is removed", () => {
    const removed = transitionMembership(
      { ...initial, status: "suspended" },
      { type: "remove", reason: "  Assignment ended  " },
      { expected_version: 0, memberships: [] },
    );
    expect(removed).toEqual({
      ok: true,
      value: {
        ...initial,
        status: "removed",
        reason: "Assignment ended",
        version: 1,
      },
    });
  });
  it("requires at least one staff role at validation and transition boundaries", () => {
    expect(membership.safeParse({ ...initial, staff_roles: [] }).success).toBe(
      false,
    );
    expect(
      membership.safeParse({ ...initial, staff_roles: ["owner"] }).success,
    ).toBe(false);
    expect(
      transitionMembership(
        { ...initial, staff_roles: [] },
        { type: "accept_invitation" },
        { expected_version: 0, memberships: [] },
      ),
    ).toEqual({
      ok: false,
      error: { code: "INVALID_INPUT", field: "staff_roles" },
    });
    expect(
      membership.safeParse({ ...initial, staff_roles: staffRole.options })
        .success,
    ).toBe(true);
  });
  it("refuses a stale membership version without changing access", () => {
    expect(
      transitionMembership(
        initial,
        { type: "accept_invitation" },
        { expected_version: 1, memberships: [] },
      ),
    ).toEqual({ ok: false, error: { code: "VERSION_CONFLICT" } });
  });
  it("exports closed lifecycle and shared refusal codes", () => {
    for (const code of [
      "ACTIVE_MEMBERSHIP_EXISTS",
      "INVITATION_EXPIRED",
      "NOT_DRAFTED_FOR_ACTOR",
      "BASE_VERSION_CHANGED",
    ])
      expect(lifecyclesErrorCode.safeParse(code).success).toBe(true);
    for (const code of [
      "INVALID_TRANSITION",
      "VERSION_CONFLICT",
      "REASON_REQUIRED",
      "INVALID_INPUT",
    ])
      expect(lifecycleRefusalCode.safeParse(code).success).toBe(true);
    expect(lifecyclesErrorCode.safeParse("unknown").success).toBe(false);
  });
});
