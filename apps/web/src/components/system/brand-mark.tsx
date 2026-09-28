import type { ReactElement } from "react";
import Image from "next/image";
import type { Locale } from "@aqarak/i18n";

/** I pair the supplied mark with the interface wordmark in either locale. */
export function BrandMark({
  locale,
  size = 24,
}: {
  locale: Locale;
  size?: 24 | 40;
}): ReactElement {
  return (
    <span
      data-slot="brand-mark"
      className={`inline-flex shrink-0 items-center gap-3 font-semibold text-foreground ${size === 40 ? "text-display" : "text-label"}`}
    >
      <Image
        src="/brand/aqarak-icon-ink.svg"
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        className="block shrink-0 dark:hidden"
        unoptimized
      />
      <Image
        src="/brand/aqarak-icon-cream.svg"
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        className="hidden shrink-0 dark:block"
        unoptimized
      />
      <span>{locale === "ar" ? "عقارك" : "Aqarak"}</span>
    </span>
  );
}
