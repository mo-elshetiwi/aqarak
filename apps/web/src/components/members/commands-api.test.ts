import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createMockApi, createMockState } from "@/lib/api/mock-adapter";
import { createHttpApi } from "@/lib/api/http-adapter";
import { MOCK_COMPANY_A_ID, MOCK_ONLY_PASSWORD } from "@/lib/api/mock-fixtures";
import type { AqarakApi } from "@/lib/api/contract";
async function setup() {
  const state = createMockState();
  const api = createMockApi({ state });
  const login = async (email: string) => {
    const result = await api.signIn({
      email,
      password: MOCK_ONLY_PASSWORD,
      client: "web",
    });
    if (!result.ok) throw new Error(result.error.code);
    return result.value.session.id;
  };
  const session = await login("hassan.ali@example.com");
  const managerSession = await login("layla.haddad@example.com");
  const members = await api.listMembers(session, MOCK_COMPANY_A_ID);
  if (!members.ok) throw new Error("Members unavailable");
  const member = members.value.members.find((item) =>
    item.staffRoles.includes("manager"),
  );
  const admin = members.value.members.find((item) =>
    item.staffRoles.includes("company_administrator"),
  );
  if (!member || !admin) throw new Error("Members missing");
  return { api, state, session, managerSession, member, admin };
}
it("M-7 versions every membership change and removes access on the next request", async () => {
  const { api, session, managerSession, member, admin } = await setup();
  const company = MOCK_COMPANY_A_ID;
  expect(
    await api.changeMemberRoles(
      session,
      company,
      member.membershipId,
      { expectedVersion: 1, staffRoles: ["manager", "accountant"] },
      randomUUID(),
    ),
  ).toMatchObject({
    value: { member: { version: 2, staffRoles: ["manager", "accountant"] } },
  });
  expect(
    await api.suspendMember(
      session,
      company,
      member.membershipId,
      { expectedVersion: 1, reason: "Review" },
      randomUUID(),
    ),
  ).toMatchObject({ error: { code: "VERSION_CONFLICT" } });
  const key = randomUUID();
  const suspended = await api.suspendMember(
    session,
    company,
    member.membershipId,
    { expectedVersion: 2, reason: "Review" },
    key,
  );
  expect(suspended).toMatchObject({
    value: { member: { version: 3, status: "suspended" } },
  });
  expect(
    await api.suspendMember(
      session,
      company,
      member.membershipId,
      { expectedVersion: 2, reason: "Review" },
      key,
    ),
  ).toEqual(suspended);
  expect(await api.getMe(managerSession)).toMatchObject({
    value: { contexts: [] },
  });
  expect(
    await api.reactivateMember(
      session,
      company,
      member.membershipId,
      { expectedVersion: 3 },
      randomUUID(),
    ),
  ).toMatchObject({ value: { member: { version: 4, status: "active" } } });
  expect(await api.getMe(managerSession)).toMatchObject({
    value: { contexts: [expect.objectContaining({ companyId: company })] },
  });
  expect(
    await api.removeMember(
      session,
      company,
      member.membershipId,
      { expectedVersion: 4, reason: "Left company" },
      randomUUID(),
    ),
  ).toMatchObject({ value: { member: { version: 5, status: "removed" } } });
  expect(await api.getMe(managerSession)).toMatchObject({
    ok: true,
    value: { contexts: [] },
  });
  expect(
    await api.suspendMember(
      session,
      company,
      admin.membershipId,
      { expectedVersion: 1, reason: "Review" },
      randomUUID(),
    ),
  ).toMatchObject({ error: { code: "LAST_ADMINISTRATOR" } });
  expect(
    await api.removeMember(
      session,
      company,
      admin.membershipId,
      { expectedVersion: 1, reason: " " },
      randomUUID(),
    ),
  ).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
});
it("M-7 revokes and rotates invitation links once and versions company settings", async () => {
  const { api, session } = await setup();
  const company = MOCK_COMPANY_A_ID;
  const created = await api.createInvitation(
    session,
    company,
    {
      kind: "staff",
      email: "new-member@example.com",
      staffRoles: ["manager"],
      locale: "ar",
    },
    randomUUID(),
  );
  if (!created.ok || !created.value.token)
    throw new Error("Invitation missing");
  const key = randomUUID();
  const id = created.value.invitation.id;
  const resent = await api.resendInvitation(
    session,
    company,
    id,
    { expectedVersion: 1 },
    key,
  );
  expect(resent).toMatchObject({
    value: {
      invitation: { version: 2 },
      acceptPath: expect.stringMatching(/^\/ar\/invitation#/) as unknown,
    },
  });
  expect(await api.previewInvitation(created.value.token)).toMatchObject({
    error: { code: "NOT_FOUND" },
  });
  expect(
    await api.resendInvitation(
      session,
      company,
      id,
      { expectedVersion: 1 },
      key,
    ),
  ).toMatchObject({ value: { token: null, acceptPath: null } });
  expect(
    await api.revokeInvitation(
      session,
      company,
      id,
      { expectedVersion: 2, reason: "Cancelled" },
      randomUUID(),
    ),
  ).toMatchObject({ value: { invitation: { version: 3, status: "revoked" } } });
  expect(
    await api.resendInvitation(
      session,
      company,
      id,
      { expectedVersion: 3 },
      randomUUID(),
    ),
  ).toMatchObject({ error: { code: "INVITATION_NOT_PENDING" } });
  expect(await api.getCompany(session, company)).toMatchObject({
    value: { company: { version: 1, defaultOwnerGate: true } },
  });
  expect(
    await api.updateCompany(
      session,
      company,
      {
        expectedVersion: 1,
        name: { en: "New company name", ar: "اسم الشركة الجديد" },
      },
      randomUUID(),
    ),
  ).toMatchObject({ value: { company: { version: 2 } } });
  expect(
    await api.updateCompany(
      session,
      company,
      { expectedVersion: 1, trn: null },
      randomUUID(),
    ),
  ).toMatchObject({ error: { code: "VERSION_CONFLICT" } });
  expect(await api.getMe(session)).toMatchObject({
    value: {
      contexts: [
        expect.objectContaining({
          companyName: { en: "New company name", ar: "اسم الشركة الجديد" },
        }),
      ],
    },
  });
});
it("M-6 sends documented paths, validated bodies, session and command keys for every command", async () => {
  const { api: mock, session, member } = await setup();
  const company = MOCK_COMPANY_A_ID;
  const key = randomUUID();
  const created = await mock.createInvitation(
    session,
    company,
    {
      kind: "staff",
      email: "transport@example.com",
      staffRoles: ["manager"],
      locale: "en",
    },
    key,
  );
  const settings = await mock.getCompany(session, company);
  if (!created.ok || !settings.ok) throw new Error("Fixture unavailable");
  const commands: {
    name: string;
    path: string;
    method?: string;
    body?: object;
    response: object;
    call: (api: AqarakApi) => Promise<unknown>;
  }[] = [
    ...(["roles", "suspend", "reactivate", "remove"] as const).map((action) => {
      const body =
        action === "roles"
          ? { expectedVersion: 1, staffRoles: ["manager" as const] }
          : action === "reactivate"
            ? { expectedVersion: 1 }
            : { expectedVersion: 1, reason: "Review" };
      return {
        name: action,
        path: `/members/${member.membershipId}/${action}`,
        body,
        response: { member },
        call: (api: AqarakApi) => {
          if (action === "roles")
            return api.changeMemberRoles(
              session,
              company,
              member.membershipId,
              { expectedVersion: 1, staffRoles: ["manager"] },
              key,
            );
          if (action === "reactivate")
            return api.reactivateMember(
              session,
              company,
              member.membershipId,
              { expectedVersion: 1 },
              key,
            );
          return api[action === "suspend" ? "suspendMember" : "removeMember"](
            session,
            company,
            member.membershipId,
            { expectedVersion: 1, reason: "Review" },
            key,
          );
        },
      };
    }),
    {
      name: "revoke",
      path: `/invitations/${created.value.invitation.id}/revoke`,
      body: { expectedVersion: 1, reason: "Review" },
      response: { invitation: created.value.invitation },
      call: (api) =>
        api.revokeInvitation(
          session,
          company,
          created.value.invitation.id,
          { expectedVersion: 1, reason: "Review" },
          key,
        ),
    },
    {
      name: "resend",
      path: `/invitations/${created.value.invitation.id}/resend`,
      body: { expectedVersion: 1 },
      response: created.value,
      call: (api) =>
        api.resendInvitation(
          session,
          company,
          created.value.invitation.id,
          { expectedVersion: 1 },
          key,
        ),
    },
    {
      name: "get",
      path: "",
      method: "GET",
      response: settings.value,
      call: (api) => api.getCompany(session, company),
    },
    {
      name: "update",
      path: "",
      method: "PATCH",
      body: { expectedVersion: 1, trn: null },
      response: settings.value,
      call: (api) =>
        api.updateCompany(
          session,
          company,
          { expectedVersion: 1, trn: null },
          key,
        ),
    },
  ];
  for (const command of commands) {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(command.response));
    const result = await command.call(
      createHttpApi("http://localhost:4010", transport),
    );
    expect(result, command.name).toEqual({ ok: true, value: command.response });
    expect(transport).toHaveBeenCalledWith(
      `http://localhost:4010/v1/companies/${company}${command.path}`,
      expect.objectContaining({
        method: command.method ?? "POST",
        cache: "no-store",
        ...(command.body ? { body: JSON.stringify(command.body) } : {}),
      }),
    );
    const headers = new Headers(transport.mock.calls[0]?.[1]?.headers);
    expect(headers.get("Authorization")).toBe(`Session ${session}`);
    expect(headers.get("Idempotency-Key")).toBe(command.body ? key : null);
  }
});

