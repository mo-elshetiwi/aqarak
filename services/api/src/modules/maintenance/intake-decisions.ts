import { randomUUID } from "node:crypto";
import { requestSha256 } from "@aqarak/domain";
import { z } from "zod";
import {
  audit,
  authorise,
  parameter,
  requireUnit,
  transaction,
  uuid,
  type Access,
  type RequestScope,
  type Transaction,
} from "./access";
import { confirmIntakeBodySchema, rejectIntakeBodySchema } from "./contract";
import {
  claim,
  idempotencyKey,
  storeResponse,
  type CommandResponse,
} from "./idempotency";
import { Problem } from "./problem";
import { jsonBody, parseInput, type Runtime } from "./runtime";
import {
  requireDraft,
  changeDraftStatus,
  intakeView,
  type DraftRow,
} from "./intake-records";
import { unitVersion } from "./intake-draft";
import { toIso, mediaRowSchema } from "../media/records";
import {
  fieldProvenance,
  reportDecision,
  type ConfirmBody,
} from "./intake-policy";
import { readTicketView } from "./reads";

function readyVersion(row: DraftRow, raw: unknown): void {
  if (row.status !== "ready")
    throw new Problem(
      409,
      "ALREADY_DECIDED",
      "The draft has already been decided.",
      { currentStatus: row.status },
    );
  const { expectedVersion } = parseInput(
    z.object({ expectedVersion: z.number().int().positive() }),
    raw,
  );
  if (row.version !== expectedVersion)
    throw new Problem(409, "STALE_VERSION", "The draft has changed.", {
      currentVersion: row.version,
    });
}
async function expire(
  tx: Transaction,
  row: DraftRow,
  key: string,
  now: number,
): Promise<CommandResponse | null> {
  const version = await unitVersion(tx, row.payload.unitId);
  if (
    version === row.base_versions[`unit:${row.payload.unitId}`] &&
    now - new Date(toIso(row.created_at)).getTime() <= 86400000
  )
    return null;
  const expired = await changeDraftStatus(tx, row, "expired");
  await audit(tx, {
    event: "drafted_action.expired",
    subjectType: "drafted_action",
    subjectId: row.id,
    versionBefore: row.version,
    versionAfter: expired.version,
    key,
  });
  return {
    status: 409,
    body: new Problem(409, "EXPIRED", "The draft has expired.").body,
  };
}
async function insertTicket(
  tx: Transaction,
  access: Access,
  row: DraftRow,
  body: ConfirmBody,
): Promise<string> {
  const id = randomUUID();
  const owner = (
    await tx.execute(
      `select o.linked_account_id from estate.unit u join estate.ownership eo on eo.company_id = u.company_id and eo.property_id = u.property_id join party.owner o on o.company_id = eo.company_id and o.id = eo.owner_id where u.company_id = :company and u.id = :unit and o.linked_account_id is not null order by eo.is_representative desc, eo.id limit 1`,
      [uuid("company", tx.scope.companyId), uuid("unit", row.payload.unitId)],
    )
  ).rows[0];
  const decision = reportDecision({
    id,
    actorId: tx.accountId,
    authorId: row.for_account_id,
    role: access.manager ? "manager" : "tenant",
    ownerAccountId: z
      .string()
      .nullable()
      .parse(owner?.linked_account_id ?? null),
    payer: row.payload.payer,
    confirmed: body,
  });
  await tx.execute(
    `insert into maint.ticket(id, company_id, created_by, unit_id, reported_by_account_id, category, priority, safety_critical, status, payer, description_en, description_ar)
  values (:id, :company, :account, :unit, :account, :category, :priority, :safety, :status, :payer, :en, :ar)`,
    [
      uuid("id", id),
      uuid("company", tx.scope.companyId),
      uuid("account", tx.accountId),
      uuid("unit", row.payload.unitId),
      parameter("category", body.category),
      parameter("priority", decision.priority),
      parameter("safety", decision.safetyCritical),
      parameter("status", decision.status),
      parameter("payer", row.payload.payer),
      parameter("en", row.payload.language === "en" ? body.description : null),
      parameter("ar", row.payload.language === "ar" ? body.description : null),
    ],
  );
  return id;
}
async function commitTicket(
  tx: Transaction,
  access: Access,
  row: DraftRow,
  input: { body: ConfirmBody; key: string },
): Promise<CommandResponse> {
  const { body, key } = input;
  const id = await insertTicket(tx, access, row, body);
  const intakeId = randomUUID();
  await tx.execute(
    `insert into maint.ticket_intake(id, company_id, created_by, ticket_id, drafted_action_id, channel, report_language, transcript, transcript_edited, safety_flags, transcription_mode, triage_mode)
  values (:id, :company, :account, :ticket, :draft, :channel, :language, :transcript, :edited, :flags, :speech, :triage)`,
    [
      uuid("id", intakeId),
      uuid("company", tx.scope.companyId),
      uuid("account", tx.accountId),
      uuid("ticket", id),
      uuid("draft", row.id),
      parameter("channel", row.channel),
      parameter("language", row.payload.language),
      parameter("transcript", body.transcript),
      parameter("edited", body.transcript !== row.payload.transcript),
      parameter("flags", JSON.stringify(body.safetyFlags), "JSON"),
      parameter("speech", row.payload.transcriptionMode),
      parameter("triage", row.payload.triageMode),
    ],
  );
  const media = (
    await tx.execute(
      "update maint.media set ticket_id = :ticket where company_id = :company and drafted_action_id = :draft returning *",
      [
        uuid("ticket", id),
        uuid("company", tx.scope.companyId),
        uuid("draft", row.id),
      ],
    )
  ).rows.map((item) => mediaRowSchema.parse(item));
  const committed = await changeDraftStatus(tx, row, "committed");
  const outboxId = randomUUID();
  await tx.execute(
    "insert into ops.outbox(id, company_id, created_by, topic, payload, dedupe_key) values (:id, :company, :account, 'maintenance.ticket_reported', :payload, :dedupe)",
    [
      uuid("id", outboxId),
      uuid("company", tx.scope.companyId),
      uuid("account", tx.accountId),
      parameter("payload", JSON.stringify({ ticketId: id }), "JSON"),
      parameter("dedupe", `ticket_reported:${id}`),
    ],
  );
  await audit(tx, {
    event: "ticket.reported",
    subjectType: "ticket",
    subjectId: id,
    versionAfter: 1,
    key,
    draftedActionId: row.id,
    provenance: fieldProvenance(row.payload, body),
    covers: [
      { type: "ticket_intake", id: intakeId, version: 1 },
      { type: "drafted_action", id: row.id, version: committed.version },
      ...media.map((item) => ({
        type: "media",
        id: item.id,
        version: item.version,
      })),
      { type: "outbox", id: outboxId, version: 1 },
    ],
  });
  return {
    status: 201,
    body: {
      ticket: await readTicketView(tx, access, id),
      intake: await intakeView(tx, committed),
    },
  };
}
export async function decideIntake(
  runtime: Runtime,
  scope: RequestScope,
  request: Request,
  input: { intakeId: string | undefined; decision: "confirm" | "reject" },
): Promise<CommandResponse> {
  const keyValue = idempotencyKey(request);
  const id = parseInput(z.uuid(), input.intakeId);
  const raw = await jsonBody(request);
  const key = {
    key: keyValue,
    command: `maintenance.intake.${input.decision}`,
    hash: requestSha256({
      pathParams: { companyId: scope.companyId, intakeId: id },
      body: z.json().parse(raw),
    }),
  };
  return transaction(runtime.db(), scope, async (tx) => {
    const access = await authorise(tx, "write");
    const saved = await claim(tx, key);
    if (saved) return saved;
    const row = await requireDraft(tx, id, true);
    scope.channel = row.channel;
    readyVersion(row, raw);
    let response: CommandResponse;
    if (input.decision === "reject") {
      const body = parseInput(rejectIntakeBodySchema, raw);
      const rejected = await changeDraftStatus(tx, row, "rejected");
      await audit(tx, {
        event: "drafted_action.rejected",
        subjectType: "drafted_action",
        subjectId: row.id,
        versionBefore: row.version,
        versionAfter: rejected.version,
        key: key.key,
        reason: body.reason?.trim()
          ? body.reason.trim()
          : "discarded_by_reporter",
      });
      response = {
        status: 200,
        body: { intake: await intakeView(tx, rejected) },
      };
    } else {
      await requireUnit(tx, access, row.payload.unitId);
      response =
        (await expire(tx, row, key.key, runtime.now())) ??
        (await commitTicket(tx, access, row, {
          body: parseInput(confirmIntakeBodySchema, raw),
          key: key.key,
        }));
    }
    await storeResponse(tx, key, response);
    return response;
  });
}
