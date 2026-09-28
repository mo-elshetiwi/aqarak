import { getMessages, type Locale } from "@aqarak/i18n";
import { createTranslator } from "use-intl";
function translate(locale: Locale): ReturnType<typeof createTranslator> {
  return createTranslator({
    locale: `${locale}-u-nu-latn`,
    messages: getMessages(locale).Mobile.Format,
  });
}
/** Integer fils are formatted using integer arithmetic throughout, including safe-integer boundaries. */
export function formatMoney(fils: number, locale: Locale): string {
  if (!Number.isSafeInteger(fils))
    throw new RangeError("Money requires safe integer fils");
  const value = BigInt(fils);
  const absolute = value < 0n ? -value : value;
  const whole = (absolute / 100n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (absolute % 100n).toString().padStart(2, "0");
  return `${value < 0n ? "-" : ""}${translate(locale)("money", { amount: `${whole}.${fraction}` })}`;
}
function date(value: string | Date): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()))
    throw new RangeError("A valid date is required");
  return parsed;
}
/** Gregorian Dubai dates always use Western digits and day/month/year ordering. */
export function formatDate(value: string | Date): string {
  return new Intl.DateTimeFormat("en-GB-u-ca-gregory-nu-latn", {
    timeZone: "Asia/Dubai",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date(value));
}
/** Twenty-four-hour Dubai time never adopts locale-specific digits. */
export function formatTime(value: string | Date): string {
  return new Intl.DateTimeFormat("en-GB-u-ca-gregory-nu-latn", {
    timeZone: "Asia/Dubai",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date(value));
}
/** Calendar age uses an injected clock and Dubai's fixed UTC offset. */
export function formatAge(
  value: string | Date,
  now: string | Date,
  locale: Locale,
): string {
  const dubaiDay = (input: string | Date): number =>
    Math.floor((date(input).getTime() + 4 * 60 * 60_000) / 86_400_000);
  return translate(locale)("age", {
    count: Math.max(0, dubaiDay(now) - dubaiDay(value)),
  });
}
/** Normalize Arabic and Persian digits without changing identifier separators. */
export function westernIdentifier(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const arabic = "٠١٢٣٤٥٦٧٨٩".indexOf(digit);
    return String(arabic >= 0 ? arabic : "۰۱۲۳۴۵۶۷۸۹".indexOf(digit));
  });
}
/** Keep the first and last three digits, preserving every separator in place. */
export function maskIdentifier(value: string): string {
  const normalized = westernIdentifier(value);
  const count = normalized.replace(/\D/g, "").length;
  let index = 0;
  return normalized.replace(/\d/g, (digit) => {
    const visible = index < 3 || index >= count - 3;
    index += 1;
    return visible ? digit : "•";
  });
}
