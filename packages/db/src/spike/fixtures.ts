import { randomUUID } from "node:crypto";
import { withSystemTx, type CompanyTransaction } from "../company-tx.ts";
import type { DataApiExecutor, Parameter } from "../data-api.ts";

export function uuid(name: string, value: string): Parameter {
  return { name, value, typeHint: "UUID" };
}
export function assertGate(
  condition: boolean,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}
export async function cover(
  tx: CompanyTransaction,
  companyId: string,
  subjectType: string,
  subjectId: string,
): Promise<void> {
  await tx.execute(
    `insert into audit.audit_event(company_id, event_type, initiator, channel, subject_type, subject_id, version_after)
    values (:company, :event, 'scheduler', 'system', :subject_type, :subject, :version)`,
    [
      uuid("company", companyId),
      { name: "event", value: `${subjectType}.created` },
      { name: "subject_type", value: subjectType },
      uuid("subject", subjectId),
      { name: "version", value: 1 },
    ],
  );
}
export async function insertCompany(
  tx: CompanyTransaction,
  companyId: string,
): Promise<void> {
  await tx.execute(
    "insert into core.company(id, kind, legal_name_en, legal_name_ar, is_demo) values (:id, 'management_company', 'SP2 spike synthetic company', 'SP2 spike شركة تجريبية', true)",
    [uuid("id", companyId)],
  );
}
export async function createCompany(
  executor: DataApiExecutor,
  companyId: string = randomUUID(),
): Promise<string> {
  await withSystemTx(executor, { companyId }, async (tx) => {
    await insertCompany(tx, companyId);
    await cover(tx, companyId, "company", companyId);
  });
  return companyId;
}
