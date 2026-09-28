import type { CompanyTransaction } from "./db.mjs";
import {
  can,
  type PermissionActor,
  type Role,
  type Capability,
  type PermissionSubject,
} from "./domain";
import { loadCompanyActor } from "../../identity/adapters";
import { Refusal } from "../../identity/problems";
import { fail } from "./problem";
export async function resolveCompanyActor(
  tx: CompanyTransaction,
  accountId: string,
  companyId: string,
): Promise<PermissionActor | null> {
  try {
    return await loadCompanyActor(tx, companyId, accountId);
  } catch (error) {
    if (error instanceof Refusal && error.code === "NOT_FOUND") return null;
    throw error;
  }
}
export function authorise(
  actor: PermissionActor,
  capability: Capability,
  subject: PermissionSubject,
  options: { write: boolean; roles?: readonly Role[] },
): Role {
  const eligible = options.roles
    ? actor.roles.filter((role) => options.roles?.includes(role))
    : actor.roles;
  if (!eligible.length) fail(403, "FORBIDDEN");
  const candidates = { ...actor, roles: eligible };
  const decision = can(
    candidates,
    options.write ? "write" : "read",
    capability,
    subject,
  );
  if (!decision.ok)
    fail(
      decision.error.code === "NOT_FOUND" ? 404 : 403,
      decision.error.code === "NOT_FOUND" ? "NOT_FOUND" : "FORBIDDEN",
    );
  const role = eligible.find(
    (role) =>
      can(
        { ...actor, roles: [role] },
        options.write ? "write" : "read",
        capability,
        subject,
      ).ok,
  );
  if (!role) fail(403, "FORBIDDEN");
  return role;
}
