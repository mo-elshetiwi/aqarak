import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createHttpApi } from "@/lib/api/http-adapter";
import { createMockApi, createMockState } from "@/lib/api/mock-adapter";
import { MOCK_COMPANY_A_ID, MOCK_ONLY_PASSWORD } from "@/lib/api/mock-fixtures";
import {
  apiProblemCodeSchema,
  type AqarakApi,
  type CreateInvitationInput,
} from "@/lib/api/contract";

async function login(api: AqarakApi, email: string): Promise<string> {
  const result = await api.signIn({
    email,
    password: MOCK_ONLY_PASSWORD,
    client: "web",
  });
  if (!result.ok) throw new Error(result.error.code);
  return result.value.session.id;
}
async function fixture() {
  const state = createMockState();
  const api = createMockApi({ state });
  const session = await login(api, "hassan.ali@example.com");
  const input: CreateInvitationInput = {
    kind: "staff",
    email: "colleague@example.com",
    staffRoles: ["manager"],
    locale: "en",
  };
  const key = randomUUID();
  const created = await api.createInvitation(
    session,
    MOCK_COMPANY_A_ID,
    input,
    key,
  );
  if (!created.ok || !created.value.token)
    throw new Error("Invitation missing");
  return {
    api,
    state,
    session,
    input,
    key,
    created: created.value,
    token: created.value.token,
  };
}

