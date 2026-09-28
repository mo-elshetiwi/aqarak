import { expect, it } from "vitest";
import {
  accept,
  assertChain,
  expectDenial,
  harness,
  invite,
  memberId,
} from "../identity/integration-support";
import { rows } from "../identity/database";
it("I-9 refuses a manager's staff, membership and company write requests", async () => {
  const h = harness();
  const admin = await h.account();
  const company = await h.company(admin);
  const manager = await h.account();
  const invitation = await invite(h, company, admin, { invitee: manager });
  await accept(h, manager, invitation.token);
  const member = await memberId(h, company, admin, manager);
  const attempts = [
    {
      method: "POST",
      path: `/v1/companies/${company}/invitations`,
      body: {
        kind: "staff",
        email: "other@example.com",
        staffRoles: ["manager"],
        locale: "en",
      },
    },
    {
      method: "POST",
      path: `/v1/companies/${company}/members/${member}/roles`,
      body: { expectedVersion: 1, staffRoles: ["company_administrator"] },
    },
    {
      method: "POST",
      path: `/v1/companies/${company}/members/${member}/suspend`,
      body: { expectedVersion: 1, reason: "Synthetic suspension" },
    },
    {
      method: "PATCH",
      path: `/v1/companies/${company}`,
      body: { expectedVersion: 1, trn: "TEST" },
    },
  ];
  for (const attempt of attempts)
    await expectDenial(h, company, admin, {
      run: () =>
        h.request(attempt.method, attempt.path, {
          account: manager,
          body: attempt.body,
        }),
      code: "FORBIDDEN",
      status: 403,
    });
});
it("I-11/I-12 protects stale membership versions and the last active administrator", async () => {
  const h = harness();
  const admin = await h.account();
  const company = await h.company(admin);
  const member = await memberId(h, company, admin, admin);
  for (const action of ["roles", "suspend", "remove"])
    await expectDenial(h, company, admin, {
      run: () =>
        h.request(
          "POST",
          `/v1/companies/${company}/members/${member}/${action}`,
          {
            account: admin,
            body: {
              expectedVersion: 1,
              staffRoles: ["manager"],
              reason: "Synthetic reason",
            },
          },
        ),
      code: "LAST_ADMINISTRATOR",
      status: 409,
    });
  const changed = await h.request(
    "POST",
    `/v1/companies/${company}/members/${member}/roles`,
    {
      account: admin,
      body: {
        expectedVersion: 1,
        staffRoles: ["company_administrator", "manager"],
      },
    },
  );
  expect(changed.status, h.errors.at(-1)).toBe(200);
  for (const action of ["roles", "suspend"])
    await expectDenial(h, company, admin, {
      run: () =>
        h.request(
          "POST",
          `/v1/companies/${company}/members/${member}/${action}`,
          {
            account: admin,
            body: {
              expectedVersion: 1,
              staffRoles: ["company_administrator"],
              reason: "Synthetic reason",
            },
          },
        ),
      code: "VERSION_CONFLICT",
      status: 409,
    });
});
it("I-13 removes suspended staff from contexts, restores access, then revokes the staff link", async () => {
  const h = harness();
  const admin = await h.account();
  const company = await h.company(admin);
  const manager = await h.account();
  const invitation = await invite(h, company, admin, { invitee: manager });
  await accept(h, manager, invitation.token);
  const member = await memberId(h, company, admin, manager);
  const suspend = await h.request(
    "POST",
    `/v1/companies/${company}/members/${member}/suspend`,
    {
      account: admin,
      body: { expectedVersion: 1, reason: "Synthetic suspension" },
    },
  );
  expect(suspend.status, h.errors.at(-1)).toBe(200);
  await expectDenial(h, company, admin, {
    run: () =>
      h.request("GET", `/v1/companies/${company}`, { account: manager }),
    code: "NOT_FOUND",
    status: 404,
  });
  const me = await h.request("GET", "/v1/me", { account: manager });
  expect(await me.json()).toMatchObject({ contexts: [] });
  const reactivate = await h.request(
    "POST",
    `/v1/companies/${company}/members/${member}/reactivate`,
    {
      account: admin,
      body: { expectedVersion: 2, reason: "Synthetic reactivation" },
    },
  );
  expect(reactivate.status).toBe(200);
  const reactivationEvent = await h.inCompany(company, admin, (tx) =>
    rows(
      tx,
      "select reason from audit.audit_event where event_type='membership.reactivated'",
    ),
  );
  expect(reactivationEvent[0]?.reason).toBe("Synthetic reactivation");
  expect(
    (await h.request("GET", `/v1/companies/${company}`, { account: manager }))
      .status,
  ).toBe(200);
  const remove = await h.request(
    "POST",
    `/v1/companies/${company}/members/${member}/remove`,
    {
      account: admin,
      body: { expectedVersion: 3, reason: "Synthetic removal" },
    },
  );
  expect(remove.status).toBe(200);
  const link = await h.inCompany(company, admin, (tx) =>
    rows(
      tx,
      "select status from core.account_company_link where account_id=cast(:account as uuid) and kind='staff'",
      { account: manager.id },
    ),
  );
  expect(link[0]?.status).toBe("revoked");
  await assertChain(h, company, admin);
  await expectDenial(h, company, admin, {
    run: () =>
      h.request(
        "POST",
        `/v1/companies/${company}/members/${member}/reactivate`,
        { account: admin, body: { expectedVersion: 4 } },
      ),
    code: "FORBIDDEN",
    status: 403,
  });
});
it("refuses reactivation when a suspended member joined another company", async () => {
  const h = harness();
  const admin = await h.account();
  const company = await h.company(admin);
  const member = await h.account();
  await accept(
    h,
    member,
    (await invite(h, company, admin, { invitee: member })).token,
  );
  const id = await memberId(h, company, admin, member);
  expect(
    (
      await h.request(
        "POST",
        `/v1/companies/${company}/members/${id}/suspend`,
        {
          account: admin,
          body: { expectedVersion: 1, reason: "Synthetic suspension" },
        },
      )
    ).status,
  ).toBe(200);
  const other = await h.company(member);
  await expectDenial(h, company, admin, {
    run: () =>
      h.request("POST", `/v1/companies/${company}/members/${id}/reactivate`, {
        account: admin,
        body: { expectedVersion: 2 },
      }),
    code: "ACTIVE_MEMBERSHIP_ELSEWHERE",
    status: 409,
  });
  await assertChain(h, other, member);
});
