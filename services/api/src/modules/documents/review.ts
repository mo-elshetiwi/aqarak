import { z } from "zod";
import {
  fieldNameSchema,
  validateField,
  storedFieldsSchema,
  presentedFields,
} from "../extraction/fields";
import type { RequestContext } from "./context";
import {
  loadVersion,
  latestExtraction,
  fieldDecision,
  modelMetadata,
  reviewModelMetadata,
} from "./read";
import { rows, one, str, num, jsonValue } from "./sql";
import { Problem } from "./problem";
import { appendAuditEvent } from "./audit";
import type { Outcome } from "./http";

export const decisionSchema = z.strictObject({
  decision: z.enum(["accepted", "edited", "not_on_document"]),
  value: z.string().max(2000).optional(),
  sourceViewed: z.boolean(),
  expectedVersion: z.number().int().nonnegative().nullable(),
});
function decisionValue(
  body: z.infer<typeof decisionSchema>,
  field: ReturnType<typeof presentedFields>[number] | undefined,
  name: string,
): string | null {
  if (body.decision === "not_on_document") return null;
  if (body.decision === "edited") return validateField(name, body.value);
  if (field?.suggestedValue == null)
    throw new Problem(422, "NOTHING_TO_ACCEPT");
  if (field.requiresSourceCheck && !body.sourceViewed)
    throw new Problem(422, "SOURCE_NOT_VIEWED");
  return field.suggestedValue;
}
function reviewProvenance(
  hasExtraction: boolean,
  decision: string,
  suggestedValue: string | null | undefined,
): string {
  if (!hasExtraction) return "human_entered";
  if (
    decision === "accepted" ||
    (decision === "not_on_document" && suggestedValue === null)
  )
    return "ai_confirmed";
  return "ai_edited";
}
export async function decideField(
  ctx: RequestContext,
  body: z.infer<typeof decisionSchema>,
): Promise<Outcome> {
  const row = await loadVersion(ctx, "write", true);
  if (row.doc_type !== "emirates_id")
    throw new Problem(422, "UNSUPPORTED_FOR_EXTRACTION");
  const name = fieldNameSchema.safeParse(ctx.params.fieldName);
  if (!name.success) throw new Problem(400, "VALIDATION_FAILED");
  if (
    row.review_status !== "pending_review" ||
    !["extracted", "extraction_failed"].includes(str(row, "processing_status"))
  )
    throw new Problem(409, "INVALID_STATE");
  const versionId = str(row, "id");
  const existing = (
    await rows(
      ctx.tx,
      `select * from doc.field_review where company_id=cast(:company as uuid) and document_version_id=cast(:version as uuid) and field_name=:name for update`,
      { company: ctx.companyId, version: versionId, name: name.data },
    )
  )[0];
  if ((existing ? num(existing, "version") : null) !== body.expectedVersion)
    throw new Problem(409, "STALE_VERSION");
  const extraction = await latestExtraction(ctx, versionId);
  const field = extraction
    ? presentedFields(
        storedFieldsSchema.parse(jsonValue(extraction.fields)),
      ).find((f) => f.name === name.data)
    : undefined;
  const value = decisionValue(body, field, name.data);
  const provenance = reviewProvenance(
    extraction !== null,
    body.decision,
    field?.suggestedValue,
  );
  const values = {
    company: ctx.companyId,
    version: versionId,
    name: name.data,
    extraction: extraction ? str(extraction, "id") : null,
    decision: body.decision,
    value,
    viewed: body.sourceViewed,
    provenance,
    account: ctx.accountId,
  };
  const saved = await one(
    ctx.tx,
    existing
      ? `update doc.field_review set extraction_id=cast(:extraction as uuid),decision=:decision,value=:value,source_viewed=:viewed,provenance=:provenance
    where company_id=cast(:company as uuid) and document_version_id=cast(:version as uuid) and field_name=:name returning *`
      : `insert into doc.field_review(company_id,document_version_id,field_name,extraction_id,decision,value,source_viewed,provenance,created_by)
      values(cast(:company as uuid),cast(:version as uuid),:name,cast(:extraction as uuid),:decision,:value,:viewed,:provenance,cast(:account as uuid)) returning *`,
    existing
      ? Object.fromEntries(
          Object.entries(values).filter(([key]) => key !== "account"),
        )
      : values,
  );
  await appendAuditEvent(ctx.tx, {
    companyId: ctx.companyId,
    accountId: ctx.accountId,
    type: existing ? "field_review.updated" : "field_review.created",
    subjectType: "field_review",
    subjectId: str(saved, "id"),
    ...(existing ? { versionBefore: num(existing, "version") } : {}),
    versionAfter: num(saved, "version"),
    fieldProvenance: { [name.data]: provenance },
    ...(extraction
      ? modelMetadata(extraction)
      : await reviewModelMetadata(ctx, versionId)),
  });
  return { status: 200, body: { decision: fieldDecision(saved) } };
}
