import { Hono } from "hono";
import { z } from "zod";
import {
  membership,
  transitionMembership,
  type MembershipCommand,
} from "@aqarak/domain";
import {
  auditEvent,
  isUnique,
  one,
  rows,
  type SubjectVersion,
} from "../identity/database";
import { staffRoles, type IdentityVariables } from "../identity/guard";
import type { DependencySource } from "../identity/ports";
import { Refusal } from "../identity/problems";
import { expectedVersion, reason, roles } from "../identity/schemas";
import {
  checkVersion,
  registerRoute,
  targetRow,
  type RouteDefinition,
  type RouteInput,
} from "./routes";
export const memberRoutes = [
  {
    method: "GET",
    path: "/:companyId/members",
    capability: "staff_memberships",
  },
  {
    method: "POST",
    path: "/:companyId/members/:membershipId/roles",
    capability: "staff_memberships",
    table: "membership",
    idParam: "membershipId",
  },
  {
    method: "POST",
    path: "/:companyId/members/:membershipId/suspend",
    capability: "staff_memberships",
    table: "membership",
    idParam: "membershipId",
  },
  {
    method: "POST",
    path: "/:companyId/members/:membershipId/reactivate",
    capability: "staff_memberships",
    table: "membership",
    idParam: "membershipId",
  },
  {
    method: "POST",
    path: "/:companyId/members/:membershipId/remove",
    capability: "staff_memberships",
    table: "membership",
    idParam: "membershipId",
  },
] as const satisfies readonly RouteDefinition[];
export function memberProjection(row: Record<string, unknown>): unknown {
  return {
    membershipId: row.id,
    accountId: row.account_id,
    email: row.email ?? null,
    displayName: row.display_name ?? null,
    staffRoles: staffRoles(row),
    status: row.status,
    version: Number(row.version),
  };
}
interface ActionInput {
  expectedVersion: number;
  reason?: string | undefined;
  staffRoles?: ReturnType<typeof staffRoles>;
}
type Action = "roles" | "suspend" | "reactivate" | "remove";
function nextStatus(
  before: Record<string, unknown>,
  input: RouteInput<ActionInput>,
  action: Action,
): string {
  const { companyId } = input;
  const currentRoles = staffRoles(before);
  let status = String(before.status);
  if (action === "roles") {
    if (status === "removed")
      throw new Refusal("FORBIDDEN", "INVALID_TRANSITION");
  } else {
    const command: MembershipCommand =
      action === "reactivate"
        ? { type: action }
        : { type: action, reason: input.input.reason ?? null };
    const result = transitionMembership(
      membership.parse({
        id: before.id,
        company_id: companyId,
        account_id: before.account_id,
        status,
        staff_roles: currentRoles,
        version: Number(before.version),
        reason: null,
      }),
      command,
      { expected_version: input.input.expectedVersion, memberships: [] },
    );
    if (!result.ok) throw new Refusal("FORBIDDEN", result.error.code);
    status = result.value.status;
  }
  return status;
}
async function changeMember(
  input: RouteInput<ActionInput>,
  action: Action,
): Promise<{ status: number; body: unknown }> {
  const { tx, principal, companyId, target, role, permission, key } = input;
  const before = targetRow(target);
  checkVersion(before, input.input.expectedVersion);
  const status = nextStatus(before, input, action);
  const newRoles = input.input.staffRoles ?? staffRoles(before);
  const administrators = await rows(
    tx,
    "select id from core.membership where company_id=cast(:company as uuid) and status='active' and is_company_admin for update",
    { company: companyId },
  );
  if (
    before.status === "active" &&
    before.is_company_admin === true &&
    (status !== "active" || !newRoles.includes("company_administrator")) &&
    administrators.length <= 1
  )
    throw new Refusal("LAST_ADMINISTRATOR");
  let after;
  try {
    after = await one(
      tx,
      `update core.membership set status=:status,is_company_admin=:admin,is_manager=:manager,is_technician=:technician,is_accountant=:accountant where id=cast(:id as uuid) returning *`,
      {
        id: String(before.id),
        status,
        admin: newRoles.includes("company_administrator"),
        manager: newRoles.includes("manager"),
        technician: newRoles.includes("technician"),
        accountant: newRoles.includes("accountant"),
      },
    );
  } catch (error) {
    if (isUnique(error, "membership_active_account_idx"))
      throw new Refusal("ACTIVE_MEMBERSHIP_ELSEWHERE");
    throw error;
  }
  const covered: SubjectVersion[] = [];
  if (action === "remove") {
    const links = await rows(
      tx,
      "update core.account_company_link set status='revoked' where company_id=cast(:company as uuid) and account_id=cast(:account as uuid) and kind='staff' and status='active' returning id,version",
      { company: companyId, account: String(before.account_id) },
    );
    covered.push(
      ...links.map((row) => ({
        type: "account_company_link",
        id: String(row.id),
        version: Number(row.version),
      })),
    );
  }
  const suffix = {
    roles: "roles_changed",
    suspend: "suspended",
    reactivate: "reactivated",
    remove: "removed",
  }[action];
  const changedFields =
    action === "roles"
      ? [
          "is_company_admin",
          "is_manager",
          "is_technician",
          "is_accountant",
        ].filter((field) => before[field] !== after[field])
      : ["status"];
  await auditEvent(tx, {
    companyId,
    principal,
    eventType: `membership.${suffix}`,
    primary: {
      type: "membership",
      id: String(before.id),
      before: Number(before.version),
      after: Number(after.version),
    },
    role,
    permission,
    changedFields,
    covered,
    ...(key ? { key } : {}),
    ...(input.input.reason ? { reason: input.input.reason } : {}),
  });
  const person = (
    await rows(
      tx,
      "select email,display_name from core.person_account where id=cast(:account as uuid)",
      { account: String(before.account_id) },
    )
  )[0];
  return {
    status: 200,
    body: { member: memberProjection({ ...after, ...person }) },
  };
}
export function registerMembers(
  routes: Hono<{ Variables: IdentityVariables }>,
  source: DependencySource,
): void {
  registerRoute(routes, source, memberRoutes[0], {
    schema: z.null(),
    run: async ({ tx, companyId }) => ({
      status: 200,
      body: {
        members: (
          await rows(
            tx,
            "select m.*,p.email,p.display_name from core.membership m left join core.person_account p on p.id=m.account_id where m.company_id=cast(:company as uuid) order by m.created_at,m.id",
            { company: companyId },
          )
        ).map(memberProjection),
      },
    }),
  });
  registerRoute(routes, source, memberRoutes[1], {
    schema: z.object({ expectedVersion, staffRoles: roles }),
    run: (input) => changeMember(input, "roles"),
  });
  registerRoute(routes, source, memberRoutes[2], {
    schema: z.object({ expectedVersion, reason }),
    run: (input) => changeMember(input, "suspend"),
  });
  registerRoute(routes, source, memberRoutes[3], {
    schema: z.object({ expectedVersion, reason: reason.optional() }),
    run: (input) => changeMember(input, "reactivate"),
  });
  registerRoute(routes, source, memberRoutes[4], {
    schema: z.object({ expectedVersion, reason }),
    run: (input) => changeMember(input, "remove"),
  });
}
