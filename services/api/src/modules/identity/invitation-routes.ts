import { Hono } from "hono";
import { withCompanyTx, type Row } from "@aqarak/db";
import { z } from "zod";
import type { Role } from "@aqarak/domain";
import { effectiveStatus } from "../companies/invitations";
import { companyContext, ensureAccount } from "./accounts";
import {
  accountTx,
  auditEvent,
  databaseInstant,
  isUnique,
  json,
  one,
  parseKey,
  rows,
  sha256,
  withIdempotency,
  type CommandResponse,
} from "./database";
import {
  authenticate,
  boundary,
  recordDenial,
  respond,
  type IdentityVariables,
  type Principal,
  type RoutePermission,
} from "./guard";
import {
  dependencies,
  type Dependencies,
  type DependencySource,
} from "./ports";
import { body, maskEmail, Refusal } from "./problems";
import { staffRole, tokenBody } from "./schemas";
async function findInvitation(
  deps: Dependencies,
  token: string,
  principal?: Principal,
): Promise<Row> {
  return accountTx(deps, principal?.accountId ?? null, async (tx) => {
    await rows(
      tx,
      "select set_config('app.invitation_token_hash',:hash,true)",
      { hash: sha256(token) },
    );
    return one(tx, "select * from core.invitation where token_hash=:hash", {
      hash: sha256(token),
    });
  });
}
async function acceptInvitation(
  deps: Dependencies,
  principal: Principal,
  token: string,
  rawKey: string | undefined,
): Promise<CommandResponse> {
  const key = parseKey(rawKey);
  const invitation = await findInvitation(deps, token, principal);
  const companyId = z.uuid().parse(invitation.company_id);
  const permission: RoutePermission = {
    route: "/v1/invitations/accept",
    method: "POST",
    capability:
      invitation.kind === "staff" ? "staff_memberships" : "party_links",
    operation: "write",
    subjectType: "invitation",
    subjectId: String(invitation.id),
  };
  try {
    return await withCompanyTx(
      deps.executor,
      { companyId, accountId: principal.accountId },
      async (tx) => {
        await one(
          tx,
          "select id from core.company where id=cast(:company as uuid) for update",
          { company: companyId },
        );
        const current = await one(
          tx,
          "select * from core.invitation where id=cast(:id as uuid) and token_hash=:hash for update",
          { id: String(invitation.id), hash: sha256(token) },
        );
        const covered = await ensureAccount(tx, principal);
        return withIdempotency(
          tx,
          {
            companyId,
            accountId: principal.accountId,
            command: "invitation.accept",
            key,
            path: { invitationId: String(current.id) },
            body: { token },
          },
          async () => {
            if (effectiveStatus(current, deps.clock) !== "pending")
              throw new Refusal("INVITATION_NOT_PENDING");
            if (
              !principal.claims.emailVerified ||
              principal.claims.email.trim().toLowerCase() !== current.email
            )
              throw new Refusal("INVITATION_EMAIL_MISMATCH");

            const granted = z.array(staffRole).parse(json(current.staff_roles));
            let role: Role;
            if (current.kind === "staff") {
              role = granted.includes("company_administrator")
                ? "company_administrator"
                : (granted[0] ?? "manager");
              let member;
              try {
                member = await one(
                  tx,
                  "insert into core.membership(company_id,account_id,is_company_admin,is_manager,is_technician,is_accountant,status,created_by) values(cast(:company as uuid),cast(:account as uuid),:admin,:manager,:technician,:accountant,'active',cast(:account as uuid)) returning id,version",
                  {
                    company: companyId,
                    account: principal.accountId,
                    admin: granted.includes("company_administrator"),
                    manager: granted.includes("manager"),
                    technician: granted.includes("technician"),
                    accountant: granted.includes("accountant"),
                  },
                );
              } catch (error) {
                if (isUnique(error, "membership_active_account_idx"))
                  throw new Refusal("ACTIVE_MEMBERSHIP_ELSEWHERE");
                throw error;
              }
              covered.push({
                type: "membership",
                id: String(member.id),
                version: Number(member.version),
              });
            } else {
              role = z.enum(["owner", "tenant"]).parse(current.kind);
              const party = await one(
                tx,
                `select * from party.${role} where id=cast(:id as uuid) for update`,
                { id: String(current.target_id) },
              );
              if (party.linked_account_id !== null)
                throw new Refusal("PARTY_ALREADY_LINKED");
              const changed = await one(
                tx,
                `update party.${role} set linked_account_id=cast(:account as uuid) where id=cast(:id as uuid) returning id,version`,
                { account: principal.accountId, id: String(current.target_id) },
              );
              covered.push({
                type: role,
                id: String(changed.id),
                version: Number(changed.version),
              });
            }
            const links = await rows(
              tx,
              `insert into core.account_company_link(company_id,account_id,kind,status,created_by) values(cast(:company as uuid),cast(:account as uuid),:kind,'active',cast(:account as uuid)) on conflict(account_id,company_id,kind) do update set status='active' where account_company_link.status='revoked' returning id,version`,
              {
                company: companyId,
                account: principal.accountId,
                kind: String(current.kind),
              },
            );
            covered.push(
              ...links.map((row) => ({
                type: "account_company_link",
                id: String(row.id),
                version: Number(row.version),
              })),
            );
            const after = await one(
              tx,
              "update core.invitation set status='accepted',accepted_account_id=cast(:account as uuid),accepted_at=cast(:now as timestamptz) where id=cast(:id as uuid) returning version",
              {
                account: principal.accountId,
                id: String(current.id),
                now: deps.clock().toISOString(),
              },
            );
            await auditEvent(tx, {
              companyId,
              principal,
              eventType: "invitation.accepted",
              primary: {
                type: "invitation",
                id: String(current.id),
                before: Number(current.version),
                after: Number(after.version),
              },
              role,
              changedFields: ["status", "accepted_account_id", "accepted_at"],
              covered,
              ...(key ? { key } : {}),
            });
            return {
              status: 200,
              body: {
                context: await companyContext(
                  tx,
                  companyId,
                  principal.accountId,
                ),
              },
            };
          },
        );
      },
    );
  } catch (error) {
    if (error instanceof Refusal)
      await recordDenial({ deps, principal, companyId, permission }, error);
    throw error;
  }
}
export function invitationRoutes(
  source: DependencySource,
): Hono<{ Variables: IdentityVariables }> {
  const routes = new Hono<{ Variables: IdentityVariables }>();
  routes.post("/invitations/preview", (c) =>
    boundary(c, async () => {
      const { token } = await body(c, tokenBody);
      const deps = dependencies(source);
      const invitation = await findInvitation(deps, token);
      const companyId = z.uuid().parse(invitation.company_id);
      const company = await withCompanyTx(
        deps.executor,
        { companyId, accountId: null },
        (tx) =>
          one(
            tx,
            "select kind,legal_name_en,legal_name_ar from core.company where id=cast(:id as uuid)",
            { id: companyId },
          ),
      );
      return c.json({
        invitation: {
          companyName: { en: company.legal_name_en, ar: company.legal_name_ar },
          companyKind: company.kind,
          kind: invitation.kind,
          staffRoles: json(invitation.staff_roles),
          maskedEmail: maskEmail(String(invitation.email)),
          expiresAt: databaseInstant(invitation.expires_at).toISOString(),
          status: effectiveStatus(invitation, deps.clock),
        },
      });
    }),
  );
  routes.post("/invitations/accept", authenticate(source), (c) =>
    boundary(c, async () => {
      const { token } = await body(c, tokenBody);
      return respond(
        c,
        await acceptInvitation(
          dependencies(source),
          c.get("principal"),
          token,
          c.req.header("Idempotency-Key"),
        ),
      );
    }),
  );
  return routes;
}
