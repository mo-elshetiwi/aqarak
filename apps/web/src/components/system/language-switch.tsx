"use client";
import type { ReactElement } from "react";
import { useLocale, useTranslations } from "next-intl";
import { getAlternateLocale, isLocale } from "@aqarak/i18n";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";

/** Preserves the destination and the visible target-language accessible name. */
export function LanguageSwitch({ href }: { href: string }): ReactElement {
  const current = useLocale();
  const alternate = getAlternateLocale(isLocale(current) ? current : "en");
  const translate = useTranslations("LocaleSwitcher");
  return (
    <Link
      href={href}
      locale={alternate}
      hrefLang={alternate}
      className={buttonVariants({
        variant: "outline",
        size: "lg",
        className: "min-w-6",
      })}
    >
      <span className="sr-only">{translate("label")} </span>
      <span lang={alternate}>{translate("target")}</span>
    </Link>
  );
}
