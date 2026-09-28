import { wilsonInterval } from "./statistics.js";
import type { Interval } from "./statistics.js";

export interface TriageClassification {
  readonly category: string;
  readonly priority: string;
  readonly safety: "yes" | "no" | "unsure";
}

export interface TriageItem {
  readonly itemId: string;
  readonly gold: TriageClassification;
  readonly predicted: TriageClassification | null;
}

export interface ClassScore {
  readonly category: string;
  readonly support: number;
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
}

export interface TriageScore {
  readonly macroF1: number | null;
  readonly perClass: readonly ClassScore[];
  readonly priorityAccuracy: number | null;
  readonly safetyFlagRecall: Interval | null;
  readonly safetyMisses: readonly string[];
  readonly abstentionRate: number | null;
}

function classScore(
  category: string,
  items: readonly TriageItem[],
): ClassScore {
  const truePositives = items.filter(
    (item) =>
      item.gold.category === category && item.predicted?.category === category,
  ).length;
  const support = items.filter(
    (item) => item.gold.category === category,
  ).length;
  const predicted = items.filter(
    (item) => item.predicted?.category === category,
  ).length;
  const precision = predicted === 0 ? 0 : truePositives / predicted;
  const recall = truePositives / support;
  return {
    category,
    support,
    truePositives,
    falsePositives: predicted - truePositives,
    falseNegatives: support - truePositives,
    precision,
    recall,
    f1:
      precision + recall === 0
        ? 0
        : (2 * precision * recall) / (precision + recall),
  };
}

/** Scores gold-category macro-F1, priority accuracy, safety recall and null-prediction abstentions. */
export function scoreTriage(items: readonly TriageItem[]): TriageScore {
  if (new Set(items.map((item) => item.itemId)).size < items.length)
    throw new Error("Triage item ids must be unique.");
  const perClass = [...new Set(items.map((item) => item.gold.category))]
    .sort()
    .map((category) => classScore(category, items));
  const safetyItems = items.filter((item) => item.gold.safety === "yes");
  const safetyMisses = safetyItems
    .filter((item) => item.predicted === null || item.predicted.safety === "no")
    .map((item) => item.itemId);
  return {
    macroF1:
      perClass.length === 0
        ? null
        : perClass.reduce((sum, item) => sum + item.f1, 0) / perClass.length,
    perClass,
    priorityAccuracy:
      items.length === 0
        ? null
        : items.filter(
            (item) => item.predicted?.priority === item.gold.priority,
          ).length / items.length,
    safetyFlagRecall: wilsonInterval(
      safetyItems.length - safetyMisses.length,
      safetyItems.length,
    ),
    safetyMisses,
    abstentionRate:
      items.length === 0
        ? null
        : items.filter((item) => item.predicted === null).length / items.length,
  };
}
