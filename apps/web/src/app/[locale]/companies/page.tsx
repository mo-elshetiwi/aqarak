import type { Metadata } from "next";
import type { ReactElement } from "react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isLocale } from "@aqarak/i18n";
import { requireSession } from "@/lib/session/session";
import { PageHeader } from "@/components/system/page-header";
import { LanguageSwitch } from "@/components/system/language-switch";
import { DemoTag, capacityWords } from "@/components/shell/capacities";
import { Link } from "@/i18n/navigation";
export const dynamic = "force-dynamic";
interface PageProps {
  params: Promise<{ locale: string }>;
}
export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  await requireSession(locale);
  const translate = await getTranslations({ locale });
  return {
    title: `${translate("Shell.chooseCompany")} · ${translate("Auth.brand")}`,
  };
}
export default async function CompaniesPage({
  params,
}: PageProps): Promise<ReactElement> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const session = await requireSession(locale);
  const translate = await getTranslations({ locale, namespace: "Shell" });
  return (
    <main
      id="main"
      tabIndex={-1}
      className="ms-auto me-auto max-w-3xl space-y-8 p-8"
    >
      <div className="flex justify-end">
        <LanguageSwitch href="/companies" />
      </div>
      <PageHeader
        title={translate("chooseCompany")}
        description={translate("chooseDescription")}
      />
      <ul className="space-y-4">
        {session.me.contexts.map((context) => (
          <li key={context.companyId} className="rounded-md border bg-card p-6">
            <Link
              href={`/companies/${context.companyId}/home`}
              className="block space-y-2"
            >
              <span className="text-h2">{context.companyName[locale]}</span>
              {context.isDemo && (
                <span className="ms-2">
                  <DemoTag locale={locale} />
                </span>
              )}
              <p className="text-body text-muted-foreground">
                {capacityWords(context, locale)}
              </p>
            </Link>
          </li>
        ))}
      </ul>
      {!session.me.contexts.length && <p>{translate("noCompanies")}</p>}
      <Link
        href="/setup/company"
        className="inline-flex min-h-8 items-center text-brand underline underline-offset-4"
      >
        {translate("newCompany")}
      </Link>
    </main>
  );
}
