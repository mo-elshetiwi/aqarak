import type { CompanyTransaction, Parameter, Row } from "./db";
import { z } from "zod";

export function parameters(
  values: Readonly<Record<string, Parameter["value"]>>,
): Parameter[] {
  return Object.entries(values).map(([name, value]) => ({ name, value }));
}
export async function rows(
  tx: CompanyTransaction,
  sql: string,
  values: Readonly<Record<string, Parameter["value"]>> = {},
): Promise<Row[]> {
  return (await tx.execute(sql, parameters(values))).rows;
}
export async function first(
  tx: CompanyTransaction,
  sql: string,
  values: Readonly<Record<string, Parameter["value"]>> = {},
): Promise<Row | undefined> {
  return (await rows(tx, sql, values))[0];
}
export function string(row: Row, key: string): string {
  return z.string().parse(row[key]);
}
export function nullableString(row: Row, key: string): string | null {
  return z
    .string()
    .nullable()
    .parse(row[key] ?? null);
}
export function integer(row: Row, key: string): number {
  return z.coerce.number().int().parse(row[key]);
}
export function boolean(row: Row, key: string): boolean {
  return z.boolean().parse(row[key]);
}
export function instant(value: unknown): string {
  const normalized =
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value)
      ? `${value.replace(" ", "T")}Z`
      : value;
  return z.coerce.date().parse(normalized).toISOString();
}