it("M-7 refuses unauthorized commands and cross-company reactivation while preserving suspended state", async () => {
  const { api, state, session, managerSession, member } = await setup();
  expect(await api.getCompany(managerSession, MOCK_COMPANY_A_ID)).toMatchObject(
    { ok: true },
  );
  expect(
    await api.changeMemberRoles(
      managerSession,
      MOCK_COMPANY_A_ID,
      member.membershipId,
      { expectedVersion: 1, staffRoles: ["accountant"] },
      randomUUID(),
    ),
  ).toMatchObject({ error: { code: "FORBIDDEN" } });
  await api.suspendMember(
    session,
    MOCK_COMPANY_A_ID,
    member.membershipId,
    { expectedVersion: 1, reason: "Review" },
    randomUUID(),
  );
  expect(await api.getCompany(managerSession, MOCK_COMPANY_A_ID)).toMatchObject(
    { error: { code: "NOT_FOUND" } },
  );
  const account = state.accounts.get("layla.haddad@example.com");
  const prior = account?.contexts[0];
  if (!account || !prior) throw new Error("Fixture unavailable");
  account.contexts.push({
    ...prior,
    companyId: randomUUID(),
    staffRoles: ["manager"],
  });
  expect(
    await api.reactivateMember(
      session,
      MOCK_COMPANY_A_ID,
      member.membershipId,
      { expectedVersion: 2 },
      randomUUID(),
    ),
  ).toMatchObject({ error: { code: "ACTIVE_MEMBERSHIP_ELSEWHERE" } });
  const members = await api.listMembers(session, MOCK_COMPANY_A_ID);
  if (!members.ok) throw new Error("Fixture unavailable");
  expect(
    members.value.members.find(
      (item) => item.membershipId === member.membershipId,
    ),
  ).toMatchObject({ version: 2, status: "suspended" });
});

it("allows the database-backed current context read the company request deadline", async () => {
  const { api, session } = await setup();
  const me = await api.getMe(session);
  if (!me.ok) throw new Error("Session unavailable");
  const timeout = vi.spyOn(AbortSignal, "timeout");
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json(me.value));
  expect(
    await createHttpApi("http://localhost:4010", transport).getMe(session),
  ).toEqual(me);
  expect(timeout).toHaveBeenCalledWith(60_000);
  timeout.mockRestore();
});
