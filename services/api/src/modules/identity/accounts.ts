import { z } from "zod";
import type { CompanyTransaction } from "@aqarak/db";
import { accountTx, one, rows, type SubjectVersion } from "./database";
import type { Dependencies } from "./ports";
import { staffRoles, type Principal } from "./guard";
export const companyContextSchema = z.object({
  companyId: z.uuid(),
  companyName: z.object({ en: z.string(), ar: z.string() }),
  companyKind: z.enum(["management_company", "self_managed_owner"]),
  isDemo: z.boolean(),
  staffRoles: z.array(
    z.enum(["company_administrator", "manager", "technician", "accountant"]),
  ),
  partyLinks: z.array(
    z.object({ role: z.enum(["owner", "tenant"]), partyId: z.uuid() }),
  ),
});
export type CompanyContext = z.infer<typeof companyContextSchema>;
export async function ensureAccount(
  tx: CompanyTransaction,
  principal: Principal,
): Promise<SubjectVersion[]> {
  const found = await rows(
    tx,
    `insert into core.person_account(id,auth_subject,email,display_name,preferred_language,created_by)
    values(cast(:id as uuid),:id,:email,:name,:locale,cast(:id as uuid)) on conflict(id) do nothing returning id,version`,
    {
      id: principal.accountId,
      email: principal.claims.email,
      name: principal.claims.displayName,
      locale: principal.claims.locale,
    },
  );
  return found.map((row) => ({
    type: "person_account",
    id: String(row.id),
    version: Number(row.version),
  }));
}
export async function companyContext(
  tx: CompanyTransaction,
  companyId: string,
  accountId: string,
): Promise<CompanyContext> {
  const company = await one(
    tx,
    "select * from core.company where id=cast(:company as uuid)",
    { company: companyId },
  );
  const member = (
    await rows(
      tx,
      "select * from core.membership where company_id=cast(:company as uuid) and account_id=cast(:account as uuid) and status='active'",
      { company: companyId, account: accountId },
    )
  )[0];
  const parties = await rows(
    tx,
    "select 'owner' as role,id from party.owner where linked_account_id=cast(:account as uuid) union all select 'tenant',id from party.tenant where linked_account_id=cast(:account as uuid)",
    { account: accountId },
  );
  return companyContextSchema.parse({
    companyId,
    companyName: { en: company.legal_name_en, ar: company.legal_name_ar },
    companyKind: company.kind,
    isDemo: company.is_demo,
    staffRoles: member ? staffRoles(member) : [],
    partyLinks: parties.map((row) => ({ role: row.role, partyId: row.id })),
  });
}
export async function getMe(
  deps: Dependencies,
  principal: Principal,
): Promise<unknown> {
  return accountTx(deps, principal.accountId, async (tx) => {
    const account = (
      await rows(
        tx,
        "select * from core.person_account where id=cast(:account as uuid)",
        { account: principal.accountId },
      )
    )[0];
    const links = await rows(
      tx,
      "select distinct company_id from core.account_company_link where account_id=cast(:account as uuid) and status='active' order by company_id",
      { account: principal.accountId },
    );
    const contexts: CompanyContext[] = [];
    for (const link of links) {
      const id = z.uuid().parse(link.company_id);
      await rows(tx, "select set_config('app.company_id',:company,true)", {
        company: id,
      });
      const context = await companyContext(tx, id, principal.accountId);
      if (context.staffRoles.length || context.partyLinks.length)
        contexts.push(context);
    }
    const details = {
      id: principal.accountId,
      email: account?.email ?? principal.claims.email,
      displayName: account?.display_name ?? principal.claims.displayName,
      locale: account?.preferred_language ?? principal.claims.locale,
    };
    if (principal.client === "web") return { account: details, contexts };
    return {
      account: {
        id: details.id,
        displayName: details.displayName,
        locale: details.locale,
      },
      contexts: contexts.map((context) => ({
        companyId: context.companyId,
        companyName: context.companyName,
        isDemo: context.isDemo,
        capacities: [
          ...new Set([
            ...context.staffRoles,
            ...context.partyLinks.map((link) => link.role),
          ]),
        ],
      })),
    };
  });
}
