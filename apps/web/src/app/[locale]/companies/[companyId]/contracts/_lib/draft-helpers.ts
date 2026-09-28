import type { DraftInput } from "./schemas";
export interface InstalmentRow {
  dueOn: string;
  chequeNo: string;
  bankName: string;
  amount: string;
}
export function parseFils(value: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return Number.NaN;
  const [whole = "0", decimal = ""] = value.trim().split(".");
  return Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
}
export function splitFils(total: number, count: number): number[] {
  if (
    !Number.isSafeInteger(total) ||
    total < 0 ||
    !Number.isInteger(count) ||
    count < 1
  )
    return [];
  const part = Math.floor(total / count);
  return Array.from(
    { length: count },
    (_, index) => part + (index === count - 1 ? total % count : 0),
  );
}
export function rowsFrom(input?: DraftInput): InstalmentRow[] {
  return input
    ? input.instalments.map((item) => ({
        dueOn: item.dueOn,
        chequeNo: item.cheque?.chequeNo ?? "",
        bankName: item.cheque?.bankName ?? "",
        amount: (item.amountFils / 100).toFixed(2),
      }))
    : Array.from({ length: 4 }, () => ({
        dueOn: "",
        chequeNo: "",
        bankName: "",
        amount: "",
      }));
}
export function fieldId(field: string): string {
  const aliases: Record<string, string> = {
    term_start: "termStart",
    term_end: "termEnd",
    annual_rent_fils: "annualRentFils",
    total_fils: "totalFils",
    deposit_fils: "depositFils",
    vat_bp: "vatBp",
    unit_id: "unitId",
    unit_ids: "unitId",
    tenant_id: "tenantId",
    grace_days: "graceDays",
    schedule: "instalments",
  };
  const clean = field.replace(/^terms\./, "");
  return aliases[clean] ?? clean.replace(/\./g, "-");
}
