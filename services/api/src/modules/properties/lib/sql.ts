import type { CompanyTransaction } from "./db.mjs";
import type { Parameter, Row } from "@aqarak/db/data-api";
import { fail } from "./problem";
export function param(
  name: string,
  value: Parameter["value"],
  typeHint?: Parameter["typeHint"],
): Parameter {
  return { name, value, ...(typeHint ? { typeHint } : {}) };
}
export function uuid(name: string, value: string | null): Parameter {
  return param(name, value, "UUID");
}
export function json(name: string, value: unknown): Parameter {
  return param(name, JSON.stringify(value), "JSON");
}
export async function rows(
  tx: CompanyTransaction,
  sql: string,
  params: readonly Parameter[] = [],
): Promise<Row[]> {
  return (await tx.execute(sql, params)).rows;
}
export function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error("Invalid stored text");
  return value;
}
export function nullableText(row: Row, key: string): string | null {
  return row[key] == null ? null : text(row, key);
}
export function number(row: Row, key: string): number {
  const value = Number(row[key]);
  if (!Number.isSafeInteger(value)) throw new Error("Invalid stored integer");
  return value;
}
export function bool(row: Row, key: string): boolean {
  if (typeof row[key] !== "boolean") throw new Error("Invalid stored boolean");
  return row[key];
}
export function one(records: Row[]): Row {
  const row = records[0];
  if (!row) fail(404, "NOT_FOUND");
  return row;
}
export function checkVersion(row: Row, expected: number): void {
  if (number(row, "version") !== expected) fail(409, "VERSION_CONFLICT");
}

export function utcTimestamp(value: string): string {
  const offsetless = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/;
  return new Date(
    offsetless.test(value) ? `${value.replace(" ", "T")}Z` : value,
  ).toISOString();
}
