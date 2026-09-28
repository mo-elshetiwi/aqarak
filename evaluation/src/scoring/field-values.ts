import { normaliseDigits, normaliseText } from "./text-normaliser.js";

export type FieldType =
  | "id_number"
  | "name"
  | "text"
  | "date"
  | "money"
  | "integer"
  | "decimal"
  | "code";
export type FieldValue = string | number | null;

const months = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const synonyms: ReadonlyMap<string, string> = new Map([
  ["male", "M"],
  ["ذكر", "M"],
  ["female", "F"],
  ["انثي", "F"],
  ["سكني", "RESIDENTIAL"],
  ["تجاري", "COMMERCIAL"],
  ["شقه", "APARTMENT"],
  ["فيلا", "VILLA"],
  ["تاونهاوس", "TOWNHOUSE"],
  ["ارض", "LAND"],
]);

function calendarDate(year: number, month: number, day: number): string | null {
  const leap = year % 4 === 0 && (year % 100 === 0 ? year % 400 === 0 : true);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const maximum = days[month - 1] ?? 0;
  if (year < 1 || year > 9999 || day < 1 || day > maximum) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normaliseDate(text: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(text);
  if (iso) return calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const numeric = /^(\d{2})([/-])(\d{2})\2(\d{4})$/u.exec(text);
  if (numeric)
    return calendarDate(
      Number(numeric[4]),
      Number(numeric[3]),
      Number(numeric[1]),
    );
  const named = /^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/iu.exec(text);
  if (named === null) return null;
  const monthName = (named[2] ?? "").toLowerCase();
  const month =
    months.findIndex(
      (name) => name === monthName || name.slice(0, 3) === monthName,
    ) + 1;
  return calendarDate(Number(named[3]), month, Number(named[1]));
}

function normaliseMoney(text: string): string | null {
  const clean = text
    .replace(/AED|Dhs|درهم/giu, "")
    .replace(/[,٬\s]/gu, "")
    .replace(/٫/gu, ".");
  if (/^[+-]?\d+(?:\.\d{1,2})?$/u.exec(clean) === null) return null;
  const negative = clean.startsWith("-");
  const [whole = "0", fraction = ""] = clean.replace(/^[+-]/u, "").split(".");
  const fils = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return String(negative ? -fils : fils);
}

function normaliseDecimal(text: string): string | null {
  const clean = text.replace(/٫/gu, ".");
  if (/^[+-]?\d+(?:\.\d+)?$/u.exec(clean) === null) return null;
  // Decimal string arithmetic avoids binary rounding at decimal half steps.
  const negative = clean.startsWith("-");
  const [whole = "0", fraction = ""] = clean.replace(/^[+-]/u, "").split(".");
  const tenths =
    BigInt(whole) * 10n +
    BigInt(fraction[0] ?? "0") +
    (Number(fraction[1] ?? "0") >= 5 ? 1n : 0n);
  return `${negative && tenths > 0n ? "-" : ""}${String(tenths / 10n)}.${String(tenths % 10n)}`;
}

function alphanumeric(text: string): string | null {
  const result = text.toUpperCase().replace(/[^\p{L}\p{N}]/gu, "");
  return result === "" ? null : result;
}

function normaliseTypedText(type: FieldType, text: string): string | null {
  switch (type) {
    case "id_number":
      return alphanumeric(text);
    case "name":
    case "text":
      return normaliseText(text) || null;
    case "date":
      return normaliseDate(text);
    case "money":
      return normaliseMoney(text);
    case "integer":
      return /^\d+$/u.test(text) ? String(BigInt(text)) : null;
    case "decimal":
      return normaliseDecimal(text);
    case "code":
      return (
        synonyms.get(normaliseText(text).replace(/[^\p{L}\p{N}]/gu, "")) ??
        alphanumeric(text)
      );
  }
}

/** Converts a typed field to its canonical comparable value, returning null for empty or unparseable input. */
export function normaliseFieldValue(
  type: FieldType,
  value: FieldValue,
): string | null {
  if (value === null) return null;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return normaliseTypedText(type, String(value));
    return null;
  }
  const text = normaliseDigits(value.normalize("NFKC")).trim();
  return text === "" ? null : normaliseTypedText(type, text);
}

/** Matches two parseable canonical field values without treating two invalid values as a match. */
export function fieldValuesMatch(
  type: FieldType,
  expected: FieldValue,
  returned: FieldValue,
): boolean {
  const expectedValue = normaliseFieldValue(type, expected);
  return expectedValue === null
    ? false
    : expectedValue === normaliseFieldValue(type, returned);
}
