import { can, companyId, tenantId, type PermissionActor } from "./domain";
import type { CompanyTransaction } from "./database";
import type { DataApiExecutor } from "@aqarak/db/data-api";
import type { ModelGateway, ModelRegistry } from "../../models";
import type { DocumentStorage } from "./storage";
import { loadCompanyActor } from "../identity/adapters";
import { Refusal } from "../identity/problems";
import { Problem } from "./problem";

export type AccountAuthenticator = (
  request: Request,
) => Promise<{ readonly accountId: string } | null>;
export interface J3Dependencies {
  readonly authenticate: AccountAuthenticator;
  readonly appExecutor: DataApiExecutor;
  readonly pipelineExecutor: DataApiExecutor | null;
  readonly storage: DocumentStorage;
  readonly extraction: {
    readonly gateway: ModelGateway;
    readonly registry: ModelRegistry;
  } | null;
  readonly now: () => Date;
  readonly randomBytes: (size: number) => Uint8Array;
}
export interface RequestContext {
  readonly tx: CompanyTransaction;
  readonly deps: J3Dependencies;
  readonly companyId: string;
  readonly accountId: string;
  readonly actor: PermissionActor;
  readonly params: Readonly<Record<string, string>>;
  readonly key: string | null;
}
export async function loadActor(
  tx: CompanyTransaction,
  company: string,
  account: string,
): Promise<PermissionActor> {
  try {
    return await loadCompanyActor(tx, company, account);
  } catch (error) {
    if (error instanceof Refusal && error.code === "NOT_FOUND")
      throw new Problem(404, "NOT_FOUND");
    throw error;
  }
}
export function authorize(
  ctx: RequestContext,
  input: {
    readonly operation: "read" | "write";
    readonly capability: "tenants_occupants" | "identity_documents";
    readonly tenant?: string;
    readonly companyScope?: boolean;
  },
): void {
  const grant = can(ctx.actor, input.operation, input.capability, {
    company_id: companyId.parse(ctx.companyId),
    tenant_ids: input.tenant
      ? [tenantId.parse(input.tenant)]
      : input.companyScope
        ? ctx.actor.tenant_ids
        : [],
    owner_ids: !input.tenant && input.companyScope ? ctx.actor.owner_ids : [],
  });
  if (!grant.ok)
    throw new Problem(
      grant.error.code === "NOT_FOUND" ? 404 : 403,
      grant.error.code === "NOT_FOUND" ? "NOT_FOUND" : "FORBIDDEN",
    );
  if (input.companyScope && grant.value.scope !== "company")
    throw new Problem(403, "FORBIDDEN");
}
