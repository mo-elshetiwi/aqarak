import { expect, it } from "vitest";
import { createBudgetGuard } from "./budget";
it("tracks spend and leaves uncapped classes unlimited", () => {
  const guard = createBudgetGuard({ mc1_document_extraction: 1 });
  expect(guard.canSpend("mc1_document_extraction")).toBe(true);
  guard.add("mc1_document_extraction", 19);
  expect(guard.spentMicroUsd("mc1_document_extraction")).toBe(19);
  expect(guard.canSpend("mc1_document_extraction")).toBe(false);
  expect(guard.canSpend("mc3_speech_to_text")).toBe(true);
  expect(() => {
    guard.add("mc1_document_extraction", 0.5);
  }).toThrow();
});
