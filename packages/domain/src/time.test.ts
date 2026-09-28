import { describe, it, expect } from "vitest";
import {
  addDays,
  addMonths,
  compareLocalDates,
  daysBetween,
  localDate,
  localDateOf,
  utcInstant,
} from "./index";

describe("calendar validation", () => {
  it.each([
    "2026-09-28",
    "2028-02-29",
    "0000-01-01",
    "0099-12-31",
    "9999-12-31",
  ])("accepts an ISO calendar date: %s", (value) => {
    expect(localDate.parse(value)).toBe(value);
  });
  it.each([
    "2026-02-29",
    "2026-13-01",
    "2026-04-31",
    "28-09-2026",
    "2026-9-28",
    "2026-09-28T00:00:00Z",
  ])("refuses an invalid calendar date: %s", (value) => {
    expect(localDate.safeParse(value).success).toBe(false);
  });
  it.each([
    "2026-09-28T10:00:00Z",
    "2026-09-28T10:00:00.1Z",
    "2026-09-28T10:00:00.123456Z",
  ])("accepts a UTC instant through microsecond precision: %s", (value) => {
    expect(utcInstant.parse(value)).toBe(value);
  });
  it.each([
    "2026-09-28T10:00:00+04:00",
    "2026-09-28T10:00:00+00:00",
    "2026-09-28T10:00:00",
    "2026-09-28T10:00:00.1234567Z",
    "2026-02-29T10:00:00Z",
  ])("refuses an unsupported instant: %s", (value) => {
    expect(utcInstant.safeParse(value).success).toBe(false);
  });
});

describe("calendar arithmetic", () => {
  it.each([
    ["2026-08-31", 6, "2027-02-28"],
    ["2027-08-31", 6, "2028-02-29"],
    ["2026-03-31", -1, "2026-02-28"],
    ["2026-12-15", 2, "2027-02-15"],
    ["2026-01-15", -2, "2025-11-15"],
    ["2026-01-31", 0, "2026-01-31"],
    ["0099-12-31", 1, "0100-01-31"],
    ["0000-01-31", 1, "0000-02-29"],
    ["9999-11-30", 1, "9999-12-30"],
  ] as const)(
    "adds %s by %s months and clamps to %s",
    (date, offset, expected) => {
      expect(addMonths(localDate.parse(date), offset)).toBe(expected);
    },
  );
  it.each([
    ["2026-09-30", 1, "2026-10-01"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2027-01-01", -1, "2026-12-31"],
    ["2028-02-28", 1, "2028-02-29"],
    ["2026-09-28", 0, "2026-09-28"],
    ["0099-12-31", 1, "0100-01-01"],
  ] as const)("adds %s by %s days to reach %s", (date, offset, expected) => {
    expect(addDays(localDate.parse(date), offset)).toBe(expected);
  });
  it.each([
    ["2026-09-30", "2026-10-02", 2],
    ["2026-12-31", "2027-01-02", 2],
    ["2027-01-02", "2026-12-31", -2],
    ["2026-09-28", "2026-09-28", 0],
    ["2028-02-28", "2028-03-01", 2],
  ] as const)("counts days from %s to %s as %s", (from, to, expected) => {
    expect(daysBetween(localDate.parse(from), localDate.parse(to))).toBe(
      expected,
    );
  });
  it.each([
    ["2026-09-27", "2026-09-28", -1],
    ["2026-09-28", "2026-09-28", 0],
    ["2026-09-29", "2026-09-28", 1],
  ] as const)("orders %s relative to %s as %s", (a, b, expected) => {
    expect(compareLocalDates(localDate.parse(a), localDate.parse(b))).toBe(
      expected,
    );
  });
  it.each([0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "throws for an invalid day offset: %s",
    (offset) => {
      expect(() => addDays(localDate.parse("2026-09-28"), offset)).toThrow(
        RangeError,
      );
    },
  );
  it.each([0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "throws for an invalid month offset: %s",
    (offset) => {
      expect(() => addMonths(localDate.parse("2026-09-28"), offset)).toThrow(
        RangeError,
      );
    },
  );
  it.each([
    ["9999-12-31", 1],
    ["0000-01-01", -1],
    ["2026-09-28", Number.MAX_SAFE_INTEGER],
  ] as const)(
    "throws when adding days exceeds the supported calendar: %s + %s",
    (date, offset) => {
      expect(() => addDays(localDate.parse(date), offset)).toThrow(RangeError);
    },
  );
  it.each([
    ["9999-12-31", 1],
    ["0000-01-01", -1],
    ["2026-09-28", Number.MAX_SAFE_INTEGER],
  ] as const)(
    "throws when adding months exceeds the supported calendar: %s + %s",
    (date, offset) => {
      expect(() => addMonths(localDate.parse(date), offset)).toThrow(
        RangeError,
      );
    },
  );
});

describe("Dubai calendar conversion", () => {
  it.each([
    ["2026-09-27T20:00:00Z", "2026-09-28"],
    ["2026-09-27T19:59:59.999999Z", "2026-09-27"],
    ["2026-12-31T20:00:00Z", "2027-01-01"],
    ["2026-06-30T20:00:00Z", "2026-07-01"],
  ])("maps %s to the Dubai calendar date %s", (instant, expected) => {
    expect(localDateOf(utcInstant.parse(instant))).toBe(expected);
  });
  it("throws when the Dubai date exceeds the supported year range", () => {
    expect(() => localDateOf(utcInstant.parse("9999-12-31T20:00:00Z"))).toThrow(
      RangeError,
    );
  });
});
