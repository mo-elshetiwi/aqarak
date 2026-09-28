import type { Row } from "../documents/database";
import type { RequestContext } from "../documents/context";
import { authorize } from "../documents/context";
import { rows, str, num, nullable, instant } from "../documents/sql";
import { Problem } from "../documents/problem";

export interface ChecklistItem {
  readonly docType: string;
  readonly required: boolean;
  readonly status: string;
  readonly documentId: string | null;
  readonly currentVersionId: string | null;
  readonly latestVersionId: string | null;
}
export interface TenantSummary {
  readonly id: string;
  readonly version: number;
  readonly kind: string;
  readonly fullNameEn: string;
  readonly fullNameAr: string | null;
  readonly email: string;
  readonly preferredLanguage: string;
  readonly eidMasked: string | null;
  readonly linkedAccount: boolean;
  readonly identityStatus: string;
  readonly missingRequired: string[];
  readonly invitation: {
    readonly id: string;
    readonly status: string;
    readonly expiresAt: string;
  } | null;
}
export interface TenantDetail extends TenantSummary {
  readonly phoneE164: string | null;
  readonly eidNumber: string | null;
  readonly checklist: ChecklistItem[];
}
export async function loadTenant(
  ctx: RequestContext,
  id: string,
  operation: "read" | "write",
  companyScope = false,
): Promise<Row> {
  const row = (
    await rows(
      ctx.tx,
      `select * from party.tenant where company_id=cast(:company as uuid) and id=cast(:id as uuid) and kind='individual' for update`,
      { company: ctx.companyId, id },
    )
  )[0];
  if (!row) throw new Problem(404, "NOT_FOUND");
  authorize(ctx, {
    operation,
    capability: "tenants_occupants",
    tenant: id,
    companyScope,
  });
  return row;
}
export function checklistStatus(row: Row | undefined, today: string): string {
  if (!row?.latest_version_id) return "missing";
  if (
    row.processing_status === "scan_rejected" ||
    row.review_status === "rejected"
  )
    return "rejected";
  if (row.review_status === "accepted")
    return row.expiry_date && str(row, "expiry_date").slice(0, 10) < today
      ? "expired"
      : "accepted";
  if (
    ["extracted", "extraction_failed"].includes(
      str(row, "processing_status"),
    ) &&
    row.review_status === "pending_review"
  )
    return "pending_review";
  return "processing";
}
export function dubaiDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export async function tenantDetail(
  ctx: RequestContext,
  row: Row,
): Promise<TenantDetail> {
  const id = str(row, "id");
  const documents = await rows(
    ctx.tx,
    `select d.id,d.doc_type,d.current_version_id,v.id as latest_version_id,v.processing_status,v.review_status,v.expiry_date
    from doc.document d left join lateral (select * from doc.document_version v where v.company_id=d.company_id and v.document_id=d.id order by version_no desc limit 1) v on true
    where d.company_id=cast(:company as uuid) and d.subject_type='tenant' and d.subject_id=cast(:id as uuid)`,
    { company: ctx.companyId, id },
  );
  const today = dubaiDate(ctx.deps.now());
  const checklist = ["emirates_id", "passport"].map(
    (docType): ChecklistItem => {
      const doc = documents.find((r) => r.doc_type === docType);
      return {
        docType,
        required: docType === "emirates_id",
        status: checklistStatus(doc, today),
        documentId: doc ? str(doc, "id") : null,
        currentVersionId: doc ? nullable(doc, "current_version_id") : null,
        latestVersionId: doc ? nullable(doc, "latest_version_id") : null,
      };
    },
  );
  const required = checklist.filter((item) => item.required);
  const invitation = (
    await rows(
      ctx.tx,
      `select id,status,expires_at from core.invitation where company_id=cast(:company as uuid) and kind='tenant' and target_id=cast(:id as uuid) order by created_at desc,id desc limit 1`,
      { company: ctx.companyId, id },
    )
  )[0];
  const eid = nullable(row, "eid_number");
  return {
    id,
    version: num(row, "version"),
    kind: str(row, "kind"),
    fullNameEn: str(row, "full_name_en"),
    fullNameAr: nullable(row, "full_name_ar"),
    email: str(row, "email"),
    preferredLanguage: str(row, "preferred_language"),
    eidMasked: eid ? `${eid.slice(0, 3)}-****-*******-${eid.slice(-1)}` : null,
    linkedAccount: row.linked_account_id != null,
    identityStatus: required.every((item) => item.status === "accepted")
      ? "verified"
      : required.some((item) => item.status === "pending_review")
        ? "pending_review"
        : "missing",
    missingRequired: required
      .filter((item) => item.status !== "accepted")
      .map((item) => item.docType),
    invitation: invitation
      ? {
          id: str(invitation, "id"),
          status: str(invitation, "status"),
          expiresAt: instant(invitation.expires_at),
        }
      : null,
    phoneE164: nullable(row, "phone_e164"),
    eidNumber: ctx.actor.roles.includes("manager") ? eid : null,
    checklist,
  };
}
export function tenantSummary(detail: TenantDetail): TenantSummary {
  return {
    id: detail.id,
    version: detail.version,
    kind: detail.kind,
    fullNameEn: detail.fullNameEn,
    fullNameAr: detail.fullNameAr,
    email: detail.email,
    preferredLanguage: detail.preferredLanguage,
    eidMasked: detail.eidMasked,
    linkedAccount: detail.linkedAccount,
    identityStatus: detail.identityStatus,
    missingRequired: detail.missingRequired,
    invitation: detail.invitation,
  };
}
