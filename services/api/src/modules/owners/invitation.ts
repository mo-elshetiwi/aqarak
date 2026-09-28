import { z } from "@hono/zod-openapi";
import { queuePartyInvitation } from "../identity/party-invitations";
import type { RequestScope } from "../properties/lib/runtime";
import type { CommandResponse } from "../properties/lib/idempotency";
import { one, rows, uuid, text, nullableText } from "../properties/lib/sql";
import { fail } from "../properties/lib/problem";
import { emailSchema } from "../properties/lib/schemas";
export const invitationSchema = z
  .object({ email: emailSchema.optional() })
  .strict();
export const invitationResponseSchema = z.object({
  invitation: z.object({
    id: z.uuid(),
    status: z.literal("pending"),
    expiresAt: z.iso.datetime(),
  }),
});
// Delivery, token issue and acceptance belong to the identity module.
export type OwnerInvitationPort = (
  scope: RequestScope,
  input: { ownerId: string; email: string },
) => Promise<{ id: string; status: "pending"; expiresAt: string }>;
export const recordOwnerInvitation: OwnerInvitationPort = (scope, input) =>
  queuePartyInvitation({
    tx: scope.tx,
    companyId: scope.audit.companyId,
    accountId: scope.audit.accountId,
    kind: "owner",
    targetId: input.ownerId,
    email: input.email,
    locale: scope.root?.preferred_language === "ar" ? "ar" : "en",
    now: () => new Date(),
  });
export async function inviteOwner(
  scope: RequestScope,
  input: unknown,
  port: OwnerInvitationPort = recordOwnerInvitation,
): Promise<CommandResponse> {
  const body = invitationSchema.parse(input);
  const owner = one(scope.root ? [scope.root] : []);
  if (owner.linked_account_id != null) fail(422, "OWNER_ALREADY_LINKED");
  const email = body.email ?? nullableText(owner, "email");
  if (!email) fail(422, "OWNER_EMAIL_REQUIRED", "email");
  const id = text(owner, "id");
  const pending = await rows(
    scope.tx,
    "select id from core.invitation where company_id=:c and kind='owner' and target_id=:id and status='pending' and expires_at>now()",
    [uuid("c", scope.audit.companyId), uuid("id", id)],
  );
  if (pending.length) fail(409, "INVITATION_PENDING");
  return {
    status: 201,
    body: { invitation: await port(scope, { ownerId: id, email }) },
  };
}
