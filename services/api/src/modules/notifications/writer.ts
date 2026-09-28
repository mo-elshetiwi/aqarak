import { randomUUID } from "node:crypto";
import type { CompanyTransaction } from "../contracts/runtime/db";
import type { Mutation } from "../contracts/runtime/audit";
import { first, string } from "../contracts/runtime/sql";
import { insertBusiness } from "../contracts/runtime/mutations";
import { WorkflowProblem } from "../contracts/runtime/problem";
export interface NotificationInput {
  companyId: string;
  actorAccountId: string;
  recipientAccountId: string;
  templateCode: string;
  contractId: string;
  dedupeSubjectId: string;
  eventType: string;
}
export interface NotificationRows {
  inAppId: string;
  emailId: string;
  outboxId: string;
  mutations: Mutation[];
}
export async function insertNotifications(
  tx: CompanyTransaction,
  input: NotificationInput,
): Promise<NotificationRows> {
  const account = await first(
    tx,
    "select preferred_language from core.person_account where id=:id::uuid",
    { id: input.recipientAccountId },
  );
  if (!account) throw new WorkflowProblem("UNAVAILABLE");
  const mutations: Mutation[] = [];
  const context = {
    tx,
    companyId: input.companyId,
    accountId: input.actorAccountId,
    mutations,
  };
  const common = {
    recipient_account_id: input.recipientAccountId,
    template_code: input.templateCode,
    language: string(account, "preferred_language"),
    subject_type: "contract",
    subject_id: input.contractId,
  };
  const prefix = `${input.templateCode}:${input.dedupeSubjectId}:${input.recipientAccountId}`;
  const inAppId = await insertBusiness(context, {
    table: "work.notification",
    eventType: input.eventType,
    values: {
      ...common,
      channel: "in_app",
      status: "sent",
      dedupe_key: `${prefix}:in_app`,
    },
  });
  const emailId = await insertBusiness(context, {
    table: "work.notification",
    eventType: input.eventType,
    values: {
      ...common,
      channel: "email",
      status: "queued",
      dedupe_key: `${prefix}:email`,
    },
  });
  const outboxId = randomUUID();
  await insertBusiness(context, {
    table: "ops.outbox",
    eventType: input.eventType,
    values: {
      id: outboxId,
      topic: "notification.email",
      payload: JSON.stringify({ notificationId: emailId }),
      dedupe_key: `email:${emailId}`,
    },
  });
  return { inAppId, emailId, outboxId, mutations };
}
