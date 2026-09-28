import { getMessages, type Locale } from "@aqarak/i18n";

/** Removes directional controls from values intended for copying. */
export function stripBidiControls(value: string): string {
  return value.replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "");
}
/** Formats integer fils with Western digits and the local currency label. */
export function formatMoney(fils: number, locale: Locale): string {
  if (!Number.isSafeInteger(fils))
    throw new TypeError("Money requires safe integer fils");
  const amount = new Intl.NumberFormat("en-AE", {
    numberingSystem: "latn",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(fils / 100);
  const currency = getMessages(locale).Format.currency;
  return stripBidiControls(
    locale === "ar" ? `${amount} ${currency}` : `${currency} ${amount}`,
  );
}
function parseDate(iso: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}(?:$|T.*(?:Z|[+-]\d{2}:\d{2})$)/.test(iso)) {
    throw new TypeError(
      "Use an ISO date or timestamp with an explicit time zone",
    );
  }
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) throw new TypeError("Invalid ISO date");
  if (iso.length === 10 && date.toISOString().slice(0, 10) !== iso)
    throw new TypeError("Invalid calendar date");
  return date;
}
/** Formats a Gregorian calendar date in the company's Dubai time zone. */
export function formatDate(iso: string, locale: Locale): string {
  const parts = new Intl.DateTimeFormat(locale, {
    numberingSystem: "latn",
    calendar: "gregory",
    timeZone: "Asia/Dubai",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(parseDate(iso));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((value) => value.type === type)?.value ?? "";
  return stripBidiControls(`${part("day")}/${part("month")}/${part("year")}`);
}
/** Produces a deterministic age when the caller supplies the reference time. */
export function formatRelativeAge(
  iso: string,
  now: string,
  locale: Locale,
): string {
  const seconds = (parseDate(iso).getTime() - parseDate(now).getTime()) / 1000;
  const absolute = Math.abs(seconds);
  const unit = absolute < 3600 ? "minute" : absolute < 86400 ? "hour" : "day";
  const divisor = unit === "minute" ? 60 : unit === "hour" ? 3600 : 86400;
  return stripBidiControls(
    new Intl.RelativeTimeFormat(
      new Intl.Locale(locale, { numberingSystem: "latn" }).toString(),
      {
        numeric: "auto",
      },
    ).format(Math.trunc(seconds / divisor), unit),
  );
}
/** Preserves separators and the first and last three digits. */
export function maskIdentifier(value: string): string {
  const clean = stripBidiControls(value);
  const total = (clean.match(/\d/g) ?? []).length;
  let index = 0;
  return clean.replace(/\d/g, (digit) => {
    const visible = index < 3 || index >= total - 3;
    index += 1;
    return visible ? digit : "•";
  });
}
