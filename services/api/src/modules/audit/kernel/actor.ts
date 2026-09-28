import type { CompanyTransaction } from "@aqarak/db";
import type { PermissionActor } from "@aqarak/domain";
import { loadCompanyActor } from "../../identity/adapters";
import { Refusal as IdentityRefusal } from "../../identity/problems";
import { Refusal } from "./problems";
export interface CompanyActor extends PermissionActor {
  readonly displayName: string | null;
}
export async function resolveActor(
  tx: CompanyTransaction,
  company: string,
  account: string,
): Promise<CompanyActor> {
  try {
    const actor = await loadCompanyActor(tx, company, account);
    const names = await tx.execute(
      "select display_name from core.person_account where id = :account::uuid",
      [{ name: "account", value: account }],
    );
    return {
      ...actor,
      displayName:
        typeof names.rows[0]?.display_name === "string"
          ? names.rows[0].display_name
          : null,
    };
  } catch (error) {
    if (error instanceof IdentityRefusal && error.code === "NOT_FOUND")
      throw new Refusal("NOT_FOUND", null);
    throw error;
  }
}
