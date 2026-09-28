import { beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  createMockApi,
  createMockState,
  MOCK_ABSOLUTE_LIFETIME_MS,
  MOCK_IDLE_LIFETIME_MS,
} from "./mock-adapter";
import {
  companyCreatedSchema,
  meSchema,
  sessionGrantSchema,
  signUpAcceptedSchema,
  type AqarakApi,
} from "./contract";
import {
  MOCK_ACCOUNTS,
  MOCK_CONFIRMATION_CODE,
  MOCK_ONLY_PASSWORD,
} from "./mock-fixtures";

let time: number;
let api: AqarakApi;
let state: ReturnType<typeof createMockState>;
const input = {
  email: "  New.Account@EXAMPLE.COM ",
  password: MOCK_ONLY_PASSWORD,
  fullName: "Synthetic Account",
  locale: "en" as const,
};
async function signIn(email = "layla.haddad@example.com"): Promise<string> {
  const result = await api.signIn({
    email,
    password: MOCK_ONLY_PASSWORD,
    client: "web",
  });
  if (!result.ok) throw new Error(result.error.code);
  expect(sessionGrantSchema.safeParse(result.value).success).toBe(true);
  return result.value.session.id;
}
beforeEach(() => {
  time = Date.now();
  state = createMockState(time);
  api = createMockApi({ state, now: () => time });
});
describe("mock API contract", () => {
  it.each(["management_company", "self_managed_owner"] as const)(
    "AC-1 creates the correct %s capacities after registration",
    async (kind) => {
      const accepted = await api.signUp(input);
      expect(accepted.ok).toBe(true);
      if (!accepted.ok) throw new Error(accepted.error.code);
      expect(signUpAcceptedSchema.safeParse(accepted.value).success).toBe(true);
      expect(accepted.value.delivery.destination).toBe("n***@example.com");
      expect(
        await api.confirmSignUp({
          email: input.email,
          code: MOCK_CONFIRMATION_CODE,
        }),
      ).toEqual({ ok: true, value: null });
      const id = await signIn(input.email);
      const created = await api.createCompany(id, {
        kind,
        name: { en: "New Properties", ar: "أملاك جديدة" },
        ...(kind === "management_company"
          ? { tradeLicenceNumber: "SYNTHETIC-123" }
          : {}),
      });
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error(created.error.code);
      expect(companyCreatedSchema.safeParse(created.value).success).toBe(true);
      const me = await api.getMe(id);
      if (!me.ok) throw new Error(me.error.code);
      expect(me.value.contexts).toHaveLength(1);
      expect(me.value.contexts[0]?.staffRoles).toEqual(
        kind === "management_company"
          ? ["company_administrator"]
          : ["company_administrator", "manager"],
      );
      const links = me.value.contexts[0]?.partyLinks ?? [];
      expect(links).toHaveLength(kind === "management_company" ? 0 : 1);
      if (kind === "self_managed_owner") {
        expect(links[0]?.role).toBe("owner");
        expect(links[0]?.partyId).toMatch(/^[0-9a-f-]{36}$/);
      }
      expect(me.value.account.email).toBe("new.account@example.com");
      expect(me.value.contexts[0]?.isDemo).toBe(false);
    },
  );
  it("AC-2 handles credential, confirmation and duplicate-email refusals", async () => {
    expect(
      await api.signIn({
        email: "layla.haddad@example.com",
        password: MOCK_ONLY_PASSWORD + "x",
        client: "web",
      }),
    ).toMatchObject({ error: { code: "INVALID_CREDENTIALS" } });
    expect(
      await api.signIn({
        email: "sara.nasser@example.com",
        password: MOCK_ONLY_PASSWORD,
        client: "web",
      }),
    ).toMatchObject({ error: { code: "USER_NOT_CONFIRMED" } });
    await api.signUp(input);
    expect(await api.signUp(input)).toMatchObject({
      error: { code: "EMAIL_TAKEN" },
    });
    expect(
      await api.confirmSignUp({ email: input.email, code: "000000" }),
    ).toMatchObject({ error: { code: "CODE_MISMATCH" } });
    const id = await signIn();
    expect(await api.signOut(id)).toEqual({ ok: true, value: null });
    expect(await api.getMe(id)).toMatchObject({
      error: { code: "SESSION_INVALID" },
    });
  });
  it("AC-2 expires an idle session after eight hours", async () => {
    const id = await signIn();
    time += MOCK_IDLE_LIFETIME_MS + 1;
    expect(await api.getMe(id)).toMatchObject({
      error: { code: "SESSION_INVALID" },
    });
  });
  it("AC-2 expires an active session at the seven-day absolute limit", async () => {
    const id = await signIn();
    const start = time;
    for (let hour = 1; hour < 168; hour += 7) {
      time = start + hour * 60 * 60 * 1000;
      expect((await api.getMe(id)).ok).toBe(true);
    }
    time = start + MOCK_ABSOLUTE_LIFETIME_MS + 1;
    expect(await api.getMe(id)).toMatchObject({
      error: { code: "SESSION_INVALID" },
    });
  });
  it("stores only the SHA-256 of the session id and refreshes idle expiry", async () => {
    const id = await signIn();
    expect(state.sessions.has(id)).toBe(false);
    const key = createHash("sha256").update(id).digest("hex");
    expect(state.sessions.has(key)).toBe(true);
    time += 7 * 60 * 60 * 1000;
    await api.getMe(id);
    expect(state.sessions.get(key)?.idleExpiresAt).toBe(
      time + MOCK_IDLE_LIFETIME_MS,
    );
    expect(
      [...state.accounts.values()].some((account) =>
        Object.values(account).includes(MOCK_ONLY_PASSWORD),
      ),
    ).toBe(false);
  });
  it("expires and resends confirmation codes, and validates input", async () => {
    await api.signUp(input);
    time += 31 * 60 * 1000;
    expect(
      await api.confirmSignUp({
        email: input.email,
        code: MOCK_CONFIRMATION_CODE,
      }),
    ).toMatchObject({ error: { code: "CODE_EXPIRED" } });
    expect((await api.resendCode({ email: input.email })).ok).toBe(true);
    expect(
      (
        await api.confirmSignUp({
          email: input.email,
          code: MOCK_CONFIRMATION_CODE,
        })
      ).ok,
    ).toBe(true);
    expect(await api.signUp({ ...input, email: "bad" })).toMatchObject({
      error: { code: "VALIDATION_FAILED" },
    });
    expect(
      await api.signUp({ ...input, email: "weak@example.com", password: "x" }),
    ).toMatchObject({ error: { code: "PASSWORD_POLICY" } });
    const id = await signIn();
    expect(
      await api.createCompany(id, {
        kind: "management_company",
        name: { en: "Test Company", ar: "شركة تجريبية" },
      }),
    ).toMatchObject({ error: { code: "VALIDATION_FAILED" } });
  });
  it("returns schema-valid synthetic contexts without exposing mutable state", async () => {
    for (const fixture of MOCK_ACCOUNTS.filter(
      (account) => account.confirmed,
    )) {
      const id = await signIn(fixture.email);
      const result = await api.getMe(id);
      if (!result.ok) throw new Error(result.error.code);
      expect(meSchema.safeParse(result.value).success).toBe(true);
      expect(result.value.contexts).toEqual(fixture.contexts);
      result.value.contexts.length = 0;
      expect(await api.getMe(id)).toMatchObject({
        value: { contexts: fixture.contexts },
      });
    }
  });
  it("keeps the default state across adapter construction", async () => {
    const first = createMockApi();
    const second = createMockApi();
    const grant = await first.signIn({
      email: "layla.haddad@example.com",
      password: MOCK_ONLY_PASSWORD,
      client: "web",
    });
    if (!grant.ok) throw new Error(grant.error.code);
    expect((await second.getMe(grant.value.session.id)).ok).toBe(true);
    await first.signOut(grant.value.session.id);
  });
});
