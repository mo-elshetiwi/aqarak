import { err, ok, type Result } from "@aqarak/domain";
import type { AqarakApi, ApiProblem } from "../api/contract";
import { emailSchema } from "../api/contract";
import { getSessionSecret } from "../session/config";
import {
  clearedSessionCookie,
  SESSION_COOKIE,
  sessionCookieOptions,
  SIGN_UP_COOKIE,
  signUpCookieOptions,
} from "../session/cookie";
import { landingPathFor, safeNextPath } from "../session/redirects";
import type {
  ConfirmSignUpRequest,
  CreateCompanyRequest,
  ResendCodeRequest,
  SignInRequest,
  SignOutRequest,
  SignUpRequest,
} from "./schemas";

export interface CookieChange {
  name: string;
  value: string;
  options: ReturnType<typeof sessionCookieOptions>;
}
export interface AuthSuccess<Data extends object = never> {
  body: { redirectTo: string } | { ok: true } | Data;
  cookies?: CookieChange[];
}
export interface AuthFailure extends ApiProblem {
  cookies?: CookieChange[];
}
export type AuthResult<Data extends object = never> = Result<
  AuthSuccess<Data>,
  AuthFailure
>;
export interface AuthContext {
  sessionId: string;
  pendingEmail: string | undefined;
  origin?: string;
}
function pendingCookie(email: string): CookieChange {
  return { name: SIGN_UP_COOKIE, value: email, options: signUpCookieOptions() };
}
function pendingEmail(
  input: { email?: string | undefined },
  context: AuthContext,
): string | null {
  const parsed = emailSchema.safeParse(input.email ?? context.pendingEmail);
  return parsed.success ? parsed.data : null;
}
/** Registers an account and carries its pending email in a protected cookie. */
export async function signUp(
  api: AqarakApi,
  input: SignUpRequest,
): Promise<AuthResult> {
  const result = await api.signUp(input);
  if (!result.ok) return result;
  return ok({
    body: { redirectTo: `/${input.locale}/verify` },
    cookies: [pendingCookie(input.email)],
  });
}
/** Confirms the pending account and ends the verification flow. */
export async function confirmSignUp(
  api: AqarakApi,
  input: ConfirmSignUpRequest,
  context: AuthContext,
): Promise<AuthResult> {
  const email = pendingEmail(input, context);
  if (!email) return err({ status: 400, code: "VALIDATION_FAILED" });
  const result = await api.confirmSignUp({ email, code: input.code });
  if (!result.ok) return result;
  return ok({
    body: { redirectTo: `/${input.locale}/sign-in` },
    cookies: [
      { name: SIGN_UP_COOKIE, value: "", options: clearedSessionCookie() },
    ],
  });
}
/** Requests another code without including personal data in navigation. */
export async function resendCode(
  api: AqarakApi,
  input: ResendCodeRequest,
  context: AuthContext,
): Promise<AuthResult> {
  const email = pendingEmail(input, context);
  if (!email) return err({ status: 400, code: "VALIDATION_FAILED" });
  const result = await api.resendCode({ email });
  return result.ok ? ok({ body: { ok: true } }) : result;
}
/** Obtains an opaque session and chooses navigation from current API permissions. */
export async function signIn(
  api: AqarakApi,
  input: SignInRequest,
): Promise<AuthResult> {
  getSessionSecret();
  const result = await api.signIn({
    email: input.email,
    password: input.password,
    client: "web",
  });
  if (!result.ok) {
    return err({
      ...result.error,
      ...(result.error.code === "USER_NOT_CONFIRMED"
        ? { cookies: [pendingCookie(input.email)] }
        : {}),
    });
  }
  const session = result.value.session;
  const me = await api.getMe(session.id);
  if (
    !me.ok ||
    Date.parse(session.expiresAt) <= Date.now() ||
    Date.parse(session.idleExpiresAt) <= Date.now()
  ) {
    await api.signOut(session.id);
    return me.ok ? err({ status: 503, code: "UNAVAILABLE" }) : me;
  }
  return ok({
    body: {
      redirectTo:
        safeNextPath(input.locale, input.next) ??
        landingPathFor(input.locale, me.value),
    },
    cookies: [
      {
        name: SESSION_COOKIE,
        value: session.id,
        options: sessionCookieOptions(session.expiresAt),
      },
    ],
  });
}
/** Revokes the API session, also clearing a cookie for an already invalid session. */
export async function signOut(
  api: AqarakApi,
  input: SignOutRequest,
  context: AuthContext,
): Promise<AuthResult> {
  const result = await api.signOut(context.sessionId);
  if (!result.ok && result.error.code !== "SESSION_INVALID") return result;
  return ok({
    body: { redirectTo: `/${input.locale}/sign-in` },
    cookies: [
      { name: SESSION_COOKIE, value: "", options: clearedSessionCookie() },
    ],
  });
}
/** Translates the browser form into the API's bilingual company contract. */
export async function createCompany(
  api: AqarakApi,
  input: CreateCompanyRequest,
  context: AuthContext,
): Promise<AuthResult> {
  const result = await api.createCompany(
    context.sessionId,
    {
      kind: input.kind,
      name: { en: input.nameEn, ar: input.nameAr },
      ...(input.tradeLicenceNumber === undefined
        ? {}
        : { tradeLicenceNumber: input.tradeLicenceNumber }),
    },
    ...(input.idempotencyKey ? [input.idempotencyKey] : []),
  );
  return result.ok
    ? ok({
        body: {
          redirectTo: `/${input.locale}/companies/${result.value.company.id}/home`,
        },
      })
    : result;
}
