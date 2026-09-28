import type { ReactElement } from "react";
import { getMessages, type Locale } from "@aqarak/i18n";
import type { CompanyContext } from "@/lib/api/contract";
import { capacitiesFor } from "@/lib/navigation/sections";
export function capacityWords(context: CompanyContext, locale: Locale): string {
  const words = getMessages(locale).Shell;
  return new Intl.ListFormat(locale, {
    style: "long",
    type: "conjunction",
  }).format(capacitiesFor(context).map((capacity) => words[capacity]));
}
export function DemoTag({ locale }: { locale: Locale }): ReactElement {
  return (
    <span className="inline-flex rounded-sm border border-status-attention-border bg-status-attention-bg ps-2 pe-2 text-caption-strong text-status-attention-fg">
      {getMessages(locale).Shell.demo}
    </span>
  );
}
