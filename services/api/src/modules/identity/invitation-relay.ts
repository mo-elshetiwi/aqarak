import { randomBytes } from "node:crypto";
import { withCompanyTx } from "@aqarak/db";
import type { DataApiExecutor } from "@aqarak/db/data-api";
import { z } from "zod";
import {
  auditEvent,
  databaseInstant,
  json,
  one,
  rows,
  sha256,
} from "./database";
import { deliverInvitation, invitationProjection } from "./invitations";
import type { Dependencies } from "./ports";
import type { Principal, RoutePermission } from "./guard";

const permission: RoutePermission = {
  route: "invitation.email",
  method: "POST",
  capability: "party_links",
  operation: "write",
};
/** I claim identifier-only outbox entries and commit a token hash before delivering its link. */
export async function deliverPendingInvitations(input: {
  deps: Dependencies;
  schedulerExecutor: DataApiExecutor;
  companyId: string;
  limit?: number;
}): Promise<{ sent: number; failed: number; skipped: number }> {
  const companyId = z.uuid().parse(input.companyId);
  const limit = z
    .number()
    .int()
    .min(1)
    .max(100)
    .parse(input.limit ?? 20);
  const counts = { sent: 0, failed: 0, skipped: 0 };
  for (let index = 0; index < limit; index++) {
    const claim = await withCompanyTx(
      input.schedulerExecutor,
      { companyId, accountId: null },
      async (tx) => {
        const pending = (
          await rows(
            tx,
            "select * from ops.outbox where topic='invitation.email' and sent_at is null and dead_lettered_at is null and available_at<=now() order by available_at,id limit 1 for update skip locked",
          )
        )[0];
        if (!pending) return null;
        const accountId = z.guid().parse(pending.created_by);
        await rows(tx, "select set_config('app.account_id',:account,true)", {
          account: accountId,
        });
        const invitationId = z
          .object({ invitationId: z.uuid() })
          .parse(json(pending.payload)).invitationId;
        const claimed = await one(
          tx,
          "update ops.outbox set attempts=attempts+1,available_at=now()+interval '5 minutes' where id=cast(:id as uuid) returning *",
          { id: String(pending.id) },
        );
        await auditEvent(tx, {
          companyId,
          principal: { accountId, client: "web" },
          eventType: "invitation.delivery_claimed",
          primary: {
            type: "outbox",
            id: String(pending.id),
            before: Number(pending.version),
            after: Number(claimed.version),
          },
        });
        return {
          id: String(pending.id),
          invitationId,
          accountId,
          attempts: Number(claimed.attempts),
        };
      },
    );
    if (!claim) break;
    let outcome: "sent" | "failed" | "skipped" = "failed";
    try {
      const prepared = await withCompanyTx(
        input.deps.executor,
        { companyId, accountId: claim.accountId },
        async (tx) => {
          const before = await one(
            tx,
            "select * from core.invitation where id=cast(:id as uuid) for update",
            { id: claim.invitationId },
          );
          if (
            before.status !== "pending" ||
            databaseInstant(before.expires_at) <= input.deps.clock()
          )
            return null;
          const token = randomBytes(32).toString("base64url");
          const after = await one(
            tx,
            "update core.invitation set token_hash=:hash where id=cast(:id as uuid) returning *",
            { id: claim.invitationId, hash: sha256(token) },
          );
          await auditEvent(tx, {
            companyId,
            principal: { accountId: claim.accountId, client: "web" },
            eventType: "invitation.delivery_prepared",
            primary: {
              type: "invitation",
              id: claim.invitationId,
              before: Number(before.version),
              after: Number(after.version),
            },
          });
          return {
            invitation: invitationProjection(after, input.deps.clock),
            token,
            acceptPath: `/${String(after.locale)}/invitation#${token}`,
          };
        },
      );
      if (!prepared) outcome = "skipped";
      else {
        const principal: Pick<Principal, "accountId" | "client"> = {
          accountId: claim.accountId,
          client: "web",
        };
        const delivered = await deliverInvitation({
          deps: input.deps,
          companyId,
          principal,
          response: { status: 200, body: prepared },
          role: null,
          permission,
          key: undefined,
        });
        const status = z
          .object({ invitation: z.object({ deliveryStatus: z.string() }) })
          .parse(delivered.body).invitation.deliveryStatus;
        outcome = status === "sent" ? "sent" : "failed";
      }
    } catch {
      outcome = "failed";
    }
    await withCompanyTx(
      input.schedulerExecutor,
      { companyId, accountId: claim.accountId },
      async (tx) => {
        const before = await one(
          tx,
          "select * from ops.outbox where id=cast(:id as uuid) for update",
          { id: claim.id },
        );
        const after = await one(
          tx,
          "update ops.outbox set sent_at=case when :complete then now() else null end,last_error=case when :complete then null else 'DELIVERY_FAILED' end,available_at=now()+power(2,least(attempts,8))*interval '1 minute',dead_lettered_at=case when not :complete and attempts>=8 then now() else null end where id=cast(:id as uuid) returning *",
          { id: claim.id, complete: outcome !== "failed" },
        );
        await auditEvent(tx, {
          companyId,
          principal: { accountId: claim.accountId, client: "web" },
          eventType: "invitation.outbox_completed",
          primary: {
            type: "outbox",
            id: claim.id,
            before: Number(before.version),
            after: Number(after.version),
          },
          reason: outcome,
        });
      },
    );
    counts[outcome]++;
  }
  return counts;
}
