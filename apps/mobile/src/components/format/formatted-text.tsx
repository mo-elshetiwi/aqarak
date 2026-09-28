import type { ReactNode } from "react";
import { Text } from "@/components/ui/text";
import { useLocale } from "@/features/locale/locale-provider";
import {
  formatMoney,
  formatDate,
  formatTime,
  formatAge,
  maskIdentifier,
  westernIdentifier,
} from "./format";
/** Tabular figures keep money readable without floating-point conversion. */
export function Money({ fils }: { fils: number }): ReactNode {
  const { locale } = useLocale();
  return (
    <Text variant="bodyStrong" style={{ fontVariant: ["tabular-nums"] }}>
      {formatMoney(fils, locale)}
    </Text>
  );
}
/** Optional age is deterministic because the caller supplies its clock. */
export function DateText({
  value,
  now,
}: {
  value: string;
  now?: string;
}): ReactNode {
  const { locale } = useLocale();
  return (
    <Text style={{ fontVariant: ["tabular-nums"] }}>
      {formatDate(value)}
      {now ? ` · ${formatAge(value, now, locale)}` : ""}
    </Text>
  );
}
/** Times retain the same clock and digit conventions as dates. */
export function TimeText({ value }: { value: string }): ReactNode {
  return (
    <Text style={{ writingDirection: "ltr", fontVariant: ["tabular-nums"] }}>
      {formatTime(value)}
    </Text>
  );
}
/** Unicode isolation protects identifier order even when nested inside an Arabic sentence. */
export function Identifier({
  value,
  masked = false,
}: {
  value: string;
  masked?: boolean;
}): ReactNode {
  const display = masked ? maskIdentifier(value) : westernIdentifier(value);
  return (
    <Text
      variant="mono"
      style={{ writingDirection: "ltr" }}
    >{`\u2066${display}\u2069`}</Text>
  );
}
