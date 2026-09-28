import type { CompanyTransaction, Parameter } from "@aqarak/db";
import { z } from "zod";
import { Refusal } from "../audit/kernel";
export function parameters(
  values: Record<string, Parameter["value"]>,
): Parameter[] {
  return Object.entries(values).map(([name, value]) => ({ name, value }));
}
export async function execute(
  tx: CompanyTransaction,
  sql: string,
  values: Record<string, Parameter["value"]> = {},
): Promise<void> {
  await tx.execute(sql, parameters(values));
}
export async function rows<T>(
  tx: CompanyTransaction,
  sql: string,
  schema: z.ZodType<T>,
  values: Record<string, Parameter["value"]> = {},
): Promise<T[]> {
  const result = await tx.execute(sql, parameters(values));
  return result.rows.map((row) => schema.parse(row));
}
export async function one<T>(
  tx: CompanyTransaction,
  sql: string,
  schema: z.ZodType<T>,
  values: Record<string, Parameter["value"]> = {},
): Promise<T> {
  const result = await rows(tx, sql, schema, values);
  const row = result[0];
  if (!row) throw new Refusal("NOT_FOUND", null);
  return row;
}
export const jsonValue = z.preprocess(
  (value) =>
    typeof value === "string" ? (JSON.parse(value) as unknown) : value,
  z.json(),
);
export const number = z.coerce.number().int();
export const timestamp = z
  .string()
  .transform((value) =>
    new Date(
      value.endsWith("Z") || /[+-]\d\d:\d\d$/.test(value)
        ? value
        : `${value.replace(" ", "T")}Z`,
    ).toISOString(),
  );
