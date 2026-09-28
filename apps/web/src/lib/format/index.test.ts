import { describe, it, expect } from "vitest";
import {
  formatMoney,
  formatDate,
  formatRelativeAge,
  maskIdentifier,
  stripBidiControls,
} from "./index";

describe("copyable property values", () => {
  it("formats integer fils exactly in both languages", () => {
    expect(formatMoney(8_500_000, "en")).toBe("AED 85,000.00");
    expect(formatMoney(8_500_000, "ar")).toBe("85,000.00 درهم");
    expect(formatMoney(1, "en")).toBe("AED 0.01");
    expect(() => formatMoney(1.5, "en")).toThrow(TypeError);
    expect(() => formatMoney(Number.NaN, "ar")).toThrow(TypeError);
  });
  it.each(["en", "ar"] as const)(
    "formats Gregorian dates in Dubai with Western digits in %s",
    (locale) => {
      expect(formatDate("2026-09-28", locale)).toBe("28/09/2026");
      expect(formatDate("2026-09-27T21:00:00Z", locale)).toBe("28/09/2026");
      expect(() => formatDate("2026-02-30", locale)).toThrow(TypeError);
      expect(() => formatDate("2026-09-28T12:00:00", locale)).toThrow(
        TypeError,
      );
      const age = formatRelativeAge("2026-09-25", "2026-09-28", locale);
      expect(age).toContain("3");
      expect(age).toBe(stripBidiControls(age));
      expect(formatMoney(8_500_000, locale)).toBe(
        stripBidiControls(formatMoney(8_500_000, locale)),
      );
    },
  );
  it("preserves the identifier's hyphens and boundary digits", () => {
    expect(maskIdentifier("784-1978-4829123-1")).toBe("784-••••-•••••23-1");
    expect(maskIdentifier("784-1978-4829163-5")).toBe("784-••••-•••••63-5");
    expect(maskIdentifier("PRP-123456789")).toBe("PRP-123•••789");
    expect(maskIdentifier("123")).toBe("123");
    expect(maskIdentifier("\u202e784-1978-4829163-5\u202c")).toBe(
      "784-••••-•••••63-5",
    );
  });
});
