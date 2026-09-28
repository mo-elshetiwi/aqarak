import type { CommandContext } from "../audit/kernel";
import type { TawtheeqDependencies } from "./dependencies";
import { initiateDocumentUpload, inspectUploadedDocument } from "./uploads";
import { execute } from "./storage";
import { expected } from "./schemas";
import { IntakeRefusal, retroactiveUploadBody } from "./retroactive-schemas";
import {
  draftDocument,
  intakeEvent,
  requireDraftVersion,
  type IntakeDraft,
} from "./retroactive-repository";
export async function uploadIntake(
  ctx: CommandContext,
  deps: TawtheeqDependencies,
  draft: IntakeDraft,
  raw: unknown,
): Promise<unknown> {
  const input = retroactiveUploadBody.parse(raw);
  requireDraftVersion(draft, input.expectedVersion);
  const result = await initiateDocumentUpload(
    ctx,
    deps,
    { subjectType: "drafted_action", subjectId: draft.id, storageId: draft.id },
    input,
  );
  await execute(
    ctx.tx,
    "update ai.drafted_action set status='drafting',payload=:payload::jsonb,extraction_id=null,field_provenance='{}' where company_id=:company::uuid and id=:draft::uuid",
    {
      company: ctx.companyId,
      draft: draft.id,
      payload: JSON.stringify({ documentVersionId: result.documentVersionId }),
    },
  );
  await intakeEvent(ctx, draft.id, "document.upload_requested", {
    before: draft.version,
    after: draft.version + 1,
  });
  return { ...result, draftId: draft.id, version: draft.version + 1 };
}
export async function completeIntakeUpload(
  ctx: CommandContext,
  deps: TawtheeqDependencies,
  draft: IntakeDraft,
  input: { body: unknown; documentVersionId: string },
): Promise<void> {
  requireDraftVersion(draft, expected.parse(input.body).expectedVersion);
  if (draft.payload.documentVersionId !== input.documentVersionId)
    throw new IntakeRefusal(
      "RETROACTIVE_EVIDENCE_MISSING",
      draft.id,
      "registered_document",
    );
  const document = await draftDocument(ctx, draft, input.documentVersionId);
  if (!document)
    throw new IntakeRefusal(
      "RETROACTIVE_EVIDENCE_MISSING",
      draft.id,
      "registered_document",
    );
  if (!["awaiting_upload", "uploaded"].includes(document.processing_status))
    throw new IntakeRefusal("INVALID_TRANSITION", draft.id);
  const result = await inspectUploadedDocument(deps, document);
  if (result.status === "scan_rejected")
    throw new IntakeRefusal("SCAN_REJECTED", draft.id, "registered_document");
  await execute(
    ctx.tx,
    "update doc.document_version set processing_status=:status,s3_version_id=:version,scan_result=:scan where company_id=:company::uuid and id=:document::uuid",
    {
      company: ctx.companyId,
      document: document.id,
      status: result.status,
      version: result.versionId,
      scan: result.scan ?? null,
    },
  );
  await execute(
    ctx.tx,
    "update doc.document set current_version_id=:version::uuid where company_id=:company::uuid and id=:document::uuid",
    {
      company: ctx.companyId,
      version: document.id,
      document: document.document_id,
    },
  );
  await execute(
    ctx.tx,
    "update ai.drafted_action set payload=payload where company_id=:company::uuid and id=:draft::uuid",
    { company: ctx.companyId, draft: draft.id },
  );
  await intakeEvent(ctx, draft.id, "document.scan_completed", {
    before: draft.version,
    after: draft.version + 1,
  });
}
