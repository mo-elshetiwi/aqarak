import type { Metadata } from "next";
import type { ReactElement } from "react";
import { isLocale } from "@aqarak/i18n";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getApi } from "@/lib/api";
import { requireCompanyContext, requireSession } from "@/lib/session/session";
import { isSectionPermitted } from "@/lib/navigation/sections";
import { PageHeader } from "@/components/system/page-header";
import { NotPermittedState } from "@/components/system/screen-states";
import { CompanySettings } from "@/components/company/company-settings";
export const dynamic = "force-dynamic";
interface PageProps {
  params: Promise<{ locale: string; companyId: string }>;
}
export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale, companyId } = await params;
  if (!isLocale(locale)) notFound();
  const context = await requireCompanyContext(locale, companyId);
  const t = await getTranslations({ locale });
  const title = isSectionPermitted(context, "settings")
    ? t("Company.title")
    : `${t("Shell.notPermitted")} · ${t("Company.title")}`;
  return {
    title: `${title} · ${context.companyName[locale]} · ${t("Auth.brand")}`,
  };
}
export default async function SettingsPage({
  params,
}: PageProps): Promise<ReactElement> {
  const { locale, companyId } = await params;
  if (!isLocale(locale)) notFound();
  const context = await requireCompanyContext(locale, companyId);
  if (!isSectionPermitted(context, "settings")) {
    const t = await getTranslations({ locale, namespace: "Shell" });
    return (
      <>
        <PageHeader title={t("notPermitted")} />
        <NotPermittedState />
      </>
    );
  }
  const session = await requireSession(locale);
  const result = await getApi()
    .getCompany(session.sessionId, companyId)
    .catch(() => null);
  if (result && !result.ok && result.error.code === "FORBIDDEN") {
    const t = await getTranslations({ locale, namespace: "Company" });
    return (
      <>
        <PageHeader title={t("title")} />
        <NotPermittedState />
      </>
    );
  }
  return <CompanySettings company={result?.ok ? result.value.company : null} />;
}