describe("invitation API contracts", () => {
  it("W-2 accepts only a matching account and updates members and invitations", async () => {
    const f = await fixture();
    expect(await f.api.previewInvitation(f.token)).toMatchObject({
      ok: true,
      value: {
        invitation: {
          maskedEmail: "c***@example.com",
          staffRoles: ["manager"],
          status: "pending",
        },
      },
    });
    expect(
      await f.api.acceptInvitation(f.session, f.token, randomUUID()),
    ).toMatchObject({ error: { code: "INVITATION_EMAIL_MISMATCH" } });
    await f.api.signUp({
      email: f.input.email,
      fullName: "New Colleague",
      password: MOCK_ONLY_PASSWORD,
      locale: "en",
    });
    await f.api.confirmSignUp({ email: f.input.email, code: "246810" });
    const colleague = await login(f.api, f.input.email);
    const key = randomUUID();
    const accepted = await f.api.acceptInvitation(colleague, f.token, key);
    expect(accepted).toMatchObject({
      ok: true,
      value: {
        context: { companyId: MOCK_COMPANY_A_ID, staffRoles: ["manager"] },
      },
    });
    expect(await f.api.acceptInvitation(colleague, f.token, key)).toEqual(
      accepted,
    );
    expect(
      await f.api.acceptInvitation(colleague, f.token, randomUUID()),
    ).toMatchObject({ error: { code: "INVITATION_NOT_PENDING" } });
    const members = await f.api.listMembers(f.session, MOCK_COMPANY_A_ID);
    if (!members.ok) throw new Error(members.error.code);
    expect(
      members.value.members.find((member) => member.email === f.input.email),
    ).toMatchObject({ status: "active", staffRoles: ["manager"] });
    expect(
      await f.api.listInvitations(f.session, MOCK_COMPANY_A_ID),
    ).toMatchObject({
      value: { invitations: [expect.objectContaining({ status: "accepted" })] },
    });
    expect(await f.api.listMembers(colleague, MOCK_COMPANY_A_ID)).toMatchObject(
      { error: { code: "FORBIDDEN" } },
    );
  });
  it("replays without disclosing the link and rejects changed input", async () => {
    const f = await fixture();
    expect(
      await f.api.createInvitation(
        f.session,
        MOCK_COMPANY_A_ID,
        f.input,
        f.key,
      ),
    ).toMatchObject({ value: { token: null, acceptPath: null } });
    expect(
      await f.api.createInvitation(
        f.session,
        MOCK_COMPANY_A_ID,
        { ...f.input, staffRoles: ["accountant"] },
        f.key,
      ),
    ).toMatchObject({ error: { code: "IDEMPOTENCY_KEY_REUSED" } });
    expect(
      await f.api.createInvitation(
        f.session,
        MOCK_COMPANY_A_ID,
        f.input,
        randomUUID(),
      ),
    ).toMatchObject({ error: { code: "INVITATION_EXISTS" } });
    expect(JSON.stringify([...f.state.invitations])).not.toContain(f.token);
    expect(JSON.stringify([...f.state.commands])).not.toContain(f.token);
  });
  it("W-1 sends exact methods, paths, bodies and headers and parses every new success", async () => {
    const f = await fixture();
    const preview = await f.api.previewInvitation(f.token);
    const members = await f.api.listMembers(f.session, MOCK_COMPANY_A_ID);
    const invitations = await f.api.listInvitations(
      f.session,
      MOCK_COMPANY_A_ID,
    );
    const me = await f.api.getMe(f.session);
    if (!preview.ok || !members.ok || !invitations.ok || !me.ok)
      throw new Error("Fixture failed");
    const context = me.value.contexts[0];
    const cases = [
      {
        path: "/v1/invitations/preview",
        method: "POST",
        body: { token: f.token },
        response: preview.value,
        status: 200,
        authenticated: false,
        key: false,
        call: (api: AqarakApi) => api.previewInvitation(f.token),
      },
      {
        path: "/v1/invitations/accept",
        method: "POST",
        body: { token: f.token },
        response: { context },
        status: 200,
        authenticated: true,
        key: true,
        call: (api: AqarakApi) =>
          api.acceptInvitation(f.session, f.token, f.key),
      },
      {
        path: `/v1/companies/${MOCK_COMPANY_A_ID}/members`,
        method: "GET",
        response: members.value,
        status: 200,
        authenticated: true,
        key: false,
        call: (api: AqarakApi) => api.listMembers(f.session, MOCK_COMPANY_A_ID),
      },
      {
        path: `/v1/companies/${MOCK_COMPANY_A_ID}/invitations`,
        method: "GET",
        response: invitations.value,
        status: 200,
        authenticated: true,
        key: false,
        call: (api: AqarakApi) =>
          api.listInvitations(f.session, MOCK_COMPANY_A_ID),
      },
      {
        path: `/v1/companies/${MOCK_COMPANY_A_ID}/invitations`,
        method: "POST",
        body: f.input,
        response: f.created,
        status: 201,
        authenticated: true,
        key: true,
        call: (api: AqarakApi) =>
          api.createInvitation(f.session, MOCK_COMPANY_A_ID, f.input, f.key),
      },
    ];
    for (const item of cases) {
      const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json(
            { ...item.response, ignored: true },
            { status: item.status },
          ),
        );
      const result = await item.call(
        createHttpApi("http://localhost:4010", transport),
      );
      expect(result).toEqual({ ok: true, value: item.response });
      expect(transport).toHaveBeenCalledWith(
        `http://localhost:4010${item.path}`,
        expect.objectContaining({
          method: item.method,
          cache: "no-store",
          redirect: "error",
          ...(item.body ? { body: JSON.stringify(item.body) } : {}),
        }),
      );
      const headers = new Headers(transport.mock.calls[0]?.[1]?.headers);
      expect(headers.get("Authorization")).toBe(
        item.authenticated ? `Session ${f.session}` : null,
      );
      expect(headers.get("Idempotency-Key")).toBe(item.key ? f.key : null);
      transport.mockResolvedValue(
        Response.json({ invalid: true }, { status: item.status }),
      );
      expect(
        await item.call(createHttpApi("http://localhost:4010", transport)),
      ).toMatchObject({ error: { code: "UNAVAILABLE" } });
      for (const code of apiProblemCodeSchema.options) {
        transport.mockResolvedValue(
          Response.json(
            { code },
            { status: code === "UNAVAILABLE" ? 503 : 409 },
          ),
        );
        expect(
          await item.call(createHttpApi("http://localhost:4010", transport)),
        ).toMatchObject({ error: { code } });
      }
    }
  });
  it("forwards an optional company key and replays company creation", async () => {
    const deadline = vi.spyOn(AbortSignal, "timeout");
    const f = await fixture();
    const input = {
      kind: "self_managed_owner" as const,
      name: { en: "Synthetic Company", ar: "شركة تجريبية" },
    };
    const created = await f.api.createCompany(f.session, input, f.key);
    expect(await f.api.createCompany(f.session, input, f.key)).toEqual(created);
    if (!created.ok) throw new Error(created.error.code);
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(created.value, { status: 201 }));
    await createHttpApi("http://localhost:4010", transport).createCompany(
      f.session,
      input,
      f.key,
    );
    expect(
      new Headers(transport.mock.calls[0]?.[1]?.headers).get("Idempotency-Key"),
    ).toBe(f.key);
    expect(deadline).toHaveBeenCalledWith(60_000);
    deadline.mockRestore();
  });
});
