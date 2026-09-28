import { expect, it } from "vitest";
import { computeCostMicroUsd, ZERO_USAGE } from "./cost";
const metadata = { source: "fixture", priceDate: "2026-09-28" };
it("AC-5 rounds reported usage to integer micro-dollars", () => {
  expect(
    computeCostMicroUsd(
      {
        unit: "token",
        inputUsdPerMillion: 0.1,
        outputUsdPerMillion: 0.5,
        ...metadata,
      },
      { ...ZERO_USAGE, inputTokens: 70, outputTokens: 24 },
    ),
  ).toBe(19);
  expect(
    computeCostMicroUsd(
      { unit: "audio_minute", usdPerMinute: 0.0045, ...metadata },
      { ...ZERO_USAGE, audioSeconds: 5 },
    ),
  ).toBe(375);
  expect(
    computeCostMicroUsd(
      { unit: "audio_second", usdPerSecond: 0.0001667, ...metadata },
      { ...ZERO_USAGE, audioSeconds: 15 },
    ),
  ).toBe(2501);
  expect(computeCostMicroUsd({ unit: "none", ...metadata }, ZERO_USAGE)).toBe(
    0,
  );
});
it("rejects invalid and overflowing costs", () => {
  expect(() =>
    computeCostMicroUsd(
      {
        unit: "token",
        inputUsdPerMillion: 1,
        outputUsdPerMillion: 1,
        ...metadata,
      },
      { ...ZERO_USAGE, inputTokens: -1 },
    ),
  ).toThrow();
});
