import { authenticateHeaders } from "../../identity/adapters";
import { runtimeDependencies } from "../../identity/runtime";
import type { DependencySource } from "../../identity/ports";
export interface AuthenticatedAccount {
  readonly accountId: string;
}
export interface Authenticator {
  authenticate(headers: Headers): Promise<AuthenticatedAccount | null>;
}
export function createAuthenticator(
  source: DependencySource = runtimeDependencies,
): Authenticator {
  return { authenticate: (headers) => authenticateHeaders(headers, source) };
}
