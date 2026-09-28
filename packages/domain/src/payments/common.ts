import { refuse } from "../errors";
import { fils, type Fils } from "../money";
import { ok } from "../result";
import type { MoneyContext, MoneyResult } from "./model";

/** Checks the actor and company boundary before a financial decision. */
export function authorize(
  company: string,
  context: MoneyContext,
): MoneyResult<void> {
  return company === context.company_id &&
    (context.role === "manager" || context.role === "accountant")
    ? ok(undefined)
    : refuse("FORBIDDEN");
}
/** Converts exact intermediate arithmetic into a bounded amount or refusal. */
export function checkedMoney(value: bigint): MoneyResult<Fils> {
  const parsed = fils.safeParse(Number(value));
  return parsed.success
    ? ok(parsed.data)
    : refuse("INVALID_INPUT", "amount_fils");
}
/** Sums integer amounts exactly before checking the final representable range. */
export function exactTotal(values: readonly Fils[]): bigint {
  return values.reduce((sum, value) => sum + BigInt(value), 0n);
}
