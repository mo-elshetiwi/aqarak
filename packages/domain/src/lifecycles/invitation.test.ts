import { describe, expect, it } from "vitest";
import { personAccountId } from "../ids";
import { utcInstant } from "../time";
import { invitationStatus } from "../vocabulary";
import {
  invitation,
  invitationStatusAt,
  invitationTransitions,
  transitionInvitation,
  type Invitation,
  type InvitationCommand,
} from "./index";

const account = personAccountId.parse("00000000-0000-4000-8000-000000000003");
const manager = personAccountId.parse("00000000-0000-4000-8000-000000000004");
const pending: Invitation = invitation.parse({
  id: "00000000-0000-4000-8000-000000000005",
  company_id: "00000000-0000-4000-8000-000000000001",
  status: "pending",
  kind: "staff",
  email: "person@example.test",
  sent_at: "2026-01-01T00:00:00.123456Z",
  staff_roles: ["manager"],
  version: 0,
  accepted_by_account_id: null,
  confirmed_by_manager_account_id: null,
  reason: null,
});
const before = utcInstant.parse("2026-01-07T23:00:00.123456Z");
const expiry = utcInstant.parse("2026-01-08T00:00:00.123456Z");
const accept: InvitationCommand = {
  type: "accept",
  account_id: account,
  verified_account_email: "person@example.test",
};
const context = { now: before, expected_version: 0 };

