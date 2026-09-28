import { requireValid } from "./validation.js";

export interface ScreeningCandidate {
  readonly candidateId: string;
  readonly schemaValidRate: number;
  readonly primary: number;
  readonly criticalFailures: number;
}

export type ScreeningMargin =
  | {
      readonly kind: "absolute";
      readonly value: number;
      readonly higherIsBetter: true;
    }
  | {
      readonly kind: "relative";
      readonly value: number;
      readonly higherIsBetter: false;
    };

export interface ScreeningDecision {
  readonly candidateId: string;
  readonly decision: "survives" | "rejected";
  readonly reasons: readonly string[];
}

function validateCandidate(candidate: ScreeningCandidate): void {
  const { schemaValidRate, primary, criticalFailures } = candidate;
  requireValid(
    Number.isFinite(schemaValidRate) &&
      schemaValidRate >= 0 &&
      schemaValidRate <= 1 &&
      Number.isFinite(primary) &&
      primary >= 0 &&
      Number.isSafeInteger(criticalFailures) &&
      criticalFailures >= 0,
    "Candidate metrics must be finite and nonnegative, schema-valid rate at most one, and critical failures an integer.",
  );
}

function decisionFor(
  candidate: ScreeningCandidate,
  margin: ScreeningMargin,
  best: number,
): ScreeningDecision {
  const reasons: string[] = [];
  if (candidate.schemaValidRate < 0.95)
    reasons.push(
      `Schema-valid rate ${String(candidate.schemaValidRate)} is below 0.95.`,
    );
  if (candidate.criticalFailures > 0)
    reasons.push(
      `Critical failures ${String(candidate.criticalFailures)} exceed 0.`,
    );
  const threshold =
    margin.kind === "absolute"
      ? best - 3 * margin.value
      : best * (1 + 3 * margin.value);
  // A scale-relative tolerance preserves inclusive boundaries under binary arithmetic.
  const tolerance =
    margin.value === 0
      ? 0
      : Number.EPSILON *
        Math.max(
          Math.abs(best),
          Math.abs(candidate.primary),
          Math.abs(threshold),
        ) *
        4;
  const outside =
    margin.kind === "absolute"
      ? threshold - candidate.primary > tolerance
      : candidate.primary - threshold > tolerance;
  if (outside)
    reasons.push(
      margin.kind === "absolute"
        ? `Primary accuracy ${String(candidate.primary)} is below ${String(threshold)}, the best ${String(best)} minus three margins of ${String(margin.value)}.`
        : `Primary error rate ${String(candidate.primary)} exceeds ${String(threshold)}, the best ${String(best)} times one plus three margins of ${String(margin.value)}.`,
    );
  return {
    candidateId: candidate.candidateId,
    decision: reasons.length === 0 ? "survives" : "rejected",
    reasons,
  };
}

/** Applies schema, critical-failure and inclusive three-margin screening gates against the best primary metric. */
export function applyScreeningRules(options: {
  readonly candidates: readonly ScreeningCandidate[];
  readonly margin: ScreeningMargin;
}): readonly ScreeningDecision[] {
  const { candidates, margin } = options;
  requireValid(
    Number.isFinite(margin.value) && margin.value >= 0,
    "Screening margin must be finite and nonnegative.",
  );
  candidates.forEach(validateCandidate);
  if (
    new Set(candidates.map((candidate) => candidate.candidateId)).size <
    candidates.length
  )
    throw new Error("Candidate ids must be unique.");
  if (candidates.length === 0) return [];
  const best = candidates.reduce(
    (value, candidate) =>
      margin.higherIsBetter
        ? Math.max(value, candidate.primary)
        : Math.min(value, candidate.primary),
    margin.higherIsBetter ? -Infinity : Infinity,
  );
  return candidates.map((candidate) => decisionFor(candidate, margin, best));
}
