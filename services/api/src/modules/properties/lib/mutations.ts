import type { Parameter, Row } from "@aqarak/db/data-api";
import type { RequestScope } from "./runtime";
import { event } from "./audit";
import { rows, uuid, param, number } from "./sql";
import { fail } from "./problem";
export type BusinessTable =
  | "party.owner"
  | "core.account_company_link"
  | "estate.owner_mandate"
  | "estate.mandate_property"
  | "estate.property"
  | "estate.ownership"
  | "estate.unit"
  | "doc.document"
  | "doc.document_version";
function fieldParameter(name: string, value: Parameter["value"]): Parameter {
  const hint = [
    "id",
    "owner_id",
    "mandate_id",
    "property_id",
    "document_id",
    "subject_id",
    "current_version_id",
    "linked_account_id",
    "account_id",
  ].includes(name)
    ? "UUID"
    : ["starts_on", "ends_on", "issue_date", "expiry_date"].includes(name)
      ? "DATE"
      : undefined;
  return param(name, value, hint);
}
export async function insert(
  scope: RequestScope,
  table: BusinessTable,
  fields: Record<string, Parameter["value"]>,
): Promise<Row> {
  const entries = Object.entries(fields);
  const result = await rows(
    scope.tx,
    `insert into ${table}(company_id,created_by,${entries.map(([key]) => key).join(",")}) values (:company,:actor,${entries.map(([key]) => placeholder(key)).join(",")}) returning *`,
    [
      uuid("company", scope.audit.companyId),
      uuid("actor", scope.audit.accountId),
      ...entries.map(([key, value]) => fieldParameter(key, value)),
    ],
  );
  const row = result[0];
  if (!row) throw new Error("Insert returned no row");
  return row;
}
export async function update(
  scope: RequestScope,
  table: BusinessTable,
  identity: { id: string; expected: number },
  fields: Record<string, Parameter["value"]>,
): Promise<Row> {
  const entries = Object.entries(fields);
  const result = await rows(
    scope.tx,
    `update ${table} set ${entries.map(([key]) => `${key}=${placeholder(key)}`).join(",")} where company_id=:company and id=:target and version=:expected returning *`,
    [
      uuid("company", scope.audit.companyId),
      uuid("target", identity.id),
      param("expected", identity.expected),
      ...entries.map(([key, value]) => fieldParameter(key, value)),
    ],
  );
  const row = result[0];
  if (!row) fail(409, "VERSION_CONFLICT");
  return row;
}
export async function auditRow(
  scope: RequestScope,
  input: {
    row: Row;
    type: string;
    before?: number;
    fields?: string[];
    reason?: string;
  },
): Promise<void> {
  await event(scope.tx, scope.audit, {
    type: input.type,
    subjectType: input.type.split(".")[0] ?? "",
    subjectId: String(input.row.id),
    after: number(input.row, "version"),
    ...(input.before ? { before: input.before } : {}),
    ...(input.fields ? { fields: input.fields } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
  });
}

function placeholder(key: string): string {
  if (key.endsWith("_fils") || key === "byte_size")
    return `cast(:${key} as bigint)`;
  if (key === "area_sqm") return `cast(:${key} as numeric)`;
  return `:${key}`;
}
