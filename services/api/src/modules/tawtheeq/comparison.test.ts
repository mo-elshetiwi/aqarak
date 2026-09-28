import { describe, expect, it } from "vitest";
import {
  amountFils,
  compareFields,
  contractContentHash,
  digits,
  normaliseField,
} from "./comparison";
import { magicMatches } from "./uploads";
describe("AC-15 deterministic comparison normalisation", () => {
  it("compares Western and Arabic identity digits without separators", () => {
    expect(digits("٧٨٤-١٩٦٤-٠٠٠٢٩٩٠-٤")).toBe("784196400029904");
    expect(
      compareFields(
        { tenant_id_number: "784196400029904" },
        { tenant_id_number: "784-1964-0002990-4" },
      ).find((item) => item.field === "tenant_id_number")?.status,
    ).toBe("match");
  });
  it("converts exact AED decimals to integer fils and refuses fractional fils", () => {
    expect(amountFils("72000.00")).toBe(7200000);
    expect(amountFils("0.01")).toBe(1);
    expect(amountFils(7200000)).toBe(7200000);
    expect(() => amountFils("1.001")).toThrow();
  });
  it("validates ISO dates and rejects invalid dates", () => {
    expect(normaliseField("term_start", "2026-08-13")).toBe("2026-08-13");
    expect(() => normaliseField("term_start", "2026-02-30")).toThrow();
  });
  it("reports folded names as format_only and missing sides explicitly", () => {
    const result = compareFields(
      { owner_name: "Omar Al Nuaimi", tenant_name: "Mohammed Farouk" },
      { owner_name: " OMAR  AL NUAIMI ", annual_rent_fils: 1 },
    );
    expect(result.find((item) => item.field === "owner_name")?.status).toBe(
      "format_only",
    );
    expect(result.find((item) => item.field === "tenant_name")?.status).toBe(
      "missing_registered",
    );
    expect(
      result.find((item) => item.field === "annual_rent_fils")?.status,
    ).toBe("missing_contract");
  });
});
it("AC-16 canonical content hash ignores key order and changes with every term", () => {
  const terms = {
    term_start: "2026-08-13",
    term_end: "2027-08-12",
    annual_rent_fils: 7000000,
    deposit_fils: 2030000,
    vat_bp: 500,
    frozen_owner_gate: true,
  };
  const hash = contractContentHash(terms);
  expect(
    contractContentHash(Object.fromEntries(Object.entries(terms).reverse())),
  ).toBe(hash);
  for (const [key, value] of Object.entries(terms))
    expect(
      contractContentHash({
        ...terms,
        [key]:
          typeof value === "number"
            ? value + 1
            : typeof value === "boolean"
              ? !value
              : `${value}x`,
      }),
    ).not.toBe(hash);
});
it("requires each declared file signature", () => {
  expect(magicMatches("image/png", Buffer.from("89504e47", "hex"))).toBe(true);
  expect(magicMatches("image/jpeg", Buffer.from("ffd8ff", "hex"))).toBe(true);
  expect(magicMatches("application/pdf", Buffer.from("25504446", "hex"))).toBe(
    true,
  );
  expect(magicMatches("application/pdf", Buffer.from("89504e47", "hex"))).toBe(
    false,
  );
});
