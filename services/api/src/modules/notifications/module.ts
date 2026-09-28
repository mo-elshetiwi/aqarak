import { z } from "zod";
import type { ApiModule } from "../index";
import {
  json,
  type WorkflowRuntime,
  type RequestContext,
} from "../contracts/runtime/request";
import {
  first,
  rows,
  string,
  integer,
  instant,
} from "../contracts/runtime/sql";
import { WorkflowProblem } from "../contracts/runtime/problem";
import {
  claimIdempotency,
  completeIdempotency,
} from "../contracts/runtime/idempotency";
import { insertAudit } from "../contracts/runtime/audit";
import { updateBusiness } from "../contracts/runtime/mutations";
import { canonical } from "../contracts/queries";
export { insertNotifications } from "./writer";
export type { NotificationInput, NotificationRows } from "./writer";
const query = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export function createNotificationsModule(runtime: WorkflowRuntime): ApiModule {
  return {
    name: "notifications",
    basePath: "/v1/companies/:companyId/notifications",
    register(app) {
      app.get(
        "/",
        runtime({
          command: "notifications_list",
          schema: query,
          run: async (context, body) => {
            const count = await first(
              context.tx,
              "select count(*) as count from work.notification where recipient_account_id=:account::uuid and channel='in_app' and read_at is null",
              { account: context.actor.accountId },
            );
            const notifications = await rows(
              context.tx,
              "select * from work.notification where recipient_account_id=:account::uuid and channel='in_app' order by created_at desc,id desc limit :limit",
              { account: context.actor.accountId, limit: body.limit },
            );
            return json({
              unreadCount: count ? integer(count, "count") : 0,
              items: notifications.map((n) => ({
                id: n.id,
                templateCode: n.template_code,
                subjectType: n.subject_type,
                subjectId: n.subject_id,
                contractId: n.subject_type === "contract" ? n.subject_id : null,
                createdAt: instant(n.created_at),
                readAt: n.read_at ? instant(n.read_at) : null,
              })),
            });
          },
        }),
      );
      app.post(
        "/:notificationId/read",
        runtime({
          command: "notification_read",
          mutation: true,
          schema: z.strictObject({}),
          run: (context, body, params) => markRead(context, { body, params }),
        }),
      );
    },
  };
}
async function markRead(
  context: RequestContext,
  input: { body: Record<string, never>; params: Record<string, string> },
): Promise<Response> {
  const row = await first(
    context.tx,
    "select * from work.notification where id=:id::uuid and recipient_account_id=:account::uuid and channel='in_app' for update",
    {
      id: z.uuid().parse(input.params.notificationId),
      account: context.actor.accountId,
    },
  );
  if (!row) throw new WorkflowProblem("NOT_FOUND");
  const replay = await claimIdempotency(context.tx, {
    actor: context.audit,
    command: "notification_read",
    pathParams: input.params,
    body: input.body,
    now: context.dependencies.clock().toISOString(),
  });
  if (replay) return json(replay.body, replay.status);
  const before = integer(row, "version");
  const readAt = row.read_at
    ? instant(row.read_at)
    : context.dependencies.clock().toISOString();
  if (!row.read_at) {
    await updateBusiness(
      {
        tx: context.tx,
        companyId: context.audit.companyId,
        accountId: context.actor.accountId,
        mutations: [],
      },
      {
        table: "work.notification",
        row,
        values: { read_at: readAt },
        eventType: "notification.updated",
      },
    );
    await insertAudit(context.tx, context.audit, {
      eventType: "notification.updated",
      subjectType: "notification",
      subjectId: string(row, "id"),
      before,
      after: before + 1,
      fields: ["read_at"],
    });
  }
  const body = canonical({ id: row.id, readAt });
  await completeIdempotency(context.tx, {
    actor: context.audit,
    command: "notification_read",
    response: { status: 200, body },
  });
  return json(body);
}
