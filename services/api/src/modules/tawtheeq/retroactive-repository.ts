import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  expectVersion,
  Refusal,
  coverTransactionVersions,
  writeAuditEvent,
  type CommandContext,
  type QueryContext,
  type CompanyActor,
} from "../audit/kernel";
import { documentSchema } from "./repository";
import { number, jsonValue, rows, one, execute } from "./storage";
import { proposalsSchema } from "./extraction";
import { IntakeRefusal } from "./retroactive-schemas";
const payloadSchema = z
  .object({
    documentVersionId: z.uuid().optional(),
    proposal: proposalsSchema.optional(),
    extractionTraceId: z.string().optional(),
  })
  .catchall(z.json());
export const draftSchema = z.object({
  id: z.uuid(),
  version: number,
  status: z.string(),
  for_account_id: z.guid(),
  extraction_id: z.uuid().nullable(),
  payload: jsonValue.pipe(payloadSchema),
});
export type IntakeDraft = z.infer<typeof draftSchema>;
export function authorizeIntake(actor: CompanyActor): Refusal | null {
  return actor.roles.includes("manager")
    ? null
    : new Refusal("NOT_PERMITTED", null);
}
export async function loadDraft(
  ctx: QueryContext,
  id: string,
): Promise<IntakeDraft> {
  return one(
    ctx.tx,
    "select * from ai.drafted_action where company_id=:company::uuid and id=:id::uuid and for_account_id=:account::uuid and command_type='tawtheeq.retroactive_intake'",
    draftSchema,
    {
      company: ctx.companyId,
      id: z.uuid().parse(id),
      account: ctx.actor.account_id,
    },
  );
}
export function requireDraftVersion(draft: IntakeDraft, version: number): void {
  expectVersion(draft.version, version, {
    type: "drafted_action",
    id: draft.id,
  });
  if (!["drafting", "ready"].includes(draft.status))
    throw new IntakeRefusal("INVALID_TRANSITION", draft.id);
}
export async function draftDocument(
  ctx: QueryContext,
  draft: IntakeDraft,
  id = draft.payload.documentVersionId,
): Promise<z.infer<typeof documentSchema> | null> {
  if (!id) return null;
  return one(
    ctx.tx,
    "select v.* from doc.document_version v join doc.document d on d.company_id=v.company_id and d.id=v.document_id where v.company_id=:company::uuid and v.id=:id::uuid and d.subject_type='drafted_action' and d.subject_id=:draft::uuid and d.doc_type='tawtheeq'",
    documentSchema,
    { company: ctx.companyId, id, draft: draft.id },
  );
}
export async function intakeEvent(
  ctx: CommandContext,
  draftId: string,
  eventType: string,
  versions: { before: number | null; after: number | null },
): Promise<void> {
  const event = await writeAuditEvent(ctx.tx, ctx.companyId, {
    eventType,
    actorAccountId: ctx.actor.account_id,
    actorRole: "manager",
    initiator: "person",
    channel: ctx.channel,
    subjectType: "drafted_action",
    subjectId: draftId,
    versionBefore: versions.before,
    versionAfter: versions.after,
    draftedActionId: draftId,
    traceId: ctx.traceId,
    idempotencyKey: ctx.idempotencyKey,
  });
  await coverTransactionVersions(ctx.tx, ctx.companyId, event.eventId);
}
export async function createIntake(
  ctx: CommandContext,
  body: unknown,
): Promise<{ draftId: string; version: number }> {
  z.strictObject({}).parse(body);
  const draftId = randomUUID();
  await execute(
    ctx.tx,
    "insert into ai.drafted_action(id,company_id,for_account_id,initiator,channel,command_type,payload,status) values (:id::uuid,:company::uuid,:account::uuid,'person',:channel,'tawtheeq.retroactive_intake','{}','drafting')",
    {
      id: draftId,
      company: ctx.companyId,
      account: ctx.actor.account_id,
      channel: ctx.channel,
    },
  );
  await intakeEvent(ctx, draftId, "drafted_action.created", {
    before: null,
    after: 1,
  });
  return { draftId, version: 1 };
}
const candidate = z.object({
  id: z.uuid(),
  nameEn: z.string().nullable(),
  nameAr: z.string().nullable(),
});
export async function intakeView(
  ctx: QueryContext,
  draft: IntakeDraft,
): Promise<Record<string, unknown>> {
  const proposal = draft.payload.proposal ?? {};
  const p = { company: ctx.companyId };
  const units = await rows(
    ctx.tx,
    'select id,unit_no as "unitNo",unt_number as "untNumber" from estate.unit where company_id=:company::uuid and unt_number=:value order by id',
    z.object({ id: z.uuid(), unitNo: z.string(), untNumber: z.string() }),
    { ...p, value: proposal.unt_number?.value ?? null },
  );
  const owners = await rows(
    ctx.tx,
    'select id,full_name_en as "nameEn",full_name_ar as "nameAr" from party.owner where company_id=:company::uuid and eid_number=:value order by id',
    candidate,
    { ...p, value: proposal.owner_id_number?.value ?? null },
  );
  const tenants = await rows(
    ctx.tx,
    'select id,full_name_en as "nameEn",full_name_ar as "nameAr" from party.tenant where company_id=:company::uuid and eid_number=:value order by id',
    candidate,
    { ...p, value: proposal.tenant_id_number?.value ?? null },
  );
  const document = await draftDocument(ctx, draft);
  return {
    draftId: draft.id,
    version: draft.version,
    status: draft.status,
    proposal,
    extractionId: draft.extraction_id,
    document: document
      ? {
          documentVersionId: document.id,
          processingStatus: document.processing_status,
          reviewStatus: document.review_status,
          contentType: document.content_type,
          byteSize: document.byte_size,
        }
      : null,
    candidates: { units, owners, tenants },
    missing: [
      ...(!units.length ? ["unit"] : []),
      ...(!owners.length ? ["owner"] : []),
      ...(!tenants.length ? ["tenant"] : []),
    ],
  };
}
