import { z } from "zod";
import { mediaViewSchema, type MediaView } from "../maintenance/contract";
import {
  ownUnitSql,
  ownTicketSql,
  parameter,
  uuid,
  type Access,
  type Transaction,
} from "../maintenance/access";
import { Denied } from "../maintenance/problem";

export const mediaRowSchema = z.object({
  id: z.string(),
  unit_id: z.string(),
  kind: z.enum(["photo", "voice_note"]),
  content_type: z.string(),
  byte_size: z.coerce.number(),
  sha256: z.string(),
  duration_ms: z.coerce.number().nullable(),
  processing_status: mediaViewSchema.shape.status,
  version: z.coerce.number(),
  created_at: z.string(),
  uploaded_by_account_id: z.string(),
  bucket: z.string(),
  s3_key: z.string(),
  s3_version_id: z.string().nullable(),
  ticket_id: z.string().nullable(),
  drafted_action_id: z.string().nullable().default(null),
});
export type MediaRow = z.infer<typeof mediaRowSchema>;
export function mediaView(row: MediaRow): MediaView {
  return mediaViewSchema.parse({
    id: row.id,
    unitId: row.unit_id,
    kind: row.kind,
    contentType: row.content_type,
    byteSize: row.byte_size,
    sha256: row.sha256,
    durationMs: row.duration_ms,
    status: row.processing_status,
    version: row.version,
    createdAt: toIso(row.created_at),
  });
}
export function toIso(value: string): string {
  return new Date(
    /[Zz]|[+-]\d\d(?::?\d\d)?$/u.test(value)
      ? value
      : `${value.replace(" ", "T")}Z`,
  ).toISOString();
}
export async function requireMedia(
  tx: Transaction,
  access: Access,
  input: { id: string; completion: boolean; lock?: boolean },
): Promise<MediaRow> {
  const row = (
    await tx.execute(
      `select * from maint.media where company_id = :company and id = :id ${input.lock ? "for update" : ""}`,
      [uuid("company", tx.scope.companyId), uuid("id", input.id)],
    )
  ).rows[0];
  if (!row) throw new Denied("media", input.id);
  const media = mediaRowSchema.parse(row);
  if (input.completion) {
    if (media.uploaded_by_account_id !== tx.accountId)
      throw new Denied("media", input.id);
    if (!access.manager) {
      const units = await tx.execute(
        `select :unit::uuid in (${ownUnitSql}) as allowed`,
        [
          uuid("unit", media.unit_id),
          uuid("company", tx.scope.companyId),
          uuid("account", tx.accountId),
        ],
      );
      if (units.rows[0]?.allowed !== true) throw new Denied("media", input.id);
    }
  } else if (
    !access.manager &&
    (media.ticket_id !== null || media.uploaded_by_account_id !== tx.accountId)
  ) {
    const ticket = await tx.execute(
      `select t.id from maint.ticket t where t.company_id = :company and t.id = :ticket and (${ownTicketSql})`,
      [
        uuid("company", tx.scope.companyId),
        parameter("ticket", media.ticket_id, "UUID"),
        uuid("account", tx.accountId),
      ],
    );
    if (!ticket.rows.length) throw new Denied("media", input.id);
  }
  return media;
}
