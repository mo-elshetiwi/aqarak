import type { ReactElement } from "react";
import { getMessages, type Locale } from "@aqarak/i18n";
import { MoneyAmount } from "@/components/system/formatted-values";
import type { MandateInput } from "../contract";
export function EstateMoneyAmount({
  fils,
  locale,
}: {
  fils: MandateInput["costThresholdFils"];
  locale: Locale;
}): ReactElement {
  const integer = BigInt(fils);
  if (integer <= 4_503_599_627_370_495n)
    return <MoneyAmount fils={Number(integer)} locale={locale} />;
  const whole = new Intl.NumberFormat("en-AE", {
    numberingSystem: "latn",
    maximumFractionDigits: 0,
  }).format(integer / 100n);
  const amount = `${whole}.${String(integer % 100n).padStart(2, "0")}`;
  const currency = getMessages(locale).Format.currency;
  return (
    <span className="text-body-strong tabular-nums">
      <bdi dir="ltr">
        {locale === "ar" ? `${amount} ${currency}` : `${currency} ${amount}`}
      </bdi>
    </span>
  );
}
