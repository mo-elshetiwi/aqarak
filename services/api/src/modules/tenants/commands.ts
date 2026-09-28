import { queuePartyInvitation } from "../identity/party-invitations";
import { z } from "zod";
import type { RequestContext } from "../documents/context";
import { authorize } from "../documents/context";
import { appendAuditEvent } from "../documents/audit";
import { rows, one, str, num } from "../documents/sql";
import { Problem } from "../documents/problem";
import type { Outcome } from "../documents/http";
import { loadTenant, tenantDetail, tenantSummary } from "./read";

export const tenantSchema = z.strictObject({
  kind: z.literal("individual"),
  fullNameEn: z.string().trim().min(1).max(120),
  fullNameAr: z.string().trim().min(1).max(120).optional(),
  email: z
    .email()
    .max(320)
    .transform((value) => value.toLowerCase()),
  phoneE164: z
    .string()
    .regex(/^\+[1-9][0-9]{7,14}$/)
    .optional(),
  preferredLanguage: z.enum(["en", "ar"]),
});
export async function createTenant(
  ctx: RequestContext,
  body: z.infer<typeof tenantSchema>,
): Promise<Outcome> {
  authorize(ctx, {
    operation: "write",
    capability: "tenants_occupants",
    companyScope: true,
  });
  const row = await one(
    ctx.tx,
    `insert into party.tenant(company_id,kind,full_name_en,full_name_ar,email,phone_e164,preferred_language,created_by)
    values(cast(:company as uuid),'individual',:en,:ar,:email,:phone,:language,cast(:account as uuid)) returning *`,
    {
      company: ctx.companyId,
      en: body.fullNameEn,
      ar: body.fullNameAr ?? null,
      email: body.email,
      phone: body.phoneE164 ?? null,
      language: body.preferredLanguage,
      account: ctx.accountId,
    },
  );
  await appendAuditEvent(ctx.tx, {
    companyId: ctx.companyId,
    accountId: ctx.accountId,
    type: "tenant.created",
    subjectType: "tenant",
    subjectId: str(row, "id"),
    versionAfter: num(row, "version"),
  });
  return { status: 201, body: { tenant: await tenantDetail(ctx, row) } };
}
export async function listTenants(ctx: RequestContext): Promise<Outcome> {
  authorize(ctx, {
    operation: "read",
    capability: "tenants_occupants",
    companyScope: true,
  });
  const result = await rows(
    ctx.tx,
    `select * from party.tenant where company_id=cast(:company as uuid) and kind='individual' order by created_at,id`,
    { company: ctx.companyId },
  );
  const tenants = [];
  for (const row of result)
    tenants.push(tenantSummary(await tenantDetail(ctx, row)));
  return { status: 200, body: { tenants } };
}
export async function getTenant(ctx: RequestContext): Promise<Outcome> {
  return {
    status: 200,
    body: {
      tenant: await tenantDetail(
        ctx,
        await loadTenant(ctx, ctx.params.tenantId ?? "", "read"),
      ),
    },
  };
}
export async function inviteTenant(ctx: RequestContext): Promise<Outcome> {
  const tenant = await loadTenant(
    ctx,
    ctx.params.tenantId ?? "",
    "write",
    true,
  );
  if (tenant.linked_account_id) throw new Problem(409, "ALREADY_LINKED");
  const pending = await rows(
    ctx.tx,
    `select id from core.invitation where company_id=cast(:company as uuid) and target_id=cast(:tenant as uuid) and kind='tenant' and status='pending' and expires_at>cast(:now as timestamptz)`,
    {
      company: ctx.companyId,
      tenant: str(tenant, "id"),
      now: ctx.deps.now().toISOString(),
    },
  );
  if (pending.length) throw new Problem(409, "INVITATION_PENDING");
  const invitation = await queuePartyInvitation({
    tx: ctx.tx,
    companyId: ctx.companyId,
    accountId: ctx.accountId,
    kind: "tenant",
    targetId: str(tenant, "id"),
    email: str(tenant, "email"),
    locale: tenant.preferred_language === "ar" ? "ar" : "en",
    now: ctx.deps.now,
  });
  return { status: 201, body: { invitation } };
}
