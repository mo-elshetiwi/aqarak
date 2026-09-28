import { z } from "zod";
import type { CommandContext } from "../audit/kernel";
import { extractionEnvelope, type ExtractionInput } from "./extraction";
import { expected } from "./schemas";
import { execute } from "./storage";
import { IntakeRefusal } from "./retroactive-schemas";
import {
  draftDocument,
  intakeEvent,
  requireDraftVersion,
  type IntakeDraft,
} from "./retroactive-repository";
export const intakeExtractionEnvelope = extractionEnvelope.extend({
  draftId: z.uuid(),
  expectedVersion: z.number().int().positive(),
});
export async function prepareIntakeExtraction(
  ctx: CommandContext,
  draft: IntakeDraft,
  raw: unknown,
): Promise<ExtractionInput> {
  requireDraftVersion(draft, expected.parse(raw).expectedVersion);
  const document = await draftDocument(ctx, draft);
  if (
    !document?.s3_version_id ||
    !["scan_clean", "extracted", "extraction_failed"].includes(
      document.processing_status,
    )
  )
    throw new IntakeRefusal(
      "RETROACTIVE_EVIDENCE_MISSING",
      draft.id,
      "registered_document",
    );
  await execute(
    ctx.tx,
    "update ai.drafted_action set status='drafting',payload=:payload::jsonb,extraction_id=null where company_id=:company::uuid and id=:draft::uuid",
    {
      company: ctx.companyId,
      draft: draft.id,
      payload: JSON.stringify({
        documentVersionId: document.id,
        extractionTraceId: ctx.traceId,
      }),
    },
  );
  await intakeEvent(ctx, draft.id, "tawtheeq.extraction_requested", {
    before: draft.version,
    after: draft.version + 1,
  });
  return {
    companyId: ctx.companyId,
    accountId: ctx.actor.account_id,
    idempotencyKey: ctx.idempotencyKey,
    traceId: ctx.traceId,
    document,
    basis: {},
    commandType: "tawtheeq.retroactive_extraction",
  };
}
export async function applyIntakeExtraction(
  ctx: CommandContext,
  draft: IntakeDraft,
  result: z.infer<typeof intakeExtractionEnvelope>,
): Promise<void> {
  requireDraftVersion(draft, result.expectedVersion);
  if (
    draft.payload.documentVersionId !== result.documentVersionId ||
    draft.payload.extractionTraceId !== result.traceId
  )
    throw new IntakeRefusal(
      "RETROACTIVE_EVIDENCE_MISSING",
      draft.id,
      "registered_document",
    );
  const proposal = { ...result.response.fields };
  // I expose the extracted annual amount as a proposal for the required total, subject to explicit confirmation.
  if (!proposal.total_fils && proposal.annual_rent_fils)
    proposal.total_fils = proposal.annual_rent_fils;
  await execute(
    ctx.tx,
    "update ai.drafted_action set status='ready',payload=:payload::jsonb,extraction_id=:extraction::uuid where company_id=:company::uuid and id=:draft::uuid",
    {
      company: ctx.companyId,
      draft: draft.id,
      extraction: result.response.extractionId,
      payload: JSON.stringify({
        ...draft.payload,
        proposal,
        extractionStatus: result.response.status,
        degradedMode: result.response.degradedMode,
      }),
    },
  );
  await intakeEvent(ctx, draft.id, "drafted_action.ready", {
    before: draft.version,
    after: draft.version + 1,
  });
}