describe("invitation lifecycle", () => {
  it("AC-7 accepts at six days and 23 hours with a matching verified email", () => {
    expect(transitionInvitation(pending, accept, context)).toEqual({
      ok: true,
      value: {
        ...pending,
        status: "accepted",
        version: 1,
        accepted_by_account_id: account,
      },
    });
    expect(pending.status).toBe("pending");
  });
  it.each([
    "2026-01-08T00:00:00.123456Z",
    "2026-01-08T00:00:00.123457Z",
    "2026-01-09T00:00:00Z",
  ])("AC-7 refuses expired acceptance at %s", (now) => {
    expect(
      transitionInvitation(pending, accept, {
        ...context,
        now: utcInstant.parse(now),
      }),
    ).toEqual({ ok: false, error: { code: "INVITATION_EXPIRED" } });
  });
  it("preserves microseconds immediately before expiry", () => {
    const now = utcInstant.parse("2026-01-08T00:00:00.123455Z");
    expect(invitationStatusAt(pending, now)).toBe("pending");
    expect(transitionInvitation(pending, accept, { ...context, now }).ok).toBe(
      true,
    );
  });
  it("derives expiry on read without altering stored status or version", () => {
    expect(invitationStatusAt(pending, before)).toBe("pending");
    expect(invitationStatusAt(pending, expiry)).toBe("expired");
    expect(pending.status).toBe("pending");
    expect(pending.version).toBe(0);
    const wholeSecond = {
      ...pending,
      sent_at: utcInstant.parse("2026-01-01T00:00:00Z"),
    };
    expect(
      invitationStatusAt(wholeSecond, utcInstant.parse("2026-01-08T00:00:00Z")),
    ).toBe("expired");
  });
  it("allows explicit expiry only once the deadline is reached", () => {
    expect(transitionInvitation(pending, { type: "expire" }, context)).toEqual({
      ok: false,
      error: { code: "INVALID_TRANSITION" },
    });
    expect(
      transitionInvitation(
        pending,
        { type: "expire" },
        { ...context, now: expiry },
      ),
    ).toEqual({
      ok: true,
      value: { ...pending, status: "expired", version: 1 },
    });
  });
  it.each(["accepted", "expired", "revoked"] as const)(
    "AC-7 %s is terminal",
    (status) => {
      const current = { ...pending, status };
      for (const command of [
        accept,
        { type: "expire" },
        { type: "revoke", reason: "Invitation superseded" },
      ] satisfies readonly InvitationCommand[]) {
        expect(transitionInvitation(current, command, context)).toEqual({
          ok: false,
          error: {
            code:
              status === "expired" && command.type === "accept"
                ? "INVITATION_EXPIRED"
                : "INVALID_TRANSITION",
          },
        });
      }
      expect(invitationStatusAt(current, expiry)).toBe(status);
    },
  );
  it.each([null, "another@example.test", "", "person@example.test.invalid"])(
    "requires matching verified email or recorded manager confirmation: %j",
    (verified_account_email) => {
      expect(
        transitionInvitation(
          pending,
          { type: "accept", account_id: account, verified_account_email },
          context,
        ),
      ).toEqual({
        ok: false,
        error: {
          code: "INVITATION_EMAIL_MISMATCH",
          field: "verified_account_email",
        },
      });
      expect(
        transitionInvitation(
          pending,
          {
            type: "accept",
            account_id: account,
            verified_account_email,
            confirmed_by_manager_account_id: manager,
          },
          context,
        ),
      ).toMatchObject({
        ok: true,
        value: {
          accepted_by_account_id: account,
          confirmed_by_manager_account_id: manager,
        },
      });
    },
  );
  it("normalizes verified email case and surrounding whitespace", () => {
    expect(
      transitionInvitation(
        pending,
        {
          type: "accept",
          account_id: account,
          verified_account_email: " PERSON@EXAMPLE.TEST ",
        },
        context,
      ),
    ).toMatchObject({
      ok: true,
      value: { confirmed_by_manager_account_id: null },
    });
  });
  it.each([undefined, null, "", "  "])(
    "requires a revocation reason: %j",
    (reason) => {
      const command: InvitationCommand =
        reason === undefined ? { type: "revoke" } : { type: "revoke", reason };
      expect(transitionInvitation(pending, command, context)).toEqual({
        ok: false,
        error: { code: "REASON_REQUIRED", field: "reason" },
      });
    },
  );
  it("revokes with a trimmed reason, but cannot revoke after derived expiry", () => {
    expect(
      transitionInvitation(
        pending,
        { type: "revoke", reason: "  Invitation replaced  " },
        context,
      ),
    ).toEqual({
      ok: true,
      value: {
        ...pending,
        status: "revoked",
        version: 1,
        reason: "Invitation replaced",
      },
    });
    expect(
      transitionInvitation(
        pending,
        { type: "revoke", reason: "Invitation replaced" },
        { ...context, now: expiry },
      ),
    ).toEqual({ ok: false, error: { code: "INVALID_TRANSITION" } });
  });
  it("rejects stale versions and time preceding the invitation", () => {
    expect(
      transitionInvitation(pending, accept, {
        ...context,
        expected_version: 1,
      }),
    ).toEqual({ ok: false, error: { code: "VERSION_CONFLICT" } });
    expect(
      transitionInvitation(pending, accept, {
        ...context,
        now: utcInstant.parse("2025-12-31T23:59:59Z"),
      }),
    ).toEqual({ ok: false, error: { code: "INVALID_INPUT", field: "now" } });
  });
  it.each(["owner", "tenant"] as const)(
    "retains the %s record link when accepting a party invitation",
    (kind) => {
      const base = Object.fromEntries(
        Object.entries(pending).filter(([key]) => key !== "staff_roles"),
      );
      const party = invitation.parse({
        ...base,
        kind,
        [`${kind}_id`]: "00000000-0000-4000-8000-000000000007",
      });
      expect(transitionInvitation(party, accept, context)).toEqual({
        ok: true,
        value: {
          ...party,
          status: "accepted",
          version: 1,
          accepted_by_account_id: account,
        },
      });
      expect(invitation.safeParse({ ...base, kind }).success).toBe(false);
    },
  );
  it("validates kinds, required staff roles and exact transition data", () => {
    expect(invitation.safeParse({ ...pending, staff_roles: [] }).success).toBe(
      false,
    );
    expect(invitation.safeParse({ ...pending, kind: "unknown" }).success).toBe(
      false,
    );
    expect(Object.keys(invitationTransitions)).toEqual(
      invitationStatus.options,
    );
    expect(invitationTransitions).toEqual({
      pending: { accept: "accepted", expire: "expired", revoke: "revoked" },
      accepted: {},
      expired: {},
      revoked: {},
    });
  });
});
