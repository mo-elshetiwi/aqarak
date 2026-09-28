import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { err, ok, type Result } from "@aqarak/domain";
import {
  passwordPolicySchema,
  rolesCommandSchema,
  reasonCommandSchema,
  reactivateCommandSchema,
  versionCommandSchema,
  updateCompanyInputSchema,
  type Membership,
  type Company,
  type VersionCommand,
  type RolesCommand,
  type ReactivateCommand,
  createInvitationInputSchema,
  invitationTokenSchema,
  idempotencyKeySchema,
  type Invitation,
  type InvitationCreated,
  type CompanyCreated,
  confirmSignUpInputSchema,
  createCompanyInputSchema,
  resendCodeInputSchema,
  sessionIdSchema,
  signInInputSchema,
  signUpInputSchema,
  type Account,
  type AqarakApi,
  type ApiProblem,
  type ApiProblemCode,
  type CompanyContext,
} from "./contract";
import {
  MOCK_ACCOUNTS,
  MOCK_ACCOUNT_IDS,
  MOCK_CONFIRMATION_CODE,
  MOCK_ONLY_PASSWORD,
} from "./mock-fixtures";

export const MOCK_IDLE_LIFETIME_MS = 8 * 60 * 60 * 1000;
export const MOCK_ABSOLUTE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const CODE_LIFETIME_MS = 30 * 60 * 1000;
interface StoredAccount {
  account: Account;
  salt: string;
  passwordHash: Buffer;
  confirmed: boolean;
  codeExpiresAt: number;
  contexts: CompanyContext[];
}
interface StoredSession {
  accountId: string;
  expiresAt: number;
  idleExpiresAt: number;
}
export interface MockState {
  members: Map<string, { companyId: string; member: Membership }>;
  companies: Map<string, Company>;
  mutations: Map<string, { hash: string; value: unknown }>;
  accounts: Map<string, StoredAccount>;
  sessions: Map<string, StoredSession>;
  invitations: Map<
    string,
    { invitation: Invitation; context: CompanyContext; locale?: "en" | "ar" }
  >;
  commands: Map<
    string,
    {
      hash: string;
      value: InvitationCreated | CompanyCreated | { context: CompanyContext };
    }
  >;
}
function hashSession(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex");
}
function credential(password: string): { salt: string; passwordHash: Buffer } {
  const salt = randomBytes(16).toString("hex");
  return { salt, passwordHash: scryptSync(password, salt, 32) };
}
function refusal(
  code: ApiProblemCode,
  status = 400,
): Result<never, ApiProblem> {
  return err({ status, code });
}
/** Creates isolated state for tests; normal development uses the process singleton. */
export function createMockState(now = Date.now()): MockState {
  const accounts = new Map<string, StoredAccount>();
  for (const fixture of MOCK_ACCOUNTS) {
    accounts.set(fixture.email, {
      account: {
        id: MOCK_ACCOUNT_IDS[fixture.handle],
        email: fixture.email,
        displayName: fixture.name.en,
        locale: "en",
      },
      ...credential(MOCK_ONLY_PASSWORD),
      confirmed: fixture.confirmed,
      codeExpiresAt: now + CODE_LIFETIME_MS,
      contexts: structuredClone(fixture.contexts),
    });
  }
  return {
    accounts,
    members: new Map(),
    companies: new Map(),
    mutations: new Map(),
    sessions: new Map(),
    invitations: new Map(),
    commands: new Map(),
  };
}
const processState = globalThis as typeof globalThis & {
  aqarakMockState?: MockState;
};
/** Implements the API in one process, storing only hashes of session identifiers. */
export function createMockApi(
  options: { state?: MockState; now?: () => number } = {},
): AqarakApi {
  const now = options.now ?? Date.now;
  const state =
    options.state ?? (processState.aqarakMockState ??= createMockState(now()));
  function sessionAccount(sessionId: string): StoredAccount | undefined {
    if (!sessionIdSchema.safeParse(sessionId).success) return undefined;
    const key = hashSession(sessionId);
    const session = state.sessions.get(key);
    const time = now();
    if (
      !session ||
      time >= session.expiresAt ||
      time >= session.idleExpiresAt
    ) {
      state.sessions.delete(key);
      return undefined;
    }
    session.idleExpiresAt = Math.min(
      time + MOCK_IDLE_LIFETIME_MS,
      session.expiresAt,
    );
    return [...state.accounts.values()].find(
      (item) => item.account.id === session.accountId,
    );
  }
  function administrator(sessionId: string, companyId: string) {
    const account = sessionAccount(sessionId);
    if (!account) return refusal("SESSION_INVALID", 401);
    const context = account.contexts.find(
      (item) => item.companyId === companyId,
    );
    if (!context || (!context.staffRoles.length && !context.partyLinks.length))
      return refusal("NOT_FOUND", 404);
    if (!context.staffRoles.includes("company_administrator"))
      return refusal("FORBIDDEN", 403);
    return ok({ account, context });
  }
  function effective(invitation: Invitation): Invitation {
    return {
      ...invitation,
      status:
        invitation.status === "pending" &&
        Date.parse(invitation.expiresAt) <= now()
          ? "expired"
          : invitation.status,
    };
  }
  function syncMembers(companyId: string): void {
    for (const { account, contexts } of state.accounts.values()) {
      const context = contexts.find((item) => item.companyId === companyId);
      const key = `${companyId}:${account.id}`;
      if (context?.staffRoles.length && !state.members.has(key))
        state.members.set(key, {
          companyId,
          member: {
            membershipId: account.id,
            accountId: account.id,
            email: account.email,
            displayName: account.displayName,
            staffRoles: [...context.staffRoles],
            status: "active",
            version: 1,
          },
        });
    }
  }
  function companyFor(context: CompanyContext): Company {
    let company = state.companies.get(context.companyId);
    if (!company) {
      company = {
        id: context.companyId,
        kind: context.companyKind,
        name: { ...context.companyName },
        tradeLicenceNumber:
          context.companyKind === "management_company" ? "DEMO-LICENCE" : null,
        trn: null,
        defaultOwnerGate: true,
        isDemo: context.isDemo,
        status: "active",
        version: 1,
      };
      state.companies.set(company.id, company);
    }
    return company;
  }
  function mutation<T>(
    ...[sessionId, companyId, targetId, action, input, idempotencyKey, run]: [
      string,
      string,
      string,
      string,
      unknown,
      string,
      (context: CompanyContext) => Result<T, ApiProblem>,
    ]
  ): Promise<Result<T, ApiProblem>> {
    return Promise.resolve().then(() => {
      const actor = administrator(sessionId, companyId);
      if (!actor.ok) return actor;
      if (!idempotencyKeySchema.safeParse(idempotencyKey).success)
        return refusal("VALIDATION_FAILED");
      const key = `${companyId}:${actor.value.account.account.id}:${action}:${idempotencyKey}`;
      const hash = hashSession(JSON.stringify({ targetId, input }));
      const replay = state.mutations.get(key);
      if (replay)
        return replay.hash === hash
          ? ok(structuredClone(replay.value as T))
          : refusal("IDEMPOTENCY_KEY_REUSED", 422);
      const result = run(actor.value.context);
      if (result.ok) {
        const value = structuredClone(result.value);
        if (action === "resend" && typeof value === "object" && value !== null)
          Object.assign(value, { token: null, acceptPath: null });
        state.mutations.set(key, { hash, value });
      }
      return result;
    });
  }
  function invalidTransition(member: Membership, action: string): boolean {
    return (
      member.status === "removed" ||
      (action === "suspend" && member.status !== "active") ||
      (action === "reactivate" && member.status !== "suspended")
    );
  }
  function removesAdministrator(
    member: Membership,
    status: Membership["status"],
    roles: Membership["staffRoles"],
  ): boolean {
    return (
      member.status === "active" &&
      member.staffRoles.includes("company_administrator") &&
      (status !== "active" || !roles.includes("company_administrator"))
    );
  }
  function memberCommand(
    ...[sessionId, companyId, targetId, input, key, action]: [
      string,
      string,
      string,
      VersionCommand | RolesCommand | ReactivateCommand,
      string,
      "roles" | "suspend" | "reactivate" | "remove",
    ]
  ) {
    return mutation(sessionId, companyId, targetId, action, input, key, () => {
      const schema = {
        roles: rolesCommandSchema,
        reactivate: reactivateCommandSchema,
        suspend: reasonCommandSchema,
        remove: reasonCommandSchema,
      }[action];
      if (!schema.safeParse(input).success) return refusal("VALIDATION_FAILED");
      syncMembers(companyId);
      const member = state.members.get(`${companyId}:${targetId}`)?.member;
      if (!member) return refusal("NOT_FOUND", 404);
      if (member.version !== input.expectedVersion)
        return refusal("VERSION_CONFLICT", 409);
      if (invalidTransition(member, action)) return refusal("FORBIDDEN", 403);
      const roles =
        "staffRoles" in input ? input.staffRoles : member.staffRoles;
      const status = {
        roles: member.status,
        reactivate: "active",
        suspend: "suspended",
        remove: "removed",
      }[action] as Membership["status"];
      if (
        removesAdministrator(member, status, roles) &&
        [...state.members.values()].filter(
          (item) =>
            item.companyId === companyId &&
            item.member.status === "active" &&
            item.member.staffRoles.includes("company_administrator"),
        ).length <= 1
      )
        return refusal("LAST_ADMINISTRATOR", 409);
      const account = [...state.accounts.values()].find(
        (item) => item.account.id === member.accountId,
      );
      if (!account) return refusal("NOT_FOUND", 404);
      if (
        action === "reactivate" &&
        account.contexts.some(
          (item) => item.companyId !== companyId && item.staffRoles.length,
        )
      )
        return refusal("ACTIVE_MEMBERSHIP_ELSEWHERE", 409);
      member.staffRoles = [...roles];
      member.status = status;
      member.version += 1;
      const context = account.contexts.find(
        (item) => item.companyId === companyId,
      );
      if (context) context.staffRoles = status === "active" ? [...roles] : [];
      return ok({ member: structuredClone(member) });
    });
  }
  return {
    changeMemberRoles: (...[sessionId, companyId, targetId, input, key]) =>
      memberCommand(sessionId, companyId, targetId, input, key, "roles"),
    suspendMember: (...[sessionId, companyId, targetId, input, key]) =>
      memberCommand(sessionId, companyId, targetId, input, key, "suspend"),
    reactivateMember: (...[sessionId, companyId, targetId, input, key]) =>
      memberCommand(sessionId, companyId, targetId, input, key, "reactivate"),
    removeMember: (...[sessionId, companyId, targetId, input, key]) =>
      memberCommand(sessionId, companyId, targetId, input, key, "remove"),
    getCompany(sessionId, companyId) {
      const account = sessionAccount(sessionId);
      if (!account) return Promise.resolve(refusal("SESSION_INVALID", 401));
      const context = account.contexts.find(
        (item) =>
          item.companyId === companyId &&
          (item.staffRoles.length || item.partyLinks.length),
      );
      if (!context) return Promise.resolve(refusal("NOT_FOUND", 404));
      if (
        !context.staffRoles.some((role) =>
          ["company_administrator", "manager", "accountant"].includes(role),
        )
      )
        return Promise.resolve(refusal("FORBIDDEN", 403));
      return Promise.resolve(
        ok({ company: structuredClone(companyFor(context)) }),
      );
    },
    updateCompany(sessionId, companyId, input, key) {
      return mutation(
        sessionId,
        companyId,
        companyId,
        "settings",
        input,
        key,
        (context) => {
          const parsed = updateCompanyInputSchema.safeParse(input);
          if (!parsed.success) return refusal("VALIDATION_FAILED");
          const company = companyFor(context);
          if (company.version !== input.expectedVersion)
            return refusal("VERSION_CONFLICT", 409);
          const { expectedVersion: version, ...patch } = parsed.data;
          Object.assign(company, patch, { version: version + 1 });
          for (const account of state.accounts.values())
            for (const item of account.contexts)
              if (item.companyId === companyId)
                item.companyName = { ...company.name };
          return ok({ company: structuredClone(company) });
        },
      );
    },
    revokeInvitation(...[sessionId, companyId, targetId, input, key]) {
      return mutation(
        sessionId,
        companyId,
        targetId,
        "revoke",
        input,
        key,
        () => {
          if (!reasonCommandSchema.safeParse(input).success)
            return refusal("VALIDATION_FAILED");
          const stored = [...state.invitations.values()].find(
            (item) =>
              item.invitation.id === targetId &&
              item.context.companyId === companyId,
          );
          if (!stored) return refusal("NOT_FOUND", 404);
          if (stored.invitation.version !== input.expectedVersion)
            return refusal("VERSION_CONFLICT", 409);
          if (effective(stored.invitation).status !== "pending")
            return refusal("INVITATION_NOT_PENDING", 409);
          stored.invitation.status = "revoked";
          stored.invitation.version += 1;
          return ok({ invitation: structuredClone(stored.invitation) });
        },
      );
    },
    resendInvitation(...[sessionId, companyId, targetId, input, key]) {
      return mutation(
        sessionId,
        companyId,
        targetId,
        "resend",
        input,
        key,
        () => {
          if (!versionCommandSchema.safeParse(input).success)
            return refusal("VALIDATION_FAILED");
          const entry = [...state.invitations.entries()].find(
            ([, item]) =>
              item.invitation.id === targetId &&
              item.context.companyId === companyId,
          );
          if (!entry) return refusal("NOT_FOUND", 404);
          const [oldHash, stored] = entry;
          if (stored.invitation.version !== input.expectedVersion)
            return refusal("VERSION_CONFLICT", 409);
          if (
            !["pending", "expired"].includes(
              effective(stored.invitation).status,
            )
          )
            return refusal("INVITATION_NOT_PENDING", 409);
          const token = randomBytes(32).toString("base64url");
          stored.invitation.status = "pending";
          stored.invitation.version += 1;
          stored.invitation.expiresAt = new Date(
            now() + 7 * 86400000,
          ).toISOString();
          state.invitations.delete(oldHash);
          state.invitations.set(hashSession(token), stored);
          return ok({
            invitation: structuredClone(stored.invitation),
            token,
            acceptPath: `/${stored.locale ?? "en"}/invitation#${token}`,
          });
        },
      );
    },
    listMembers(sessionId, companyId) {
      return Promise.resolve().then(() => {
        const actor = administrator(sessionId, companyId);
        if (!actor.ok) return actor;
        syncMembers(companyId);
        return ok({
          members: [...state.members.values()]
            .filter((item) => item.companyId === companyId)
            .map((item) => structuredClone(item.member)),
        });
      });
    },
    listInvitations(sessionId, companyId) {
      return Promise.resolve().then(() => {
        const actor = administrator(sessionId, companyId);
        if (!actor.ok) return actor;
        return ok({
          invitations: [...state.invitations.values()]
            .filter((item) => item.context.companyId === companyId)
            .map((item) => structuredClone(effective(item.invitation))),
        });
      });
    },
    createInvitation(sessionId, companyId, input, idempotencyKey) {
      return Promise.resolve().then(() => {
        const actor = administrator(sessionId, companyId);
        if (!actor.ok) return actor;
        const parsed = createInvitationInputSchema.safeParse(input);
        if (
          !parsed.success ||
          !idempotencyKeySchema.safeParse(idempotencyKey).success
        )
          return refusal("VALIDATION_FAILED");
        const value = parsed.data;
        const key = `invite:${companyId}:${actor.value.account.account.id}:${idempotencyKey}`;
        const hash = hashSession(JSON.stringify(value));
        const replay = state.commands.get(key);
        if (replay)
          return replay.hash === hash
            ? ok(structuredClone(replay.value as InvitationCreated))
            : refusal("IDEMPOTENCY_KEY_REUSED", 422);
        if (
          [...state.invitations.values()].some(
            (item) =>
              item.context.companyId === companyId &&
              item.invitation.email === value.email &&
              item.invitation.status === "pending",
          )
        )
          return refusal("INVITATION_EXISTS", 409);
        const token = randomBytes(32).toString("base64url");
        const invitation: Invitation = {
          id: randomUUID(),
          kind: "staff",
          email: value.email,
          staffRoles: value.staffRoles,
          targetId: null,
          status: "pending",
          expiresAt: new Date(now() + 7 * 86400000).toISOString(),
          deliveryStatus: "not_configured",
          createdAt: new Date(now()).toISOString(),
          version: 1,
        };
        state.invitations.set(hashSession(token), {
          invitation,
          context: structuredClone(actor.value.context),
          locale: value.locale,
        });
        state.commands.set(key, {
          hash,
          value: {
            invitation: structuredClone(invitation),
            token: null,
            acceptPath: null,
          },
        });
        return ok({
          invitation: structuredClone(invitation),
          token,
          acceptPath: `/${value.locale}/invitation#${token}`,
        });
      });
    },
    previewInvitation(token) {
      return Promise.resolve().then(() => {
        if (!invitationTokenSchema.safeParse(token).success)
          return refusal("VALIDATION_FAILED");
        const stored = state.invitations.get(hashSession(token));
        if (!stored) return refusal("NOT_FOUND", 404);
        const invitation = effective(stored.invitation);
        const [local = "", domain = ""] = invitation.email.split("@");
        return ok({
          invitation: {
            companyName: { ...stored.context.companyName },
            companyKind: stored.context.companyKind,
            kind: invitation.kind,
            staffRoles: [...invitation.staffRoles],
            maskedEmail: `${local.slice(0, 1)}***@${domain}`,
            expiresAt: invitation.expiresAt,
            status: invitation.status,
          },
        });
      });
    },
    acceptInvitation(sessionId, token, idempotencyKey) {
      return Promise.resolve().then(() => {
        const account = sessionAccount(sessionId);
        if (!account) return refusal("SESSION_INVALID", 401);
        if (
          !invitationTokenSchema.safeParse(token).success ||
          !idempotencyKeySchema.safeParse(idempotencyKey).success
        )
          return refusal("VALIDATION_FAILED");
        const stored = state.invitations.get(hashSession(token));
        if (!stored) return refusal("NOT_FOUND", 404);
        const key = `accept:${stored.context.companyId}:${account.account.id}:${idempotencyKey}`;
        const hash = hashSession(token);
        const replay = state.commands.get(key);
        if (replay)
          return replay.hash === hash
            ? ok(structuredClone(replay.value as { context: CompanyContext }))
            : refusal("IDEMPOTENCY_KEY_REUSED", 422);
        if (effective(stored.invitation).status !== "pending")
          return refusal("INVITATION_NOT_PENDING", 409);
        if (
          !account.confirmed ||
          account.account.email !== stored.invitation.email
        )
          return refusal("INVITATION_EMAIL_MISMATCH", 403);
        if (account.contexts.some((item) => item.staffRoles.length))
          return refusal("ACTIVE_MEMBERSHIP_ELSEWHERE", 409);
        const context: CompanyContext = {
          ...stored.context,
          staffRoles: [...stored.invitation.staffRoles],
          partyLinks: [],
        };
        account.contexts.push(context);
        stored.invitation.status = "accepted";
        stored.invitation.version += 1;
        state.commands.set(key, { hash, value: structuredClone({ context }) });
        return ok(structuredClone({ context }));
      });
    },
    signUp(input) {
      const parsed = signUpInputSchema.safeParse(input);
      if (!parsed.success) return Promise.resolve(refusal("VALIDATION_FAILED"));
      const value = parsed.data;
      if (state.accounts.has(value.email))
        return Promise.resolve(refusal("EMAIL_TAKEN", 409));
      if (!passwordPolicySchema.safeParse(value.password).success)
        return Promise.resolve(refusal("PASSWORD_POLICY"));
      const id = randomUUID();
      state.accounts.set(value.email, {
        account: {
          id,
          email: value.email,
          displayName: value.fullName,
          locale: value.locale,
        },
        ...credential(value.password),
        confirmed: false,
        codeExpiresAt: now() + CODE_LIFETIME_MS,
        contexts: [],
      });
      const [local = "", domain = ""] = value.email.split("@");
      return Promise.resolve(
        ok({
          accountId: id,
          delivery: {
            medium: "email",
            destination: `${local.slice(0, 1)}***@${domain}`,
          },
        }),
      );
    },
    confirmSignUp(input) {
      const parsed = confirmSignUpInputSchema.safeParse(input);
      if (!parsed.success) return Promise.resolve(refusal("VALIDATION_FAILED"));
      const account = state.accounts.get(parsed.data.email);
      if (!account || parsed.data.code !== MOCK_CONFIRMATION_CODE)
        return Promise.resolve(refusal("CODE_MISMATCH"));
      if (now() >= account.codeExpiresAt)
        return Promise.resolve(refusal("CODE_EXPIRED"));
      account.confirmed = true;
      return Promise.resolve(ok(null));
    },
    resendCode(input) {
      const parsed = resendCodeInputSchema.safeParse(input);
      if (!parsed.success) return Promise.resolve(refusal("VALIDATION_FAILED"));
      const account = state.accounts.get(parsed.data.email);
      if (account && !account.confirmed)
        account.codeExpiresAt = now() + CODE_LIFETIME_MS;
      return Promise.resolve(ok(null));
    },
    signIn(input) {
      const parsed = signInInputSchema.safeParse(input);
      if (!parsed.success) return Promise.resolve(refusal("VALIDATION_FAILED"));
      const account = state.accounts.get(parsed.data.email);
      if (
        !account ||
        !timingSafeEqual(
          account.passwordHash,
          scryptSync(parsed.data.password, account.salt, 32),
        )
      )
        return Promise.resolve(refusal("INVALID_CREDENTIALS", 401));
      if (!account.confirmed)
        return Promise.resolve(refusal("USER_NOT_CONFIRMED", 403));
      const id = randomBytes(32).toString("base64url");
      const time = now();
      const session = {
        accountId: account.account.id,
        expiresAt: time + MOCK_ABSOLUTE_LIFETIME_MS,
        idleExpiresAt: time + MOCK_IDLE_LIFETIME_MS,
      };
      state.sessions.set(hashSession(id), session);
      return Promise.resolve(
        ok({
          session: {
            id,
            expiresAt: new Date(session.expiresAt).toISOString(),
            idleExpiresAt: new Date(session.idleExpiresAt).toISOString(),
          },
        }),
      );
    },
    signOut(sessionId) {
      const account = sessionAccount(sessionId);
      state.sessions.delete(hashSession(sessionId));
      return Promise.resolve(
        account ? ok(null) : refusal("SESSION_INVALID", 401),
      );
    },
    getMe(sessionId) {
      const account = sessionAccount(sessionId);
      return Promise.resolve(
        account
          ? ok(
              structuredClone({
                account: account.account,
                contexts: account.contexts.filter(
                  (item) => item.staffRoles.length || item.partyLinks.length,
                ),
              }),
            )
          : refusal("SESSION_INVALID", 401),
      );
    },
    createCompany(sessionId, input, idempotencyKey) {
      const account = sessionAccount(sessionId);
      if (!account) return Promise.resolve(refusal("SESSION_INVALID", 401));
      const parsed = createCompanyInputSchema.safeParse(input);
      if (!parsed.success) return Promise.resolve(refusal("VALIDATION_FAILED"));
      if (
        idempotencyKey &&
        !idempotencyKeySchema.safeParse(idempotencyKey).success
      )
        return Promise.resolve(refusal("VALIDATION_FAILED"));
      const key = idempotencyKey
        ? `company:${account.account.id}:${idempotencyKey}`
        : undefined;
      const hash = hashSession(JSON.stringify(parsed.data));
      const replay = key ? state.commands.get(key) : undefined;
      if (replay)
        return Promise.resolve(
          replay.hash === hash
            ? ok(structuredClone(replay.value as CompanyCreated))
            : refusal("IDEMPOTENCY_KEY_REUSED", 422),
        );
      const company = {
        id: randomUUID(),
        kind: parsed.data.kind,
        name: parsed.data.name,
        isDemo: false as const,
      };
      const context: CompanyContext = {
        companyId: company.id,
        companyName: { ...company.name },
        companyKind: company.kind,
        isDemo: false,
        staffRoles:
          company.kind === "self_managed_owner"
            ? ["company_administrator", "manager"]
            : ["company_administrator"],
        partyLinks:
          company.kind === "self_managed_owner"
            ? [{ role: "owner", partyId: randomUUID() }]
            : [],
      };
      account.contexts.push(context);
      state.companies.set(company.id, {
        ...company,
        tradeLicenceNumber: parsed.data.tradeLicenceNumber ?? null,
        trn: null,
        defaultOwnerGate: true,
        status: "active",
        version: 1,
      });
      if (key)
        state.commands.set(key, {
          hash,
          value: structuredClone({ company, context }),
        });
      return Promise.resolve(ok(structuredClone({ company, context })));
    },
  };
}
