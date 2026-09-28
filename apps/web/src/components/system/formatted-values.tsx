import type { ReactElement } from "react";
import type { Locale } from "@aqarak/i18n";
import {
  formatMoney,
  formatDate,
  formatRelativeAge,
  maskIdentifier,
  stripBidiControls,
} from "@/lib/format";
export function MoneyAmount({
  fils,
  locale,
}: {
  fils: number;
  locale: Locale;
}): ReactElement {
  return (
    <span data-slot="money-amount" className="text-body-strong tabular-nums">
      <bdi>{formatMoney(fils, locale)}</bdi>
    </span>
  );
}
export function DateText({
  iso,
  locale,
  relativeTo,
}: {
  iso: string;
  locale: Locale;
  relativeTo?: string;
}): ReactElement {
  return (
    <time dateTime={iso} className="tabular-nums">
      <bdi dir="ltr">{formatDate(iso, locale)}</bdi>
      {relativeTo && (
        <span className="ms-2 text-caption text-muted-foreground">
          ({formatRelativeAge(iso, relativeTo, locale)})
        </span>
      )}
    </time>
  );
}
export type IdentifierKind =
  "emirates_id" | "unt" | "prp" | "cheque" | "tawtheeq";
export function IdentifierText({
  value,
  kind,
  masked = false,
}: {
  value: string;
  kind: IdentifierKind;
  masked?: boolean;
}): ReactElement {
  return (
    <bdi
      dir="ltr"
      data-kind={kind}
      className="font-mono text-mono tabular-nums"
    >
      {masked ? maskIdentifier(value) : stripBidiControls(value)}
    </bdi>
  );
}
