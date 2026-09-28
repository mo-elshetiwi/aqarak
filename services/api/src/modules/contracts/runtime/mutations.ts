import { randomUUID } from "node:crypto";
import type { CompanyTransaction, Parameter, Row } from "./db";
import type { Mutation } from "./audit";
import { parameters, integer, string } from "./sql";
export interface WriteContext {
  tx: CompanyTransaction;
  companyId: string;
  accountId: string;
  mutations: Mutation[];
}
export async function insertBusiness(
  context: WriteContext,
  input: {
    table: string;
    values: Record<string, Parameter["value"]>;
    eventType: string;
  },
): Promise<string> {
  const id =
    typeof input.values.id === "string" ? input.values.id : randomUUID();
  const values = {
    ...input.values,
    id,
    company_id: context.companyId,
    created_by: context.accountId,
  };
  const keys = Object.keys(values);
  await context.tx.execute(
    `insert into ${input.table} (${keys.join(",")}) values (${keys.map((k) => `:${k}${cast(k)}`).join(",")})`,
    parameters(values),
  );
  context.mutations.push({
    subjectType: input.table.split(".")[1] ?? input.table,
    subjectId: id,
    version: 1,
    before: null,
    fields: keys.filter((k) => !["id", "company_id", "created_by"].includes(k)),
    eventType: input.eventType,
  });
  return id;
}
function cast(key: string): string {
  if (
    key === "id" ||
    key.endsWith("_id") ||
    ["created_by", "requested_by"].includes(key)
  )
    return "::uuid";
  if (["payload", "services", "warnings"].includes(key)) return "::jsonb";
  if (["submitted_at", "read_at"].includes(key)) return "::timestamptz";
  if (
    [
      "term_start",
      "term_end",
      "occupancy_start",
      "occupancy_end",
      "due_on",
      "cheque_date",
    ].includes(key)
  )
    return "::date";
  return "";
}
export async function updateBusiness(
  context: WriteContext,
  input: {
    table: string;
    row: Row;
    values: Record<string, Parameter["value"]>;
    eventType: string;
  },
): Promise<void> {
  const id = string(input.row, "id");
  const before = integer(input.row, "version");
  const keys = Object.keys(input.values);
  await context.tx.execute(
    `update ${input.table} set ${keys.map((k) => `${k}=:${k}${cast(k)}`).join(",")} where id=:id::uuid`,
    parameters({ ...input.values, id }),
  );
  context.mutations.push({
    subjectType: input.table.split(".")[1] ?? input.table,
    subjectId: id,
    version: before + 1,
    before,
    fields: keys,
    eventType: input.eventType,
  });
  Object.assign(input.row, input.values, { version: before + 1 });
}
