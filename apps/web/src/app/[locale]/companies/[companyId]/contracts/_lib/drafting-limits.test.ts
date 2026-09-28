import { describe, expect, it } from "vitest";
import { draft } from "./test-fixtures";
import { draftInputSchema, suggestionInputSchema } from "./schemas";
describe("Documented drafting limits", () => {
  it("refuses oversized suggestions before transport", () => {
    expect(
      suggestionInputSchema.safeParse({ textEn: "x".repeat(2000) }).success,
    ).toBe(true);
    expect(
      suggestionInputSchema.safeParse({ textEn: "x".repeat(2001) }).success,
    ).toBe(false);
  });
  it("enforces clause, instalment and money limits", () => {
    const input = draft();
    const clause = {
      textEn: "Synthetic clause",
      textAr: "شرط تجريبي",
      modelTranslated: false,
    };
    expect(
      draftInputSchema.safeParse({
        ...input,
        specialClauses: Array.from({ length: 11 }, () => clause),
      }).success,
    ).toBe(false);
    expect(
      draftInputSchema.safeParse({
        ...input,
        specialClauses: [{ ...clause, textAr: "س".repeat(2001) }],
      }).success,
    ).toBe(false);
    expect(
      draftInputSchema.safeParse({
        ...input,
        instalments: Array.from({ length: 25 }, (_, index) => ({
          ...input.instalments[0],
          seqNo: index + 1,
        })),
      }).success,
    ).toBe(false);
    expect(
      draftInputSchema.safeParse({ ...input, annualRentFils: 100_000_000_001 })
        .success,
    ).toBe(false);
  });
});

it("retains exact Arabic whitespace while refusing a blank clause", () => {
  const input = draft();
  const clause = {
    textEn: "Synthetic clause",
    textAr: " نص عربي ",
    modelTranslated: true,
    suggestionId: "60000000-0000-4000-8000-000000000099",
  };
  expect(
    draftInputSchema.parse({ ...input, specialClauses: [clause] })
      .specialClauses[0]?.textAr,
  ).toBe(clause.textAr);
  expect(
    draftInputSchema.safeParse({
      ...input,
      specialClauses: [{ ...clause, textAr: "   " }],
    }).success,
  ).toBe(false);
});
