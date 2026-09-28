import { requireValid } from "./validation.js";

export interface Interval {
  readonly estimate: number;
  readonly lower: number;
  readonly upper: number;
}

export interface RatioCluster {
  readonly numerator: number;
  readonly denominator: number;
}

export interface RatioPair {
  readonly a: RatioCluster;
  readonly b: RatioCluster;
}

export interface BootstrapOptions {
  readonly resamples?: number;
  readonly seed?: number;
  readonly confidence?: number;
}

/** Computes a Wilson score interval, returning null when there are no trials. */
export function wilsonInterval(
  successes: number,
  trials: number,
  zScore?: number,
): Interval | null {
  const z = zScore ?? 1.959963984540054;
  requireValid(
    Number.isSafeInteger(trials) &&
      Number.isSafeInteger(successes) &&
      successes >= 0 &&
      successes <= trials &&
      trials >= 0 &&
      Number.isFinite(z) &&
      z > 0,
    "Wilson counts must be nonnegative integers with successes at most trials and z positive.",
  );
  if (trials === 0) return null;
  const estimate = successes / trials;
  const scale = 1 + (z * z) / trials;
  const centre = (estimate + (z * z) / (2 * trials)) / scale;
  const radius =
    (z *
      Math.sqrt(
        (estimate * (1 - estimate)) / trials + (z * z) / (4 * trials * trials),
      )) /
    scale;
  return {
    estimate,
    lower: Math.max(0, centre - radius),
    upper: Math.min(1, centre + radius),
  };
}

/** Creates a deterministic mulberry32 generator from an integer seed. */
export function createSeededRandom(seed: number): () => number {
  requireValid(Number.isSafeInteger(seed), "Seed must be a safe integer.");
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function validateCluster(cluster: RatioCluster): void {
  requireValid(
    Number.isFinite(cluster.numerator) &&
      Number.isFinite(cluster.denominator) &&
      cluster.numerator >= 0 &&
      cluster.denominator >= 0,
    "Cluster counts must be finite and nonnegative.",
  );
}

function pooled(clusters: readonly RatioCluster[]): number | null {
  const numerator = clusters.reduce(
    (sum, cluster) => sum + cluster.numerator,
    0,
  );
  const denominator = clusters.reduce(
    (sum, cluster) => sum + cluster.denominator,
    0,
  );
  requireValid(
    Number.isFinite(numerator) && Number.isFinite(denominator),
    "Pooled counts overflowed.",
  );
  return denominator === 0 ? null : numerator / denominator;
}

function percentile(sorted: readonly number[], probability: number): number {
  const position = (sorted.length - 1) * probability;
  const lower = sorted[Math.floor(position)] ?? 0;
  const upper = sorted[Math.ceil(position)] ?? lower;
  return lower + (upper - lower) * (position - Math.floor(position));
}

function bootstrap(
  size: number,
  statistic: (indices: readonly number[]) => number | null,
  options: BootstrapOptions,
): Interval | null {
  const { resamples = 2000, seed = 20260928, confidence = 0.95 } = options;
  requireValid(
    Number.isSafeInteger(resamples) &&
      resamples >= 1 &&
      Number.isFinite(confidence) &&
      confidence > 0 &&
      confidence < 1,
    "Resamples must be positive and confidence must be between zero and one.",
  );
  const random = createSeededRandom(seed);
  const estimate = statistic(Array.from({ length: size }, (_, index) => index));
  if (estimate === null) return null;
  const samples: number[] = [];
  while (samples.length < resamples) {
    const value = statistic(
      Array.from({ length: size }, () => Math.floor(random() * size)),
    );
    if (value === null) continue;
    samples.push(value);
  }
  samples.sort((a, b) => a - b);
  const tail = (1 - confidence) / 2;
  return {
    estimate,
    lower: percentile(samples, tail),
    upper: percentile(samples, 1 - tail),
  };
}

/** Bootstraps pooled ratios by cluster with linear percentile interpolation, returning null for a zero total denominator. */
export function clusterBootstrapRatio(
  clusters: readonly RatioCluster[],
  options: BootstrapOptions = {},
): Interval | null {
  clusters.forEach(validateCluster);
  return bootstrap(
    clusters.length,
    (indices) =>
      pooled(
        indices.map((index) => {
          const cluster = clusters[index];
          if (cluster === undefined)
            throw new RangeError("Cluster index is out of range.");
          return cluster;
        }),
      ),
    options,
  );
}

/** Bootstraps shared pair indices to estimate pooled ratio a minus b, returning null if either total denominator is zero. */
export function pairedBootstrapDifference(
  pairs: readonly RatioPair[],
  options: BootstrapOptions = {},
): Interval | null {
  pairs.forEach(({ a, b }) => {
    validateCluster(a);
    validateCluster(b);
  });
  return bootstrap(
    pairs.length,
    (indices) => {
      const selected = indices.map((index) => {
        const pair = pairs[index];
        if (pair === undefined)
          throw new RangeError("Pair index is out of range.");
        return pair;
      });
      const a = pooled(selected.map((pair) => pair.a));
      const b = pooled(selected.map((pair) => pair.b));
      return a === null || b === null ? null : a - b;
    },
    options,
  );
}
