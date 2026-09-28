import { z } from "zod";
import type { Row } from "../documents/database";
import type { RequestContext } from "../documents/context";
import { appendAuditEvent, type AuditSubject } from "../documents/audit";
import { rows, one, str, num, nullable } from "../documents/sql";
import { Problem } from "../documents/problem";
import type { Outcome } from "../documents/http";
import { versionDetail, reviewModelMetadata } from "../documents/read";
import { catalogue, identityDigits, validateField } from "../extraction/fields";
import { loadTenant, tenantDetail } from "./read";

export const saveSchema = z.strictObject({
  documentVersionId: z.uuid(),
  expectedTenantVersion: z.number().int().positive(),
});
interface ReviewedIdentity {
  readonly nameEn: string;
  readonly nameAr: string | null;
  readonly eid: string;
  readonly issueDate: string | null;
  readonly expiryDate: string | null;
  readonly provenance: Record<string, string>;
}
function reviewedIdentity(decisions: readonly Row[]): ReviewedIdentity {
  const missing = catalogue
    .filter(({ name }) => !decisions.some((row) => row.field_name === name))
    .map(({ name }) => name);
  if (missing.length)
    throw new Problem(422, "REVIEW_INCOMPLETE", { fields: missing });
  const byName = new Map(decisions.map((row) => [str(row, "field_name"), row]));
  const value = (name: string): string | null => {
    const row = byName.get(name);
    return row ? nullable(row, "value") : null;
  };
  const nameEn = value("name_en");
  if (!nameEn) throw new Problem(422, "FIELD_REQUIRED", { field: "name_en" });
  validateField("name_en", nameEn);
  const eid = identityDigits(value("id_number") ?? "");
  if (eid.length !== 15)
    throw new Problem(422, "FIELD_INVALID", { field: "id_number" });
  const nameAr = value("name_ar");
  if (nameAr !== null) validateField("name_ar", nameAr);
  const issueDate = value("issue_date");
  const expiryDate = value("expiry_date");
  if (issueDate !== null) validateField("issue_date", issueDate);
  if (expiryDate !== null) validateField("expiry_date", expiryDate);
  return {
    nameEn,
    nameAr,
    eid,
    issueDate,
    expiryDate,
    provenance: Object.fromEntries(
      decisions.map((row) => [str(row, "field_name"), str(row, "provenance")]),
    ),
  };
}
async function supersede(
  ctx: RequestContext,
  current: string | null,
  versionId: string,
): Promise<AuditSubject[]> {
  if (!current || current === versionId) return [];
  const row = (
    await rows(
      ctx.tx,
      `update doc.document_version set review_status='superseded' where company_id=cast(:company as uuid) and id=cast(:id as uuid) and review_status='accepted' returning version`,
      { company: ctx.companyId, id: current },
    )
  )[0];
  if (!row) return [];
  await appendAuditEvent(ctx.tx, {
    companyId: ctx.companyId,
    accountId: ctx.accountId,
    type: "document_version.superseded",
    subjectType: "document_version",
    subjectId: current,
  });
  return [
    { type: "document_version", id: current, version: num(row, "version") },
  ];
}
export async function saveIdentity(
  ctx: RequestContext,
  body: z.infer<typeof saveSchema>,
): Promise<Outcome> {
  const tenant = await loadTenant(
    ctx,
    ctx.params.tenantId ?? "",
    "write",
    true,
  );
  if (num(tenant, "version") !== body.expectedTenantVersion)
    throw new Problem(409, "STALE_VERSION");
  const row = (
    await rows(
      ctx.tx,
      `select v.*,d.current_version_id from doc.document_version v join doc.document d on d.company_id=v.company_id and d.id=v.document_id
    where v.company_id=cast(:company as uuid) and v.id=cast(:version as uuid) and d.subject_type='tenant' and d.subject_id=cast(:tenant as uuid) and d.doc_type='emirates_id' for update of v,d`,
      {
        company: ctx.companyId,
        version: body.documentVersionId,
        tenant: str(tenant, "id"),
      },
    )
  )[0];
  if (!row) throw new Problem(404, "NOT_FOUND");
  if (
    row.review_status !== "pending_review" ||
    !["extracted", "extraction_failed"].includes(str(row, "processing_status"))
  )
    throw new Problem(409, "INVALID_STATE");
  const decisions = await rows(
    ctx.tx,
    `select * from doc.field_review where company_id=cast(:company as uuid) and document_version_id=cast(:version as uuid) order by field_name for update`,
    { company: ctx.companyId, version: body.documentVersionId },
  );
  const identity = reviewedIdentity(decisions);
  const extra = await supersede(
    ctx,
    nullable(row, "current_version_id"),
    body.documentVersionId,
  );
  const updated = await one(
    ctx.tx,
    `update party.tenant set full_name_en=:en,full_name_ar=:ar,eid_number=:eid where company_id=cast(:company as uuid) and id=cast(:id as uuid) returning *`,
    {
      company: ctx.companyId,
      id: str(tenant, "id"),
      en: identity.nameEn,
      ar: identity.nameAr,
      eid: identity.eid,
    },
  );
  const accepted = await one(
    ctx.tx,
    `update doc.document_version set review_status='accepted',issue_date=cast(:issue as date),expiry_date=cast(:expiry as date),reject_reason=null
    where company_id=cast(:company as uuid) and id=cast(:id as uuid) returning version`,
    {
      company: ctx.companyId,
      id: body.documentVersionId,
      issue: identity.issueDate,
      expiry: identity.expiryDate,
    },
  );
  const document = await one(
    ctx.tx,
    `update doc.document set current_version_id=cast(:version as uuid) where company_id=cast(:company as uuid) and id=cast(:id as uuid) returning version`,
    {
      company: ctx.companyId,
      id: str(row, "document_id"),
      version: body.documentVersionId,
    },
  );
  // I obtain attribution from the model call; every identity value comes from reviewed rows.
  const metadata = await reviewModelMetadata(ctx, body.documentVersionId);
  await appendAuditEvent(
    ctx.tx,
    {
      companyId: ctx.companyId,
      accountId: ctx.accountId,
      type: "document_version.accepted",
      subjectType: "document_version",
      subjectId: body.documentVersionId,
      versionBefore: num(row, "version"),
      versionAfter: num(accepted, "version"),
      fieldProvenance: identity.provenance,
      ...metadata,
    },
    [
      {
        type: "document",
        id: str(row, "document_id"),
        version: num(document, "version"),
      },
      ...extra,
    ],
  );
  const savedProvenance = Object.fromEntries(
    ["name_en", "name_ar", "id_number"].map((name) => [
      name,
      identity.provenance[name] ?? "human_entered",
    ]),
  );
  await appendAuditEvent(ctx.tx, {
    companyId: ctx.companyId,
    accountId: ctx.accountId,
    type: "tenant.updated",
    subjectType: "tenant",
    subjectId: str(tenant, "id"),
    versionBefore: num(tenant, "version"),
    versionAfter: num(updated, "version"),
    changedFields: ["full_name_en", "full_name_ar", "eid_number"],
    fieldProvenance: savedProvenance,
    ...metadata,
  });
  return {
    status: 200,
    body: {
      tenant: await tenantDetail(ctx, updated),
      version: await versionDetail(ctx, body.documentVersionId),
    },
  };
}
