import type { Row } from "./database";
import type { RequestContext } from "./context";
import { authorize } from "./context";
import { rows, str, num, nullable, jsonValue, instant } from "./sql";
import { Problem } from "./problem";
import {
  presentedFields,
  storedFieldsSchema,
  type ExtractedField,
} from "../extraction/fields";

export interface FieldDecision {
  readonly fieldName: string;
  readonly decision: string;
  readonly value: string | null;
  readonly sourceViewed: boolean;
  readonly provenance: string;
  readonly version: number;
  readonly decidedBy: string;
  readonly decidedAt: string;
}
export interface VersionDetail {
  readonly id: string;
  readonly documentId: string;
  readonly docType: string;
  readonly versionNo: number;
  readonly fileName: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly processingStatus: string;
  readonly reviewStatus: string;
  readonly rejectReason: string | null;
  readonly uploadedAt: string | null;
  readonly fields: ExtractedField[] | null;
  readonly decisions: FieldDecision[];
  readonly modelCall: {
    readonly id: string;
    readonly registryEntry: string;
    readonly promptVersion: string;
    readonly status: string;
    readonly latencyMs: number;
    readonly createdAt: string;
  } | null;
}
export async function loadVersion(
  ctx: RequestContext,
  operation: "read" | "write" = "read",
  companyScope = false,
): Promise<Row> {
  const row = (
    await rows(
      ctx.tx,
      `select v.*,d.doc_type,d.subject_id,d.current_version_id from doc.document_version v
    join doc.document d on d.company_id=v.company_id and d.id=v.document_id
    join party.tenant t on t.company_id=d.company_id and t.id=d.subject_id and t.kind='individual'
    where v.company_id=cast(:company as uuid) and v.id=cast(:version as uuid) and d.id=cast(:document as uuid) and d.subject_type='tenant' for update of v,d`,
      {
        company: ctx.companyId,
        version: ctx.params.versionId ?? "",
        document: ctx.params.documentId ?? "",
      },
    )
  )[0];
  if (!row) throw new Problem(404, "NOT_FOUND");
  authorize(ctx, {
    operation,
    capability: "identity_documents",
    tenant: str(row, "subject_id"),
    companyScope,
  });
  return row;
}
export function fieldDecision(row: Row): FieldDecision {
  return {
    fieldName: str(row, "field_name"),
    decision: str(row, "decision"),
    value: nullable(row, "value"),
    sourceViewed: row.source_viewed === true,
    provenance: str(row, "provenance"),
    version: num(row, "version"),
    decidedBy: str(row, row.updated_by ? "updated_by" : "created_by"),
    decidedAt: instant(row.updated_at ?? row.created_at),
  };
}
export async function latestExtraction(
  ctx: Pick<RequestContext, "tx" | "companyId">,
  versionId: string,
): Promise<Row | null> {
  return (
    (
      await rows(
        ctx.tx,
        `select e.*,m.registry_entry,m.prompt_version from ai.extraction e
    join ai.model_call m on m.company_id=e.company_id and m.id=e.model_call_id
    where e.company_id=cast(:company as uuid) and e.document_version_id=cast(:version as uuid) order by e.created_at desc,e.id desc limit 1`,
        { company: ctx.companyId, version: versionId },
      )
    )[0] ?? null
  );
}
export async function versionDetail(
  ctx: Pick<RequestContext, "tx" | "companyId">,
  versionId: string,
): Promise<VersionDetail> {
  const row = (
    await rows(
      ctx.tx,
      `select v.*,d.doc_type from doc.document_version v join doc.document d on d.company_id=v.company_id and d.id=v.document_id
    where v.company_id=cast(:company as uuid) and v.id=cast(:version as uuid)`,
      { company: ctx.companyId, version: versionId },
    )
  )[0];
  if (!row) throw new Problem(404, "NOT_FOUND");
  const extraction = await latestExtraction(ctx, versionId);
  const decisions = await rows(
    ctx.tx,
    `select * from doc.field_review where company_id=cast(:company as uuid) and document_version_id=cast(:version as uuid) order by field_name`,
    { company: ctx.companyId, version: versionId },
  );
  const call = (
    await rows(
      ctx.tx,
      `select m.* from ai.model_call m where m.company_id=cast(:company as uuid)
    and m.output_key like :receipt order by m.created_at desc,m.id desc limit 1`,
      {
        company: ctx.companyId,
        receipt: `${str(row, "s3_key").replace(/original$/, "")}receipts/%`,
      },
    )
  )[0];
  return {
    id: versionId,
    documentId: str(row, "document_id"),
    docType: str(row, "doc_type"),
    versionNo: num(row, "version_no"),
    fileName: str(row, "file_name"),
    contentType: str(row, "content_type"),
    byteSize: num(row, "byte_size"),
    processingStatus: str(row, "processing_status"),
    reviewStatus: str(row, "review_status"),
    rejectReason: nullable(row, "reject_reason"),
    uploadedAt: row.uploaded_at ? instant(row.uploaded_at) : null,
    fields: extraction
      ? presentedFields(storedFieldsSchema.parse(jsonValue(extraction.fields)))
      : null,
    decisions: decisions.map(fieldDecision),
    modelCall: call
      ? {
          id: str(call, "id"),
          registryEntry: str(call, "registry_entry"),
          promptVersion: str(call, "prompt_version"),
          status: str(call, "status"),
          latencyMs: num(call, "latency_ms"),
          createdAt: instant(call.created_at),
        }
      : null,
  };
}
export function modelMetadata(extraction: Row | null): {
  modelCallIds: string[];
  registryEntry: string | null;
  promptVersion: string | null;
} {
  return {
    modelCallIds: extraction ? [str(extraction, "model_call_id")] : [],
    registryEntry: extraction ? str(extraction, "registry_entry") : null,
    promptVersion: extraction ? str(extraction, "prompt_version") : null,
  };
}

export async function reviewModelMetadata(
  ctx: Pick<RequestContext, "tx" | "companyId">,
  versionId: string,
): Promise<ReturnType<typeof modelMetadata>> {
  const call = (
    await rows(
      ctx.tx,
      `select m.id as model_call_id,m.registry_entry,m.prompt_version
    from ai.model_call m join doc.document_version v on v.company_id=m.company_id
    where v.company_id=cast(:company as uuid) and v.id=cast(:version as uuid)
      and left(m.output_key,length(regexp_replace(v.s3_key,'original$','') || 'receipts/')) = regexp_replace(v.s3_key,'original$','') || 'receipts/'
    order by m.created_at desc,m.id desc limit 1`,
      { company: ctx.companyId, version: versionId },
    )
  )[0];
  return modelMetadata(call ?? null);
}
