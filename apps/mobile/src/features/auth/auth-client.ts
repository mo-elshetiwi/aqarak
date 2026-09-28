import type {
  AuthErrorCode,
  Credentials,
  Me,
  RefreshTokens,
  SignInTokens,
} from "./contract";
import { createFixtureAuthClient } from "./fixture-auth-client";
import { createHttpAuthClient } from "./http-auth-client";
/** Transports expose failures without retaining response bodies or credentials. */
export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode) {
    super(code);
    this.name = "AuthError";
  }
}
/** Auth transports exchange validated data without choosing navigation. */
export interface AuthClient {
  signIn(credentials: Credentials): Promise<SignInTokens>;
  refresh(refreshToken: string): Promise<RefreshTokens>;
  signOut(accessToken: string, refreshToken: string): Promise<void>;
  getMe(accessToken: string): Promise<Me>;
}
/** Unknown failures are safe, localisable responses rather than raw exceptions. */
export function authError(error: unknown): AuthError {
  return error instanceof AuthError
    ? error
    : new AuthError("unexpected_response");
}
/** Validated startup configuration selects one transport for the provider lifetime. */
export function createAuthClient(
  configuration: Readonly<{ adapter: "fixture" | "http"; baseUrl: string }>,
  options: {
    fetch?: typeof fetch;
    clock?: () => number;
    locale?: () => "en" | "ar";
  } = {},
): AuthClient {
  return configuration.adapter === "http"
    ? createHttpAuthClient(configuration.baseUrl, options.fetch)
    : createFixtureAuthClient(options.clock, options.locale);
}
