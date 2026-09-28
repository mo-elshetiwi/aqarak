import { withCompanyTx, type CompanyTransaction } from "@aqarak/db";
import {
  can,
  companyId as companyIdentifier,
  personAccountId,
  ownerId,
  tenantId,
  technicianProfileId,
  type Capability,
  type PermissionActor,
  type PermissionOperation,
  type PermissionSubject,
  type Role,
} from "@aqarak/domain";
import type { Context, MiddlewareHandler } from "hono";
import { z } from "zod";
import {
  accountTx,
  auditEvent,
  databaseInstant,
  one,
  rows,
  securityEvent,
  sha256,
  type CommandResponse,
} from "./database";
import {
  dependencies,
  type Claims,
  type Client,
  type Dependencies,
  type DependencySource,
} from "./ports";
import { problem, Refusal } from "./problems";
export interface Principal {
  accountId: string;
  client: Client;
  sessionId: string | null;
  claims: Claims;
}
export interface IdentityVariables {
  principal: Principal;
}
export type IdentityContext = Context<{ Variables: IdentityVariables }>;
const sessionSchema = z.object({
  id: z.uuid(),
  account_id: z.guid(),
  email: z.email(),
  display_name: z.string(),
  locale: z.enum(["en", "ar"]),
  revoked_at: z.string().nullable(),
  idle_expires_at: z.string(),
  expires_at: z.string(),
  last_seen_at: z.string(),
});
function timestamp(value: string): number {
  return databaseInstant(value).getTime();
}
export async function resolvePrincipal(
  deps: Dependencies,
  authorization: string | undefined,
): Promise<Principal> {
  const bearer = /^Bearer (\S+)$/.exec(authorization ?? "")?.[1];
  if (bearer) {
    const claims = await deps.identityProvider.verifyAccessToken(bearer);
    if (!claims.emailVerified) throw new Refusal("SESSION_INVALID");
    return {
      accountId: claims.subject,
      client: "mobile",
      sessionId: null,
      claims,
    };
  }
  const session = /^Session ([A-Za-z0-9_-]{43})$/.exec(
    authorization ?? "",
  )?.[1];
  if (!session) throw new Refusal("SESSION_INVALID");
  const principal = await accountTx(deps, null, async (tx) => {
    await rows(tx, "select set_config('app.session_hash', :hash, true)", {
      hash: sha256(session),
    });
    const found = (
      await rows(
        tx,
        "select * from ops.auth_session where session_hash=:hash",
        { hash: sha256(session) },
      )
    )[0];
    if (!found) return null;
    const row = sessionSchema.parse(found);
    await rows(tx, "select set_config('app.account_id', :account, true)", {
      account: row.account_id,
    });
    const now = deps.clock().getTime();
    if (row.revoked_at) return null;
    if (
      timestamp(row.idle_expires_at) <= now ||
      timestamp(row.expires_at) <= now
    ) {
      const changed = await rows(
        tx,
        "update ops.auth_session set revoked_at=cast(:now as timestamptz),revoke_reason='expired' where id=cast(:id as uuid) and revoked_at is null returning id",
        { now: new Date(now).toISOString(), id: row.id },
      );
      if (changed.length)
        await securityEvent(tx, {
          accountId: row.account_id,
          type: "session_expired",
          client: "web",
          sessionId: row.id,
        });
      return null;
    }
    if (now - timestamp(row.last_seen_at) >= 60_000)
      await rows(
        tx,
        "update ops.auth_session set last_seen_at=cast(:now as timestamptz),idle_expires_at=least(expires_at,cast(:idle as timestamptz)) where id=cast(:id as uuid) and revoked_at is null and last_seen_at <= cast(:threshold as timestamptz)",
        {
          id: row.id,
          now: new Date(now).toISOString(),
          idle: new Date(now + 8 * 3600_000).toISOString(),
          threshold: new Date(now - 60_000).toISOString(),
        },
      );
    return {
      accountId: row.account_id,
      client: "web" as const,
      sessionId: row.id,
      claims: {
        subject: row.account_id,
        email: row.email,
        displayName: row.display_name,
        locale: row.locale,
        emailVerified: true,
      },
    };
  });
  if (!principal) throw new Refusal("SESSION_INVALID");
  return principal;
}
export function authenticate(
  source: DependencySource,
): MiddlewareHandler<{ Variables: IdentityVariables }> {
  return async (context, next) => {
    try {
      context.set(
        "principal",
        await resolvePrincipal(
          dependencies(source),
          context.req.header("Authorization"),
        ),
      );
    } catch (error) {
      return problem(
        context,
        error instanceof Refusal ? error.code : "SESSION_INVALID",
      );
    }
    await next();
    return undefined;
  };
}
export interface RoutePermission {
  route: string;
  method: string;
  capability: Capability;
  operation: PermissionOperation;
  subjectType?: string;
  subjectId?: string;
}
export interface CompanyCommand {
  deps: Dependencies;
  principal: Principal;
  companyId: string;
  permission: RoutePermission;
}
export function staffRoles(
  row: Record<string, unknown>,
): ("manager" | "technician" | "company_administrator" | "accountant")[] {
  const roles: (
    "manager" | "technician" | "company_administrator" | "accountant"
  )[] = [];
  if (row.is_company_admin) roles.push("company_administrator");
  if (row.is_manager) roles.push("manager");
  if (row.is_technician) roles.push("technician");
  if (row.is_accountant) roles.push("accountant");
  return roles;
}
export async function requireCompanyActor(
  tx: CompanyTransaction,
  input: { companyId: string; principal: Pick<Principal, "accountId"> },
): Promise<PermissionActor> {
  const id = companyIdentifier.safeParse(input.companyId);
  if (!id.success) throw new Refusal("NOT_FOUND");
  const data = await rows(
    tx,
    `select 'membership' as kind,to_jsonb(m) as data from core.membership m where m.company_id=cast(:company as uuid) and m.account_id=cast(:account as uuid) and m.status='active'
    union all select 'owner',to_jsonb(o) from party.owner o where o.company_id=cast(:company as uuid) and o.linked_account_id=cast(:account as uuid) and exists(select 1 from core.account_company_link l where l.company_id=o.company_id and l.account_id=o.linked_account_id and l.kind='owner' and l.status='active')
    union all select 'tenant',to_jsonb(t) from party.tenant t where t.company_id=cast(:company as uuid) and t.linked_account_id=cast(:account as uuid) and exists(select 1 from core.account_company_link l where l.company_id=t.company_id and l.account_id=t.linked_account_id and l.kind='tenant' and l.status='active')
    union all select 'technician',to_jsonb(p) from core.technician_profile p join core.membership m on m.id=p.membership_id and m.company_id=p.company_id where m.account_id=cast(:account as uuid) and m.status='active'`,
    { company: id.data, account: input.principal.accountId },
  );
  const actor: PermissionActor = {
    company_id: id.data,
    account_id: personAccountId.parse(input.principal.accountId),
    roles: [],
    owner_ids: [],
    tenant_ids: [],
    technician_profile_id: null,
  };
  const roles = new Set<Role>();
  const owners: ReturnType<typeof ownerId.parse>[] = [];
  const tenants: ReturnType<typeof tenantId.parse>[] = [];
  let technician = null;
  for (const item of data) {
    const record = z
      .record(z.string(), z.unknown())
      .parse(typeof item.data === "string" ? JSON.parse(item.data) : item.data);
    if (item.kind === "membership")
      staffRoles(record).forEach((role) => roles.add(role));
    if (item.kind === "owner") {
      roles.add("owner");
      owners.push(ownerId.parse(record.id));
    }
    if (item.kind === "tenant") {
      roles.add("tenant");
      tenants.push(tenantId.parse(record.id));
    }
    if (item.kind === "technician")
      technician = technicianProfileId.parse(record.id);
  }
  if (!roles.size) throw new Refusal("NOT_FOUND");
  return {
    ...actor,
    roles: [...roles],
    owner_ids: owners,
    tenant_ids: tenants,
    technician_profile_id: technician,
  };
}
export function authorize(
  actor: PermissionActor,
  permission: Pick<RoutePermission, "operation" | "capability">,
  subject: PermissionSubject | null,
): Role | null {
  const result = can(
    actor,
    permission.operation,
    permission.capability,
    subject,
  );
  if (!result.ok)
    throw new Refusal(
      result.error.code === "NOT_FOUND" ? "NOT_FOUND" : "FORBIDDEN",
      result.error.code,
    );
  return (
    actor.roles.find(
      (role) =>
        can(
          { ...actor, roles: [role] },
          permission.operation,
          permission.capability,
          subject,
        ).ok,
    ) ?? null
  );
}
export async function recordDenial(
  input: CompanyCommand,
  refusal: Refusal,
): Promise<void> {
  if (!z.uuid().safeParse(input.companyId).success) return;
  await withCompanyTx(
    input.deps.executor,
    { companyId: input.companyId, accountId: input.principal.accountId },
    async (tx) => {
      const exists = await rows(
        tx,
        "select id from core.company where id=cast(:id as uuid)",
        { id: input.companyId },
      );
      if (!exists.length) {
        await securityEvent(tx, {
          accountId: input.principal.accountId,
          client: input.principal.client,
          type: "access_refused",
        });
        return;
      }
      const p = input.permission;
      await auditEvent(tx, {
        companyId: input.companyId,
        principal: input.principal,
        eventType: "policy.denied",
        primary: {
          type: z.guid().safeParse(p.subjectId).success
            ? (p.subjectType ?? "company")
            : "company",
          id: z.guid().safeParse(p.subjectId).success
            ? (p.subjectId ?? input.companyId)
            : input.companyId,
        },
        reason: refusal.reason,
        denialReasons: [
          refusal.reason,
          `route:${p.method} ${p.route}`,
          `capability:${p.capability}`,
          `operation:${p.operation}`,
        ],
      });
    },
  );
}
export async function commandTx<T>(
  input: CompanyCommand,
  run: (tx: CompanyTransaction, actor: PermissionActor) => Promise<T>,
): Promise<T> {
  if (!z.uuid().safeParse(input.companyId).success)
    throw new Refusal("NOT_FOUND");
  try {
    return await withCompanyTx(
      input.deps.executor,
      { companyId: input.companyId, accountId: input.principal.accountId },
      async (tx) => {
        await one(
          tx,
          "select id from core.company where id=cast(:id as uuid) for update",
          { id: input.companyId },
        );
        const actor = await requireCompanyActor(tx, input);
        return run(tx, actor);
      },
    );
  } catch (error) {
    if (error instanceof Refusal) await recordDenial(input, error);
    throw error;
  }
}
export function respond(context: Context, response: CommandResponse): Response {
  if (response.replayed) context.header("Idempotent-Replayed", "true");
  context.header("Cache-Control", "no-store");
  return context.newResponse(
    JSON.stringify(response.body),
    response.status as 200 | 201,
    { "Content-Type": "application/json" },
  );
}
export async function boundary(
  context: Context,
  run: () => Promise<Response>,
): Promise<Response> {
  context.header("Cache-Control", "no-store");
  try {
    return await run();
  } catch (error) {
    return problem(
      context,
      error instanceof Refusal ? error.code : "UNAVAILABLE",
    );
  }
}
