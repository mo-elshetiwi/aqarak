import { describe, expect, it } from "vitest";
import { applyScreeningRules } from "./screening-rules.js";
import type { ScreeningCandidate } from "./screening-rules.js";

function candidate(
  candidateId: string,
  primary: number,
  schemaValidRate = 1,
  criticalFailures = 0,
): ScreeningCandidate {
  return { candidateId, primary, schemaValidRate, criticalFailures };
}

describe("applyScreeningRules", () => {
  it("applies accuracy boundaries, schema validity and critical failures", () => {
    const decisions = applyScreeningRules({
      candidates: [
        candidate("best", 0.9),
        candidate("boundary", 0.75),
        candidate("outside", 0.749),
        candidate("schema", 0.9, 0.94),
        candidate("critical", 0.9, 0.95, 1),
      ],
      margin: { kind: "absolute", value: 0.05, higherIsBetter: true },
    });
    expect(decisions.map((item) => item.decision)).toEqual([
      "survives",
      "survives",
      "rejected",
      "rejected",
      "rejected",
    ]);
    expect(decisions[1]?.reasons).toEqual([]);
    expect(decisions[2]?.reasons[0]).toContain(
      "Primary accuracy 0.749 is below 0.75",
    );
    expect(decisions[2]?.reasons[0]).toContain(
      "best 0.9 minus three margins of 0.05",
    );
    expect(decisions[3]?.reasons).toEqual([
      "Schema-valid rate 0.94 is below 0.95.",
    ]);
    expect(decisions[4]?.reasons).toEqual(["Critical failures 1 exceed 0."]);
  });
  it("applies error-rate boundaries and reports every failed gate", () => {
    const decisions = applyScreeningRules({
      candidates: [
        candidate("best", 0.2),
        candidate("boundary", 0.26),
        candidate("outside", 0.261, 0.94, 1),
      ],
      margin: { kind: "relative", value: 0.1, higherIsBetter: false },
    });
    expect(decisions.map((item) => item.decision)).toEqual([
      "survives",
      "survives",
      "rejected",
    ]);
    expect(decisions[2]?.reasons).toHaveLength(3);
    expect(decisions[2]?.reasons[2]).toContain(
      "Primary error rate 0.261 exceeds 0.26",
    );
  });
  it("retains a best zero error rate and rejects positive error", () => {
    expect(
      applyScreeningRules({
        candidates: [candidate("zero", 0), candidate("nonzero", 0.001)],
        margin: { kind: "relative", value: 0.1, higherIsBetter: false },
      }).map((item) => item.decision),
    ).toEqual(["survives", "rejected"]);
  });
  it("accepts the schema-valid threshold and zero margins", () => {
    expect(
      applyScreeningRules({
        candidates: [candidate("best", 0.9, 0.95), candidate("lower", 0.89)],
        margin: { kind: "absolute", value: 0, higherIsBetter: true },
      }).map((item) => item.decision),
    ).toEqual(["survives", "rejected"]);
  });
  it("rejects positive errors against zero and preserves a strict zero margin", () => {
    const errors = applyScreeningRules({
      candidates: [candidate("zero", 0), candidate("tiny", Number.MIN_VALUE)],
      margin: { kind: "relative", value: 0.1, higherIsBetter: false },
    });
    expect(errors[1]?.decision).toBe("rejected");
    const accuracy = applyScreeningRules({
      candidates: [
        candidate("best", 1),
        candidate("lower", 1 - Number.EPSILON),
      ],
      margin: { kind: "absolute", value: 0, higherIsBetter: true },
    });
    expect(accuracy[1]?.decision).toBe("rejected");
  });
  it("handles no candidates and rejects invalid metrics", () => {
    const margin = {
      kind: "absolute",
      value: 0.1,
      higherIsBetter: true,
    } as const;
    expect(applyScreeningRules({ candidates: [], margin })).toEqual([]);
    expect(() =>
      applyScreeningRules({ candidates: [candidate("bad", NaN)], margin }),
    ).toThrow(RangeError);
    expect(() =>
      applyScreeningRules({ candidates: [candidate("bad", 1, 1.1)], margin }),
    ).toThrow(RangeError);
    expect(() =>
      applyScreeningRules({ candidates: [candidate("bad", 1, 1, -1)], margin }),
    ).toThrow(RangeError);
    expect(() =>
      applyScreeningRules({ candidates: [], margin: { ...margin, value: -1 } }),
    ).toThrow(RangeError);
    expect(() =>
      applyScreeningRules({
        candidates: [candidate("same", 1), candidate("same", 1)],
        margin,
      }),
    ).toThrow("unique");
  });
});
