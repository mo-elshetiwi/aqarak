import { getConfig } from "../../config";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DataApiExecutor } from "@aqarak/db/data-api";
import {
  withSystemTx,
  type CompanyTransaction,
  type Row,
} from "../contracts/runtime/db";
import { first, integer, parameters, string } from "../contracts/runtime/sql";
import { renderNotificationEmail, emailTemplates } from "./render";
import type { EmailSender } from "./sender";
export type { EmailSender } from "./sender";
export interface DeliveryCounts {
  attempted: number;
  sent: number;
  failed: number;
  deadLettered: number;
  skipped: number;
}
export interface RelayOptions {
  schedulerExecutor: DataApiExecutor;
  appExecutor: DataApiExecutor;
  email: EmailSender;
  now: () => Date;
  companyId?: string;
  limit?: number;
}
export function deliveryError(error: unknown): {
  code: string;
  detail: string;
} {
  const redact = (value: string) =>
    value.replace(/[^\s<>"'@]+@[^\s<>"'@]+/gu, "[address]");
  const code = redact(
    error instanceof Error ? error.name : "DeliveryError",
  ).slice(0, 100);
  const message =
    error instanceof Error ? error.message : "Email delivery failed";
  return { code, detail: redact(`${code}: ${message}`).slice(0, 300) };
}
export async function deliverPendingEmails(
  options: RelayOptions,
): Promise<DeliveryCounts> {
  const limit = z
    .number()
    .int()
    .min(1)
    .max(10_000)
    .parse(options.limit ?? 100);
  const counts: DeliveryCounts = {
    attempted: 0,
    sent: 0,
    failed: 0,
    deadLettered: 0,
    skipped: 0,
  };
  const companies = options.companyId
    ? [{ id: z.uuid().parse(options.companyId) }]
    : (
        await options.schedulerExecutor.execute(
          "select id from core.company order by id",
        )
      ).rows;
  let processed = 0;
  for (const company of companies) {
    const companyId = string(company, "id");
    while (processed < limit) {
      const outcome = await withSystemTx(
        options.schedulerExecutor,
        { companyId },
        (tx) => deliverOne(tx, companyId, options),
      );
      if (outcome === null) break;
      processed++;
      if (outcome === "dead_lettered") counts.deadLettered++;
      if (outcome === "skipped") counts.skipped++;
      else {
        counts.attempted++;
        if (outcome === "sent") counts.sent++;
        else {
          counts.failed++;
        }
      }
    }
    if (processed >= limit) break;
  }
  return counts;
}
async function deliverOne(
  tx: CompanyTransaction,
  companyId: string,
  options: RelayOptions,
): Promise<"sent" | "failed" | "dead_lettered" | "skipped" | null> {
  const outbox = await first(
    tx,
    `select * from ops.outbox where topic = 'notification.email' and sent_at is null and dead_lettered_at is null and available_at <= now() order by available_at limit 1 for update skip locked`,
  );
  if (!outbox) return null;
  const payload = z
    .object({ notificationId: z.uuid() })
    .parse(
      typeof outbox.payload === "string"
        ? (JSON.parse(outbox.payload) as unknown)
        : outbox.payload,
    );
  const notification = await first(
    tx,
    "select * from work.notification where id=:id::uuid and channel='email' for update",
    { id: payload.notificationId },
  );
  if (!notification) throw new Error("Email notification is missing");
  const ids = {
    company: companyId,
    notification: payload.notificationId,
    outbox: string(outbox, "id"),
  };
  if (notification.status === "sent") {
    await tx.execute(
      "update ops.outbox set sent_at=now() where id=:outbox::uuid",
      parameters(ids),
    );
    await auditDelivery(tx, {
      companyId,
      notification,
      outbox,
      eventType: "notification.sent",
      changed: false,
    });
    return "skipped";
  }
  const attempt = integer(outbox, "attempts") + 1;
  let messageId: string | null = null;
  let failure: ReturnType<typeof deliveryError> | null = null;
  try {
    const message = await withSystemTx(
      options.appExecutor,
      { companyId },
      async (appTx) => {
        const recipient = await first(
          appTx,
          `select p.email,p.preferred_language from core.person_account p where p.id=:id::uuid and exists(select 1 from core.account_company_link l where l.account_id=p.id and l.company_id=:company::uuid and l.status='active')`,
          {
            id: string(notification, "recipient_account_id"),
            company: companyId,
          },
        );
        if (!recipient) throw new Error("RecipientUnavailable");
        const company = await first(
          appTx,
          "select legal_name_en,legal_name_ar from core.company where id=:id::uuid",
          { id: companyId },
        );
        const contract = await first(
          appTx,
          "select contract_no from lease.contract where id=:id::uuid",
          { id: string(notification, "subject_id") },
        );
        if (!company || !contract || notification.subject_type !== "contract")
          throw new Error("NotificationSubjectUnavailable");
        return {
          to: z.email().parse(recipient.email),
          ...renderNotificationEmail({
            template: z.enum(emailTemplates).parse(notification.template_code),
            locale: z.enum(["en", "ar"]).parse(recipient.preferred_language),
            companyName: {
              en: string(company, "legal_name_en"),
              ar: string(company, "legal_name_ar"),
            },
            contractNo: string(contract, "contract_no"),
            companyId,
            contractId: string(notification, "subject_id"),
            appOrigin: getConfig().APP_ORIGIN,
          }),
        };
      },
    );
    messageId = z
      .string()
      .min(1)
      .parse((await options.email.send(message)).messageId);
  } catch (error) {
    failure = deliveryError(error);
  }
  const outcome = failure
    ? attempt >= 8
      ? "dead_lettered"
      : "failed"
    : "sent";
  if (failure) {
    await tx.execute(
      `update ops.outbox set attempts=:attempt,last_error=:error,available_at=now() + power(2,:attempt) * interval '1 minute',dead_lettered_at=case when :attempt>=8 then now() else null end where id=:outbox::uuid`,
      parameters({ ...ids, attempt, error: failure.detail }),
    );
  } else {
    await tx.execute(
      "update ops.outbox set sent_at=now(),last_error=null where id=:outbox::uuid",
      parameters(ids),
    );
  }
  await tx.execute(
    "update work.notification set status=:status where id=:notification::uuid",
    parameters({ ...ids, status: failure ? "failed" : "sent" }),
  );
  await tx.execute(
    `insert into work.notification_attempt(company_id,notification_id,outbox_id,attempt_no,outcome,provider_message_id,error_code,error_detail,occurred_at) values (:company::uuid,:notification::uuid,:outbox::uuid,:attempt,:outcome,:message,:code,:detail,:occurred::timestamptz)`,
    parameters({
      ...ids,
      attempt,
      outcome,
      message: messageId,
      code: failure?.code ?? null,
      detail: failure?.detail ?? null,
      occurred: options.now().toISOString(),
    }),
  );
  await auditDelivery(tx, {
    companyId,
    notification,
    outbox,
    eventType: failure ? "notification.failed" : "notification.sent",
    changed: true,
  });
  return outcome;
}
async function auditDelivery(
  tx: CompanyTransaction,
  input: {
    companyId: string;
    notification: Row;
    outbox: Row;
    eventType: string;
    changed: boolean;
  },
): Promise<void> {
  const { companyId, notification, outbox, eventType, changed } = input;
  const event = randomUUID();
  await tx.execute(
    `insert into audit.audit_event(event_id,company_id,event_type,actor_account_id,actor_role,initiator,channel,subject_type,subject_id,version_before,version_after,changed_fields,policy_decision) values (:event::uuid,:company::uuid,:type,null,null,'scheduler','system','notification',:notification::uuid,:before::integer,:after::integer,:fields::jsonb,null)`,
    parameters({
      event,
      company: companyId,
      type: eventType,
      notification: string(notification, "id"),
      before: changed ? integer(notification, "version") : null,
      after: changed ? integer(notification, "version") + 1 : null,
      fields: JSON.stringify(changed ? ["status"] : []),
    }),
  );
  await tx.execute(
    `insert into audit.event_subject(company_id,event_id,subject_type,subject_id,subject_version) values (:company::uuid,:event::uuid,'outbox',:outbox::uuid,:version)`,
    parameters({
      company: companyId,
      event,
      outbox: string(outbox, "id"),
      version: integer(outbox, "version") + 1,
    }),
  );
}
