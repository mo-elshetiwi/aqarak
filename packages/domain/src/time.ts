import { z } from "zod";

/** Validates an Asia/Dubai calendar date when storing a date without a time. */
export const localDate = z.iso.date().brand<"LocalDate">();
/** Represents an Asia/Dubai calendar date for date based domain decisions. */
export type LocalDate = z.infer<typeof localDate>;
/** Validates a UTC instant with at most microsecond precision when recording event times. */
export const utcInstant = z.iso
  .datetime()
  .refine((value) => !/\.\d{7,}Z$/.test(value))
  .brand<"UtcInstant">();
/** Represents a validated UTC instant when recording an event time. */
export type UtcInstant = z.infer<typeof utcInstant>;

const millisecondsPerDay = 86_400_000;

function dateAtMidnight(date: LocalDate): Date {
  return new Date(`${date}T00:00:00Z`);
}

function calendarDate(date: Date): LocalDate {
  if (
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() < 0 ||
    date.getUTCFullYear() > 9999
  ) {
    throw new RangeError(
      "Calendar date is outside the supported four digit year range",
    );
  }
  return localDate.parse(date.toISOString().slice(0, 10));
}

function requireIntegerOffset(offset: number): void {
  if (!Number.isSafeInteger(offset)) {
    throw new RangeError("Calendar offset must be a safe integer");
  }
}

/** Orders calendar dates when comparing domain deadlines or term boundaries. */
export function compareLocalDates(a: LocalDate, b: LocalDate): -1 | 0 | 1 {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Adds calendar days when moving a date across month or year boundaries.
 * @throws {RangeError} If the offset is not a safe integer or the resulting year is unsupported.
 */
export function addDays(date: LocalDate, days: number): LocalDate {
  requireIntegerOffset(days);
  const result = dateAtMidnight(date);
  result.setUTCDate(result.getUTCDate() + days);
  return calendarDate(result);
}

/**
 * Adds calendar months and clamps to month end when moving a term boundary.
 * @throws {RangeError} If the offset is not a safe integer or the resulting year is unsupported.
 */
export function addMonths(date: LocalDate, months: number): LocalDate {
  requireIntegerOffset(months);
  const result = dateAtMidnight(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const monthEnd = new Date(result.getTime());
  monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);
  result.setUTCDate(Math.min(day, monthEnd.getUTCDate()));
  return calendarDate(result);
}

/** Counts signed calendar days when measuring the distance between two dates. */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return (
    (dateAtMidnight(to).getTime() - dateAtMidnight(from).getTime()) /
    millisecondsPerDay
  );
}

/**
 * Converts a UTC instant to its Asia/Dubai date when evaluating local deadlines.
 * @throws {RangeError} If the resulting local year is outside the supported four digit range.
 */
export function localDateOf(instant: UtcInstant): LocalDate {
  // Asia/Dubai is UTC+4 without daylight saving, so the calendar conversion uses a fixed offset.
  return calendarDate(
    new Date(new Date(instant).getTime() + 4 * 60 * 60 * 1000),
  );
}
