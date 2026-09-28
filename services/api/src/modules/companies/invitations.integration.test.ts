import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { z } from "zod";
import {
  accept,
  assertChain,
  events,
  expectDenial,
  harness,
  invitationResponse,
  invitationVersion,
  invite,
  ownerFixture,
} from "../identity/integration-support";
import { json, rows, sha256 } from "../identity/database";
import { companyContextSchema } from "../identity/accounts";
it("I-6 creates, delivers, previews and accepts a staff invitation with exact coverage", async () => {
  const h = harness();
  const admin = await h.account();
  const company = await h.company(admin);
  const invitee = await h.account();
  const created = await invite(h, company, admin, { invitee: invitee });
  expect(h.emails).toHaveLength(1);
  expect(h.emails[0]?.text).toContain(
    `http://localhost:3000/en/invitation#${created.token}`,
  );
  expect(h.emails[0]?.text).toContain("شركة تجريبية");
  const stored = await h.inCompany(company, admin, (tx) =>
    rows(tx, "select * from core.invitation where id=cast(:id as uuid)", {
      id: created.invitation.id,
    }),
  );
  expect(stored[0]?.token_hash).toBe(sha256(created.token));
  expect(created.invitation.deliveryStatus).toBe("sent");
  expect(created.invitation.deliveryStatus).toBe(stored[0]?.delivery_status);
  expect(created.invitation.version).toBe(Number(stored[0]?.version));
  expect(JSON.stringify(stored)).not.toContain(created.token);
  const preview = await h.request("POST", "/v1/invitations/preview", {
    body: { token: created.token },
  });
  expect(preview.status).toBe(200);
  expect(await preview.json()).toMatchObject({
    invitation: {
      kind: "staff",
      staffRoles: ["manager"],
      status: "pending",
      maskedEmail: "i***@example.com",
    },
  });
  const accepted = await h.request("POST", "/v1/invitations/accept", {
    account: invitee,
    body: { token: created.token },
  });
  expect(accepted.status, h.errors.at(-1)).toBe(200);
  expect(
    z.object({ context: companyContextSchema }).parse(await accepted.json())
      .context.staffRoles,
  ).toEqual(["manager"]);
  const audit = await events(h, company, admin);
  expect(audit.map((event) => event.event_type)).toEqual([
    "company.created",
    "invitation.created",
    "invitation.delivery_recorded",
    "invitation.accepted",
  ]);
  expect(audit[2]).toMatchObject({
    actor_role: "company_administrator",
    initiator: "person",
    channel: "web_form",
  });
  const coverage = await h.inCompany(company, admin, (tx) =>
    rows(
      tx,
      "select s.subject_type from audit.event_subject s join audit.audit_event e using(company_id,event_id) where e.event_type='invitation.accepted' order by s.subject_type",
    ),
  );
  expect(coverage.map((row) => row.subject_type)).toEqual([
    "account_company_link",
    "invitation",
    "membership",
    "person_account",
  ]);
  const me = await h.request("GET", "/v1/me", { account: invitee });
  expect(await me.json()).toMatchObject({
    contexts: [{ companyId: company, staffRoles: ["manager"] }],
  });
  await assertChain(h, company, admin);
});
it("I-5 stores no invitation token and replays create and resend without delivery", async () => {
  const h = harness();
  const admin = await h.account();
  const company = await h.company(admin);
  const invitee = await h.account();
  const key = randomUUID();
  const body = {
    kind: "staff",
    email: invitee.email,
    staffRoles: ["manager"],
    locale: "en",
  };
  const first = await h.request(
    "POST",
    `/v1/companies/${company}/invitations`,
    { account: admin, key, body },
  );
  expect(first.status, h.errors.at(-1)).toBe(201);
  const value = invitationResponse.parse(await first.json());
  const assertStoredResponse = async (responseKey: string, tokens: string[]) =>
    h.inCompany(company, admin, async (tx) => {
      for (const table of [
        "ops.idempotency_key",
        "core.invitation",
        "audit.audit_event",
      ]) {
        const stored = await rows(
          tx,
          `select to_jsonb(stored)::text as row_json from ${table} stored where company_id=cast(:company as uuid)`,
          { company },
        );
        expect(stored.length).toBeGreaterThan(0);
        for (const row of stored)
          for (const token of tokens)
            expect(String(row.row_json)).not.toContain(token);
      }
      const stored = await rows(
        tx,
        "select response from ops.idempotency_key where company_id=cast(:company as uuid) and key=:key",
        { company, key: responseKey },
      );
      const response = z
        .object({ status: z.number(), body: z.unknown() })
        .parse(json(stored[0]?.response));
      expect(response.body).toMatchObject({
        invitation: { id: value.invitation.id },
        token: null,
        acceptPath: null,
      });
      return response;
    });
  const storedCreate = await assertStoredResponse(key, [value.token]);
  expect(storedCreate.status).toBe(201);
  const replay = await h.request(
    "POST",
    `/v1/companies/${company}/invitations`,
    { account: admin, key, body },
  );
  expect(replay.status).toBe(201);
  expect(await replay.json()).toEqual(storedCreate.body);
  expect(replay.headers.get("Idempotent-Replayed")).toBe("true");
  expect(h.emails).toHaveLength(1);
  expect(await events(h, company, admin)).toHaveLength(3);
  await expectDenial(h, company, admin, {
    run: () =>
      h.request("POST", `/v1/companies/${company}/invitations`, {
        account: admin,
        key,
        body: { ...body, staffRoles: ["technician"] },
      }),
    code: "IDEMPOTENCY_KEY_REUSED",
    status: 422,
  });
  await expectDenial(h, company, admin, {
    run: () =>
      h.request("POST", `/v1/companies/${company}/invitations`, {
        account: admin,
        body,
      }),
    code: "INVITATION_EXISTS",
    status: 409,
  });
  const resendKey = randomUUID();
  const resendPath = `/v1/companies/${company}/invitations/${value.invitation.id}/resend`;
  const resendBody = {
    expectedVersion: value.invitation.version,
  };
  const resent = await h.request("POST", resendPath, {
    account: admin,
    key: resendKey,
    body: resendBody,
  });
  expect(resent.status, h.errors.at(-1)).toBe(200);
  const rotated = invitationResponse.parse(await resent.json());
  expect(rotated.token).not.toBe(value.token);
  const storedResend = await assertStoredResponse(resendKey, [
    value.token,
    rotated.token,
  ]);
  expect(storedResend.status).toBe(200);
  const eventsBeforeReplay = await events(h, company, admin);
  const resentReplay = await h.request("POST", resendPath, {
    account: admin,
    key: resendKey,
    body: resendBody,
  });
  expect(resentReplay.status).toBe(200);
  expect(resentReplay.headers.get("Idempotent-Replayed")).toBe("true");
  expect(await resentReplay.json()).toEqual(storedResend.body);
  expect(h.emails).toHaveLength(2);
  expect(await events(h, company, admin)).toEqual(eventsBeforeReplay);
  await assertChain(h, company, admin);
});
it("I-7 refuses email mismatch, repeat acceptance, expiry and IN2 in the inviting chain", async () => {
  const h = harness();
  const admin = await h.account();
  const company = await h.company(admin);
  const invitee = await h.account();
  const wrong = await h.account();
  const created = await invite(h, company, admin, { invitee: invitee });
  await expectDenial(h, company, admin, {
    run: () =>
      h.request("POST", "/v1/invitations/accept", {
        account: wrong,
        body: { token: created.token },
      }),
    code: "INVITATION_EMAIL_MISMATCH",
    status: 403,
  });
  await accept(h, invitee, created.token);
  await expectDenial(h, company, admin, {
    run: () =>
      h.request("POST", "/v1/invitations/accept", {
        account: invitee,
        body: { token: created.token },
      }),
    code: "INVITATION_NOT_PENDING",
    status: 409,
  });
  const otherCompany = await h.company(wrong);
  const conflict = await invite(h, company, admin, { invitee: wrong });
  await expectDenial(h, company, admin, {
    run: () =>
      h.request("POST", "/v1/invitations/accept", {
        account: wrong,
        body: { token: conflict.token },
      }),
    code: "ACTIVE_MEMBERSHIP_ELSEWHERE",
    status: 409,
  });
  await assertChain(h, otherCompany, wrong);
  const expiringAccount = await h.account();
  const expiring = await invite(h, company, admin, {
    invitee: expiringAccount,
  });
  h.setTime(new Date(h.deps.clock().getTime() + 8 * 86400_000));
  const freshLogin = await h.request("POST", "/v1/auth/sign-in", {
    body: {
      email: expiringAccount.email,
      password: "Synthetic-Only-123!",
      client: "web",
    },
  });
  expect(freshLogin.status).toBe(200);
  expiringAccount.session = z
    .object({ session: z.object({ id: z.string() }) })
    .parse(await freshLogin.json()).session.id;
  await expectDenial(h, company, admin, {
    run: () =>
      h.request("POST", "/v1/invitations/accept", {
        account: expiringAccount,
        body: { token: expiring.token },
      }),
    code: "INVITATION_NOT_PENDING",
    status: 409,
  });
});
it.each(["owner", "tenant"] as const)(
  "I-8 links an invited %s and refuses a competing link",
  async (kind) => {
    const h = harness();
    const admin = await h.account();
    const company = await h.company(admin);
    const party = await ownerFixture(h, company, admin, kind);
    const first = await h.account();
    const second = await h.account();
    const invitation = await invite(h, company, admin, {
      invitee: first,
      kind,
      targetId: party,
    });
    const competing = await invite(h, company, admin, {
      invitee: second,
      kind,
      targetId: party,
    });
    await accept(h, first, invitation.token);
    const linked = await h.inCompany(company, admin, (tx) =>
      rows(
        tx,
        `select linked_account_id from party.${kind} where id=cast(:id as uuid)`,
        { id: party },
      ),
    );
    expect(linked[0]?.linked_account_id).toBe(first.id);
    await expectDenial(h, company, admin, {
      run: () =>
        h.request("POST", "/v1/invitations/accept", {
          account: second,
          body: { token: competing.token },
        }),
      code: "PARTY_ALREADY_LINKED",
      status: 409,
    });
  },
);
it("I-11 rejects stale revoke and resend then rotates and revokes a pending invitation", async () => {
  const h = harness();
  const admin = await h.account();
  const company = await h.company(admin);
  const invitee = await h.account();
  const invitation = await invite(h, company, admin, { invitee: invitee });
  for (const action of ["revoke", "resend"])
    await expectDenial(h, company, admin, {
      run: () =>
        h.request(
          "POST",
          `/v1/companies/${company}/invitations/${invitation.invitation.id}/${action}`,
          {
            account: admin,
            body: { expectedVersion: 1, reason: "Synthetic withdrawal" },
          },
        ),
      code: "VERSION_CONFLICT",
      status: 409,
    });
  const resent = await h.request(
    "POST",
    `/v1/companies/${company}/invitations/${invitation.invitation.id}/resend`,
    {
      account: admin,
      body: { expectedVersion: invitation.invitation.version },
    },
  );
  expect(resent.status, h.errors.at(-1)).toBe(200);
  const rotated = invitationResponse.parse(await resent.json());
  expect(rotated.token).not.toBe(invitation.token);
  expect(rotated.invitation.deliveryStatus).toBe("sent");
  expect(rotated.invitation.version).toBe(invitation.invitation.version + 2);
  expect(rotated.invitation.version).toBe(
    await invitationVersion(h, company, admin, invitation.invitation.id),
  );
  expect(
    (
      await h.request("POST", "/v1/invitations/preview", {
        body: { token: invitation.token },
      })
    ).status,
  ).toBe(404);
  const revoked = await h.request(
    "POST",
    `/v1/companies/${company}/invitations/${invitation.invitation.id}/revoke`,
    {
      account: admin,
      body: {
        expectedVersion: rotated.invitation.version,
        reason: "Synthetic withdrawal",
      },
    },
  );
  expect(revoked.status).toBe(200);
  await assertChain(h, company, admin);
});
it("I-15 retains an invitation and records only the delivery error name", async () => {
  const h = harness({ failEmail: true });
  const admin = await h.account();
  const company = await h.company(admin);
  const invitee = await h.account();
  const invitation = await invite(h, company, admin, { invitee: invitee });
  const stored = await h.inCompany(company, admin, (tx) =>
    rows(
      tx,
      "select delivery_status,delivery_error,version from core.invitation where id=cast(:id as uuid)",
      { id: invitation.invitation.id },
    ),
  );
  expect(stored[0]).toMatchObject({
    delivery_status: "failed",
    delivery_error: "TypeError",
  });
  expect(invitation.invitation.deliveryStatus).toBe("failed");
  expect(invitation.invitation.version).toBe(Number(stored[0]?.version));
  await assertChain(h, company, admin);
});
it("I-16 serializes concurrent acceptance into one membership and one acceptance event", async () => {
  const h = harness();
  const admin = await h.account();
  const company = await h.company(admin);
  const invitee = await h.account();
  const invitation = await invite(h, company, admin, { invitee: invitee });
  const responses = await Promise.all([
    h.request("POST", "/v1/invitations/accept", {
      account: invitee,
      body: { token: invitation.token },
    }),
    h.request("POST", "/v1/invitations/accept", {
      account: invitee,
      body: { token: invitation.token },
    }),
  ]);
  expect(responses.map((response) => response.status).sort()).toEqual([
    200, 409,
  ]);
  const members = await h.inCompany(company, admin, (tx) =>
    rows(
      tx,
      "select id from core.membership where account_id=cast(:account as uuid)",
      { account: invitee.id },
    ),
  );
  expect(members).toHaveLength(1);
  expect(
    (await events(h, company, admin)).filter(
      (event) => event.event_type === "invitation.accepted",
    ),
  ).toHaveLength(1);
  await assertChain(h, company, admin);
});
