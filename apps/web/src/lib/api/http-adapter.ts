import { z } from "zod";
import { err, ok, type Result } from "@aqarak/domain";
import {
  apiProblemCodeSchema,
  rolesCommandSchema,
  reasonCommandSchema,
  reactivateCommandSchema,
  versionCommandSchema,
  memberChangedSchema,
  invitationChangedSchema,
  companyResponseSchema,
  updateCompanyInputSchema,
  tokenInputSchema,
  invitationPreviewSchema,
  invitationAcceptedSchema,
  membersSchema,
  invitationsSchema,
  invitationCreatedSchema,
  createInvitationInputSchema,
  companyCreatedSchema,
  confirmSignUpInputSchema,
  createCompanyInputSchema,
  meSchema,
  resendCodeInputSchema,
  sessionGrantSchema,
  signInInputSchema,
  signUpAcceptedSchema,
  signUpInputSchema,
  type AqarakApi,
  type ApiProblem,
  type ApiProblemCode,
} from "./contract";

interface RequestOptions {
  method: "GET" | "POST" | "PATCH";
  sessionId?: string;
  body?: unknown;
  status: number;
  idempotencyKey?: string;
}
function requestTimeout(path: string): number {
  return path.startsWith("/v1/companies") ||
    ["/v1/invitations/accept", "/v1/me"].includes(path)
    ? 60_000
    : 10_000;
}
function fallbackCode(
  status: number,
  path: string,
  authenticated: boolean,
): ApiProblemCode {
  if (status === 401 && authenticated) return "SESSION_INVALID";
  if (status === 401 && path === "/v1/auth/sign-in")
    return "INVALID_CREDENTIALS";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  return "UNAVAILABLE";
}
/** Builds an adapter with an injectable transport for contract tests. */
export function createHttpApi(
  baseUrl: string,
  transport: typeof fetch = fetch,
): AqarakApi {
  async function request<T>(
    path: string,
    schema: z.ZodType<T>,
    options: RequestOptions,
  ): Promise<Result<T, ApiProblem>> {
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (options.idempotencyKey)
        headers["Idempotency-Key"] = options.idempotencyKey;
      if (options.sessionId)
        headers.Authorization = `Session ${options.sessionId}`;
      if (options.body !== undefined)
        headers["Content-Type"] = "application/json";
      const response = await transport(`${baseUrl.replace(/\/$/, "")}${path}`, {
        method: options.method,
        headers,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(requestTimeout(path)),
        ...(options.body === undefined
          ? {}
          : { body: JSON.stringify(options.body) }),
      });
      if (response.status >= 500)
        return err({ status: 503, code: "UNAVAILABLE" });
      if (!response.ok) {
        const problem: unknown = await response.json().catch(() => null);
        const parsed = z
          .object({ code: apiProblemCodeSchema })
          .safeParse(problem);
        const code = parsed.success
          ? parsed.data.code
          : fallbackCode(response.status, path, Boolean(options.sessionId));
        return err({
          status: code === "UNAVAILABLE" ? 503 : response.status,
          code,
        });
      }
      if (response.status !== options.status)
        return err({ status: 503, code: "UNAVAILABLE" });
      const body: unknown =
        response.status === 204 ? null : await response.json();
      const parsed = schema.safeParse(body);
      return parsed.success
        ? ok(parsed.data)
        : err({ status: 503, code: "UNAVAILABLE" });
    } catch {
      return err({ status: 503, code: "UNAVAILABLE" });
    }
  }
  function post<I, O>(
    path: string,
    input: I,
    inputSchema: z.ZodType<I>,
    output: {
      schema: z.ZodType<O>;
      status: number;
      sessionId?: string;
      idempotencyKey?: string;
    },
  ): Promise<Result<O, ApiProblem>> {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success)
      return Promise.resolve(err({ status: 400, code: "VALIDATION_FAILED" }));
    return request(path, output.schema, {
      method: "POST",
      body: parsed.data,
      status: output.status,
      ...(output.idempotencyKey
        ? { idempotencyKey: output.idempotencyKey }
        : {}),
      ...(output.sessionId ? { sessionId: output.sessionId } : {}),
    });
  }
  return {
    changeMemberRoles: (
      ...[sessionId, companyId, targetId, input, idempotencyKey]
    ) =>
      post(
        `/v1/companies/${encodeURIComponent(companyId)}/members/${encodeURIComponent(targetId)}/roles`,
        input,
        rolesCommandSchema,
        { schema: memberChangedSchema, status: 200, sessionId, idempotencyKey },
      ),
    suspendMember: (
      ...[sessionId, companyId, targetId, input, idempotencyKey]
    ) =>
      post(
        `/v1/companies/${encodeURIComponent(companyId)}/members/${encodeURIComponent(targetId)}/suspend`,
        input,
        reasonCommandSchema,
        { schema: memberChangedSchema, status: 200, sessionId, idempotencyKey },
      ),
    reactivateMember: (
      ...[sessionId, companyId, targetId, input, idempotencyKey]
    ) =>
      post(
        `/v1/companies/${encodeURIComponent(companyId)}/members/${encodeURIComponent(targetId)}/reactivate`,
        input,
        reactivateCommandSchema,
        { schema: memberChangedSchema, status: 200, sessionId, idempotencyKey },
      ),
    removeMember: (
      ...[sessionId, companyId, targetId, input, idempotencyKey]
    ) =>
      post(
        `/v1/companies/${encodeURIComponent(companyId)}/members/${encodeURIComponent(targetId)}/remove`,
        input,
        reasonCommandSchema,
        { schema: memberChangedSchema, status: 200, sessionId, idempotencyKey },
      ),
    revokeInvitation: (
      ...[sessionId, companyId, targetId, input, idempotencyKey]
    ) =>
      post(
        `/v1/companies/${encodeURIComponent(companyId)}/invitations/${encodeURIComponent(targetId)}/revoke`,
        input,
        reasonCommandSchema,
        {
          schema: invitationChangedSchema,
          status: 200,
          sessionId,
          idempotencyKey,
        },
      ),
    resendInvitation: (
      ...[sessionId, companyId, targetId, input, idempotencyKey]
    ) =>
      post(
        `/v1/companies/${encodeURIComponent(companyId)}/invitations/${encodeURIComponent(targetId)}/resend`,
        input,
        versionCommandSchema,
        {
          schema: invitationCreatedSchema,
          status: 200,
          sessionId,
          idempotencyKey,
        },
      ),
    getCompany: (sessionId, companyId) =>
      request(
        `/v1/companies/${encodeURIComponent(companyId)}`,
        companyResponseSchema,
        { method: "GET", status: 200, sessionId },
      ),
    updateCompany: (sessionId, companyId, input, idempotencyKey) => {
      const parsed = updateCompanyInputSchema.safeParse(input);
      if (!parsed.success)
        return Promise.resolve(err({ status: 400, code: "VALIDATION_FAILED" }));
      return request(
        `/v1/companies/${encodeURIComponent(companyId)}`,
        companyResponseSchema,
        {
          method: "PATCH",
          status: 200,
          sessionId,
          idempotencyKey,
          body: parsed.data,
        },
      );
    },
    previewInvitation: (token) =>
      post("/v1/invitations/preview", { token }, tokenInputSchema, {
        schema: invitationPreviewSchema,
        status: 200,
      }),
    acceptInvitation: (sessionId, token, idempotencyKey) =>
      post("/v1/invitations/accept", { token }, tokenInputSchema, {
        schema: invitationAcceptedSchema,
        status: 200,
        sessionId,
        idempotencyKey,
      }),
    listMembers: (sessionId, companyId) =>
      request(
        `/v1/companies/${encodeURIComponent(companyId)}/members`,
        membersSchema,
        { method: "GET", sessionId, status: 200 },
      ),
    listInvitations: (sessionId, companyId) =>
      request(
        `/v1/companies/${encodeURIComponent(companyId)}/invitations`,
        invitationsSchema,
        { method: "GET", sessionId, status: 200 },
      ),
    createInvitation: (sessionId, companyId, input, idempotencyKey) =>
      post(
        `/v1/companies/${encodeURIComponent(companyId)}/invitations`,
        input,
        createInvitationInputSchema,
        {
          schema: invitationCreatedSchema,
          status: 201,
          sessionId,
          idempotencyKey,
        },
      ),
    signUp: (input) =>
      post("/v1/auth/sign-up", input, signUpInputSchema, {
        schema: signUpAcceptedSchema,
        status: 201,
      }),
    confirmSignUp: (input) =>
      post("/v1/auth/confirm-sign-up", input, confirmSignUpInputSchema, {
        schema: z.null(),
        status: 204,
      }),
    resendCode: (input) =>
      post("/v1/auth/resend-code", input, resendCodeInputSchema, {
        schema: z.null(),
        status: 204,
      }),
    signIn: (input) =>
      post("/v1/auth/sign-in", input, signInInputSchema, {
        schema: sessionGrantSchema,
        status: 200,
      }),
    signOut: (sessionId) =>
      request("/v1/auth/sign-out", z.null(), {
        method: "POST",
        sessionId,
        status: 204,
      }),
    getMe: (sessionId) =>
      request("/v1/me", meSchema, { method: "GET", sessionId, status: 200 }),
    createCompany: (sessionId, input, idempotencyKey) =>
      post("/v1/companies", input, createCompanyInputSchema, {
        ...(idempotencyKey ? { idempotencyKey } : {}),
        schema: companyCreatedSchema,
        status: 201,
        sessionId,
      }),
  };
}
