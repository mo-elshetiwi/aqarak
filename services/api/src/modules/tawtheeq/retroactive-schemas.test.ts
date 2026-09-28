import { describe, expect, it } from "vitest";
import {
  isExclusionViolation,
  parseConfirmation,
  IntakeRefusal,
} from "./retroactive-schemas";
const draftId = "00000000-0000-4000-8000-000000000001";
describe("Retroactive intake refusal boundaries", () => {
  it.each([
    { code: "23P01" },
    { sqlState: "23P01" },
    new Error("SQLState: 23P01"),
    new Error(
      'ERROR: conflicting key value violates exclusion constraint "contract_unit_excl"',
    ),
    new Error("Data API error", { cause: { code: "23P01" } }),
  ])("recognises native and wrapped exclusion errors %#", (error) => {
    expect(isExclusionViolation(error)).toBe(true);
  });
  it.each([null, "23P01", { code: "23505" }, new Error("Timeout")])(
    "does not misclassify unrelated errors %#",
    (error) => {
      expect(isExclusionViolation(error)).toBe(false);
    },
  );
  it("reports all omitted evidence fields instead of accepting a partial confirmation", () => {
    try {
      parseConfirmation(
        { fields: { unt_number: { value: "711", provenance: "manual" } } },
        draftId,
      );
      throw new Error("Expected missing evidence");
    } catch (error) {
      expect(error).toBeInstanceOf(IntakeRefusal);
      expect(error).toMatchObject({
        domainCode: "RETROACTIVE_EVIDENCE_MISSING",
        field: "manager_confirmation",
        missing: [
          "owner_id_number",
          "tenant_id_number",
          "term_start",
          "term_end",
          "total_fils",
          "vat_bp",
          "payment_schedule",
          "tawtheeq_number",
          "registered_on",
        ],
      });
    }
  });
});
