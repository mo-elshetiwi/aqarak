import type { CompanyTransaction, Parameter, Row } from "./database";

export type SqlValues = Readonly<Record<string, Parameter["value"]>>;
export async function rows(
  tx: CompanyTransaction,
  sql: string,
  values: SqlValues = {},
): Promise<Row[]> {
  return (
    await tx.execute(
      sql,
      Object.entries(values).map(([name, value]) => ({ name, value })),
    )
  ).rows;
}
export async function one(
  tx: CompanyTransaction,
  sql: string,
  values: SqlValues = {},
): Promise<Row> {
  const row = (await rows(tx, sql, values))[0];
  if (!row) throw new Error("Expected database row");
  return row;
}
export function str(row: Row, key: string): string {
  const value = row[key];
  if (value == null) return "";
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  )
    throw new Error("Expected scalar database value");
  return String(value);
}
export function nullable(row: Row, key: string): string | null {
  return row[key] == null ? null : str(row, key);
}
export function num(row: Row, key: string): number {
  return Number(row[key]);
}
export function jsonValue(value: unknown): unknown {
  return typeof value === "string" ? (JSON.parse(value) as unknown) : value;
}
export function instant(value: unknown): string {
  return new Date(String(value)).toISOString();
}
