import { authenticateHeaders } from "../identity/adapters";
import { runtimeDependencies } from "../identity/runtime";
import type { DependencySource } from "../identity/ports";
export type Authenticator = (
  request: Request,
) => Promise<{ subject: string } | null>;
export function createAuthenticator(
  source: DependencySource = runtimeDependencies,
): Authenticator {
  return async (request) => {
    const account = await authenticateHeaders(request.headers, source);
    return account ? { subject: account.accountId } : null;
  };
}
