import type { CompanyTransaction } from "./runtime/db";
import { rows, integer, instant, string, nullableString } from "./runtime/sql";
export interface ContractDelivery {
  notificationId: string;
  recipientName: string;
  channel: string;
  templateCode: string;
  status: string;
  createdAt: string;
  lastErrorCode: string | null;
  attempts: number;
  deadLettered: boolean;
}
export async function contractDeliveries(
  tx: CompanyTransaction,
  contractId: string,
): Promise<ContractDelivery[]> {
  const notifications = await rows(
    tx,
    `select n.*,p.display_name,
    (select count(*) from work.notification_attempt a where a.notification_id=n.id and a.company_id=n.company_id) as attempts,
    (select a.outcome from work.notification_attempt a where a.notification_id=n.id and a.company_id=n.company_id order by a.attempt_no desc limit 1) as last_outcome,
    (select a.error_code from work.notification_attempt a where a.notification_id=n.id and a.company_id=n.company_id order by a.attempt_no desc limit 1) as last_error_code
    from work.notification n left join core.person_account p on p.id=n.recipient_account_id
    where n.subject_type='contract' and n.subject_id=:id::uuid order by n.created_at,n.id`,
    { id: contractId },
  );
  return notifications.map((n) => ({
    notificationId: string(n, "id"),
    recipientName: nullableString(n, "display_name") ?? "",
    channel: string(n, "channel"),
    templateCode: string(n, "template_code"),
    status: string(n, "status"),
    createdAt: instant(n.created_at),
    lastErrorCode: nullableString(n, "last_error_code"),
    attempts: integer(n, "attempts"),
    deadLettered: n.last_outcome === "dead_lettered",
  }));
}
