import { randomBytes, randomUUID } from "node:crypto";
import { Hono } from "hono";
import { withCompanyTx } from "@aqarak/db";
import { z } from "zod";
import type { Role } from "@aqarak/domain";
import {
  auditEvent,
  databaseInstant,
  isUnique,
  json,
  one,
  rows,
  sha256,
  type CommandResponse,
} from "../identity/database";
import type {
  IdentityVariables,
  Principal,
  RoutePermission,
} from "../identity/guard";
import type {
  Dependencies,
  DependencySource,
  EmailMessage,
} from "../identity/ports";
import { Refusal } from "../identity/problems";
import {
  email,
  expectedVersion,
  locale,
  reason,
  roles,
} from "../identity/schemas";
import {
  checkVersion,
  registerRoute,
  targetRow,
  type RouteDefinition,
  type RouteInput,
} from "../companies/routes";
export const invitationRoutes = [
  {
    method: "GET",
    path: "/:companyId/invitations",
    capability: "staff_memberships",
  },
  {
    method: "POST",
    path: "/:companyId/invitations",
    capability: "staff_memberships",
  },
  {
    method: "POST",
    path: "/:companyId/invitations/:invitationId/revoke",
    capability: "staff_memberships",
    table: "invitation",
    idParam: "invitationId",
  },
  {
    method: "POST",
    path: "/:companyId/invitations/:invitationId/resend",
    capability: "staff_memberships",
    table: "invitation",
    idParam: "invitationId",
  },
] as const satisfies readonly RouteDefinition[];
export const invitationInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("staff"), email, staffRoles: roles, locale }),
  z.object({
    kind: z.enum(["owner", "tenant"]),
    email,
    targetId: z.uuid(),
    locale,
  }),
]);
export function effectiveStatus(
  row: Record<string, unknown>,
  clock: () => Date,
): string {
  return row.status === "pending" &&
    databaseInstant(row.expires_at).getTime() <= clock().getTime()
    ? "expired"
    : String(row.status);
}
export function invitationProjection(
  row: Record<string, unknown>,
  clock: () => Date,
): unknown {
  return {
    id: row.id,
    kind: row.kind,
    email: row.email,
    staffRoles: json(row.staff_roles),
    targetId: row.target_id,
    status: effectiveStatus(row, clock),
    expiresAt: databaseInstant(row.expires_at).toISOString(),
    deliveryStatus: row.delivery_status,
    createdAt: databaseInstant(row.created_at).toISOString(),
    version: Number(row.version),
  };
}
export function invitationReplayBody(body: unknown): unknown {
  const { invitation } = z.object({ invitation: z.unknown() }).parse(body);
  return { invitation, token: null, acceptPath: null };
}
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
const arabicRoles: Readonly<Record<string, string>> = {
  manager: "مدير",
  technician: "فني",
  company_administrator: "مسؤول الشركة",
  accountant: "محاسب",
  owner: "مالك",
  tenant: "مستأجر",
};
export function invitationEmail(input: {
  to: string;
  companyName: { en: string; ar: string };
  roles: string[];
  expiry: string;
  link: string;
}): EmailMessage {
  const en = `You are invited to ${input.companyName.en} (${input.companyName.ar}). Role: ${input.roles.join(", ")}. Expires: ${input.expiry}. Accept: ${input.link}`;
  const ar = `أنت مدعو إلى ${input.companyName.ar} (${input.companyName.en}). الدور: ${input.roles.map((role) => arabicRoles[role] ?? role).join("، ")}. تنتهي الدعوة: ${input.expiry}. قبول الدعوة: ${input.link}`;
  return {
    to: input.to,
    subject: `${input.companyName.en} invitation / دعوة ${input.companyName.ar}`,
    text: `${en}\n\n${ar}`,
    html: `<p lang="en" dir="ltr">${escapeHtml(en)}</p><p lang="ar" dir="rtl">${escapeHtml(ar)}</p>`,
  };
}
export async function deliverInvitation(input: {
  deps: Dependencies;
  principal: Pick<Principal, "accountId" | "client"> &
    Partial<Omit<Principal, "accountId" | "client">>;
  companyId: string;
  response: CommandResponse;
  role: Role | null;
  permission: RoutePermission;
  key: string | undefined;
}): Promise<CommandResponse> {
  const data = z
    .object({
      invitation: z.object({ id: z.uuid() }),
      token: z.string(),
      acceptPath: z.string(),
    })
    .parse(input.response.body);
  return withCompanyTx(
    input.deps.executor,
    { companyId: input.companyId, accountId: input.principal.accountId },
    async (tx) => {
      await one(
        tx,
        "select id from core.company where id=cast(:id as uuid) for update",
        { id: input.companyId },
      );
      const before = await one(
        tx,
        "select i.*,c.legal_name_en,c.legal_name_ar from core.invitation i join core.company c on c.id=i.company_id where i.id=cast(:id as uuid) for update of i",
        { id: data.invitation.id },
      );
      const audit = {
        companyId: input.companyId,
        principal: input.principal,
        eventType: "invitation.delivery_recorded",
        role: input.role,
        permission: input.permission,
        ...(input.key ? { key: input.key } : {}),
      };
      if (before.token_hash !== sha256(data.token)) {
        await auditEvent(tx, {
          ...audit,
          primary: { type: "invitation", id: data.invitation.id },
          reason: "delivery_superseded",
        });
        return input.response;
      }
      let outcome: "sent" | "not_configured" | "failed";
      let errorName: string | null = null;
      try {
        outcome = await input.deps.emailSender.send(
          invitationEmail({
            to: String(before.email),
            companyName: {
              en: String(before.legal_name_en),
              ar: String(before.legal_name_ar),
            },
            roles:
              before.kind === "staff"
                ? z.array(z.string()).parse(json(before.staff_roles))
                : [String(before.kind)],
            expiry: databaseInstant(before.expires_at).toISOString(),
            link: `${input.deps.appOrigin.replace(/\/$/, "")}${data.acceptPath}`,
          }),
        );
      } catch (error) {
        outcome = "failed";
        errorName =
          error instanceof Error &&
          /^[A-Za-z][A-Za-z0-9]{0,199}$/.test(error.name)
            ? error.name
            : "Error";
      }
      const after = await one(
        tx,
        "update core.invitation set delivery_status=:status,delivery_attempted_at=cast(:now as timestamptz),delivery_error=:error where id=cast(:id as uuid) returning *",
        {
          id: data.invitation.id,
          status: outcome,
          now: input.deps.clock().toISOString(),
          error: errorName,
        },
      );
      await auditEvent(tx, {
        ...audit,
        primary: {
          type: "invitation",
          id: data.invitation.id,
          before: Number(before.version),
          after: Number(after.version),
        },
        changedFields: [
          "delivery_status",
          "delivery_attempted_at",
          "delivery_error",
        ],
      });
      return {
        ...input.response,
        body: {
          invitation: invitationProjection(after, input.deps.clock),
          token: data.token,
          acceptPath: data.acceptPath,
        },
      };
    },
  );
}
export async function createInvitation(
  input: Omit<
    RouteInput<z.infer<typeof invitationInput>>,
    "actor" | "target" | "deps" | "principal"
  > & {
    deps: Pick<Dependencies, "clock">;
    principal: Pick<Principal, "accountId" | "client">;
  },
  queueDelivery = false,
): Promise<CommandResponse> {
  const { tx, companyId, principal, deps, role, permission, key } = input;
  const value = input.input;
  if (value.kind !== "staff") {
    const party = await one(
      tx,
      `select linked_account_id from party.${value.kind} where company_id=cast(:company as uuid) and id=cast(:id as uuid) for update`,
      { company: companyId, id: value.targetId },
    );
    if (party.linked_account_id !== null)
      throw new Refusal("PARTY_ALREADY_LINKED");
  }
  const expired = await rows(
    tx,
    "update core.invitation set status='expired' where company_id=cast(:company as uuid) and email=:email and kind=:kind and target_id is not distinct from cast(:target as uuid) and status='pending' and expires_at<=cast(:now as timestamptz) returning id,version",
    {
      company: companyId,
      email: value.email,
      kind: value.kind,
      target: value.kind === "staff" ? null : value.targetId,
      now: deps.clock().toISOString(),
    },
  );
  for (const row of expired)
    await auditEvent(tx, {
      companyId,
      principal,
      eventType: "invitation.expired",
      primary: {
        type: "invitation",
        id: String(row.id),
        before: Number(row.version) - 1,
        after: Number(row.version),
      },
      role,
      permission,
      changedFields: ["status"],
    });
  const token = randomBytes(32).toString("base64url");
  const expiry = new Date(deps.clock().getTime() + 7 * 86400_000).toISOString();
  let created;
  try {
    created = await one(
      tx,
      "insert into core.invitation(company_id,kind,email,target_id,token_hash,expires_at,status,staff_roles,locale,created_by) values(cast(:company as uuid),:kind,:email,cast(:target as uuid),:hash,cast(:expires as timestamptz),'pending',cast(:roles as jsonb),:locale,cast(:account as uuid)) returning *",
      {
        company: companyId,
        kind: value.kind,
        email: value.email,
        target: value.kind === "staff" ? null : value.targetId,
        hash: sha256(token),
        expires: expiry,
        roles: JSON.stringify(value.kind === "staff" ? value.staffRoles : []),
        locale: value.locale,
        account: principal.accountId,
      },
    );
  } catch (error) {
    if (isUnique(error, "invitation_pending_idx"))
      throw new Refusal("INVITATION_EXISTS");
    throw error;
  }
  const outboxId = queueDelivery ? randomUUID() : null;
  if (outboxId)
    await rows(
      tx,
      "insert into ops.outbox(id,company_id,created_by,topic,payload,dedupe_key) values(cast(:id as uuid),cast(:company as uuid),cast(:account as uuid),'invitation.email',cast(:payload as jsonb),:dedupe)",
      {
        id: outboxId,
        company: companyId,
        account: principal.accountId,
        payload: JSON.stringify({ invitationId: created.id }),
        dedupe: `invitation:${String(created.id)}:email`,
      },
    );
  await auditEvent(tx, {
    companyId,
    principal,
    eventType: "invitation.created",
    covered: outboxId ? [{ type: "outbox", id: outboxId, version: 1 }] : [],
    primary: {
      type: "invitation",
      id: String(created.id),
      after: Number(created.version),
    },
    role,
    permission,
    changedFields: [
      "kind",
      "email",
      "target_id",
      "expires_at",
      "status",
      "staff_roles",
      "locale",
    ],
    ...(key ? { key } : {}),
  });
  return {
    status: 201,
    body: {
      invitation: invitationProjection(created, deps.clock),
      token,
      acceptPath: `/${value.locale}/invitation#${token}`,
    },
  };
}
export function registerInvitations(
  routes: Hono<{ Variables: IdentityVariables }>,
  source: DependencySource,
): void {
  registerRoute(routes, source, invitationRoutes[0], {
    schema: z.null(),
    run: async ({ tx, deps }) => ({
      status: 200,
      body: {
        invitations: (
          await rows(tx, "select * from core.invitation order by created_at,id")
        ).map((row) => invitationProjection(row, deps.clock)),
      },
    }),
  });
  registerRoute(routes, source, invitationRoutes[1], {
    schema: invitationInput,
    capability: (input) =>
      input.kind === "staff" ? "staff_memberships" : "party_links",
    run: createInvitation,
    replayBody: invitationReplayBody,
    afterCommit: deliverInvitation,
  });
  registerRoute(routes, source, invitationRoutes[2], {
    schema: z.object({ expectedVersion, reason }),
    capability: (_input, target) =>
      target?.kind === "staff" ? "staff_memberships" : "party_links",
    run: async ({
      tx,
      deps,
      companyId,
      principal,
      input,
      target,
      role,
      permission,
      key,
    }) => {
      const before = targetRow(target);
      checkVersion(before, input.expectedVersion);
      if (effectiveStatus(before, deps.clock) !== "pending")
        throw new Refusal("INVITATION_NOT_PENDING");
      const after = await one(
        tx,
        "update core.invitation set status='revoked' where id=cast(:id as uuid) returning *",
        { id: String(before.id) },
      );
      await auditEvent(tx, {
        companyId,
        principal,
        eventType: "invitation.revoked",
        primary: {
          type: "invitation",
          id: String(before.id),
          before: Number(before.version),
          after: Number(after.version),
        },
        role,
        permission,
        changedFields: ["status"],
        reason: input.reason,
        ...(key ? { key } : {}),
      });
      return {
        status: 200,
        body: { invitation: invitationProjection(after, deps.clock) },
      };
    },
  });
  registerRoute(routes, source, invitationRoutes[3], {
    schema: z.object({ expectedVersion }),
    replayBody: invitationReplayBody,
    capability: (_input, target) =>
      target?.kind === "staff" ? "staff_memberships" : "party_links",
    run: async ({
      tx,
      deps,
      companyId,
      principal,
      input,
      target,
      role,
      permission,
      key,
    }) => {
      const before = targetRow(target);
      checkVersion(before, input.expectedVersion);
      if (!["pending", "expired"].includes(effectiveStatus(before, deps.clock)))
        throw new Refusal("INVITATION_NOT_PENDING");
      const token = randomBytes(32).toString("base64url");
      const after = await one(
        tx,
        "update core.invitation set token_hash=:hash,expires_at=cast(:expires as timestamptz),status='pending',delivery_status='pending',delivery_attempted_at=null,delivery_error=null where id=cast(:id as uuid) returning *",
        {
          id: String(before.id),
          hash: sha256(token),
          expires: new Date(
            deps.clock().getTime() + 7 * 86400_000,
          ).toISOString(),
        },
      );
      await auditEvent(tx, {
        companyId,
        principal,
        eventType: "invitation.resent",
        primary: {
          type: "invitation",
          id: String(before.id),
          before: Number(before.version),
          after: Number(after.version),
        },
        role,
        permission,
        changedFields: [
          "expires_at",
          "status",
          "delivery_status",
          "delivery_attempted_at",
          "delivery_error",
        ],
        ...(key ? { key } : {}),
      });
      return {
        status: 200,
        body: {
          invitation: invitationProjection(after, deps.clock),
          token,
          acceptPath: `/${String(before.locale)}/invitation#${token}`,
        },
      };
    },
    afterCommit: deliverInvitation,
  });
}
