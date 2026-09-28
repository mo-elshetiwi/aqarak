import { describe, expect, it } from "vitest";
import { fieldValuesMatch, normaliseFieldValue } from "./field-values.js";
import type { FieldType } from "./field-values.js";

describe("normaliseFieldValue", () => {
  it("normalises identifier digits and letters", () => {
    expect(normaliseFieldValue("id_number", "ab-٧٨٤ / ۱۲")).toBe("AB78412");
  });
  it("normalises names with alef variants", () => {
    expect(fieldValuesMatch("name", "أحمد علي", "إحمد على")).toBe(true);
  });
  it("normalises text", () => {
    expect(normaliseFieldValue("text", "[Hello] مدرسة")).toBe("hello مدرسه");
  });
  it.each([
    "2026-01-12",
    "12/01/2026",
    "12-01-2026",
    "12 Jan 2026",
    "12 January 2026",
    "١٢/٠١/٢٠٢٦",
    "۱۲ Jan ۲۰۲۶",
  ])("normalises date %s", (value) => {
    expect(fieldValuesMatch("date", value, "2026-01-12")).toBe(true);
  });
  it.each([
    "2026-02-29",
    "31/04/2026",
    "2026-13-01",
    "2026-00-01",
    "0000-01-01",
    "1 Foo 2026",
    "12/01-2026",
    "2026-01-00",
  ])("rejects invalid date %s", (value) => {
    expect(normaliseFieldValue("date", value)).toBeNull();
  });
  it("validates leap centuries without a clock", () => {
    expect(normaliseFieldValue("date", "2000-02-29")).toBe("2000-02-29");
    expect(normaliseFieldValue("date", "1900-02-29")).toBeNull();
  });
  it.each(["85000.00", "AED 85,000", "Dhs 85 000", "٨٥٬٠٠٠٫٠٠ درهم", "۸۵۰۰۰"])(
    "normalises money %s to integer fils",
    (value) => {
      expect(normaliseFieldValue("money", value)).toBe("8500000");
    },
  );
  it("preserves exact money cents and rejects extra decimal places", () => {
    expect(normaliseFieldValue("money", "1.01")).toBe("101");
    expect(normaliseFieldValue("money", "-0.05")).toBe("-5");
    expect(normaliseFieldValue("money", "1.001")).toBeNull();
    expect(normaliseFieldValue("money", "1.2.3")).toBeNull();
  });
  it("normalises digit-only integers", () => {
    expect(normaliseFieldValue("integer", "٠٠١٢")).toBe("12");
    expect(normaliseFieldValue("integer", "12x")).toBeNull();
    expect(normaliseFieldValue("integer", "-12")).toBeNull();
    expect(normaliseFieldValue("integer", 12)).toBe("12");
  });
  it("rounds decimals to one place using decimal half-away-from-zero", () => {
    expect(normaliseFieldValue("decimal", "١٢٫٢٥")).toBe("12.3");
    expect(normaliseFieldValue("decimal", "9.99")).toBe("10.0");
    expect(normaliseFieldValue("decimal", "-1.25")).toBe("-1.3");
    expect(normaliseFieldValue("decimal", "-0.01")).toBe("0.0");
    expect(normaliseFieldValue("decimal", "2")).toBe("2.0");
    expect(normaliseFieldValue("decimal", "12x")).toBeNull();
  });
  it.each([
    ["MALE", "M"],
    ["ذكر", "M"],
    ["FEMALE", "F"],
    ["أنثى", "F"],
    ["سكني", "RESIDENTIAL"],
    ["تجاري", "COMMERCIAL"],
    ["شقة", "APARTMENT"],
    ["فيلا", "VILLA"],
    ["تاون هاوس", "TOWNHOUSE"],
    ["أرض", "LAND"],
    ["ab-١٢", "AB12"],
  ])("maps code %s", (value, expected) => {
    expect(normaliseFieldValue("code", value)).toBe(expected);
  });
  it("maps synonyms after removing punctuation without inherited object keys", () => {
    expect(normaliseFieldValue("code", "MA-LE")).toBe("M");
    expect(normaliseFieldValue("code", "تاون-هاوس")).toBe("TOWNHOUSE");
    expect(normaliseFieldValue("code", "constructor")).toBe("CONSTRUCTOR");
  });
  it("returns null for empty, invalid and nonfinite values of every type", () => {
    const types: readonly FieldType[] = [
      "id_number",
      "name",
      "text",
      "date",
      "money",
      "integer",
      "decimal",
      "code",
    ];
    for (const type of types) {
      expect(normaliseFieldValue(type, null)).toBeNull();
      expect(normaliseFieldValue(type, " ")).toBeNull();
      expect(normaliseFieldValue(type, Infinity)).toBeNull();
    }
    expect(normaliseFieldValue("code", "---")).toBeNull();
    expect(normaliseFieldValue("name", "[]")).toBeNull();
  });
  it("does not match two invalid or absent values", () => {
    expect(fieldValuesMatch("date", "bad", "bad")).toBe(false);
    expect(fieldValuesMatch("money", null, null)).toBe(false);
    expect(fieldValuesMatch("integer", 1, 2)).toBe(false);
  });
});
