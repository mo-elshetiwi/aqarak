import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isLocale } from "@aqarak/i18n";
import { LanguageSwitch } from "@/components/system/language-switch";
/** Renders the localised entry screen and a link to its alternate language. */
export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<ReactNode> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const translate = await getTranslations({ locale });
  return (
    <main
      id="main"
      className="flex min-h-svh items-center justify-center ps-6 pe-6"
    >
      <div className="flex max-w-lg flex-col items-start gap-6 text-start">
        <h1 className="text-h1">{translate("Home.title")}</h1>
        <p className="text-body text-muted-foreground">
          {translate("Home.description")}
        </p>
        <LanguageSwitch href="/" />
      </div>
    </main>
  );
}
