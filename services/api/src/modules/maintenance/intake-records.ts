import { z } from "zod";
import {
  intakeViewSchema,
  intakeBodySchema,
  categorySchema,
  prioritySchema,
  safetyFlagSchema,
} from "./contract";
import { parameter, uuid, type Transaction } from "./access";
import { Denied } from "./problem";
import { mediaRowSchema, mediaView, toIso } from "../media/records";
import type { IntakeView } from "./contract";

export const draftPayloadSchema = intakeBodySchema.extend({
  transcript: z.string().max(8000).nullable(),
  category: categorySchema,
  priority: prioritySchema,
  safetyFlags: z.array(safetyFlagSchema),
  description: z.string().max(1000),
  payer: z.enum(["owner", "tenant"]),
  transcriptionMode: z.enum(["model", "degraded", "not_requested"]),
  triageMode: z.enum(["model", "degraded"]),
  confidence: z.number().min(0).max(1).nullable(),
});
const json = (value: unknown): unknown =>
  typeof value === "string" ? (JSON.parse(value) as unknown) : value;
export const draftRowSchema = z.object({
  id: z.string(),
  version: z.coerce.number(),
  for_account_id: z.string(),
  status: intakeViewSchema.shape.status,
  channel: z.enum(["voice", "mobile_form"]),
  payload: z.preprocess(json, draftPayloadSchema),
  base_versions: z.preprocess(json, z.record(z.string(), z.number())),
  created_at: z.string(),
});
export type DraftRow = z.infer<typeof draftRowSchema>;
export async function requireDraft(
  tx: Transaction,
  id: string,
  lock = false,
): Promise<DraftRow> {
  const row = (
    await tx.execute(
      `select * from ai.drafted_action where company_id = :company and id = :id and command_type = 'ticket.report' ${lock ? "for update" : ""}`,
      [uuid("company", tx.scope.companyId), uuid("id", id)],
    )
  ).rows[0];
  if (row?.for_account_id !== tx.accountId)
    throw new Denied("drafted_action", id);
  return draftRowSchema.parse(row);
}
export async function intakeView(
  tx: Transaction,
  row: DraftRow,
): Promise<IntakeView> {
  const media = (
    await tx.execute(
      "select * from maint.media where company_id = :company and drafted_action_id = :id order by created_at, id",
      [uuid("company", tx.scope.companyId), uuid("id", row.id)],
    )
  ).rows.map((item) => mediaView(mediaRowSchema.parse(item)));
  const ticket = (
    await tx.execute(
      "select ticket_id from maint.ticket_intake where company_id = :company and drafted_action_id = :id",
      [uuid("company", tx.scope.companyId), uuid("id", row.id)],
    )
  ).rows[0];
  return intakeViewSchema.parse({
    ...row.payload,
    id: row.id,
    version: row.version,
    status: row.status,
    transcription: { mode: row.payload.transcriptionMode },
    triage: {
      mode: row.payload.triageMode,
      confidence: row.payload.confidence,
    },
    media,
    ticketId: ticket?.ticket_id ?? null,
    createdAt: toIso(row.created_at),
  });
}
export async function changeDraftStatus(
  tx: Transaction,
  row: DraftRow,
  status: "committed" | "rejected" | "expired",
): Promise<DraftRow> {
  return draftRowSchema.parse(
    (
      await tx.execute(
        "update ai.drafted_action set status = :status where company_id = :company and id = :id returning *",
        [
          parameter("status", status),
          uuid("company", tx.scope.companyId),
          uuid("id", row.id),
        ],
      )
    ).rows[0],
  );
}
