import type { CompanyTransaction } from "./db.mjs";
import type { Row } from "@aqarak/db/data-api";
import {
  deriveDocumentValidity,
  localDate,
  documentType,
  documentReviewStatus,
  missingOnboardingDocuments,
} from "./domain";
import type { z } from "zod";
import {
  documentItemSchema,
  versionItemSchema,
  historySchema,
} from "./schemas";
import { today } from "./gate";
import {
  rows,
  uuid,
  param,
  text,
  number,
  nullableText,
  utcTimestamp,
} from "./sql";
export function versionItem(row: Row): z.infer<typeof versionItemSchema> {
  const expiryDate = nullableText(row, "expiry_date");
  return {
    versionId: text(row, "id"),
    version: number(row, "version"),
    versionNo: number(row, "version_no"),
    processingStatus: text(row, "processing_status"),
    reviewStatus: text(row, "review_status"),
    scanResult: nullableText(row, "scan_result"),
    issueDate: nullableText(row, "issue_date"),
    expiryDate,
    validity: deriveDocumentValidity({
      expiryDate: expiryDate ? localDate.parse(expiryDate) : null,
      leadDays: 60,
      on: today(),
    }),
    rejectReason: nullableText(row, "reject_reason"),
  };
}
export async function documents(
  tx: CompanyTransaction,
  input: { companyId: string; type: "owner" | "property"; id: string },
): Promise<z.infer<typeof documentItemSchema>[]> {
  const docs = await rows(
    tx,
    "select id, doc_type, current_version_id from doc.document where company_id=:c and subject_type=:type and subject_id=:id order by doc_type,id",
    [
      uuid("c", input.companyId),
      uuid("id", input.id),
      param("type", input.type),
    ],
  );
  const result: z.infer<typeof documentItemSchema>[] = [];
  for (const doc of docs) {
    const versions = await rows(
      tx,
      "select * from doc.document_version where company_id=:c and document_id=:d order by version_no desc",
      [uuid("c", input.companyId), uuid("d", text(doc, "id"))],
    );
    const current = versions.find((v) => v.id === doc.current_version_id);
    result.push({
      documentId: text(doc, "id"),
      docType: text(doc, "doc_type"),
      current: current ? versionItem(current) : null,
      latest: versions[0] ? versionItem(versions[0]) : null,
    });
  }
  return result;
}
export function ownerOnboarding(
  docs: z.infer<typeof documentItemSchema>[],
  pendingInvitation: boolean,
): {
  status: "verified" | "pending_review" | "invited" | "incomplete";
  missing: string[];
} {
  const missing = missingOnboardingDocuments(
    "owner",
    docs.flatMap((doc) =>
      doc.current
        ? [
            {
              documentType: documentType.parse(doc.docType),
              review_status: documentReviewStatus.parse(
                doc.current.reviewStatus,
              ),
              expiryDate: doc.current.expiryDate
                ? localDate.parse(doc.current.expiryDate)
                : null,
            },
          ]
        : [],
    ),
    today(),
  );
  const pending = docs.some(
    (doc) =>
      missing.some((types) =>
        types.includes(documentType.parse(doc.docType)),
      ) && doc.latest?.reviewStatus === "pending_review",
  );
  return {
    status: !missing.length
      ? "verified"
      : pending
        ? "pending_review"
        : pendingInvitation
          ? "invited"
          : "incomplete",
    missing: missing.map((types) => types.join("|")),
  };
}
export async function history(
  tx: CompanyTransaction,
  input: { companyId: string; type: "owner" | "property"; id: string },
): Promise<z.infer<typeof historySchema>> {
  const result = await rows(
    tx,
    `select e.event_type,e.occurred_at,e.actor_role,e.channel,e.reason,a.display_name from audit.audit_event e left join core.person_account a on a.id=e.actor_account_id where e.company_id=:c and ((e.subject_type=:type and e.subject_id=:id) or (e.subject_type='owner_mandate' and e.subject_id in (select id from estate.owner_mandate where company_id=:c and owner_id=:id) and :type='owner') or (e.subject_type='document' and e.subject_id in (select id from doc.document where company_id=:c and subject_type=:type and subject_id=:id)) or (e.subject_type='document_version' and e.subject_id in (select v.id from doc.document_version v join doc.document d on d.company_id=v.company_id and d.id=v.document_id where d.company_id=:c and d.subject_type=:type and d.subject_id=:id))) order by e.seq desc limit 10`,
    [
      uuid("c", input.companyId),
      uuid("id", input.id),
      param("type", input.type),
    ],
  );
  return result.map((row) => ({
    eventType: text(row, "event_type"),
    occurredAt: utcTimestamp(text(row, "occurred_at")),
    actorDisplayName: nullableText(row, "display_name"),
    actorRole: nullableText(row, "actor_role"),
    channel: text(row, "channel"),
    reason: nullableText(row, "reason"),
  }));
}
