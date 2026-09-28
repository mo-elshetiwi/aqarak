import { describe, it, expect } from "vitest";
import {
  getMessages,
  getDirection,
  isLocale,
  getAlternateLocale,
} from "./index";
function keyPaths(value: object, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, entry]: [string, unknown]) => {
    const path = `${prefix}${key}`;
    return typeof entry === "object" && entry !== null
      ? keyPaths(entry, `${path}.`)
      : [path];
  });
}
function leaves(value: object): unknown[] {
  return Object.values(value).flatMap((entry: unknown) =>
    typeof entry === "object" && entry !== null ? leaves(entry) : [entry],
  );
}
describe("catalogues", () => {
  it("provides the same key paths in both languages", () => {
    expect(keyPaths(getMessages("en")).sort()).toEqual(
      keyPaths(getMessages("ar")).sort(),
    );
  });
  it.each(["en", "ar"] as const)(
    "provides non-empty strings for every %s message",
    (locale) => {
      expect(
        leaves(getMessages(locale)).every(
          (value) => typeof value === "string" && value.trim().length > 0,
        ),
      ).toBe(true);
    },
  );
  it.each([
    ["en", "ltr"],
    ["ar", "rtl"],
  ] as const)("uses %s reading direction", (locale, direction) => {
    expect(getDirection(locale)).toBe(direction);
  });
  it("rejects an unsupported language", () => {
    expect(isLocale("fr")).toBe(false);
  });
  it.each(["en", "ar"] as const)("accepts supported locale %s", (locale) => {
    expect(isLocale(locale)).toBe(true);
  });
  it.each([
    ["en", "ar"],
    ["ar", "en"],
  ] as const)("switches %s to its alternate", (locale, alternate) => {
    expect(getAlternateLocale(locale)).toBe(alternate);
  });
});

it("includes all six Arabic branches in every ICU plural", () => {
  for (const value of leaves(getMessages("ar"))) {
    if (typeof value !== "string" || !/\{[^{}]+,\s*plural\s*,/.test(value))
      continue;
    for (const category of ["zero", "one", "two", "few", "many", "other"]) {
      expect(value).toMatch(new RegExp(`\\b${category}\\s*\\{`));
    }
  }
});
