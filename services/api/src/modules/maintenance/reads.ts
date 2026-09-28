import { z } from "zod";
import {
  authorise,
  ownUnitSql,
  ownTicketSql,
  parameter,
  transaction,
  uuid,
  type RequestScope,
  type Transaction,
  type Access,
} from "./access";
import {
  ticketStatusSchema,
  ticketSummarySchema,
  ticketViewSchema,
  type TicketSummary,
  type TicketView,
} from "./contract";
import { Denied, Problem } from "./problem";
import { parseInput, type Runtime } from "./runtime";
import type { CommandResponse } from "./idempotency";
import { mediaRowSchema, mediaView, toIso } from "../media/records";

const ticketRowSchema = z.object({
  id: z.string(),
  unit_id: z.string(),
  unit_label: z.string(),
  category: ticketSummarySchema.shape.category,
  priority: ticketSummarySchema.shape.priority,
  status: ticketStatusSchema,
  safety_critical: z.boolean(),
  created_at: z.string(),
  reported_by_me: z.boolean(),
  version: z.coerce.number(),
  description: z.string().nullable(),
  payer: ticketViewSchema.shape.payer,
  transcript: z.string().nullable(),
  safety_flags: z.union([z.string(), z.array(z.string())]).nullable(),
  channel: ticketViewSchema.shape.channel,
  intake_id: z.string().nullable(),
});
type TicketRow = z.infer<typeof ticketRowSchema>;
function summary(row: TicketRow): TicketSummary {
  return ticketSummarySchema.parse({
    id: row.id,
    unitId: row.unit_id,
    unitLabel: row.unit_label,
    category: row.category,
    priority: row.priority,
    status: row.status,
    safetyCritical: row.safety_critical,
    createdAt: toIso(row.created_at),
    reportedByMe: row.reported_by_me,
  });
}
const ticketSelect = `select t.id, t.unit_id, t.category, t.priority, t.status, t.safety_critical, t.created_at::text as created_at, t.version, t.payer, concat_ws(' · ', coalesce(p.name_en, p.name_ar), u.unit_no) as unit_label,
  t.reported_by_account_id = :account as reported_by_me,
  case when ti.report_language = 'ar' then coalesce(t.description_ar, t.description_en) else coalesce(t.description_en, t.description_ar) end as description,
  ti.transcript, ti.safety_flags, ti.channel, ti.drafted_action_id as intake_id
  from maint.ticket t
  join estate.unit u on u.company_id = t.company_id and u.id = t.unit_id
  join estate.property p on p.company_id = u.company_id and p.id = u.property_id
  left join maint.ticket_intake ti on ti.company_id = t.company_id and ti.ticket_id = t.id
  where t.company_id = :company and (:manager or ${ownTicketSql})`;
export async function units(
  runtime: Runtime,
  scope: RequestScope,
): Promise<CommandResponse> {
  return transaction(runtime.db(), scope, async (tx) => {
    const access = await authorise(tx, "read");
    const result = await tx.execute(
      `select u.id, u.unit_no as "unitNo", coalesce(p.name_en, p.name_ar, '') as "propertyName",
      concat_ws(' · ', coalesce(p.name_en, p.name_ar), u.unit_no) as label
      from estate.unit u join estate.property p on p.company_id = u.company_id and p.id = u.property_id
      where u.company_id = :company and (:manager or u.id in (${ownUnitSql})) order by u.unit_no, u.id limit 200`,
      [
        uuid("company", scope.companyId),
        uuid("account", tx.accountId),
        parameter("manager", access.manager),
      ],
    );
    return { status: 200, body: { items: result.rows } };
  });
}
const cursorSchema = z.object({
  createdAt: z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)?$/u,
    ),
  id: z.uuid(),
});
function decodeCursor(
  value: string | undefined,
): z.infer<typeof cursorSchema> | null {
  if (!value) return null;
  try {
    return cursorSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown,
    );
  } catch {
    throw new Problem(400, "INVALID_REQUEST", "The cursor is invalid.", {
      field: "cursor",
    });
  }
}
export async function tickets(
  runtime: Runtime,
  scope: RequestScope,
  request: Request,
): Promise<CommandResponse> {
  const query = parseInput(
    z.object({
      status: ticketStatusSchema.optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
      cursor: z.string().max(1000).optional(),
    }),
    Object.fromEntries(new URL(request.url).searchParams),
  );
  const cursor = decodeCursor(query.cursor);
  return transaction(runtime.db(), scope, async (tx) => {
    const access = await authorise(tx, "read");
    const result = await tx.execute(
      `${ticketSelect}
      and (:status::text is null or t.status = :status)
      and (:cursor_id::uuid is null or (t.created_at, t.id) < (cast(:cursor_at as timestamptz), :cursor_id::uuid))
      order by t.created_at desc, t.id desc limit :limit`,
      [
        uuid("company", scope.companyId),
        uuid("account", tx.accountId),
        parameter("manager", access.manager),
        parameter("status", query.status ?? null),
        parameter("cursor_at", cursor?.createdAt ?? null),
        parameter("cursor_id", cursor?.id ?? null, "UUID"),
        parameter("limit", query.limit + 1),
      ],
    );
    const rows = result.rows.map((row) => ticketRowSchema.parse(row));
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const nextCursor =
      rows.length > query.limit && last
        ? Buffer.from(
            JSON.stringify({ createdAt: last.created_at, id: last.id }),
          ).toString("base64url")
        : null;
    const items = [];
    for (const row of page) items.push(await fullView(tx, row));
    return { status: 200, body: { items, nextCursor } };
  });
}
export async function ticket(
  runtime: Runtime,
  scope: RequestScope,
  ticketId: string | undefined,
): Promise<CommandResponse> {
  const id = parseInput(z.uuid(), ticketId);
  return transaction(runtime.db(), scope, async (tx) => {
    const access = await authorise(tx, "read");
    return {
      status: 200,
      body: { ticket: await readTicketView(tx, access, id) },
    };
  });
}
export async function readTicketView(
  tx: Transaction,
  access: Access,
  id: string,
): Promise<TicketView> {
  const raw = (
    await tx.execute(`${ticketSelect} and t.id = :ticket`, [
      uuid("company", tx.scope.companyId),
      uuid("account", tx.accountId),
      parameter("manager", access.manager),
      uuid("ticket", id),
    ])
  ).rows[0];
  if (!raw) throw new Denied("ticket", id);
  return fullView(tx, ticketRowSchema.parse(raw));
}
async function fullView(tx: Transaction, row: TicketRow): Promise<TicketView> {
  const media = (
    await tx.execute(
      "select * from maint.media where company_id = :company and ticket_id = :ticket order by created_at, id",
      [uuid("company", tx.scope.companyId), uuid("ticket", row.id)],
    )
  ).rows.map((item) => mediaView(mediaRowSchema.parse(item)));
  return ticketViewSchema.parse({
    ...summary(row),
    version: row.version,
    description: row.description,
    transcript: row.transcript,
    safetyFlags:
      typeof row.safety_flags === "string"
        ? (JSON.parse(row.safety_flags) as unknown)
        : (row.safety_flags ?? []),
    payer: row.payer,
    channel: row.channel,
    intakeId: row.intake_id,
    media,
  });
}
