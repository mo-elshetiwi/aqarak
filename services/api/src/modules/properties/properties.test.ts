import { describe, expect, it } from "vitest";
import {
  bulkUnitsSchema,
  unitStatusSchema,
  updatePropertySchema,
} from "./schemas";
describe("Property and unit command schemas", () => {
  it("AC-12 bulk requests contain one to one hundred units", () => {
    const unit = { unitNo: "S-1", use: "residential", kind: "apartment" };
    expect(bulkUnitsSchema.safeParse({ units: [unit] }).success).toBe(true);
    expect(bulkUnitsSchema.safeParse({ units: [] }).success).toBe(false);
    expect(
      bulkUnitsSchema.safeParse({
        units: Array.from({ length: 101 }, () => unit),
      }).success,
    ).toBe(false);
  });
  it.each([
    "move_in",
    "move_out",
    "submit_contract",
    "retroactive_move_in",
    "record_notice",
  ])("AC-13 IN4 excludes contract-driven command %s", (command) => {
    expect(
      unitStatusSchema.safeParse({
        expectedVersion: 1,
        command,
        reason: "Synthetic reason",
      }).success,
    ).toBe(false);
  });
  it("AC-13 requires a reason and a closed blockReason choice", () => {
    expect(
      unitStatusSchema.safeParse({
        expectedVersion: 1,
        command: "block",
        reason: "Synthetic reason",
        blockReason: "sale",
      }).success,
    ).toBe(true);
    expect(
      unitStatusSchema.safeParse({
        expectedVersion: 1,
        command: "block",
        reason: "Synthetic reason",
      }).success,
    ).toBe(false);
    expect(
      unitStatusSchema.safeParse({ expectedVersion: 1, command: "list" })
        .success,
    ).toBe(false);
    expect(
      unitStatusSchema.safeParse({
        expectedVersion: 1,
        command: "list",
        reason: "x".repeat(501),
      }).success,
    ).toBe(false);
  });
  it("rejects empty property edits and malformed decimal areas", () => {
    expect(updatePropertySchema.safeParse({ expectedVersion: 1 }).success).toBe(
      false,
    );
    expect(
      bulkUnitsSchema.safeParse({
        units: [
          {
            unitNo: "S-1",
            use: "residential",
            kind: "apartment",
            areaSqm: "20.50",
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      bulkUnitsSchema.safeParse({
        units: [
          {
            unitNo: "S-1",
            use: "residential",
            kind: "apartment",
            areaSqm: "0",
          },
        ],
      }).success,
    ).toBe(false);
  });
});
