import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import { withSystemTx } from "../company-tx.ts";
import type { DataApiExecutor } from "../data-api.ts";
import { assertGate, cover, uuid } from "./fixtures.ts";

export async function checkRoundTrips(
  executor: DataApiExecutor,
  companyId: string,
): Promise<Record<string, unknown>> {
  const id = randomUUID();
  const document = randomUUID();
  const instant = "2026-01-02T03:04:05.123456Z";
  const largeInteger = "9007199254740993";
  const json = {
    policy_version: "sp2",
    result: "allow",
    reasons: ["SP2 spike عقارك", { nested: [true, 7, null] }, "control\u0001"],
  };
  await withSystemTx(executor, { companyId }, async (tx) => {
    const timezone = await tx.execute("show timezone");
    assertGate(
      Object.values(timezone.rows[0] ?? {}).includes("UTC"),
      "Database timezone is not UTC",
    );
    await tx.execute(
      "insert into doc.document(id, company_id, subject_type, subject_id, doc_type, title, sensitivity) values (:id, :company, 'company', :company, 'other', 'SP2 spike type round trips', 'general')",
      [uuid("id", document), uuid("company", companyId)],
    );
    await cover(tx, companyId, "document", document);
    await tx.execute(
      `insert into doc.document_version(id, company_id, document_id, version_no, bucket, s3_key, sha256, byte_size, content_type, issue_date, expiry_date, created_at, uploaded_via)
      values (:id, :company, :document, 7, 'synthetic-round-trip', :key, :hash, cast(:size as bigint), 'text/plain', :issue, :expiry, cast(:instant as timestamptz), 'import')`,
      [
        uuid("id", id),
        uuid("company", companyId),
        uuid("document", document),
        { name: "key", value: `SP2 spike/${id}` },
        { name: "hash", value: "a".repeat(64) },
        { name: "size", value: largeInteger },
        { name: "issue", value: "2026-01-02", typeHint: "DATE" },
        { name: "expiry", value: "2027-01-02", typeHint: "DATE" },
        {
          name: "instant",
          value: "2026-01-02 03:04:05.123456",
          typeHint: "TIMESTAMP",
        },
      ],
    );
    await cover(tx, companyId, "document_version", id);
    await tx.execute(
      "insert into audit.audit_event(company_id, event_type, initiator, channel, subject_type, subject_id, policy_decision) values (:company, 'document_version.types_checked', 'scheduler', 'system', 'document_version', :id, cast(:policy_decision as jsonb))",
      [
        uuid("company", companyId),
        uuid("id", id),
        {
          name: "policy_decision",
          value: JSON.stringify(json),
          typeHint: "JSON",
        },
      ],
    );
  });
  await withSystemTx(executor, { companyId }, async (tx) => {
    const company = (
      await tx.execute(
        "select id::text as id, legal_name_en, is_demo, default_owner_gate from core.company where id = :company",
        [uuid("company", companyId)],
      )
    ).rows[0];
    assertGate(
      isDeepStrictEqual(company, {
        id: companyId,
        legal_name_en: "SP2 spike synthetic company",
        is_demo: true,
        default_owner_gate: true,
      }),
      "Company UUID, text or boolean round trip failed",
    );
    const version = (
      await tx.execute(
        `select id::text as id, version_no::text as version_no, byte_size::text as byte_size, issue_date::text as issue_date, expiry_date::text as expiry_date,
      to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as instant, sha256, content_type
      from doc.document_version where id = :id`,
        [uuid("id", id)],
      )
    ).rows[0];
    assertGate(
      isDeepStrictEqual(version, {
        id,
        version_no: "7",
        byte_size: largeInteger,
        issue_date: "2026-01-02",
        expiry_date: "2027-01-02",
        instant,
        sha256: "a".repeat(64),
        content_type: "text/plain",
      }),
      "Document version type round trip failed",
    );
    const event = (
      await tx.execute(
        "select policy_decision from audit.audit_event where company_id = :company and subject_id = :id and event_type = 'document_version.types_checked'",
        [uuid("company", companyId), uuid("id", id)],
      )
    ).rows[0];
    const policyDecision: unknown =
      typeof event?.policy_decision === "string"
        ? JSON.parse(event.policy_decision)
        : event?.policy_decision;
    assertGate(
      isDeepStrictEqual(policyDecision, json),
      "JSON round trip failed",
    );
  });
  return {
    types: [
      "uuid",
      "text",
      "boolean",
      "integer",
      "bigint",
      "date",
      "timestamptz",
      "jsonb",
    ],
    timezone: "UTC",
    bigint: largeInteger,
    instant,
    documentVersionId: id,
    policyDecision: json,
  };
}
