import { loadCompanyActor } from "../../identity/adapters";
import { Refusal } from "../../identity/problems";
import type { CompanyTransaction, Row } from "./db";
import { first, string } from "./sql";
import { WorkflowProblem } from "./problem";
export interface Actor {
  accountId: string;
  manager: boolean;
  reader: boolean;
  technician: boolean;
  ownerIds: readonly string[];
  tenantIds: readonly string[];
}
export async function resolveActor(
  tx: CompanyTransaction,
  accountId: string,
  companyId: string,
): Promise<Actor> {
  try {
    const actor = await loadCompanyActor(tx, companyId, accountId);
    return {
      accountId,
      manager: actor.roles.includes("manager"),
      reader: actor.roles.some(
        (role) => role === "company_administrator" || role === "accountant",
      ),
      technician: actor.roles.includes("technician"),
      ownerIds: actor.owner_ids,
      tenantIds: actor.tenant_ids,
    };
  } catch (error) {
    if (error instanceof Refusal && error.code === "NOT_FOUND")
      throw new WorkflowProblem("NOT_FOUND");
    throw error;
  }
}
export async function requireContractScope(
  tx: CompanyTransaction,
  actor: Actor,
  contract: Row,
): Promise<void> {
  if (
    actor.manager ||
    actor.reader ||
    actor.tenantIds.includes(string(contract, "tenant_id"))
  )
    return;
  const owned = await first(
    tx,
    `select 1 from lease.contract_unit cu join estate.unit u on u.id=cu.unit_id and u.company_id=cu.company_id
    join estate.ownership o on o.property_id=u.property_id and o.company_id=u.company_id
    join party.owner p on p.id=o.owner_id and p.company_id=o.company_id
    where cu.contract_id=:id::uuid and p.linked_account_id=:account::uuid limit 1`,
    { id: string(contract, "id"), account: actor.accountId },
  );
  if (!owned) throw new WorkflowProblem("NOT_FOUND");
}
export function commandRole(
  actor: Actor,
  command: string,
): "manager" | "owner" | "tenant" {
  if (["approve_owner", "return_owner"].includes(command)) {
    if (actor.ownerIds.length) return "owner";
  } else if (["accept_tenant", "return_tenant"].includes(command)) {
    if (actor.tenantIds.length) return "tenant";
  } else if (actor.manager) return "manager";
  throw new WorkflowProblem("FORBIDDEN");
}
