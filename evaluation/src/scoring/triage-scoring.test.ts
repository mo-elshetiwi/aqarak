import { describe, expect, it } from "vitest";
import { scoreTriage } from "./triage-scoring.js";
import type { TriageItem } from "./triage-scoring.js";

describe("scoreTriage", () => {
  const items: readonly TriageItem[] = [
    {
      itemId: "1",
      gold: { category: "repair", priority: "high", safety: "yes" },
      predicted: { category: "repair", priority: "high", safety: "unsure" },
    },
    {
      itemId: "2",
      gold: { category: "repair", priority: "low", safety: "yes" },
      predicted: { category: "billing", priority: "high", safety: "no" },
    },
    {
      itemId: "3",
      gold: { category: "billing", priority: "low", safety: "no" },
      predicted: { category: "billing", priority: "low", safety: "no" },
    },
    {
      itemId: "4",
      gold: { category: "billing", priority: "high", safety: "yes" },
      predicted: null,
    },
  ];
  it("computes macro-F1 and shows each gold class precision and recall", () => {
    const score = scoreTriage(items);
    expect(score.perClass).toEqual([
      {
        category: "billing",
        support: 2,
        truePositives: 1,
        falsePositives: 1,
        falseNegatives: 1,
        precision: 0.5,
        recall: 0.5,
        f1: 0.5,
      },
      {
        category: "repair",
        support: 2,
        truePositives: 1,
        falsePositives: 0,
        falseNegatives: 1,
        precision: 1,
        recall: 0.5,
        f1: 2 / 3,
      },
    ]);
    expect(score.macroF1).toBe((0.5 + 2 / 3) / 2);
    expect(score.priorityAccuracy).toBe(0.5);
    expect(score.abstentionRate).toBe(0.25);
  });
  it("counts unsure and yes as safety flags and lists every miss", () => {
    const score = scoreTriage(items);
    expect(score.safetyFlagRecall?.estimate).toBe(1 / 3);
    expect(score.safetyFlagRecall?.lower).toBeLessThan(1 / 3);
    expect(score.safetyFlagRecall?.upper).toBeGreaterThan(1 / 3);
    expect(score.safetyMisses).toEqual(["2", "4"]);
    expect(
      scoreTriage(
        items.map((item) => ({
          ...item,
          predicted: { ...item.gold, safety: "yes" },
        })),
      ).safetyFlagRecall?.estimate,
    ).toBe(1);
  });
  it("limits macro-F1 to gold categories and gives unpredicted classes zero", () => {
    const score = scoreTriage([
      {
        itemId: "1",
        gold: { category: "repair", priority: "high", safety: "no" },
        predicted: { category: "unknown", priority: "high", safety: "yes" },
      },
    ]);
    expect(score.perClass).toHaveLength(1);
    expect(score.macroF1).toBe(0);
    expect(score.perClass[0]?.precision).toBe(0);
    expect(score.safetyFlagRecall).toBeNull();
  });
  it("handles empty input without invented metrics", () => {
    expect(scoreTriage([])).toEqual({
      macroF1: null,
      perClass: [],
      priorityAccuracy: null,
      safetyFlagRecall: null,
      safetyMisses: [],
      abstentionRate: null,
    });
  });
  it("rejects duplicate item ids", () => {
    expect(() => scoreTriage([...items, ...items])).toThrow("unique");
  });
});
