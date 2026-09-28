import { z } from "zod";
import type { UnitUse } from "./vocabulary";

/** Validates integer fils for money amounts including negative balances. */
export const fils = z.int().brand<"Fils">();
/** Represents an exact money amount when calculating in integer fils. */
export type Fils = z.infer<typeof fils>;
/** Validates integer fils when a money amount cannot be negative. */
export const nonNegativeFils = z.int().min(0).brand<"Fils">();
/** Validates integer fils when a money amount must exceed zero. */
export const positiveFils = z.int().positive().brand<"Fils">();
/** Validates rates from zero to one hundred percent for money calculations. */
export const basisPoints = z.int().min(0).max(10_000).brand<"BasisPoints">();
/** Represents a validated rate when calculating in basis points. */
export type BasisPoints = z.infer<typeof basisPoints>;

/** Supplies the five percent rate when commercial rent is taxable. */
export const VAT_BP_COMMERCIAL: BasisPoints = basisPoints.parse(500);
/** Supplies the zero rate when residential rent is exempt. */
export const VAT_BP_RESIDENTIAL: BasisPoints = basisPoints.parse(0);

function checkedFils(value: bigint): Fils {
  if (
    value < BigInt(Number.MIN_SAFE_INTEGER) ||
    value > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new RangeError("Money exceeds the safe integer range");
  }
  return fils.parse(Number(value));
}

/**
 * Calculates VAT per line with half up rounding when the amount is nonnegative.
 * @throws {RangeError} If the amount or rate violates its integer bounds or the result is unsafe.
 */
export function vatFils(amountFils: Fils, vatBp: BasisPoints): Fils {
  if (!Number.isSafeInteger(amountFils) || amountFils < 0) {
    throw new RangeError("VAT requires a nonnegative safe integer amount");
  }
  if (!Number.isInteger(vatBp) || vatBp < 0 || vatBp > 10_000) {
    throw new RangeError(
      "VAT requires an integer rate between zero and ten thousand",
    );
  }
  return checkedFils((BigInt(amountFils) * BigInt(vatBp) + 5_000n) / 10_000n);
}

/** Selects the applicable VAT rate when classifying rent by unit use and issuer registration. */
export function applicableVatBp(input: {
  readonly unitUse: UnitUse;
  readonly issuerTrn: string | null;
}): BasisPoints {
  // IN17: taxable commercial supplies require an issuer with a TRN.
  return input.unitUse === "commercial" &&
    input.issuerTrn !== null &&
    input.issuerTrn.trim() !== ""
    ? VAT_BP_COMMERCIAL
    : VAT_BP_RESIDENTIAL;
}

/**
 * Adds money amounts exactly when calculating balances or totals.
 * @throws {RangeError} If the total exceeds the safe integer range.
 */
export function sumFils(values: readonly Fils[]): Fils {
  return checkedFils(
    values.reduce((total, value) => total + BigInt(value), 0n),
  );
}
