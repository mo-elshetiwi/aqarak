import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  applicableVatBp,
  basisPoints,
  fils,
  nonNegativeFils,
  positiveFils,
  sumFils,
  vatFils,
  VAT_BP_COMMERCIAL,
  VAT_BP_RESIDENTIAL,
  type BasisPoints,
  type Fils,
} from "./index";

describe("money validation", () => {
  it.each([Number.MIN_SAFE_INTEGER, -1, 0, 1, Number.MAX_SAFE_INTEGER])(
    "accepts signed safe integer fils: %s",
    (value) => {
      expect(fils.parse(value)).toBe(value);
    },
  );
  it.each([
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    Number.MIN_SAFE_INTEGER - 1,
    NaN,
    Infinity,
    -Infinity,
  ])("refuses invalid fils: %s", (value) => {
    expect(fils.safeParse(value).success).toBe(false);
  });
  it("accepts zero as nonnegative fils", () => {
    const value: Fils = nonNegativeFils.parse(0);
    expect(value).toBe(0);
  });
  it("refuses negative nonnegative fils", () => {
    expect(nonNegativeFils.safeParse(-1).success).toBe(false);
  });
  it("accepts positive fils with the shared brand", () => {
    const value: Fils = positiveFils.parse(1);
    expect(value).toBe(1);
  });
  it.each([0, -1])("refuses nonpositive positive fils: %s", (value) => {
    expect(positiveFils.safeParse(value).success).toBe(false);
  });
  it.each([0, 500, 10_000])("accepts bounded basis points: %s", (value) => {
    expect(basisPoints.parse(value)).toBe(value);
  });
  it.each([-1, 10_001, 0.5, NaN, Infinity])(
    "refuses invalid basis points: %s",
    (value) => {
      expect(basisPoints.safeParse(value).success).toBe(false);
    },
  );
});

describe("VAT", () => {
  it.each([
    [1, 0],
    [10, 1],
    [30, 2],
    [12_345, 617],
    [12_350, 618],
  ])("rounds VAT half up to the fils", (amount, expected) => {
    expect(vatFils(fils.parse(amount), VAT_BP_COMMERCIAL)).toBe(expected);
  });
  it("rounds every amount to the nearest fils with ties up", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10 ** 12 }),
        fc.integer({ min: 0, max: 10_000 }),
        (amount, bp) => {
          const vat = BigInt(
            vatFils(fils.parse(amount), basisPoints.parse(bp)),
          );
          const product = BigInt(amount) * BigInt(bp);
          const delta = product - vat * 10_000n;
          expect(delta >= -5_000n && delta <= 5_000n).toBe(true);
          if (product % 10_000n === 5_000n) {
            expect(vat).toBe(product / 10_000n + 1n);
          }
          expect(vat >= 0n && vat <= BigInt(amount)).toBe(true);
        },
      ),
      // The constrained build caps properties at 100 cases while retaining the seed.
      { seed: 20260928, numRuns: 100 },
    );
  }, 60_000);
  it("preserves precision when the intermediate product exceeds safe integers", () => {
    expect(
      vatFils(fils.parse(Number.MAX_SAFE_INTEGER), basisPoints.parse(10_000)),
    ).toBe(Number.MAX_SAFE_INTEGER);
  });
  it("returns zero VAT for a zero rate", () => {
    expect(vatFils(fils.parse(100), VAT_BP_RESIDENTIAL)).toBe(0);
  });
  it("throws for a negative amount", () => {
    expect(() => vatFils(fils.parse(-1), VAT_BP_COMMERCIAL)).toThrow(
      RangeError,
    );
  });
  it.each([-1, 10_001, 1.5, NaN, Infinity])(
    "throws for an invalid runtime rate: %s",
    (value) => {
      // AC-3: the forged brand stays inside the callback that verifies invariant rejection.
      expect(() => vatFils(fils.parse(100), value as BasisPoints)).toThrow(
        RangeError,
      );
    },
  );
  it.each([Number.MAX_SAFE_INTEGER + 1, 1.5, NaN, Infinity])(
    "throws for an invalid runtime amount: %s",
    (value) => {
      // AC-3: the forged brand stays inside the callback that verifies invariant rejection.
      expect(() => vatFils(value as Fils, VAT_BP_COMMERCIAL)).toThrow(
        RangeError,
      );
    },
  );
  it.each([
    { unitUse: "residential", issuerTrn: null, expected: 0 },
    { unitUse: "residential", issuerTrn: "100000000000001", expected: 0 },
    { unitUse: "commercial", issuerTrn: null, expected: 0 },
    { unitUse: "commercial", issuerTrn: "", expected: 0 },
    { unitUse: "commercial", issuerTrn: "  ", expected: 0 },
    { unitUse: "commercial", issuerTrn: "100000000000001", expected: 500 },
  ] as const)(
    "selects $expected basis points for $unitUse with TRN $issuerTrn",
    ({ unitUse, issuerTrn, expected }) => {
      expect(applicableVatBp({ unitUse, issuerTrn })).toBe(expected);
    },
  );
});

describe("exact money totals", () => {
  it("returns zero for no amounts", () => {
    expect(sumFils([])).toBe(0);
  });
  it("sums positive and negative amounts exactly", () => {
    expect(sumFils([fils.parse(123), fils.parse(-23), fils.parse(50)])).toBe(
      150,
    );
  });
  it("preserves exact cancellation beyond intermediate safe integer bounds", () => {
    const maximum = fils.parse(Number.MAX_SAFE_INTEGER);
    expect(sumFils([maximum, fils.parse(2), fils.parse(-2)])).toBe(maximum);
  });
  it.each([
    [Number.MAX_SAFE_INTEGER, 1],
    [Number.MIN_SAFE_INTEGER, -1],
  ])("throws when a total exceeds safe integer bounds: %s + %s", (a, b) => {
    expect(() => sumFils([fils.parse(a), fils.parse(b)])).toThrow(RangeError);
  });
  it("preserves the input amounts", () => {
    const values = Object.freeze([fils.parse(1), fils.parse(2)]);
    sumFils(values);
    expect(values).toEqual([1, 2]);
  });
});
