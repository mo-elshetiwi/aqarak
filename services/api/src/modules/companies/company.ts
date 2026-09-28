import { withCompanyTx } from "@aqarak/db";
import { z } from "zod";
import {
  personAccountId,
  companyId as companyIdentifier,
} from "@aqarak/domain";
import { ensureAccount, companyContext } from "../identity/accounts";
import {
  auditEvent,
  companyCreationId,
  isUnique,
  one,
  parseKey,
  recordSecurity,
  rows,
  withIdempotency,
  type CommandResponse,
  type SubjectVersion,
} from "../identity/database";
import { authorize, recordDenial, type Principal } from "../identity/guard";
import type { Dependencies } from "../identity/ports";
import { Refusal } from "../identity/problems";
import { companyCreate } from "../identity/schemas";
export function companyProjection(row: Record<string, unknown>): unknown {
  return {
    id: row.id,
    kind: row.kind,
    name: { en: row.legal_name_en, ar: row.legal_name_ar },
    tradeLicenceNumber: row.trade_licence_no,
    trn: row.trn,
    defaultOwnerGate: row.default_owner_gate,
    isDemo: row.is_demo,
    status: row.status,
    version: Number(row.version),
  };
}
export async function createCompany(
  deps: Dependencies,
  principal: Principal,
  input: z.infer<typeof companyCreate>,
  rawKey?: string,
): Promise<CommandResponse> {
  const key = parseKey(rawKey);
  const companyId = companyCreationId(principal.accountId, key);
  try {
    return await withCompanyTx(
      deps.executor,
      { companyId, accountId: principal.accountId },
      async (tx) => {
        await rows(
          tx,
          "select pg_advisory_xact_lock(hashtextextended(:account,0))",
          { account: principal.accountId },
        );
        const idem = {
          companyId,
          accountId: principal.accountId,
          command: "company.create",
          key,
          path: {},
          body: input,
        };
        if (
          key &&
          (
            await rows(
              tx,
              "select key from ops.idempotency_key where company_id=cast(:company as uuid) and account_id=cast(:account as uuid) and command_type='company.create' and key=:key",
              { company: companyId, account: principal.accountId, key },
            )
          ).length
        )
          return withIdempotency(tx, idem, () =>
            Promise.reject(new Refusal("UNAVAILABLE")),
          );
        await rows(
          tx,
          "insert into core.company(id,kind,legal_name_en,legal_name_ar,trade_licence_no,is_demo,created_by) values(cast(:company as uuid),:kind,:en,:ar,:licence,false,cast(:account as uuid))",
          {
            company: companyId,
            kind: input.kind,
            en: input.name.en,
            ar: input.name.ar,
            licence: input.tradeLicenceNumber ?? null,
            account: principal.accountId,
          },
        );
        const covered = await ensureAccount(tx, principal);
        return withIdempotency(tx, idem, async () => {
          const member = await one(
            tx,
            "insert into core.membership(company_id,account_id,is_company_admin,is_manager,status,created_by) values(cast(:company as uuid),cast(:account as uuid),true,:manager,'active',cast(:account as uuid)) returning id,version",
            {
              company: companyId,
              account: principal.accountId,
              manager: input.kind === "self_managed_owner",
            },
          );
          covered.push({
            type: "membership",
            id: String(member.id),
            version: Number(member.version),
          });
          const kinds =
            input.kind === "self_managed_owner"
              ? ["staff", "owner"]
              : ["staff"];
          const links = await rows(
            tx,
            "insert into core.account_company_link(company_id,account_id,kind,status,created_by) select cast(:company as uuid),cast(:account as uuid),value,'active',cast(:account as uuid) from jsonb_array_elements_text(cast(:kinds as jsonb)) returning id,version",
            {
              company: companyId,
              account: principal.accountId,
              kinds: JSON.stringify(kinds),
            },
          );
          covered.push(
            ...links.map((row): SubjectVersion => ({
              type: "account_company_link",
              id: String(row.id),
              version: Number(row.version),
            })),
          );
          if (input.kind === "self_managed_owner") {
            const owner = await one(
              tx,
              "insert into party.owner(company_id,full_name_en,full_name_ar,email,preferred_language,linked_account_id,created_by) values(cast(:company as uuid),:name,:name,:email,:locale,cast(:account as uuid),cast(:account as uuid)) returning id,version",
              {
                company: companyId,
                name: principal.claims.displayName,
                email: principal.claims.email,
                locale: principal.claims.locale,
                account: principal.accountId,
              },
            );
            covered.push({
              type: "owner",
              id: String(owner.id),
              version: Number(owner.version),
            });
          }
          const permission = {
            capability: "company_settings" as const,
            operation: "write" as const,
          };
          const actor = {
            company_id: companyIdentifier.parse(companyId),
            account_id: personAccountId.parse(principal.accountId),
            roles: ["company_administrator" as const],
            owner_ids: [],
            tenant_ids: [],
            technician_profile_id: null,
          };
          authorize(actor, permission, { company_id: actor.company_id });
          await auditEvent(tx, {
            companyId,
            principal,
            eventType: "company.created",
            primary: { type: "company", id: companyId, after: 1 },
            covered,
            role: "company_administrator",
            changedFields: [
              "kind",
              "legal_name_en",
              "legal_name_ar",
              "trade_licence_no",
              "is_demo",
            ],
            permission,
            ...(key ? { key } : {}),
          });
          return {
            status: 201,
            body: {
              company: {
                id: companyId,
                kind: input.kind,
                name: input.name,
                isDemo: false,
              },
              context: await companyContext(tx, companyId, principal.accountId),
            },
          };
        });
      },
    );
  } catch (error) {
    if (isUnique(error, "membership_active_account_idx")) {
      await recordSecurity(deps, {
        accountId: principal.accountId,
        type: "company_create_refused",
        client: principal.client,
      });
      throw new Refusal("FORBIDDEN");
    }
    if (error instanceof Refusal && error.code === "IDEMPOTENCY_KEY_REUSED")
      await recordDenial(
        {
          deps,
          principal,
          companyId,
          permission: {
            route: "/v1/companies",
            method: "POST",
            capability: "company_settings",
            operation: "write",
          },
        },
        error,
      );
    throw error;
  }
}
