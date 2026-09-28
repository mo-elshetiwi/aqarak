import type { CompanyTransaction } from "@aqarak/db";
import { requireCompanyActor, resolvePrincipal } from "./guard";
import { dependencies, type DependencySource } from "./ports";
import { Refusal } from "./problems";
import { runtimeDependencies } from "./runtime";

/** I resolve every transport through the identity session and token verifier. */
export async function authenticateHeaders(
  headers: Headers,
  source: DependencySource = runtimeDependencies,
): Promise<{ accountId: string } | null> {
  const authorization = headers.get("Authorization") ?? undefined;
  if (!/^(?:Session [A-Za-z0-9_-]{43}|Bearer \S+)$/.test(authorization ?? ""))
    return null;
  try {
    const principal = await resolvePrincipal(
      dependencies(source),
      authorization,
    );
    return { accountId: principal.accountId };
  } catch (error) {
    if (
      error instanceof Refusal &&
      ["SESSION_INVALID", "INVALID_CREDENTIALS"].includes(error.code)
    )
      return null;
    throw error;
  }
}
export function authenticateRequest(
  request: Request,
): Promise<{ accountId: string } | null> {
  return authenticateHeaders(request.headers);
}
/** I load current company capacities in the caller's existing transaction. */
export function loadCompanyActor(
  tx: CompanyTransaction,
  companyId: string,
  accountId: string,
): ReturnType<typeof requireCompanyActor> {
  return requireCompanyActor(tx, { companyId, principal: { accountId } });
}
