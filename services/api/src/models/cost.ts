import type { ModelPrice } from "./registry";

export interface ModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly audioSeconds: number;
}
export const ZERO_USAGE: ModelUsage = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  audioSeconds: 0,
});

function fraction(value: number): readonly [bigint, bigint] {
  if (!Number.isFinite(value) || value < 0)
    throw new RangeError("Usage and prices must be finite and nonnegative");
  const [coefficient = "0", exponent = "0"] = value.toString().split("e");
  const [whole = "0", decimal = ""] = coefficient.split(".");
  const scale = decimal.length - Number(exponent);
  const digits = BigInt(whole + decimal);
  return scale >= 0
    ? [digits, 10n ** BigInt(scale)]
    : [digits * 10n ** BigInt(-scale), 1n];
}
function multiply(
  left: number,
  right: number,
  divisor = 1,
): readonly [bigint, bigint] {
  const [a, b] = fraction(left);
  const [c, d] = fraction(right);
  return [a * c, b * d * BigInt(divisor)];
}
/** Convert reported usage to integer micro-US-dollars using decimal round half up. */
export function computeCostMicroUsd(
  price: ModelPrice,
  usage: ModelUsage,
): number {
  let terms: readonly (readonly [bigint, bigint])[];
  switch (price.unit) {
    case "token":
      terms = [
        multiply(price.inputUsdPerMillion, usage.inputTokens),
        multiply(price.outputUsdPerMillion, usage.outputTokens),
      ];
      break;
    case "audio_minute": {
      const [n, d] = multiply(price.usdPerMinute, usage.audioSeconds, 60);
      terms = [[n * 1000000n, d]];
      break;
    }
    case "audio_second": {
      const [n, d] = multiply(price.usdPerSecond, usage.audioSeconds);
      terms = [[n * 1000000n, d]];
      break;
    }
    case "none":
      return 0;
  }
  let numerator = 0n;
  let denominator = 1n;
  for (const [n, d] of terms) {
    numerator = numerator * d + n * denominator;
    denominator *= d;
  }
  const result = Number((2n * numerator + denominator) / (2n * denominator));
  if (!Number.isSafeInteger(result))
    throw new RangeError("Cost exceeds integer precision");
  return result;
}
