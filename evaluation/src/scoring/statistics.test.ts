import { describe, expect, it } from "vitest";
import {
  clusterBootstrapRatio,
  createSeededRandom,
  pairedBootstrapDifference,
  wilsonInterval,
} from "./statistics.js";

describe("wilsonInterval", () => {
  it("matches reference Wilson intervals", () => {
    expect(wilsonInterval(0, 40)?.upper).toBeCloseTo(0.0876, 4);
    for (const [successes = 0, trials = 0, lower = 0, upper = 0] of [
      [12, 15, 0.548, 0.93],
      [27, 30, 0.744, 0.965],
      [360, 400, 0.867, 0.926],
    ]) {
      const interval = wilsonInterval(successes, trials);
      expect(interval?.lower).toBeCloseTo(lower, 3);
      expect(interval?.upper).toBeCloseTo(upper, 3);
      expect(interval?.estimate).toBe(successes / trials);
    }
  });
  it("returns null without trials and bounds perfect scores", () => {
    expect(wilsonInterval(0, 0)).toBeNull();
    expect(wilsonInterval(40, 40)?.upper).toBe(1);
  });
  it("accepts a custom z", () => {
    expect(wilsonInterval(1, 2, 1)).toEqual({
      estimate: 0.5,
      lower: 0.21132486540518713,
      upper: 0.7886751345948129,
    });
  });
  it("rejects invalid counts and z", () => {
    for (const args of [
      [-1, 1],
      [2, 1],
      [0.5, 1],
      [0, -1],
      [NaN, 1],
    ])
      expect(() => wilsonInterval(args[0] ?? 0, args[1] ?? 0)).toThrow(
        RangeError,
      );
    expect(() => wilsonInterval(1, 2, 0)).toThrow(RangeError);
  });
});

describe("bootstrap", () => {
  const clusters = [
    { numerator: 1, denominator: 2 },
    { numerator: 1, denominator: 10 },
    { numerator: 3, denominator: 4 },
  ];
  it("is deterministic for a seed", () => {
    const a = clusterBootstrapRatio(clusters, { seed: 123 });
    const b = clusterBootstrapRatio(clusters, { seed: 123 });
    expect(a).toEqual(b);
    expect(a?.estimate).toBe(5 / 16);
    expect(a?.lower).toBeLessThanOrEqual(5 / 16);
    expect(a?.upper).toBeGreaterThanOrEqual(5 / 16);
  });
  it("matches a mulberry32 reference stream", () => {
    const a = createSeededRandom(1),
      b = createSeededRandom(1);
    expect(a()).toBe(0.6270739405881613);
    expect(b()).toBe(0.6270739405881613);
    expect(Array.from({ length: 10 }, a)).toEqual(
      Array.from({ length: 10 }, b),
    );
  });
  it("returns zero-width intervals for constant ratios", () => {
    expect(
      clusterBootstrapRatio([
        { numerator: 1, denominator: 2 },
        { numerator: 5, denominator: 10 },
      ]),
    ).toEqual({ estimate: 0.5, lower: 0.5, upper: 0.5 });
  });
  it("pools a known asymmetric case rather than averaging ratios", () => {
    expect(
      clusterBootstrapRatio(
        [
          { numerator: 0, denominator: 1 },
          { numerator: 9, denominator: 9 },
        ],
        { seed: 7, resamples: 1000 },
      ),
    ).toEqual({ estimate: 0.9, lower: 0, upper: 1 });
  });
  it("redraws zero-denominator samples", () => {
    expect(
      clusterBootstrapRatio(
        [
          { numerator: 0, denominator: 0 },
          { numerator: 2, denominator: 4 },
        ],
        { resamples: 100 },
      ),
    ).toEqual({ estimate: 0.5, lower: 0.5, upper: 0.5 });
  });
  it("returns null for empty or undefined ratios", () => {
    expect(clusterBootstrapRatio([])).toBeNull();
    expect(
      clusterBootstrapRatio([{ numerator: 0, denominator: 0 }]),
    ).toBeNull();
    expect(pairedBootstrapDifference([])).toBeNull();
  });
  it("resamples pairs together and preserves difference sign", () => {
    const pairs = [
      {
        a: { numerator: 0, denominator: 1 },
        b: { numerator: 1, denominator: 1 },
      },
      {
        a: { numerator: 9, denominator: 9 },
        b: { numerator: 0, denominator: 9 },
      },
    ];
    const result = pairedBootstrapDifference(pairs, {
      seed: 7,
      resamples: 1000,
    });
    expect(result?.estimate).toBeCloseTo(0.8, 15);
    expect(result?.lower).toBe(-1);
    expect(result?.upper).toBe(1);
    expect(result).toEqual(
      pairedBootstrapDifference(pairs, { seed: 7, resamples: 1000 }),
    );
    expect(
      pairedBootstrapDifference(pairs.map(({ a }) => ({ a, b: a }))),
    ).toEqual({ estimate: 0, lower: 0, upper: 0 });
  });
  it("redraws pairs when either denominator is zero", () => {
    expect(
      pairedBootstrapDifference([
        {
          a: { numerator: 1, denominator: 1 },
          b: { numerator: 0, denominator: 0 },
        },
        {
          a: { numerator: 0, denominator: 0 },
          b: { numerator: 1, denominator: 2 },
        },
      ]),
    ).toEqual({ estimate: 0.5, lower: 0.5, upper: 0.5 });
  });
  it("allows error rates greater than one", () => {
    expect(
      clusterBootstrapRatio([{ numerator: 3, denominator: 1 }])?.estimate,
    ).toBe(3);
  });
  it("rejects invalid options and counts", () => {
    expect(() => clusterBootstrapRatio(clusters, { resamples: 0 })).toThrow(
      RangeError,
    );
    expect(() => clusterBootstrapRatio(clusters, { confidence: 1 })).toThrow(
      RangeError,
    );
    expect(() => clusterBootstrapRatio(clusters, { seed: NaN })).toThrow(
      RangeError,
    );
    expect(() =>
      clusterBootstrapRatio([{ numerator: -1, denominator: 1 }]),
    ).toThrow(RangeError);
    expect(() =>
      clusterBootstrapRatio([{ numerator: 0, denominator: Infinity }]),
    ).toThrow(RangeError);
  });
});
