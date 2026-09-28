import {
  classifyDiscrepancy,
  discrepancyFields,
  encodeCanonical,
  sha256Hex,
  type DiscrepancyField,
  type CanonicalValue,
} from "@aqarak/domain";
import { z } from "zod";

export const comparedFields = [
  "unt_number",
  "owner_id_number",
  "tenant_id_number",
  "term_start",
  "term_end",
  "annual_rent_fils",
  "deposit_fils",
  "contract_type",
  "owner_name",
  "tenant_name",
] as const;
export type ComparedField = (typeof comparedFields)[number];
export type FieldValue = string | number | null;
export interface Comparison {
  field: ComparedField;
  class: "identity" | "material" | "minor";
  contractValue: FieldValue;
  registeredValue: FieldValue;
  status:
    | "match"
    | "mismatch"
    | "format_only"
    | "missing_contract"
    | "missing_registered";
}
export function digits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x6f0))
    .replace(/\D/g, "");
}
/** Integer values are fils; decimal strings represent AED, without floating point arithmetic. */
export function amountFils(value: string | number): number {
  if (typeof value === "number")
    return z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .parse(value);
  const match = /^(\d+)\.(\d{2})$/.exec(value.trim());
  if (!match?.[1] || !match[2])
    throw new TypeError("Expected an AED two-decimal string");
  return z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER)
    .parse(Number(BigInt(match[1]) * 100n + BigInt(match[2])));
}
export function normaliseField(
  field: DiscrepancyField,
  value: string | number,
): string | number {
  switch (discrepancyFields[field].kind) {
    case "identity_number":
      return digits(String(value));
    case "amount":
      return amountFils(value);
    case "date":
      return z.iso.date().parse(String(value).trim());
    case "text":
      return String(value)
        .normalize("NFKC")
        .toLocaleLowerCase("en")
        .trim()
        .replace(/\s+/gu, " ");
    case "integer":
      return z.number().int().nonnegative().parse(value);
    case "schedule":
      throw new TypeError("Schedule comparison requires structured lines");
  }
}
export function compareFields(
  contract: Partial<Record<ComparedField, FieldValue>>,
  registered: Partial<Record<ComparedField, FieldValue>>,
): Comparison[] {
  return comparedFields.map((field) => {
    const contractValue = contract[field] ?? null;
    const registeredValue = registered[field] ?? null;
    let status: Comparison["status"];
    if (contractValue === null || contractValue === "")
      status = "missing_contract";
    else if (registeredValue === null || registeredValue === "")
      status = "missing_registered";
    else if (
      normaliseField(field, contractValue) !==
      normaliseField(field, registeredValue)
    )
      status = "mismatch";
    else if (
      (field === "owner_name" || field === "tenant_name") &&
      contractValue !== registeredValue
    )
      status = "format_only";
    else status = "match";
    return {
      field,
      class: classifyDiscrepancy(field),
      contractValue,
      registeredValue,
      status,
    };
  });
}
/** I hash every supplied, validated term using the shared canonical encoder. */
export function contractContentHash(
  terms: Readonly<Record<string, CanonicalValue>>,
): string {
  return sha256Hex(encodeCanonical(terms));
}
